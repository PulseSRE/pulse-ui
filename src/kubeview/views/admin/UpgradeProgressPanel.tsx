import React from 'react';
import {
  AlertOctagon, ShieldAlert, Ban, Clock, ExternalLink, Server, AlertTriangle, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Panel } from '../../components/primitives/Panel';
import type { ClusterVersion, MachineConfigPool, Node } from '../../engine/types';
import {
  detectDesiredUpdateMismatch,
  getUpgradeableBlocker,
  getConditionalUpdateRisks,
  summarizeMachineConfigPools,
  getNodesInRollout,
  getDrainBlockingNodes,
  getBlockingPdbs,
  estimateUpgradeEta,
  type PdbLike,
  type PodLike,
} from '../../engine/upgradeHealth';

export interface UpgradeProgressPanelProps {
  clusterVersion: ClusterVersion | null | undefined;
  isUpdating: boolean;
  nodes: Node[];
  machineConfigPools: MachineConfigPool[];
  pdbs: PdbLike[];
  pods: PodLike[];
  availableUpdates: Array<{ version: string; image?: string }>;
  onReapplyUpdate: (version: string, image: string | undefined) => void;
}

/**
 * Real-time upgrade progress and blocker detection. Everything here is
 * derived from actual ClusterVersion / MachineConfigPool / Node / PDB
 * objects via the pure functions in engine/upgradeHealth.ts — no fabricated
 * percentages or invented risk text.
 */
export function UpgradeProgressPanel({
  clusterVersion, isUpdating, nodes, machineConfigPools, pdbs, pods,
  availableUpdates, onReapplyUpdate,
}: UpgradeProgressPanelProps) {
  const mismatch = React.useMemo(() => detectDesiredUpdateMismatch(clusterVersion), [clusterVersion]);
  const upgradeableBlocker = React.useMemo(() => getUpgradeableBlocker(clusterVersion), [clusterVersion]);
  const conditionalRisks = React.useMemo(() => getConditionalUpdateRisks(clusterVersion), [clusterVersion]);
  const poolProgress = React.useMemo(() => summarizeMachineConfigPools(machineConfigPools), [machineConfigPools]);
  const nodesInRollout = React.useMemo(() => getNodesInRollout(nodes), [nodes]);
  const drainBlockingNodes = React.useMemo(() => getDrainBlockingNodes(nodes), [nodes]);
  const blockingPdbs = React.useMemo(() => getBlockingPdbs(pdbs, pods, nodesInRollout), [pdbs, pods, nodesInRollout]);

  const progressingCond = (clusterVersion?.status?.conditions || []).find((c) => c.type === 'Progressing');
  const eta = React.useMemo(() => estimateUpgradeEta({
    progressingSince: progressingCond?.status === 'True' ? progressingCond.lastTransitionTime : undefined,
    pools: poolProgress,
    nodeCount: nodes.length,
  }), [progressingCond, poolProgress, nodes.length]);

  const matchingAvailableUpdate = mismatch ? availableUpdates.find((u) => u.version === mismatch.requestedVersion) : undefined;

  const hasBlockers = !!mismatch || !!upgradeableBlocker || conditionalRisks.length > 0;
  const showRollout = isUpdating || poolProgress.some((p) => p.isUpdating) || nodesInRollout.length > 0;

  if (!hasBlockers && !showRollout) return null;

  return (
    <div className="space-y-6">
      {/* Stuck / no-op update — read-path detection of the stale desiredUpdate.image class of bug */}
      {mismatch && (
        <div className="px-4 py-3 bg-red-950/30 border border-red-900 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertOctagon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-300">Update appears stuck {'\u2014'} requested {mismatch.mismatchKind} does not match what&apos;s active</div>
              <div className="text-xs text-slate-400 mt-1">
                <span className="text-slate-300">spec.desiredUpdate</span> requests <span className="font-mono text-slate-300">{mismatch.requestedVersion}</span>
                {mismatch.requestedImage && <> (<span className="font-mono text-slate-300">{mismatch.requestedImage.slice(0, 28)}{'\u2026'}</span>)</>}
                {', but the cluster is still targeting '}
                <span className="font-mono text-slate-300">{mismatch.actualVersion || '\u2014'}</span>
                {mismatch.actualImage && <> (<span className="font-mono text-slate-300">{mismatch.actualImage.slice(0, 28)}{'\u2026'}</span>)</>}
                {'. cluster-version-operator treats '}{mismatch.mismatchKind}{' as authoritative and has not started \u2014 '}
                {mismatch.minutesSinceProgressingStable !== null
                  ? `no progress for ${mismatch.minutesSinceProgressingStable} min.`
                  : 'Progressing has no recorded transition time.'}
              </div>
              <div className="mt-2">
                {matchingAvailableUpdate ? (
                  <button
                    onClick={() => onReapplyUpdate(matchingAvailableUpdate.version, matchingAvailableUpdate.image)}
                    className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded-sm"
                  >
                    Re-apply update to {matchingAvailableUpdate.version}
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">
                    {mismatch.requestedVersion} is no longer listed under Available Updates below {'\u2014'} select it again once it reappears, or correct spec.desiredUpdate directly with <code className="mx-1 px-1 bg-slate-800 rounded-sm">oc adm upgrade --to-image=&lt;correct digest&gt;</code>.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upgradeable=False — often gated behind an admin acknowledgment */}
      {upgradeableBlocker && (
        <div className="px-4 py-3 bg-amber-950/30 border border-amber-800 rounded-lg">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-amber-300">Cluster is not upgradeable{upgradeableBlocker.reason ? ` (${upgradeableBlocker.reason})` : ''}</div>
              <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{upgradeableBlocker.message}</p>
              {upgradeableBlocker.adminAckCommand ? (
                <div className="mt-2">
                  <div className="text-xs text-slate-500 mb-1">Unblock by running the acknowledgment command from the message above:</div>
                  <pre className="text-xs font-mono bg-slate-950 border border-slate-800 rounded-sm p-2 overflow-x-auto text-slate-300">{upgradeableBlocker.adminAckCommand}</pre>
                </div>
              ) : (
                <p className="text-xs text-slate-500 mt-2">
                  Boundaries like this commonly require an administrator acknowledgment {'\u2014'} run <code className="mx-1 px-1 bg-slate-800 rounded-sm">oc adm upgrade</code> for the exact <code className="mx-1 px-1 bg-slate-800 rounded-sm">admin-acks</code> ConfigMap key this cluster needs before the update can proceed.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Conditional update risks — real, structured data from status.conditionalUpdates */}
      {conditionalRisks.length > 0 && (
        <Panel title={`Conditional Update Risks (${conditionalRisks.length})`} icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}>
          <div className="space-y-2">
            {conditionalRisks.map((risk, i) => (
              <div key={i} className="p-2.5 rounded-sm bg-amber-950/20 border border-amber-900/30">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-slate-300">{risk.version}</span>
                  {risk.riskName && <span className="px-1.5 py-0.5 bg-amber-900/50 text-amber-300 rounded-sm">{risk.riskName}</span>}
                </div>
                <p className="text-xs text-slate-400 mt-1">{risk.message}</p>
                {risk.url && (
                  <a href={risk.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-1">
                    Details <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Real per-pool / per-node rollout progress */}
      {showRollout && (
        <Panel title="Node Rollout Progress" icon={<Server className="w-4 h-4 text-blue-500" />}>
          <div className="space-y-4">
            <div className={cn('flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-sm', eta.isEvidenceBased ? 'bg-blue-950/30 text-blue-300' : 'bg-slate-800/50 text-slate-400')}>
              <Clock className="w-3.5 h-3.5 shrink-0" />
              {eta.label}
            </div>

            {poolProgress.length > 0 && (
              <div className="space-y-3">
                {poolProgress.map((pool) => (
                  <div key={pool.name}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="flex items-center gap-2 text-slate-200">
                        {pool.name}
                        {pool.isDegraded && <span className="text-xs px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded-sm">Degraded</span>}
                        {pool.isUpdating && <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded-sm">Updating</span>}
                      </span>
                      <span className="text-xs font-mono text-slate-400">{pool.updatedMachineCount}/{pool.machineCount} nodes updated</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', pool.isDegraded ? 'bg-red-500' : 'bg-blue-500')}
                        style={{ width: `${pool.machineCount > 0 ? (pool.updatedMachineCount / pool.machineCount) * 100 : 0}%` }}
                      />
                    </div>
                    {pool.degradedMessage && <p className="text-xs text-red-400/80 mt-1">{pool.degradedMessage}</p>}
                  </div>
                ))}
              </div>
            )}

            {nodesInRollout.length > 0 && (
              <div>
                <div className="text-xs text-slate-400 mb-1.5">Nodes in rollout ({nodesInRollout.length})</div>
                <div className="space-y-1 max-h-48 overflow-auto">
                  {nodesInRollout.map((n) => (
                    <div key={n.name} className="flex items-center justify-between py-1 px-2 text-xs hover:bg-slate-800/30 rounded-sm">
                      <span className="font-mono text-slate-300 truncate">{n.name}</span>
                      <span className={cn('px-1.5 py-0.5 rounded-sm shrink-0 ml-2', n.mcoState === 'Degraded' ? 'bg-red-900/50 text-red-300' : 'bg-blue-900/50 text-blue-300')}>
                        {n.mcoState}{n.reason ? `: ${n.reason}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* Drain blockers — nodes/PDBs that can stall a rollout indefinitely */}
      {showRollout && (drainBlockingNodes.length > 0 || blockingPdbs.length > 0) && (
        <Panel title="Drain Blockers" icon={<Ban className="w-4 h-4 text-red-500" />}>
          <div className="space-y-2">
            {drainBlockingNodes.map((n) => (
              <div key={n.name} className="flex items-start gap-2 p-2 rounded-sm bg-red-950/20 border border-red-900/30">
                <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-mono text-red-300">{n.name}</span>
                  <span className="text-slate-400 ml-2">
                    {[n.unschedulable && 'cordoned/unschedulable', !n.ready && 'NotReady'].filter(Boolean).join(', ')} {'\u2014'} can stall a drain indefinitely
                  </span>
                </div>
              </div>
            ))}
            {blockingPdbs.map((pdb) => (
              <div key={`${pdb.namespace}/${pdb.name}`} className="flex items-start gap-2 p-2 rounded-sm bg-red-950/20 border border-red-900/30">
                <Ban className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-mono text-red-300">{pdb.namespace}/{pdb.name}</span>
                  <span className="text-slate-400 ml-2">allows 0 disruptions {'\u2014'} blocks draining {pdb.blockedNodeNames.join(', ')}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
