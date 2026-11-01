/**
 * OLM install planning: one implementation for every install path.
 *
 * A namespace may hold exactly one OperatorGroup. Creating a second one —
 * which the catalog did on every install into a namespace that already had
 * one — makes OLM refuse every CSV there with TooManyOperatorGroups. The
 * OperatorGroup also decides the install mode (which namespaces the operator
 * watches), and an operator only runs in the modes its CSV supports.
 */
import { k8sCreate, k8sList, k8sPatch } from './query';
import { PulseError } from './errors';

export type InstallModeType = 'OwnNamespace' | 'SingleNamespace' | 'MultiNamespace' | 'AllNamespaces';
export type ApprovalStrategy = 'Automatic' | 'Manual';

export interface InstallMode { type: string; supported: boolean }

export interface OperatorGroup {
  metadata: { name: string; namespace?: string };
  spec?: { targetNamespaces?: string[]; selector?: unknown; upgradeStrategy?: unknown };
  status?: { namespaces?: string[] };
}

/** Namespaces with a cluster-wide OperatorGroup out of the box. */
export const GLOBAL_OPERATOR_NAMESPACES = ['openshift-operators'];

/** The install modes this channel's CSV supports that this UI can set up (Multi is excluded: it needs a namespace list). */
export function supportedInstallModes(modes: InstallMode[] | undefined): Array<'OwnNamespace' | 'SingleNamespace' | 'AllNamespaces'> {
  const ok = new Set((modes ?? []).filter((m) => m.supported).map((m) => m.type));
  return (['AllNamespaces', 'OwnNamespace', 'SingleNamespace'] as const).filter((t) => ok.has(t));
}

/** The mode a fresh install should default to: AllNamespaces when supported, else OwnNamespace. */
export function defaultInstallMode(modes: InstallMode[] | undefined): 'OwnNamespace' | 'SingleNamespace' | 'AllNamespaces' | null {
  const supported = supportedInstallModes(modes);
  return supported[0] ?? null;
}

/** What an existing OperatorGroup makes the operator watch. */
export function operatorGroupMode(og: OperatorGroup, ns: string): InstallModeType {
  const targets = og.spec?.targetNamespaces;
  if (og.spec?.selector) return 'MultiNamespace';
  if (!targets || targets.length === 0) return 'AllNamespaces';
  if (targets.length === 1) return targets[0] === ns ? 'OwnNamespace' : 'SingleNamespace';
  return 'MultiNamespace';
}

export type OperatorGroupPlan =
  | { action: 'reuse'; name: string; mode: InstallModeType }
  | { action: 'create'; body: OperatorGroup & { apiVersion: string; kind: string }; mode: InstallModeType }
  | { action: 'refuse'; reason: string };

/**
 * Decide what to do about the OperatorGroup in `ns` for an operator that
 * should run in `mode` (watching `targetNamespace` for SingleNamespace).
 */
export function planOperatorGroup(opts: {
  packageName: string;
  ns: string;
  mode: 'OwnNamespace' | 'SingleNamespace' | 'AllNamespaces';
  targetNamespace?: string;
  existing: OperatorGroup[];
  supportedModes: InstallMode[] | undefined;
}): OperatorGroupPlan {
  const { packageName, ns, mode, existing } = opts;
  const supported = supportedInstallModes(opts.supportedModes);
  if (existing.length > 1) {
    return { action: 'refuse', reason: `${ns} already has ${existing.length} OperatorGroups (${existing.map((o) => o.metadata.name).join(', ')}). OLM refuses to install into a namespace with more than one; remove the extra one first.` };
  }
  if (existing.length === 1) {
    const og = existing[0];
    const ogMode = operatorGroupMode(og, ns);
    if (!(supported as string[]).includes(ogMode)) {
      return { action: 'refuse', reason: `${ns} has OperatorGroup ${og.metadata.name}, which installs operators in ${ogMode} mode. This operator supports ${supported.join(', ') || 'no install mode this UI can set up'}. Choose another namespace.` };
    }
    return { action: 'reuse', name: og.metadata.name, mode: ogMode };
  }
  if (!(supported as string[]).includes(mode)) {
    return { action: 'refuse', reason: `This operator does not support ${mode} installs (supported: ${supported.join(', ') || 'none'}).` };
  }
  const targets = mode === 'AllNamespaces' ? undefined : [mode === 'SingleNamespace' ? (opts.targetNamespace || ns) : ns];
  return {
    action: 'create',
    mode,
    body: {
      apiVersion: 'operators.coreos.com/v1',
      kind: 'OperatorGroup',
      metadata: { name: `${packageName}-group`, namespace: ns },
      spec: targets ? { targetNamespaces: targets } : {},
    },
  };
}

export function subscriptionBody(opts: {
  packageName: string; ns: string; channel: string; source: string; sourceNamespace: string; approval: ApprovalStrategy; startingCSV?: string;
}) {
  return {
    apiVersion: 'operators.coreos.com/v1alpha1',
    kind: 'Subscription',
    metadata: { name: opts.packageName, namespace: opts.ns },
    spec: {
      channel: opts.channel,
      name: opts.packageName,
      source: opts.source,
      sourceNamespace: opts.sourceNamespace,
      installPlanApproval: opts.approval,
      ...(opts.startingCSV ? { startingCSV: opts.startingCSV } : {}),
    },
  };
}

export interface InstallOperatorOptions {
  packageName: string;
  channel: string;
  source: string;
  sourceNamespace: string;
  targetNamespace: string;
  installModes?: InstallMode[];
  mode?: 'OwnNamespace' | 'SingleNamespace' | 'AllNamespaces';
  /** For SingleNamespace: the namespace the operator should watch. */
  watchNamespace?: string;
  approval?: ApprovalStrategy;
}

function isConflict(e: unknown): boolean {
  return e instanceof PulseError && e.statusCode === 409;
}

/**
 * Create the namespace (if missing), reuse or create its OperatorGroup, and
 * create the Subscription. Throws with a reason instead of creating a second
 * OperatorGroup or one in a mode the operator does not support.
 */
export async function installOperator(clusterId: string, opts: InstallOperatorOptions): Promise<{ operatorGroup: OperatorGroupPlan }> {
  const ns = opts.targetNamespace;
  const mode = opts.mode ?? (GLOBAL_OPERATOR_NAMESPACES.includes(ns) ? 'AllNamespaces' : defaultInstallMode(opts.installModes) ?? 'OwnNamespace');

  if (!GLOBAL_OPERATOR_NAMESPACES.includes(ns)) {
    try {
      await k8sCreate('/api/v1/namespaces', { apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns } }, clusterId);
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
  }

  const existing = await k8sList<OperatorGroup>(`/apis/operators.coreos.com/v1/namespaces/${ns}/operatorgroups`, undefined, clusterId);
  const plan = planOperatorGroup({
    packageName: opts.packageName,
    ns,
    mode,
    targetNamespace: opts.watchNamespace,
    existing,
    // An operator with no installModes in its manifest is installed where the user asked.
    supportedModes: opts.installModes ?? [{ type: mode, supported: true }],
  });
  if (plan.action === 'refuse') throw new Error(plan.reason);
  if (plan.action === 'create') {
    await k8sCreate(`/apis/operators.coreos.com/v1/namespaces/${ns}/operatorgroups`, plan.body, clusterId);
  }

  await k8sCreate(`/apis/operators.coreos.com/v1alpha1/namespaces/${ns}/subscriptions`, subscriptionBody({
    packageName: opts.packageName,
    ns,
    channel: opts.channel,
    source: opts.source,
    sourceNamespace: opts.sourceNamespace,
    approval: opts.approval ?? 'Automatic',
  }), clusterId);

  return { operatorGroup: plan };
}

// ---- Installed operators ----

export interface SubscriptionLike {
  metadata: { name: string; namespace: string; resourceVersion?: string };
  spec?: { channel?: string; installPlanApproval?: string; name?: string };
  status?: { installedCSV?: string; currentCSV?: string; state?: string; installPlanRef?: { name?: string } };
}

export interface InstallPlanLike {
  metadata: { name: string; namespace: string; resourceVersion?: string };
  spec?: { approved?: boolean; approval?: string; clusterServiceVersionNames?: string[] };
  status?: { phase?: string };
}

/** An upgrade is waiting when OLM resolved a newer CSV than the one installed. */
export function upgradeAvailable(sub: SubscriptionLike | null | undefined): string | null {
  if (!sub?.status) return null;
  const { currentCSV, installedCSV, state } = sub.status;
  if (currentCSV && installedCSV && currentCSV !== installedCSV) return currentCSV;
  if (state === 'UpgradePending' && currentCSV) return currentCSV;
  return null;
}

export function needsApproval(plan: InstallPlanLike | null | undefined): boolean {
  return !!plan && plan.spec?.approved === false && (plan.status?.phase === 'RequiresApproval' || plan.spec?.approval === 'Manual');
}

export function subscriptionPath(sub: SubscriptionLike): string {
  return `/apis/operators.coreos.com/v1alpha1/namespaces/${sub.metadata.namespace}/subscriptions/${sub.metadata.name}`;
}

export function installPlanPath(plan: InstallPlanLike): string {
  return `/apis/operators.coreos.com/v1alpha1/namespaces/${plan.metadata.namespace}/installplans/${plan.metadata.name}`;
}

const MERGE = 'application/merge-patch+json';

export function patchSubscription(clusterId: string, sub: SubscriptionLike, spec: { channel?: string; installPlanApproval?: ApprovalStrategy }) {
  return k8sPatch(subscriptionPath(sub), { spec }, MERGE, clusterId);
}

export function approveInstallPlan(clusterId: string, plan: InstallPlanLike) {
  return k8sPatch(installPlanPath(plan), { spec: { approved: true } }, MERGE, clusterId);
}
