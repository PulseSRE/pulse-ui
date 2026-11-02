import React from 'react';
import {
  Settings, Shield, Puzzle,
  CheckCircle, XCircle, RefreshCw,
  AlertTriangle, GitBranch, Server, HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sPatch } from '../../engine/query';
import type { K8sResource } from '../../engine/renderers';
import { resourceDetailUrl } from '../../engine/gvr';
import type { ClusterVersion, ClusterOperator, Node, Deployment, Condition, MachineConfigPool, Pod } from '../../engine/types';
import { useUIStore } from '../../store/uiStore';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { Panel } from '../../components/primitives/Panel';
import { UpgradeProgressPanel } from './UpgradeProgressPanel';
import { UpgradeGraph } from '../../components/updates/UpgradeGraph';
import { buildUpgradeModel, channelOptions, desiredUpdatePatch, type UpgradeTarget } from '../../engine/upgradeGraph';
import { showErrorToast } from '../../engine/errorToast';
import { getActiveClusterId } from '../../engine/clusterConnection';
import { assertActiveCluster } from '../../engine/pendingCluster';
import { isPlatformNamespace } from '../../engine/platformNamespaces';
import { useCanI } from '../../hooks/useCanI';
import { MachineConfigPoolPauseButton, isMcpPaused } from '../../components/MachineConfigPoolPauseButton';
import { errorReason } from '../../engine/readResult';
import { RemovedApisPanel, AdminGateActions, useApiRemovalReads, VERDICT_LABEL } from './RemovedApisPanel';
import { computeApiRemovalVerdict, parseMinor, targetMinorOptions, targetMinorLabel, currentClusterVersion, type ApiRemovalVerdict } from '../../engine/upgradeApiRemovals';

/** PDB resource */
interface PodDisruptionBudget extends K8sResource {
  spec?: {
    selector?: { matchLabels?: Record<string, string> };
    [key: string]: unknown;
  };
  status?: {
    disruptionsAllowed?: number;
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

export interface UpdatesTabProps {
  clusterVersion: ClusterVersion | null | undefined;
  cvVersion: string;
  cvChannel: string;
  platform: string;
  availableUpdates: AvailableUpdate[];
  isUpdating: boolean;
  operators: ClusterOperator[];
  nodes: Node[];
  deployments: Deployment[];
  pdbs: PodDisruptionBudget[];
  /** PodDisruptionBudgets or Deployments could not be read: the PDB check is unknown. */
  pdbCheckError?: unknown;
  /** PDBs or Deployments are still loading: the PDB check is unknown, not a pass. */
  pdbCheckLoading?: boolean;
  /** Nodes could not be read: "All nodes ready" is unknown, not "0/0 ready". */
  nodesError?: unknown;
  nodesLoading?: boolean;
  /** ClusterOperators could not be read: "No degraded operators" is unknown. */
  operatorsError?: unknown;
  operatorsLoading?: boolean;
  etcdBackupExists: boolean | undefined;
  /** Backups could not be read (403/500): the backup check is unknown, not "none configured". */
  etcdBackupError?: unknown;
  isHyperShift: boolean;
  machineConfigPools: MachineConfigPool[];
  pods: Pod[];
  go: (path: string, title: string) => void;
}

export function UpdatesTab({
  clusterVersion, cvVersion, cvChannel, platform,
  availableUpdates, isUpdating,
  operators, nodes, deployments, pdbs, pdbCheckError, pdbCheckLoading,
  nodesError, nodesLoading, operatorsError, operatorsLoading,
  etcdBackupExists, etcdBackupError, isHyperShift,
  machineConfigPools, pods, go,
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
    variant: 'danger' | 'warning'; onConfirm: () => void; warning?: React.ReactNode;
  } | null>(null);
  // A conditional target is confirmed only after its risks are explicitly accepted.
  const [riskDialog, setRiskDialog] = React.useState<{ target: UpgradeTarget; clusterId: string } | null>(null);
  const [risksAccepted, setRisksAccepted] = React.useState(false);

  // Removed-API go/no-go for the next minor (or a picked target).
  const removal = useApiRemovalReads();
  const removalOptions = React.useMemo(() => targetMinorOptions(clusterVersion), [clusterVersion]);
  const [pickedRemovalTarget, setPickedRemovalTarget] = React.useState<string | undefined>();
  const removalTarget = pickedRemovalTarget && removalOptions.includes(pickedRemovalTarget) ? pickedRemovalTarget : removalOptions[0];
  const verdictFor = React.useCallback((targetVersion?: string): ApiRemovalVerdict | null => (
    removal.reads ? computeApiRemovalVerdict({ clusterVersion, ...removal.reads, targetVersion }) : null
  ), [removal.reads, clusterVersion]);
  const removalVerdict = React.useMemo(() => verdictFor(removalTarget), [verdictFor, removalTarget]);
  // Gates evaluated on the current minor are what an Upgradeable=False admin-ack condition is about.
  const nextMinorVerdict = React.useMemo(() => verdictFor(undefined), [verdictFor]);
  const pendingCurrentGates = (nextMinorVerdict?.gates ?? []).filter((g) => g.acknowledged === false);

  /** For a minor update: a warning when the removed-API check is not a go. Patch updates get none. */
  const removalWarningFor = (version: string): React.ReactNode => {
    const cur = parseMinor(currentClusterVersion(clusterVersion));
    const tgt = parseMinor(version);
    if (!cur || !tgt || tgt.major !== cur.major || tgt.minor <= cur.minor) return null;
    const v = verdictFor(version);
    if (v?.status === 'go') return null;
    return (
      <div role="note" data-testid="removed-apis-update-warning" className={cn('rounded-sm border px-3 py-2 text-xs', v?.status === 'no_go' ? 'border-red-900 bg-red-950/30 text-red-200' : 'border-slate-700 bg-slate-900/60 text-slate-300')}>
        <span className="font-medium">Removed APIs: {v ? VERDICT_LABEL[v.status] : 'Checking\u2026'}.</span>{' '}
        {v ? v.reason : 'The removed-API check has not finished.'}{v?.status === 'no_go' ? ' You can still update; see the Removed APIs panel for the callers.' : ''}
      </div>
    );
  };

  const model = React.useMemo(() => buildUpgradeModel({
    clusterVersion,
    availableUpdates,
    fallbackVersion: cvVersion,
    operators,
    pools: machineConfigPools,
  }), [clusterVersion, availableUpdates, cvVersion, operators, machineConfigPools]);

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
      warning: removalWarningFor(version),
      onConfirm: () => {
        setConfirmDialog(null);
        void applyUpdate({ version, image, state: 'recommended', risks: [] }, clusterId);
      },
    });
  };

  const handleSelectUpdate = (target: UpgradeTarget) => {
    const clusterId = getActiveClusterId();
    if (target.state === 'conditional') {
      setRisksAccepted(false);
      setRiskDialog({ target, clusterId });
      return;
    }
    handleStartUpdate(target.version, target.image);
  };

  const handleChangeChannel = async () => {
    if (!channelEdit) return;
    try {
      assertActiveCluster(channelClusterId, 'The channel change');
      await k8sPatch(CV_PATH, {
        spec: { channel: channelEdit },
      }, 'application/merge-patch+json', channelClusterId);
      addToast({ type: 'success', title: 'Channel updated', detail: channelEdit });
      setShowChannelEdit(false);
      invalidate();
    } catch (err) {
      showErrorToast(err, 'Channel update failed');
    }
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

      {/* Removed APIs still in use and admin gates, before the update action */}
      <RemovedApisPanel
        verdict={removalVerdict}
        targetOptions={removalOptions}
        selectedTarget={removalTarget}
        onTargetChange={setPickedRemovalTarget}
        targetLabel={(m) => targetMinorLabel(clusterVersion, m)}
        clusterId={removal.clusterId}
        onRetry={removal.refetchAll}
        onAcked={removal.refetchAcks}
        go={go}
      />

      {/* Update graph: installed path, targets, progress and history */}
      <Panel title={`Update Graph (${model.nodes.length} target${model.nodes.length === 1 ? '' : 's'})`} icon={<GitBranch className="w-4 h-4 text-blue-500" />}>
        <UpgradeGraph
          model={model}
          onUpdate={handleSelectUpdate}
          updateDisabledReason={updateDisabledReason}
          onNavigate={go}
          hiddenBlockerTypes={['upgradeable']}
          updatesUnknownReason={updatesUnknownReason}
          renderPoolAction={poolAction}
          updateWarning={(t) => removalWarningFor(t.version)}
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

      {/* Pre-update checklist */}
      {availableUpdates.length > 0 && (
        <Panel title="Pre-Update Checklist" icon={<Shield className="w-4 h-4 text-amber-500" />}>
          <div className="space-y-2">
            {(() => {
              const readyNodes = nodes.filter((n) => {
                const conds: Condition[] = n.status?.conditions || [];
                return conds.some((c) => c.type === 'Ready' && c.status === 'True');
              });
              const allNodesReady = readyNodes.length === nodes.length;
              const degradedOps = operators.filter((o) => (o.status?.conditions || []).some((c: Condition) => c.type === 'Degraded' && c.status === 'True'));
              const allOpsHealthy = degradedOps.length === 0;
              const channelStable = cvChannel?.includes('stable') || cvChannel?.includes('eus');

              // Real PDB check: user deployments with >1 replica that have PDBs
              const userDeploys = deployments.filter((d) => {
                return !isPlatformNamespace(d.metadata?.namespace) && (d.spec?.replicas ?? 0) > 1;
              });
              const pdbSelectors = pdbs.map((p) => p.spec?.selector?.matchLabels || {});
              const deploysWithPDB = userDeploys.filter((d) => {
                const podLabels = d.spec?.template?.metadata?.labels || {};
                return pdbSelectors.some((sel) => Object.entries(sel).every(([k, v]) => podLabels[k] === v));
              });
              const pdbCoverage = userDeploys.length === 0 || deploysWithPDB.length >= userDeploys.length * 0.5;

              // pass: true = ok, false = needs attention, null = could not check.
              const backupCheck: { pass: boolean | null; detail: string } = isHyperShift
                ? { pass: true, detail: 'Managed by hosting provider' }
                : etcdBackupError
                  ? { pass: null, detail: `Could not check: ${errorReason(etcdBackupError)}. Confirm a recent etcd backup exists before updating.` }
                  : etcdBackupExists === undefined
                    ? { pass: null, detail: 'Checking\u2026' }
                    : etcdBackupExists
                      ? { pass: true, detail: 'Backup schedule configured' }
                      : { pass: false, detail: 'No automated backup configured \u2014 take a manual backup: ssh to control plane \u2192 /usr/local/bin/cluster-backup.sh /home/core/backup' };
              const pdbCheck: { pass: boolean | null; detail: string } = pdbCheckError
                ? { pass: null, detail: `Could not check: ${errorReason(pdbCheckError)}` }
                : pdbCheckLoading
                  ? { pass: null, detail: 'Checking\u2026' }
                  : { pass: pdbCoverage, detail: userDeploys.length === 0 ? 'No multi-replica user deployments' : `${deploysWithPDB.length}/${userDeploys.length} multi-replica deployments have PDBs` };

              const removedApisCheck: { pass: boolean | null; detail: string } = !removalVerdict
                ? { pass: null, detail: 'Checking\u2026' }
                : removalVerdict.status === 'unknown'
                  ? { pass: null, detail: removalVerdict.reason }
                  : { pass: removalVerdict.status === 'go', detail: `${removalVerdict.target ? `${removalVerdict.target.ocp}: ` : ''}${removalVerdict.reason}` };

              const checks: Array<{ label: string; pass: boolean | null; detail: string }> = [
                nodesError
                  ? { label: 'All nodes ready', pass: null, detail: `Could not check: ${errorReason(nodesError)}` }
                  : nodesLoading
                    ? { label: 'All nodes ready', pass: null, detail: 'Checking\u2026' }
                    : { label: 'All nodes ready', pass: allNodesReady, detail: allNodesReady ? `${nodes.length}/${nodes.length} ready` : `${readyNodes.length}/${nodes.length} ready \u2014 fix unready nodes first` },
                operatorsError
                  ? { label: 'No degraded operators', pass: null, detail: `Could not check: ${errorReason(operatorsError)}` }
                  : operatorsLoading
                    ? { label: 'No degraded operators', pass: null, detail: 'Checking\u2026' }
                    : { label: 'No degraded operators', pass: allOpsHealthy, detail: allOpsHealthy ? `${operators.length} operators healthy` : `${degradedOps.length} degraded: ${degradedOps.slice(0, 3).map((o) => o.metadata.name).join(', ')}` },
                { label: 'Stable update channel', pass: channelStable, detail: channelStable ? `Channel: ${cvChannel}` : `Channel "${cvChannel}" \u2014 consider switching to stable for production` },
                { label: 'Etcd backup', ...backupCheck },
                { label: 'PodDisruptionBudgets', ...pdbCheck },
                { label: 'Removed APIs', ...removedApisCheck },
              ];

              return checks.map((check, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 px-2" data-testid={`precheck-${check.label}`} data-status={check.pass === null ? 'unknown' : check.pass ? 'pass' : 'warn'}>
                  {check.pass === null ? <HelpCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-label="Could not check" />
                    : check.pass ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
                  <div>
                    <span className="text-sm text-slate-200">{check.label}</span>
                    <div className="text-xs text-slate-500 mt-0.5">{check.detail}</div>
                  </div>
                </div>
              ));
            })()}
          </div>
        </Panel>
      )}

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
          {confirmDialog.warning && <div className="mt-3">{confirmDialog.warning}</div>}
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
          {removalWarningFor(riskDialog.target.version) && <div className="mt-3">{removalWarningFor(riskDialog.target.version)}</div>}
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
