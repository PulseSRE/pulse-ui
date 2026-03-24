import React from 'react';
import {
  Settings, Shield, Puzzle,
  CheckCircle, XCircle, RefreshCw, Loader2,
  ArrowUpCircle, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sPatch } from '../../engine/query';
import type { K8sResource } from '../../engine/renderers';
import type { ClusterVersion, ClusterOperator, Node, Deployment, Condition } from '../../engine/types';
import { useUIStore } from '../../store/uiStore';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { Panel } from '../../components/primitives/Panel';
import { SnapshotsTab } from './SnapshotsTab';

/** PDB resource */
interface PodDisruptionBudget extends K8sResource {
  spec?: {
    selector?: { matchLabels?: Record<string, string> };
    [key: string]: unknown;
  };
}

/** Available update entry */
interface AvailableUpdate {
  version: string;
  image?: string;
  risks?: Array<{ name?: string; message?: string }>;
}

export interface UpdatesTabProps {
  clusterVersion: ClusterVersion | null | undefined;
  cvVersion: string;
  cvChannel: string;
  platform: string;
  availableUpdates: AvailableUpdate[];
  isUpdating: boolean;
  operators: K8sResource[];
  nodes: K8sResource[];
  deployments: K8sResource[];
  pdbs: K8sResource[];
  etcdBackupExists: boolean | undefined;
  isHyperShift: boolean;
}

export function UpdatesTab({
  clusterVersion, cvVersion, cvChannel, platform,
  availableUpdates, isUpdating,
  operators, nodes, deployments, pdbs,
  etcdBackupExists, isHyperShift,
}: UpdatesTabProps) {
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const [updating, setUpdating] = React.useState(false);
  const [channelEdit, setChannelEdit] = React.useState('');
  const [showChannelEdit, setShowChannelEdit] = React.useState(false);

  const [confirmDialog, setConfirmDialog] = React.useState<{
    title: string; description: string; confirmLabel: string;
    variant: 'danger' | 'warning'; onConfirm: () => void;
  } | null>(null);

  const handleStartUpdate = (version: string) => {
    setConfirmDialog({
      title: `Start cluster update to ${version}?`,
      description: `This will rolling-restart all nodes in the cluster. The update process cannot be easily reversed. Make sure you have a recent etcd backup before proceeding.`,
      confirmLabel: 'Start Update',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmDialog(null);
        setUpdating(true);
        try {
          await k8sPatch('/apis/config.openshift.io/v1/clusterversions/version', {
            spec: { desiredUpdate: { version } },
          }, 'application/merge-patch+json');
          addToast({ type: 'success', title: 'Cluster update started', detail: `Updating to ${version}` });
          queryClient.invalidateQueries({ queryKey: ['admin', 'clusterversion'] });
        } catch (err) {
          addToast({ type: 'error', title: 'Update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
        }
        setUpdating(false);
      },
    });
  };

  const handleChangeChannel = async () => {
    if (!channelEdit) return;
    try {
      await k8sPatch('/apis/config.openshift.io/v1/clusterversions/version', {
        spec: { channel: channelEdit },
      }, 'application/merge-patch+json');
      addToast({ type: 'success', title: 'Channel updated', detail: channelEdit });
      setShowChannelEdit(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'clusterversion'] });
    } catch (err) {
      addToast({ type: 'error', title: 'Channel update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
  };

  return (
    <div className="space-y-6">
      {/* ClusterVersion conditions */}
      {(() => {
        const conditions: Condition[] = clusterVersion?.status?.conditions || [];
        const progressing = conditions.find((c) => c.type === 'Progressing');
        const available = conditions.find((c) => c.type === 'Available');
        const failing = conditions.find((c) => c.type === 'Failing');
        const isProgressing = progressing?.status === 'True';
        const isFailing = failing?.status === 'True';
        return (
          <>
            {isFailing && (
              <div className="flex items-start gap-3 px-4 py-3 bg-red-950/30 border border-red-900 rounded-lg">
                <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-red-300">Update Failing</div>
                  <div className="text-xs text-slate-400 mt-0.5">{failing?.message}</div>
                </div>
              </div>
            )}
            {isProgressing && !isFailing && (
              <div className="flex items-start gap-3 px-4 py-3 bg-blue-950/30 border border-blue-800 rounded-lg">
                <RefreshCw className="w-5 h-5 text-blue-400 animate-spin shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-blue-300">Update in Progress</div>
                  <div className="text-xs text-slate-400 mt-0.5">{progressing?.message}</div>
                </div>
              </div>
            )}
          </>
        );
      })()}

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
                <select value={channelEdit} onChange={(e) => setChannelEdit(e.target.value)} className="px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 w-48" autoFocus>
                  {(() => {
                    const ver = cvVersion.match(/^(\d+\.\d+)/)?.[1] || '';
                    const majMin = ver ? [ver] : [];
                    const prev = ver ? [`${ver.split('.')[0]}.${parseInt(ver.split('.')[1]) - 1}`] : [];
                    const versions = [...majMin, ...prev];
                    const prefixes = ['stable', 'fast', 'candidate', 'eus'];
                    const options = versions.flatMap(v => prefixes.map(p => `${p}-${v}`));
                    if (cvChannel && !options.includes(cvChannel)) options.unshift(cvChannel);
                    return options.map(ch => <option key={ch} value={ch}>{ch}</option>);
                  })()}
                </select>
                <button onClick={handleChangeChannel} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500">Save</button>
                <button onClick={() => setShowChannelEdit(false)} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-slate-200">{cvChannel || '\u2014'}</span>
                <button onClick={() => { setChannelEdit(cvChannel); setShowChannelEdit(true); }} className="text-xs text-blue-400 hover:text-blue-300">Change</button>
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
                const node = n as unknown as Node;
                const conds: Condition[] = node.status?.conditions || [];
                return conds.some((c) => c.type === 'Ready' && c.status === 'True');
              });
              const allNodesReady = readyNodes.length === nodes.length;
              const degradedOps = operators.filter((o) => ((o as unknown as ClusterOperator).status?.conditions || []).some((c: Condition) => c.type === 'Degraded' && c.status === 'True'));
              const allOpsHealthy = degradedOps.length === 0;
              const channelStable = cvChannel?.includes('stable') || cvChannel?.includes('eus');

              // Real PDB check: user deployments with >1 replica that have PDBs
              const userDeploys = deployments.filter((d) => {
                const dep = d as unknown as Deployment;
                const ns = dep.metadata?.namespace || '';
                return !ns.startsWith('openshift-') && !ns.startsWith('kube-') && (dep.spec?.replicas ?? 0) > 1;
              });
              const pdbSelectors = (pdbs as unknown as PodDisruptionBudget[]).map((p) => p.spec?.selector?.matchLabels || {});
              const deploysWithPDB = userDeploys.filter((d) => {
                const dep = d as unknown as Deployment;
                const podLabels = dep.spec?.template?.metadata?.labels || {};
                return pdbSelectors.some((sel) => Object.entries(sel).every(([k, v]) => podLabels[k] === v));
              });
              const pdbCoverage = userDeploys.length === 0 || deploysWithPDB.length >= userDeploys.length * 0.5;

              const checks = [
                { label: 'All nodes ready', pass: allNodesReady, detail: allNodesReady ? `${nodes.length}/${nodes.length} ready` : `${readyNodes.length}/${nodes.length} ready \u2014 fix unready nodes first` },
                { label: 'No degraded operators', pass: allOpsHealthy, detail: allOpsHealthy ? `${operators.length} operators healthy` : `${degradedOps.length} degraded: ${degradedOps.slice(0, 3).map((o) => o.metadata.name).join(', ')}` },
                { label: 'Stable update channel', pass: channelStable, detail: channelStable ? `Channel: ${cvChannel}` : `Channel "${cvChannel}" \u2014 consider switching to stable for production` },
                { label: 'Etcd backup', pass: isHyperShift || !!etcdBackupExists, detail: isHyperShift ? 'Managed by hosting provider' : etcdBackupExists ? 'Backup schedule configured' : 'No automated backup configured \u2014 take a manual backup: ssh to control plane \u2192 /usr/local/bin/cluster-backup.sh /home/core/backup' },
                { label: 'PodDisruptionBudgets', pass: pdbCoverage, detail: userDeploys.length === 0 ? 'No multi-replica user deployments' : `${deploysWithPDB.length}/${userDeploys.length} multi-replica deployments have PDBs` },
              ];

              return checks.map((check, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 px-2">
                  {check.pass ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
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

      {/* Available updates */}
      <Panel title={`Available Updates (${availableUpdates.length})`} icon={<ArrowUpCircle className="w-4 h-4 text-blue-500" />}>
        {availableUpdates.length === 0 ? (
          <div className="text-center py-6">
            <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
            <p className="text-sm text-slate-400">Cluster is up to date</p>
            <p className="text-xs text-slate-500 mt-1">Channel: {cvChannel}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {availableUpdates.map((u, i: number) => {
              const versionParts = u.version?.split('.') || [];
              const currentParts = cvVersion?.split('.') || [];
              const minorSkip = versionParts[1] && currentParts[1] ? parseInt(versionParts[1]) - parseInt(currentParts[1]) : 0;
              return (
                <div key={i} className="flex items-center justify-between p-3 rounded bg-slate-800/50 border border-slate-700">
                  <div>
                    <span className="text-sm font-medium text-slate-200">{u.version}</span>
                    {i === 0 && <span className="ml-2 text-xs px-1.5 py-0.5 bg-blue-900 text-blue-300 rounded">Recommended</span>}
                    {minorSkip > 1 && <span className="ml-2 text-xs px-1.5 py-0.5 bg-amber-900 text-amber-300 rounded">Skips {minorSkip - 1} minor</span>}
                    {u.risks && u.risks.length > 0 && <span className="ml-2 text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{u.risks.length} known risk{u.risks.length > 1 ? 's' : ''}</span>}
                  </div>
                  <button
                    onClick={() => handleStartUpdate(u.version)}
                    disabled={updating || isUpdating}
                    className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {updating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpCircle className="w-3 h-3" />}
                    Update
                  </button>
                </div>
              );
            })}
            <div className="text-xs text-slate-500 pt-2">
              <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-yellow-500" /> Estimated duration: ~{Math.max(30, nodes.length * 10)} minutes ({nodes.length} nodes \u00d7 ~10min each)</span>
            </div>
          </div>
        )}
      </Panel>

      {/* Operator update status (during upgrade) */}
      {isUpdating && (
        <Panel title="Operator Update Progress" icon={<Puzzle className="w-4 h-4 text-violet-500" />}>
          <div className="space-y-1 max-h-64 overflow-auto">
            {operators.map((op) => {
              const co = op as unknown as ClusterOperator;
              const conds: Condition[] = co.status?.conditions || [];
              const progressing = conds.find((c) => c.type === 'Progressing');
              const available = conds.find((c) => c.type === 'Available');
              const degraded = conds.find((c) => c.type === 'Degraded');
              const isProgressing = progressing?.status === 'True';
              const isDegraded = degraded?.status === 'True';
              const isAvailable = available?.status === 'True';
              const version = co.status?.versions?.find((v) => v.name === 'operator')?.version || '';
              return (
                <div key={op.metadata.uid} className="flex items-center justify-between py-1.5 px-2 hover:bg-slate-800/30 rounded">
                  <div className="flex items-center gap-2">
                    {isDegraded ? <XCircle className="w-3.5 h-3.5 text-red-500" /> :
                     isProgressing ? <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" /> :
                     <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                    <span className="text-sm text-slate-200">{op.metadata.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {version && <span className="text-xs font-mono text-slate-500">{version}</span>}
                    <span className={cn('text-xs px-1.5 py-0.5 rounded',
                      isDegraded ? 'bg-red-900/50 text-red-300' :
                      isProgressing ? 'bg-blue-900/50 text-blue-300' :
                      'bg-green-900/50 text-green-300'
                    )}>
                      {isDegraded ? 'Degraded' : isProgressing ? 'Updating' : 'Ready'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Update history */}
      <Panel title="Update History" icon={<RefreshCw className="w-4 h-4 text-blue-500" />}>
        <div className="space-y-1 max-h-64 overflow-auto">
          {(clusterVersion?.status?.history || []).slice(0, 10).map((h, i: number) => {
            const startTime = h.startedTime ? new Date(h.startedTime) : null;
            const endTime = h.completionTime ? new Date(h.completionTime) : null;
            const duration = startTime && endTime ? Math.round((endTime.getTime() - startTime.getTime()) / 60000) : null;
            return (
              <div key={i} className="flex items-center justify-between py-2 px-2 hover:bg-slate-800/30 rounded">
                <div className="flex items-center gap-2">
                  {h.state === 'Completed' ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> :
                   h.state === 'Partial' ? <RefreshCw className="w-3.5 h-3.5 text-yellow-500 animate-spin" /> :
                   <XCircle className="w-3.5 h-3.5 text-red-500" />}
                  <span className="text-sm text-slate-200 font-mono">{h.version}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {duration && <span>{duration}min</span>}
                  <span className={cn(h.state === 'Completed' ? 'text-green-400' : h.state === 'Partial' ? 'text-yellow-400' : 'text-red-400')}>{h.state}</span>
                  {endTime && <span>{endTime.toLocaleDateString()}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Snapshots section (merged from separate tab) */}
      <div className="border-t border-slate-800 pt-6">
        <h2 className="text-lg font-semibold text-slate-200 mb-4">Cluster Snapshots</h2>
        <SnapshotsTab />
      </div>

      {confirmDialog && (
        <ConfirmDialog
          open={true}
          onClose={() => setConfirmDialog(null)}
          onConfirm={confirmDialog.onConfirm}
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          variant={confirmDialog.variant}
        />
      )}
    </div>
  );
}
