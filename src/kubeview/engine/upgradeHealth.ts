/**
 * Pure, unit-testable logic for OpenShift cluster-update progress and
 * blocker detection. Every function here takes already-fetched API objects
 * (ClusterVersion, MachineConfigPool[], Node[], ClusterOperator[], PDBs,
 * Pods) as input and returns plain derived data — no JSX, no API calls, no
 * fabricated numbers. UI components in views/admin/ render this output.
 */

import type { ClusterVersion, ClusterOperator, MachineConfigPool, Node, Condition } from './types';

// ---- MachineConfigPool rollout progress ----

export interface MachineConfigPoolProgress {
  name: string;
  machineCount: number;
  updatedMachineCount: number;
  readyMachineCount: number;
  degradedMachineCount: number;
  unavailableMachineCount: number;
  isUpdating: boolean;
  isDegraded: boolean;
  isUpdated: boolean;
  /** Real message/reason from the Degraded (or RenderDegraded) condition, when degraded. */
  degradedMessage: string | undefined;
  configuration: string;
}

export function getMachineConfigPoolProgress(pool: MachineConfigPool): MachineConfigPoolProgress {
  const conditions: Condition[] = pool.status?.conditions || [];
  const updated = conditions.find((c) => c.type === 'Updated');
  const updating = conditions.find((c) => c.type === 'Updating');
  const degraded = conditions.find((c) => c.type === 'Degraded');
  const renderDegraded = conditions.find((c) => c.type === 'RenderDegraded');
  const isDegraded = degraded?.status === 'True' || renderDegraded?.status === 'True';

  return {
    name: pool.metadata.name,
    machineCount: pool.status?.machineCount ?? 0,
    updatedMachineCount: pool.status?.updatedMachineCount ?? 0,
    readyMachineCount: pool.status?.readyMachineCount ?? 0,
    degradedMachineCount: pool.status?.degradedMachineCount ?? 0,
    unavailableMachineCount: pool.status?.unavailableMachineCount ?? 0,
    isUpdating: updating?.status === 'True',
    isDegraded,
    isUpdated: updated?.status === 'True',
    degradedMessage: isDegraded
      ? ((degraded?.status === 'True' ? degraded?.message || degraded?.reason : undefined) ??
         (renderDegraded?.status === 'True' ? renderDegraded?.message || renderDegraded?.reason : undefined))
      : undefined,
    configuration: pool.status?.configuration?.name || pool.spec?.configuration?.name || '',
  };
}

export function summarizeMachineConfigPools(pools: MachineConfigPool[]): MachineConfigPoolProgress[] {
  return pools.map(getMachineConfigPoolProgress);
}

// ---- Per-node rollout status (cross-referenced from MCO annotations) ----

const MCO_STATE_ANNOTATION = 'machineconfiguration.openshift.io/state';
const MCO_DESIRED_CONFIG_ANNOTATION = 'machineconfiguration.openshift.io/desiredConfig';
const MCO_CURRENT_CONFIG_ANNOTATION = 'machineconfiguration.openshift.io/currentConfig';
const MCO_REASON_ANNOTATION = 'machineconfiguration.openshift.io/reason';

export interface NodeRolloutStatus {
  name: string;
  /** Raw value of the machineconfiguration.openshift.io/state annotation (e.g. Done, Working, Degraded). */
  mcoState: string;
  desiredConfig: string | undefined;
  currentConfig: string | undefined;
  /** desiredConfig and currentConfig annotations disagree — a config rollout is pending/in-flight for this node. */
  needsUpdate: boolean;
  ready: boolean;
  unschedulable: boolean;
  /** machineconfiguration.openshift.io/reason annotation — populated when MCO reports a specific failure. */
  reason: string | undefined;
}

export function getNodeRolloutStatus(node: Node): NodeRolloutStatus {
  const annotations = node.metadata.annotations || {};
  const desiredConfig = annotations[MCO_DESIRED_CONFIG_ANNOTATION];
  const currentConfig = annotations[MCO_CURRENT_CONFIG_ANNOTATION];
  const conditions: Condition[] = node.status?.conditions || [];
  const ready = conditions.some((c) => c.type === 'Ready' && c.status === 'True');

  return {
    name: node.metadata.name,
    mcoState: annotations[MCO_STATE_ANNOTATION] || 'Unknown',
    desiredConfig,
    currentConfig,
    needsUpdate: !!desiredConfig && !!currentConfig && desiredConfig !== currentConfig,
    ready,
    unschedulable: !!node.spec?.unschedulable,
    reason: annotations[MCO_REASON_ANNOTATION] || undefined,
  };
}

/** Nodes MCO is actively rolling a config change through (mid-drain/reboot/apply, or degraded). */
export function getNodesInRollout(nodes: Node[]): NodeRolloutStatus[] {
  return nodes
    .map(getNodeRolloutStatus)
    .filter((n) => n.needsUpdate || (n.mcoState !== 'Done' && n.mcoState !== 'Unknown'));
}

/** Nodes that can stall a drain indefinitely: cordoned/unschedulable or NotReady. */
export function getDrainBlockingNodes(nodes: Node[]): NodeRolloutStatus[] {
  return nodes.map(getNodeRolloutStatus).filter((n) => n.unschedulable || !n.ready);
}

// ---- PodDisruptionBudgets that could block node draining ----

export interface PdbLike {
  metadata: { name: string; namespace?: string; uid?: string };
  spec?: { selector?: { matchLabels?: Record<string, string> } };
  status?: { disruptionsAllowed?: number };
}

export interface PodLike {
  metadata: { name: string; namespace?: string; labels?: Record<string, string> };
  spec?: { nodeName?: string };
}

export interface BlockingPdb {
  name: string;
  namespace: string;
  disruptionsAllowed: number;
  /** Names of in-rollout nodes running a pod this PDB's selector covers. */
  blockedNodeNames: string[];
}

/**
 * PDBs with zero remaining disruptions allowed, where a pod they cover is
 * currently scheduled on a node that's mid-rollout — i.e. `oc adm drain`
 * would be refused for that pod today, which can stall the whole pool.
 * PDBs with an empty selector are skipped rather than guessed at, since an
 * empty matchLabels technically matches every pod and would produce noisy
 * false positives.
 */
export function getBlockingPdbs(pdbs: PdbLike[], pods: PodLike[], nodesInRollout: NodeRolloutStatus[]): BlockingPdb[] {
  const rolloutNodeNames = new Set(nodesInRollout.map((n) => n.name));
  if (rolloutNodeNames.size === 0) return [];

  const result: BlockingPdb[] = [];
  for (const pdb of pdbs) {
    const disruptionsAllowed = pdb.status?.disruptionsAllowed;
    if (disruptionsAllowed === undefined || disruptionsAllowed > 0) continue;

    const namespace = pdb.metadata.namespace || '';
    const selectorEntries = Object.entries(pdb.spec?.selector?.matchLabels || {});
    if (selectorEntries.length === 0) continue;

    const blockedNodeNames = new Set<string>();
    for (const pod of pods) {
      if ((pod.metadata.namespace || '') !== namespace) continue;
      const nodeName = pod.spec?.nodeName;
      if (!nodeName || !rolloutNodeNames.has(nodeName)) continue;
      const podLabels = pod.metadata.labels || {};
      const matchesSelector = selectorEntries.every(([key, value]) => podLabels[key] === value);
      if (matchesSelector) blockedNodeNames.add(nodeName);
    }

    if (blockedNodeNames.size > 0) {
      result.push({ name: pdb.metadata.name, namespace, disruptionsAllowed, blockedNodeNames: [...blockedNodeNames] });
    }
  }
  return result;
}

// ---- Stale/no-op desiredUpdate detection (read-path guard) ----

export interface DesiredUpdateMismatch {
  requestedVersion: string;
  requestedImage: string | undefined;
  actualVersion: string | undefined;
  actualImage: string | undefined;
  /** Which field CVO is treating as authoritative and ignoring the request for. */
  mismatchKind: 'image' | 'version';
  /** Minutes the Progressing condition has continuously reported False, when known. */
  minutesSinceProgressingStable: number | null;
}

/**
 * Detects the write-path bug class (fixed in UpdatesTab's own PATCH logic)
 * from the read side too, since spec.desiredUpdate can also be set directly
 * by other tooling (e.g. `oc adm upgrade`, GitOps, another admin) — this
 * repo's fix only guarantees *this UI* never sends a mismatched pair again.
 *
 * A mismatch alone isn't proof of a stuck update — right after a *good*
 * patch, CVO needs a brief moment to notice and flip Progressing=True. We
 * only flag it once the Progressing condition has been reporting False for
 * at least `graceMinutes`, using its real `lastTransitionTime` (not a
 * fabricated "request sent at" clock, which this API doesn't expose).
 */
export function detectDesiredUpdateMismatch(
  clusterVersion: ClusterVersion | null | undefined,
  options: { graceMinutes?: number; now?: number } = {},
): DesiredUpdateMismatch | null {
  const { graceMinutes = 2, now = Date.now() } = options;
  const desiredUpdate = clusterVersion?.spec?.desiredUpdate;
  if (!desiredUpdate?.version) return null;

  const conditions: Condition[] = clusterVersion?.status?.conditions || [];
  const progressing = conditions.find((c) => c.type === 'Progressing');
  if (progressing?.status === 'True') return null; // actively working toward it — not stuck

  const statusDesired = clusterVersion?.status?.desired;
  const imageMismatch = !!desiredUpdate.image && !!statusDesired?.image && desiredUpdate.image !== statusDesired.image;
  const versionMismatch = !imageMismatch && !!statusDesired?.version && desiredUpdate.version !== statusDesired.version;
  if (!imageMismatch && !versionMismatch) return null;

  const base: Omit<DesiredUpdateMismatch, 'minutesSinceProgressingStable'> = {
    requestedVersion: desiredUpdate.version,
    requestedImage: desiredUpdate.image,
    actualVersion: statusDesired?.version,
    actualImage: statusDesired?.image,
    mismatchKind: imageMismatch ? 'image' : 'version',
  };

  if (!progressing?.lastTransitionTime) {
    // No timestamp to apply a grace window against — trust the real mismatch as-is.
    return { ...base, minutesSinceProgressingStable: null };
  }

  const minutesSince = (now - new Date(progressing.lastTransitionTime).getTime()) / 60000;
  if (minutesSince < graceMinutes) return null;

  return { ...base, minutesSinceProgressingStable: Math.round(minutesSince) };
}

// ---- Upgradeable=False / admin-ack style blockers ----

export interface UpgradeableBlocker {
  message: string;
  reason: string | undefined;
  /** A literal `oc -n openshift-config patch configmap admin-acks ...` command, extracted verbatim from the real condition message when CVO includes one. Never fabricated. */
  adminAckCommand: string | null;
}

export function getUpgradeableBlocker(clusterVersion: ClusterVersion | null | undefined): UpgradeableBlocker | null {
  const conditions: Condition[] = clusterVersion?.status?.conditions || [];
  const upgradeable = conditions.find((c) => c.type === 'Upgradeable');
  if (!upgradeable || upgradeable.status !== 'False') return null;

  const message = upgradeable.message || 'Cluster reports Upgradeable=False with no message.';
  // CVO's Upgradeable=False message for admin-ack-gated boundaries (e.g. Kubernetes
  // API removals) typically embeds the exact unblock command. Extract it verbatim
  // rather than reconstructing the ConfigMap key ourselves — it's version- and
  // risk-specific and only the live condition text can be trusted for it.
  const commandMatch = message.match(/oc\s+-n\s+openshift-config\s+patch\s+configmap\s+admin-acks[^\n`]*/i);

  return {
    message,
    reason: upgradeable.reason,
    adminAckCommand: commandMatch ? commandMatch[0].trim() : null,
  };
}

// ---- Conditional update risks ----

export interface ConditionalUpdateRisk {
  version: string;
  image: string | undefined;
  riskName: string | undefined;
  message: string;
  url: string | undefined;
}

/** Flattens status.conditionalUpdates[].risks[] into a display-ready list, using each risk's real message/url verbatim. */
export function getConditionalUpdateRisks(clusterVersion: ClusterVersion | null | undefined): ConditionalUpdateRisk[] {
  const conditionalUpdates = clusterVersion?.status?.conditionalUpdates || [];
  const risks: ConditionalUpdateRisk[] = [];
  for (const cu of conditionalUpdates) {
    const version = cu.release?.version;
    if (!version) continue;
    for (const risk of cu.risks || []) {
      if (!risk.message) continue;
      risks.push({ version, image: cu.release?.image, riskName: risk.name, message: risk.message, url: risk.url });
    }
  }
  return risks;
}

// ---- Degraded operators (with real blocking message/reason) ----

export interface DegradedOperatorInfo {
  name: string;
  message: string | undefined;
  reason: string | undefined;
}

export function getDegradedOperators(operators: ClusterOperator[]): DegradedOperatorInfo[] {
  const result: DegradedOperatorInfo[] = [];
  for (const op of operators) {
    const degraded = (op.status?.conditions || []).find((c) => c.type === 'Degraded' && c.status === 'True');
    if (!degraded) continue;
    result.push({ name: op.metadata.name, message: degraded.message, reason: degraded.reason });
  }
  return result;
}

// ---- Evidence-based ETA ----

export interface UpgradeEtaEstimate {
  minutes: number;
  /** True when derived from observed MachineConfigPool rollout rate; false for the static node-count fallback guess. */
  isEvidenceBased: boolean;
  label: string;
}

/**
 * Estimates remaining upgrade time from the observed rollout rate
 * (minutes-per-node so far, from real MachineConfigPool counters and the
 * ClusterVersion Progressing condition's real lastTransitionTime) rather
 * than a flat per-node guess. Falls back to the original `nodes.length *
 * 10min` rough estimate — clearly labeled as such — when there isn't yet
 * enough real progress to extrapolate from.
 */
export function estimateUpgradeEta(params: {
  /** ClusterVersion's Progressing condition lastTransitionTime, only meaningful while Progressing=True. */
  progressingSince: string | undefined;
  pools: MachineConfigPoolProgress[];
  nodeCount: number;
  now?: number;
}): UpgradeEtaEstimate {
  const { progressingSince, pools, nodeCount, now = Date.now() } = params;
  const totalMachines = pools.reduce((sum, p) => sum + p.machineCount, 0);
  const totalUpdated = pools.reduce((sum, p) => sum + p.updatedMachineCount, 0);

  if (progressingSince && totalMachines > 0 && totalUpdated > 0 && totalUpdated < totalMachines) {
    const elapsedMinutes = (now - new Date(progressingSince).getTime()) / 60000;
    if (elapsedMinutes > 0) {
      const minutesPerNode = elapsedMinutes / totalUpdated;
      const remaining = totalMachines - totalUpdated;
      const minutes = Math.round(minutesPerNode * remaining);
      return {
        minutes,
        isEvidenceBased: true,
        label: `~${minutes} min remaining \u2014 based on ${totalUpdated}/${totalMachines} nodes updated over the last ${Math.round(elapsedMinutes)} min`,
      };
    }
  }

  const minutes = Math.max(30, nodeCount * 10);
  return {
    minutes,
    isEvidenceBased: false,
    label: `Rough estimate: ~${minutes} min (${nodeCount} nodes \u00d7 ~10min each) \u2014 no in-progress rollout data yet`,
  };
}
