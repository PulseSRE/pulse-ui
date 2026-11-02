import React from 'react';
import { Settings, GitBranch, Server, ArrowUpCircle, Puzzle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resourceDetailUrl } from '../../engine/gvr';
import { k8sPatch } from '../../engine/query';
import type { K8sResource } from '../../engine/renderers';
import type { ClusterVersion, ClusterOperator, Node, Condition, MachineConfigPool, Pod } from '../../engine/types';
import { useUIStore } from '../../store/uiStore';
import { useFleetStore } from '../../store/fleetStore';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { Panel } from '../../components/primitives/Panel';
import { UpgradeProgressPanel } from './UpgradeProgressPanel';
import { UpgradeGraph } from '../../components/updates/UpgradeGraph';
import { buildUpgradeModel, channelOptions, channelChangeImpact, desiredUpdatePatch, minorOf, type UpgradeTarget } from '../../engine/upgradeGraph';
import { showErrorToast } from '../../engine/errorToast';
import { getActiveClusterId } from '../../engine/clusterConnection';
import { assertActiveCluster } from '../../engine/pendingCluster';
import { useCanI } from '../../hooks/useCanI';
import { MachineConfigPoolPauseButton, isMcpPaused } from '../../components/MachineConfigPoolPauseButton';
import { askPulse } from '../../engine/askPulse';
import type { PdbLike } from '../../engine/upgradeHealth';
import { RemovedApisPanel, AdminGateActions, useApiRemovalReads } from './RemovedApisPanel';
import { computeApiRemovalVerdict, defaultTargetMinor, parseMinor, targetMinorOptions, targetMinorLabel, type ApiRemovalVerdict } from '../../engine/upgradeApiRemovals';
import {
  toLoadable, readinessVerdict, readinessText,
  checkRemovedApis, checkAdminAck, checkUpgradeable, checkDrainPdbs, checkCriticalAlerts, checkPendingCsrs,
  checkControlPlaneCerts, checkEtcdHealth, checkEtcdBackup, checkNodes, checkOperators, checkChannel,
  type FiringAlert, type Loadable, type ReadinessCheck,
} from '../../engine/upgradeReadiness';
import { useUpgradeReadinessReads } from './useUpgradeReadinessReads';
import { UpgradeReadinessPanel, type UpgradeReadinessPanelProps } from './UpgradeReadinessPanel';
import { TakeEtcdBackupAction, PauseWorkerPoolsButton } from './UpdateActions';

/** PDB resource */
interface PodDisruptionBudget extends K8sResource {
  spec?: {
    selector?: { matchLabels?: Record<string, string> };
    minAvailable?: number | string;
    maxUnavailable?: number | string;
    [key: string]: unknown;
  };
  status?: {
    disruptionsAllowed?: number;
    currentHealthy?: number;
    desiredHealthy?: number;
    [key: string]: unknown;
  };
}

/** Available update entry */
interface AvailableUpdate {
  version: string;
  image?: string;
  channels?: string[];
}

const CV_PATH = '/apis/config.openshift.io/v1/clusterversions/version';
const MERGE = 'application/merge-patch+json';

export interface UpdatesTabProps {
  clusterVersion: ClusterVersion | null | undefined;
  cvVersion: string;
  cvChannel: string;
  platform: string;
  availableUpdates: AvailableUpdate[];
  isUpdating: boolean;
  operators: ClusterOperator[];
  nodes: Node[];
  pdbs: PodDisruptionBudget[];
  /** PodDisruptionBudgets could not be read: the drain check is unknown. */
  pdbsError?: unknown;
  pdbsLoading?: boolean;
  /** Nodes could not be read: "nodes ready" is unknown, not "0/0 ready". */
  nodesError?: unknown;
  nodesLoading?: boolean;
  /** ClusterOperators could not be read: "operators healthy" is unknown. */
  operatorsError?: unknown;
  operatorsLoading?: boolean;
  isHyperShift: boolean;
  machineConfigPools: MachineConfigPool[];
  /** MachineConfigPools could not be read: every node is assumed to drain. */
  machineConfigPoolsError?: unknown;
  pods: Pod[];
  podsError?: unknown;
  podsLoading?: boolean;
  /** Firing alerts (Prometheus /api/v1/alerts); undefined while loading. */
  firingAlerts?: FiringAlert[];
  firingAlertsError?: unknown;
  /** ClusterVersion is still being read: checks that need it are "Checking…". */
  clusterVersionLoading?: boolean;
  /** When reads this tab gets from the page (alerts, PDBs) last answered, for "checked N ago". */
  readsUpdatedAt?: number[];
  go: (path: string, title: string) => void;
}

const isMinorBump = (from: string, to: string) => {
  const a = parseMinor(from);
  const b = parseMinor(to);
  return !!a && !!b && (b.major > a.major || (b.major === a.major && b.minor > a.minor));
};

const linkBtn = 'inline-flex items-center px-3 py-1.5 text-xs rounded-md border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 min-h-9';

export function UpdatesTab({
  clusterVersion, cvVersion, cvChannel, platform,
  availableUpdates, isUpdating,
  operators, nodes, pdbs, pdbsError, pdbsLoading,
  nodesError, nodesLoading, operatorsError, operatorsLoading,
  isHyperShift, machineConfigPools, machineConfigPoolsError,
  pods, podsError, podsLoading, firingAlerts, firingAlertsError, clusterVersionLoading, readsUpdatedAt, go,
}: UpdatesTabProps) {
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const { allowed: canPatchCv } = useCanI('patch', 'config.openshift.io', 'clusterversions');

  const [updating, setUpdating] = React.useState(false);
  const [channelEdit, setChannelEdit] = React.useState('');
  const [showChannelEdit, setShowChannelEdit] = React.useState(false);
  // The channel being edited belongs to the cluster that was active when the edit began.
  const [channelClusterId, setChannelClusterId] = React.useState(() => getActiveClusterId());

  const [confirmDialog, setConfirmDialog] = React.useState<{
    title: string; description: string; confirmLabel: string;
    variant: 'danger' | 'warning'; onConfirm: () => void;
    /** Update target whose open readiness blockers are listed; computed at render so a late result still appears. */
    warningVersion?: string;
    body?: React.ReactNode;
  } | null>(null);
  // A conditional target is confirmed only after its risks are explicitly accepted.
  const [riskDialog, setRiskDialog] = React.useState<{ target: UpgradeTarget; clusterId: string } | null>(null);
  const [risksAccepted, setRisksAccepted] = React.useState(false);

  const model = React.useMemo(() => buildUpgradeModel({
    clusterVersion,
    availableUpdates,
    fallbackVersion: cvVersion,
    operators,
    pools: machineConfigPools,
  }), [clusterVersion, availableUpdates, cvVersion, operators, machineConfigPools]);
  const fromVersion = model.updatesFrom || model.current.version || cvVersion;

  // The update target: picked here or on the graph; by default the newest recommended one.
  const [pickedVersion, setPickedVersion] = React.useState<string | undefined>();
  const selected = model.nodes.find((n) => n.version === pickedVersion)
    ?? model.nodes.find((n) => n.state === 'recommended')
    ?? model.nodes[0];

  // Removed-API go/no-go: for the picked target when it is a minor update; with
  // no target offered, for the next minor (or a minor picked in the panel).
  const removal = useApiRemovalReads();
  const removalOptions = React.useMemo(() => targetMinorOptions(clusterVersion), [clusterVersion]);
  const [pickedRemovalTarget, setPickedRemovalTarget] = React.useState<string | undefined>();
  const fallbackRemovalTarget = pickedRemovalTarget && removalOptions.includes(pickedRemovalTarget)
    ? pickedRemovalTarget
    : defaultTargetMinor(clusterVersion) ?? removalOptions[0];
  const removalTarget = selected ? (isMinorBump(fromVersion, selected.version) ? selected.version : null) : fallbackRemovalTarget ?? null;
  const verdictFor = React.useCallback((targetVersion?: string): ApiRemovalVerdict | null => (
    removal.reads ? computeApiRemovalVerdict({ clusterVersion, ...removal.reads, targetVersion }) : null
  ), [removal.reads, clusterVersion]);
  const removalVerdict = React.useMemo(() => (removalTarget ? verdictFor(removalTarget) : null), [verdictFor, removalTarget]);
  // Gates evaluated on the current minor are what an Upgradeable=False admin-ack condition is about.
  const nextMinorVerdict = React.useMemo(() => verdictFor(undefined), [verdictFor]);
  const pendingCurrentGates = (nextMinorVerdict?.gates ?? []).filter((g) => g.acknowledged === false);

  // --- Readiness ---
  const readiness = useUpgradeReadinessReads({ enabled: !isUpdating });
  const loadable = <T,>(data: T, error: unknown, loading?: boolean): Loadable<T> => toLoadable(data, error, !!loading);
  const nodesL = loadable(nodes, nodesError, nodesLoading);
  const opsL = loadable(operators, operatorsError, operatorsLoading);
  const pdbsL = loadable(pdbs as PdbLike[], pdbsError, pdbsLoading);
  const podsL = loadable(pods, podsError, podsLoading);
  const alertsL = toLoadable(firingAlerts, firingAlertsError, false);
  const pools = machineConfigPoolsError ? null : machineConfigPools;
  const checks: ReadinessCheck[] = [
    !selected && !removalTarget
      ? (clusterVersionLoading
        ? { id: 'removed-apis', label: 'Removed APIs in use', status: 'checking', detail: 'Checking\u2026' }
        : { id: 'removed-apis', label: 'Removed APIs in use', status: 'unknown', detail: 'Could not check: the current version or the target is unknown' }) as ReadinessCheck
      : checkRemovedApis(removal.reads, removalVerdict, removalTarget, selected?.version),
    ...(removalTarget ? [checkAdminAck(removal.reads, removalVerdict, clusterVersion), checkUpgradeable(clusterVersion, clusterVersionLoading)].filter((c): c is ReadinessCheck => !!c) : []),
    checkDrainPdbs(pdbsL, podsL, nodesL, pools),
    checkCriticalAlerts(alertsL),
    checkPendingCsrs(readiness.csrs),
    checkControlPlaneCerts(readiness.certs, isHyperShift),
    checkEtcdHealth(opsL, readiness.etcdPods, isHyperShift),
    checkEtcdBackup(readiness.backups, readiness.schedules, isHyperShift),
    checkNodes(nodesL),
    checkOperators(opsL),
    checkChannel(clusterVersion, clusterVersionLoading),
  ];
  const verdict = readinessVerdict(checks);
  const blockers = checks.filter((c) => c.status === 'blocker');
  const readinessTargetLabel = selected ? selected.version : removalTarget ? targetMinorLabel(clusterVersion, removalTarget) : null;

  const activeClusterId = useFleetStore((s) => s.activeClusterId);
  // Same reason the agent dock gives: the agent runs on the local cluster only.
  const askDisabledReason = activeClusterId !== 'local' ? 'This agent runs on Local Cluster. Remote resource-context actions are unavailable.' : undefined;
  const readTimes = [readiness.checkedAt ?? 0, removal.updatedAt, ...(readsUpdatedAt ?? [])];
  const checkedAt = readTimes.every((t) => t > 0) ? Math.min(...readTimes) : null;

  const recheck = () => {
    readiness.refetchAll();
    removal.refetchAll();
    for (const key of [['admin', 'firing-alerts'], ['k8s', 'list', '/apis/policy/v1/poddisruptionbudgets'], ['k8s', 'list', '/api/v1/pods']]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
  const askAboutReadiness = () => askPulse(
    `Help me decide whether to update this cluster from ${fromVersion || 'its current version'} to ${readinessTargetLabel || 'the next version'}, and how to fix what blocks it. Readiness result:\n${readinessText(readinessTargetLabel || 'the next version', verdict, checks)}`,
    { kind: 'ClusterVersion', name: 'version' },
  );

  // "Up to date" is only true when CVO actually retrieved the update graph.
  const retrievedUpdates = (clusterVersion?.status?.conditions as Condition[] | undefined)?.find((c) => c.type === 'RetrievedUpdates');
  const updatesUnknownReason = !clusterVersion
    ? 'ClusterVersion could not be read'
    : retrievedUpdates?.status === 'False'
      ? `The cluster could not retrieve available updates${retrievedUpdates.message ? `: ${retrievedUpdates.message}` : ''}`
      : undefined;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['k8s', 'list', '/apis/config.openshift.io/v1/clusterversions'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'clusterversion'] });
  };

  // Every update goes through here: pinned to the cluster it was requested on,
  // version and image always together, acceptRisks only for a conditional target.
  const applyUpdate = async (target: Pick<UpgradeTarget, 'version' | 'image' | 'state' | 'risks'>, clusterId: string) => {
    setUpdating(true);
    try {
      assertActiveCluster(clusterId, 'The cluster update');
      const patch = desiredUpdatePatch(target, clusterVersion?.spec?.desiredUpdate?.acceptRisks);
      const updated = await k8sPatch<ClusterVersion>(CV_PATH, patch, 'application/merge-patch+json', clusterId);
      let detail = `Updating to ${target.version}`;
      if (patch.spec.desiredUpdate.acceptRisks) {
        // Without the ClusterUpdateAcceptRisks gate the API drops the field; say which happened.
        const kept = new Set((updated?.spec?.desiredUpdate?.acceptRisks || []).map((r) => r.name));
        const recorded = target.risks.every((r) => kept.has(r.name));
        detail += recorded
          ? ` · accepted risks recorded in spec.desiredUpdate.acceptRisks`
          : ` · this cluster did not record acceptRisks (ClusterUpdateAcceptRisks feature gate is off)`;
      }
      addToast({ type: 'success', title: 'Cluster update started', detail });
      invalidate();
    } catch (err) {
      showErrorToast(err, 'Update failed');
    }
    setUpdating(false);
  };

  // Used by the stuck-update banner to re-send a recommended target.
  const handleStartUpdate = (version: string, image: string | undefined) => {
    const clusterId = getActiveClusterId();
    setConfirmDialog({
      title: `Start cluster update to ${version}?`,
      description: `This will rolling-restart all nodes in the cluster. The update process cannot be easily reversed. Make sure you have a recent etcd backup before proceeding.`,
      confirmLabel: 'Start Update',
      variant: 'warning',
      warningVersion: version,
      onConfirm: () => {
        setConfirmDialog(null);
        void applyUpdate({ version, image, state: 'recommended', risks: [] }, clusterId);
      },
    });
  };

  const handleSelectUpdate = (target: UpgradeTarget) => {
    const clusterId = getActiveClusterId();
    setPickedVersion(target.version);
    if (target.state === 'conditional') {
      setRisksAccepted(false);
      setRiskDialog({ target, clusterId });
      return;
    }
    handleStartUpdate(target.version, target.image);
  };

  const applyChannel = async (channel: string, clusterId: string) => {
    try {
      assertActiveCluster(clusterId, 'The channel change');
      await k8sPatch(CV_PATH, {
        spec: { channel },
      }, MERGE, clusterId);
      addToast({ type: 'success', title: 'Channel updated', detail: `${channel} · the update list changes once the cluster fetches the new channel's graph` });
      setShowChannelEdit(false);
      invalidate();
    } catch (err) {
      showErrorToast(err, 'Channel update failed');
    }
  };

  // Changing the channel changes which updates the cluster is offered, so it
  // asks first and says what it knows about the targets on screen now.
  const handleChangeChannel = () => {
    if (!channelEdit) return;
    if (channelEdit === cvChannel) { setShowChannelEdit(false); return; }
    const next = channelEdit;
    const clusterId = channelClusterId;
    const impact = channelChangeImpact(model.nodes, next);
    const list = (vs: string[]) => <span className="font-mono">{vs.join(', ')}</span>;
    // The installed release lists the channels it is in (status.desired.channels).
    // Unless the new channel is one of them, the cluster may be offered nothing
    // from it until its own version is in that channel, so "still offered" is
    // only said when the list includes it.
    const installedVersion = model.current.version || cvVersion;
    const installedInChannel = model.channels?.length ? model.channels.includes(next) : null;
    const installedNotInChannel = installedInChannel !== true;
    setConfirmDialog({
      title: `Change update channel from ${cvChannel || '(none)'} to ${next}?`,
      description: `The cluster will fetch the update graph for ${next}. The updates offered here will change once it has; nothing is installed by changing the channel.`,
      confirmLabel: 'Change channel',
      variant: 'warning',
      body: (
        <div className="mt-3 space-y-1 text-xs text-slate-300" data-testid="channel-change-impact">
          {installedNotInChannel && (
            <p role="alert" className="text-amber-300">
              {installedInChannel === false
                ? `The installed release${installedVersion ? ` (${installedVersion})` : ''} is not in ${next}.`
                : `The cluster's channel list does not show whether the installed release${installedVersion ? ` (${installedVersion})` : ''} is in ${next}.`}
              {' '}Updates may disappear until the cluster&apos;s version is in that channel.
            </p>
          )}
          {model.nodes.length === 0 ? (
            <p>No update is offered in {cvChannel || 'the current channel'} now. Updates in {next} appear after the cluster refreshes.</p>
          ) : (
            <>
              {impact.kept.length > 0 && (installedNotInChannel
                ? <p>Their release lists {next}, but they may not be offered: {list(impact.kept)}</p>
                : <p>Still offered (their release lists {next}): {list(impact.kept)}</p>)}
              {impact.dropped.length > 0 && <p className="text-amber-300">No longer offered (their release does not list {next}): {list(impact.dropped)}</p>}
              {impact.unknown.length > 0 && <p>Not known (the release metadata lists no channels): {list(impact.unknown)}</p>}
              <p className="text-slate-400">Updates only in {next} appear after the cluster refreshes.</p>
            </>
          )}
        </div>
      ),
      onConfirm: () => {
        setConfirmDialog(null);
        void applyChannel(next, clusterId);
      },
    });
  };

  // The pool row's action acts on the live (watched) pool, so its resourceVersion is current.
  const poolAction = (name: string) => {
    const mcp = machineConfigPools.find((p) => p.metadata.name === name);
    return mcp ? <MachineConfigPoolPauseButton mcp={mcp} variant="text" /> : null;
  };

  const updateDisabledReason = updating ? 'An update request is being sent.'
    : isUpdating ? 'An update is already in progress.'
    : !canPatchCv ? 'You do not have permission to patch the ClusterVersion.'
    : undefined;
  const startDisabledReason = !selected ? undefined
    : selected.state === 'blocked' ? `Blocked: minor-version updates are not allowed while the cluster reports Upgradeable=False.`
    : !selected.image ? 'The update service gave no release image for this version.'
    : updateDisabledReason;

  const pdbCheck = checks.find((c) => c.id === 'pdbs');
  const actions: UpgradeReadinessPanelProps['actions'] = {
    'admin-ack': removalVerdict?.gates.length
      ? <div className="basis-full"><AdminGateActions gates={removalVerdict.gates} clusterId={removal.clusterId} onAcked={removal.refetchAcks} /></div>
      : undefined,
    pdbs: pdbCheck?.blockingPdbs?.length
      ? <span className="flex flex-wrap gap-2">{pdbCheck.blockingPdbs.slice(0, 3).map((p) => (
          <button key={`${p.namespace}/${p.name}`} type="button" className={linkBtn}
            onClick={() => go(`/yaml/policy~v1~poddisruptionbudgets/${p.namespace}/${p.name}`, `${p.name} (YAML)`)}>
            Edit PDB{pdbCheck.blockingPdbs!.length > 1 ? ` ${p.namespace}/${p.name}` : ''}
          </button>
        ))}</span>
      : undefined,
    alerts: <button type="button" className={linkBtn} onClick={() => go('/alerts?severity=critical', 'Alerts')}>View critical alerts</button>,
    csrs: <button type="button" className={linkBtn} onClick={() => go('/admin?tab=csrs', 'Certificate requests')}>Certificate requests</button>,
    'cp-certs': isHyperShift ? undefined : <button type="button" className={linkBtn} onClick={() => go('/admin?tab=certificates&system=1', 'Certificates')}>Certificates</button>,
    'etcd-backup': !isHyperShift && readiness.backupApiServed
      ? <TakeEtcdBackupAction pvcs={readiness.pvcs} onDone={readiness.refetchBackups} />
      : undefined,
    nodes: <button type="button" className={linkBtn} onClick={() => go('/compute', 'Compute')}>Nodes</button>,
    operators: <button type="button" className={linkBtn} onClick={() => go('/admin?tab=operators', 'Platform operators')}>Platform operators</button>,
  };
  for (const c of checks) if (c.status === 'passed' && c.id !== 'admin-ack') delete actions[c.id];
  // A z-stream target removes no API; the next minor can still be checked ahead of a channel change.
  const nextMinorTarget = !removalTarget && selected ? fallbackRemovalTarget : undefined;
  const expansionVerdict = removalTarget ? removalVerdict : nextMinorTarget ? verdictFor(nextMinorTarget) : null;
  const expansionTarget = removalTarget ?? nextMinorTarget;
  const expansions: UpgradeReadinessPanelProps['expansions'] = expansionTarget && expansionVerdict ? {
    'removed-apis': {
      label: removalTarget ? 'See callers' : `Check ${minorOf(expansionTarget)} (next minor)`,
      content: (
        <RemovedApisPanel
          verdict={expansionVerdict}
          targetOptions={selected && removalTarget ? [] : removalOptions}
          selectedTarget={expansionTarget}
          onTargetChange={setPickedRemovalTarget}
          targetLabel={(m) => targetMinorLabel(clusterVersion, m)}
          clusterId={removal.clusterId}
          onRetry={removal.refetchAll}
          onAcked={removal.refetchAcks}
          go={go}
          hideGates={!!removalTarget}
        />
      ),
    },
  } : {};

  // The confirm lists the readiness blockers still open; the update stays the admin's call.
  const blockersNote = blockers.length > 0 ? (
    <div role="note" data-testid="start-update-blockers" className="mt-3 rounded-sm border border-red-900 bg-red-950/30 px-3 py-2 text-xs text-red-200">
      <div className="font-medium">{blockers.length} readiness blocker{blockers.length === 1 ? ' is' : 's are'} still open:</div>
      <ul className="mt-1 list-disc pl-4">{blockers.map((b) => <li key={b.id}>{b.label}: {b.detail}</li>)}</ul>
    </div>
  ) : null;

  const riskSentence = verdict.blockers > 0
    ? `The update is your call. With ${verdict.blockers} blocker${verdict.blockers === 1 ? '' : 's'} open (${blockers.map((b) => b.label.toLowerCase()).join(', ')}) it is likely to stall or break something.`
    : verdict.state === 'unknown' ? `${verdict.unknown} readiness check${verdict.unknown === 1 ? '' : 's'} could not be completed, so this update has not been shown to be safe.`
    : verdict.state === 'checking' ? 'Readiness is still being checked.'
    : 'Every readiness check passed.';

  return (
    <div className="space-y-6">
      {/* Stuck-update detection, Upgradeable=False acknowledgement, node rollout and drain blockers */}
      <UpgradeProgressPanel
        clusterVersion={clusterVersion}
        isUpdating={isUpdating}
        nodes={nodes}
        machineConfigPools={machineConfigPools}
        pdbs={pdbs}
        pods={pods}
        availableUpdates={availableUpdates}
        onReapplyUpdate={handleStartUpdate}
        go={go}
        adminAck={pendingCurrentGates.length > 0
          ? <AdminGateActions gates={pendingCurrentGates} clusterId={removal.clusterId} onAcked={removal.refetchAcks} />
          : undefined}
      />

      {!isUpdating && (
        <>
          <UpgradeReadinessPanel
            targetLabel={readinessTargetLabel}
            checks={checks}
            checkedAt={checkedAt}
            onRecheck={recheck}
            onAsk={askAboutReadiness}
            askDisabledReason={askDisabledReason}
            actions={actions}
            expansions={expansions}
          />

          {/* The update action, below the verdict: blockers do not disable it (the admin's call), they are stated. */}
          <section aria-labelledby="update-action-title" className="rounded-lg border border-slate-800 bg-slate-900 p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex-1 min-w-0 basis-96">
              <h2 id="update-action-title" className="text-base font-semibold text-slate-100">{selected ? `Update to ${selected.version}` : 'No update offered'}</h2>
              <p className="text-xs text-slate-300 mt-1" data-testid="update-action-risk">
                {selected ? riskSentence : updatesUnknownReason ? 'Which updates are offered is not known; see the update graph.' : `No update is offered on ${cvChannel || 'the current channel'}. To update to a new minor, change the channel below.`}
              </p>
            </div>
            {model.nodes.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-400">
                Target
                <select
                  aria-label="Update target"
                  value={selected?.version ?? ''}
                  onChange={(e) => setPickedVersion(e.target.value)}
                  className="px-2 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-slate-200 font-mono text-sm min-h-9"
                >
                  {model.nodes.map((n) => (
                    <option key={n.version} value={n.version}>
                      {n.version} ({n.state === 'recommended' ? 'recommended' : n.state === 'conditional' ? `conditional: ${n.risks.length} known risk${n.risks.length === 1 ? '' : 's'}` : 'blocked: Upgradeable=False'})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {!machineConfigPoolsError && <PauseWorkerPoolsButton pools={machineConfigPools} />}
              {selected && (
                <button
                  type="button"
                  onClick={() => handleSelectUpdate(selected)}
                  disabled={!!startDisabledReason}
                  title={startDisabledReason}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed min-h-10"
                >
                  <ArrowUpCircle className="w-4 h-4" aria-hidden="true" />Start update{'…'}
                </button>
              )}
            </div>
            {selected && startDisabledReason && <p className="basis-full text-xs text-slate-500">{startDisabledReason}</p>}
          </section>
        </>
      )}

      {/* Update graph: installed path, targets and progress */}
      <Panel title={`Update Graph (${model.nodes.length} target${model.nodes.length === 1 ? '' : 's'})`} icon={<GitBranch className="w-4 h-4 text-blue-500" />}>
        <UpgradeGraph
          model={model}
          onUpdate={handleSelectUpdate}
          updateDisabledReason={updateDisabledReason}
          onNavigate={go}
          hiddenBlockerTypes={['upgradeable']}
          updatesUnknownReason={updatesUnknownReason}
          renderPoolAction={poolAction}
        />
      </Panel>

      {/* Between updates the progress rows are not shown: pools are listed here so one can be paused before an update starts. */}
      {model.progress.phase === 'idle' && machineConfigPools.length > 0 && (
        <Panel title={`MachineConfigPools (${machineConfigPools.length})`} icon={<Server className="w-4 h-4 text-slate-400" />}>
          <ul className="divide-y divide-slate-800" aria-label="MachineConfigPools">
            {machineConfigPools.map((mcp) => {
              const st = mcp.status || {};
              return (
                <li key={mcp.metadata.name} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="flex items-center gap-2">
                    <button type="button" onClick={() => go(`/r/machineconfiguration.openshift.io~v1~machineconfigpools/_/${mcp.metadata.name}`, mcp.metadata.name)} className="font-mono text-blue-400 hover:text-blue-300 hover:underline">{mcp.metadata.name}</button>
                    {isMcpPaused(mcp) && <span className="px-1.5 py-0.5 bg-amber-900/50 text-amber-300 rounded-sm">Paused</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-slate-400">{st.updatedMachineCount ?? 0}/{st.machineCount ?? 0} nodes updated</span>
                    {poolAction(mcp.metadata.name)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {/* Current version + channel */}
      <Panel title="Current Version" icon={<Settings className="w-4 h-4 text-slate-400" />}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Version</span>
            <span className="text-sm font-mono text-slate-200">{cvVersion || '\u2014'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Channel</span>
            {showChannelEdit ? (
              <div className="flex items-center gap-2">
                <select aria-label="Update channel" value={channelEdit} onChange={(e) => setChannelEdit(e.target.value)} className="px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded-sm text-slate-200 w-48" autoFocus>
                  {channelOptions(model.current.version || cvVersion, cvChannel, model.channels).map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                </select>
                <button onClick={handleChangeChannel} className="px-2 py-1 text-xs bg-blue-600 text-white rounded-sm hover:bg-blue-500">Save</button>
                <button onClick={() => setShowChannelEdit(false)} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-slate-200">{cvChannel || '\u2014'}</span>
                {canPatchCv && (
                  <button onClick={() => { setChannelEdit(cvChannel); setChannelClusterId(getActiveClusterId()); setShowChannelEdit(true); }} className="text-xs text-blue-400 hover:text-blue-300">Change</button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Cluster ID</span>
            <span className="text-xs font-mono text-slate-500">{clusterVersion?.spec?.clusterID || '\u2014'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Platform</span>
            <span className="text-xs font-mono text-slate-500">{platform || '\u2014'}</span>
          </div>
        </div>
      </Panel>

      {/* Operator update status (during upgrade) */}
      {isUpdating && (
        <Panel title="Operator Update Progress" icon={<Puzzle className="w-4 h-4 text-violet-500" />}>
          <div className="space-y-1 max-h-64 overflow-auto">
            {operators.map((op) => {
              const conds: Condition[] = op.status?.conditions || [];
              const progressing = conds.find((c) => c.type === 'Progressing');
              const degraded = conds.find((c) => c.type === 'Degraded');
              const isProgressing = progressing?.status === 'True';
              const isDegraded = degraded?.status === 'True';
              const version = op.status?.versions?.find((v) => v.name === 'operator')?.version || '';
              // Surface *why* — the actual blocking condition message/reason, not just a badge.
              const detailMessage = isDegraded ? (degraded?.message || degraded?.reason)
                : isProgressing ? (progressing?.message || progressing?.reason)
                : '';
              return (
                <button
                  key={op.metadata.uid}
                  onClick={() => go(resourceDetailUrl({ apiVersion: 'config.openshift.io/v1', kind: 'ClusterOperator', metadata: { name: op.metadata.name } }), op.metadata.name)}
                  className="w-full flex items-start justify-between gap-2 py-1.5 px-2 hover:bg-slate-800/30 rounded-sm text-left transition-colors"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {isDegraded ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" /> :
                     isProgressing ? <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0 mt-0.5" /> :
                     <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <span className="text-sm text-slate-200">{op.metadata.name}</span>
                      {detailMessage && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{detailMessage}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {version && <span className="text-xs font-mono text-slate-500">{version}</span>}
                    <span className={cn('text-xs px-1.5 py-0.5 rounded-sm',
                      isDegraded ? 'bg-red-900/50 text-red-300' :
                      isProgressing ? 'bg-blue-900/50 text-blue-300' :
                      'bg-green-900/50 text-green-300'
                    )}>
                      {isDegraded ? 'Degraded' : isProgressing ? 'Updating' : 'Ready'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {confirmDialog && (
        <ConfirmDialog
          open={true}
          onClose={() => setConfirmDialog(null)}
          onConfirm={confirmDialog.onConfirm}
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          variant={confirmDialog.variant}
        >
          {confirmDialog.body}
          {/* Readiness is judged for the picked target; another target's confirm does not borrow its blockers. */}
          {confirmDialog.warningVersion && confirmDialog.warningVersion === selected?.version && blockersNote}
        </ConfirmDialog>
      )}

      {riskDialog && (
        <ConfirmDialog
          open={true}
          onClose={() => setRiskDialog(null)}
          onConfirm={() => {
            const { target, clusterId } = riskDialog;
            setRiskDialog(null);
            void applyUpdate(target, clusterId);
          }}
          title={`Accept ${riskDialog.target.risks.length} risk${riskDialog.target.risks.length === 1 ? '' : 's'} and update to ${riskDialog.target.version}?`}
          description={`${riskDialog.target.version} is not recommended for this cluster. The update rolling-restarts every node and cannot easily be reversed. The accepted risks are sent as spec.desiredUpdate.acceptRisks, which is recorded only where the ClusterUpdateAcceptRisks feature gate is enabled.`}
          confirmLabel="Accept risks and update"
          variant="danger"
          confirmDisabled={!risksAccepted}
        >
          {riskDialog.target.version === selected?.version && blockersNote}
          <ul className="mt-3 space-y-1.5 max-h-48 overflow-auto" aria-label="Risks to accept">
            {riskDialog.target.risks.map((r) => (
              <li key={r.name} className="text-xs rounded-sm bg-slate-900/60 border border-slate-700 p-2">
                <span className="font-medium text-amber-300">{r.name}</span>
                {r.message && <span className="block text-slate-400 mt-0.5 whitespace-pre-wrap">{r.message}</span>}
                {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300">{r.url}</a>}
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-start gap-2 text-xs text-slate-200">
            <input type="checkbox" checked={risksAccepted} onChange={(e) => setRisksAccepted(e.target.checked)} className="mt-0.5" />
            I have read these risks and accept them for this cluster.
          </label>
        </ConfirmDialog>
      )}

    </div>
  );
}
