import React from 'react';
import { ArrowRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import type { K8sResource } from '../../engine/renderers';
import type { Machine, MachineSet, NodePool, Condition } from '../../engine/types';
import type { MachineAutoscalerResource, ClusterAutoscalerResource, MachineHealthCheckResource } from './types';

interface MachineManagementProps {
  isHyperShift: boolean;
  machines: K8sResource[];
  machineSets: K8sResource[];
  healthChecks: K8sResource[];
  machineAutoscalers: K8sResource[];
  clusterAutoscaler: K8sResource[];
  nodePools: K8sResource[];
  go: (path: string, title: string) => void;
}

export function MachineManagement({
  isHyperShift, machines, machineSets, healthChecks,
  machineAutoscalers, clusterAutoscaler, nodePools, go,
}: MachineManagementProps) {
  if (isHyperShift) {
    return <HyperShiftSection nodePools={nodePools} go={go} />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <MachineSetsCard machineSets={machineSets} machineAutoscalers={machineAutoscalers} go={go} />
      <MachinesCard machines={machines} go={go} />
      <HealthChecksCard healthChecks={healthChecks} go={go} />
      <AutoscalingCard clusterAutoscaler={clusterAutoscaler} machineAutoscalers={machineAutoscalers} go={go} />
    </div>
  );
}

function HyperShiftSection({ nodePools, go }: { nodePools: K8sResource[]; go: (path: string, title: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-950/30 border border-blue-800/50 rounded-lg">
        <Info className="w-4 h-4 text-blue-400 shrink-0" />
        <span className="text-xs text-blue-300">Hosted Control Plane — Machine API managed externally. Worker scaling via NodePools.</span>
      </div>

      <Card>
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            NodePools ({nodePools.length})
            <span className="text-xs px-2 py-0.5 bg-violet-900/50 text-violet-300 rounded-full">HyperShift</span>
          </h2>
        </div>
        {nodePools.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-slate-500">No NodePools found</p>
            <p className="text-xs text-slate-600 mt-1">NodePool resources may not be accessible from the guest cluster, or the hypershift.openshift.io API is not available.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {(nodePools as unknown as NodePool[]).map((np) => {
              const desired = np.spec?.replicas ?? 0;
              const ready = np.status?.replicas ?? 0;
              const autoScale = np.spec?.autoScaling;
              const platform = np.spec?.platform;
              const instanceType = platform?.aws?.instanceType || platform?.azure?.vmSize || platform?.gcp?.instanceType || '';
              const autoRepair = np.spec?.management?.autoRepair;
              const version = np.status?.version;
              const conditions = np.status?.conditions || [];
              const isDegraded = conditions.some((c: Condition) => c.type === 'Ready' && c.status !== 'True');
              const isUpdating = conditions.some((c: Condition) => (c.type === 'UpdatingVersion' || c.type === 'UpdatingConfig') && c.status === 'True');

              return (
                <div key={np.metadata.uid || np.metadata.name} className="px-4 py-3 hover:bg-slate-800/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn('w-2 h-2 rounded-full shrink-0',
                        isDegraded ? 'bg-red-500' : isUpdating ? 'bg-blue-500 animate-pulse' : ready === desired ? 'bg-green-500' : 'bg-yellow-500'
                      )} />
                      <span className="text-sm font-medium text-slate-200">{np.metadata.name}</span>
                      {instanceType && <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono">{instanceType}</span>}
                      {autoScale && (
                        <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded">
                          auto {autoScale.min}-{autoScale.max}
                        </span>
                      )}
                      {autoRepair && <span className="text-xs px-1.5 py-0.5 bg-emerald-900/50 text-emerald-300 rounded">auto-repair</span>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {version && <span className="text-xs text-slate-500 font-mono">{version}</span>}
                      <span className={cn('text-xs font-mono font-semibold',
                        ready === desired ? 'text-green-400' : 'text-yellow-400'
                      )}>{ready}/{desired}</span>
                    </div>
                  </div>
                  {isDegraded && (
                    <div className="mt-1.5 ml-4">
                      <span className="text-xs text-red-400">
                        {conditions.find((c: Condition) => c.type === 'Ready' && c.status !== 'True')?.message || 'Not ready'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function MachineSetsCard({ machineSets, machineAutoscalers, go }: { machineSets: K8sResource[]; machineAutoscalers: K8sResource[]; go: (path: string, title: string) => void }) {
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">MachineSets ({machineSets.length})</h2>
        <button onClick={() => go('/r/machine.openshift.io~v1beta1~machinesets', 'MachineSets')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
      </div>
      <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
        {machineSets.length === 0 ? <div className="px-4 py-6 text-center text-sm text-slate-500">No MachineSets</div> : (machineSets as MachineSet[]).map((ms) => {
          const desired = ms.spec?.replicas ?? 0;
          const ready = ms.status?.readyReplicas ?? 0;
          const autoscaler = (machineAutoscalers as MachineAutoscalerResource[]).find((a) => a.spec?.scaleTargetRef?.name === ms.metadata.name);
          return (
            <button key={ms.metadata.uid} onClick={() => go(`/r/machine.openshift.io~v1beta1~machinesets/${ms.metadata.namespace}/${ms.metadata.name}`, ms.metadata.name)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/50 text-left">
              <div className="flex items-center gap-2 min-w-0">
                <div className={cn('w-2 h-2 rounded-full shrink-0', ready === desired ? 'bg-green-500' : 'bg-yellow-500')} />
                <span className="text-sm text-slate-200 truncate">{ms.metadata.name}</span>
                {autoscaler && <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded shrink-0">autoscaled {autoscaler.spec?.minReplicas}-{autoscaler.spec?.maxReplicas}</span>}
              </div>
              <span className={cn('text-xs font-mono shrink-0', ready === desired ? 'text-green-400' : 'text-yellow-400')}>{ready}/{desired}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function MachinesCard({ machines, go }: { machines: K8sResource[]; go: (path: string, title: string) => void }) {
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Machines ({machines.length})</h2>
        <button onClick={() => go('/r/machine.openshift.io~v1beta1~machines', 'Machines')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
      </div>
      <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
        {machines.length === 0 ? <div className="px-4 py-6 text-center text-sm text-slate-500">No Machines</div> : (machines as Machine[]).map((m) => {
          const phase = m.status?.phase || 'Unknown';
          const instanceType = (m.spec?.providerSpec?.value?.instanceType as string) || '';
          const nodeRef = m.status?.nodeRef?.name || '';
          return (
            <button key={m.metadata.uid} onClick={() => go(`/r/machine.openshift.io~v1beta1~machines/${m.metadata.namespace}/${m.metadata.name}`, m.metadata.name)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/50 text-left">
              <div className="flex items-center gap-2 min-w-0">
                <div className={cn('w-2 h-2 rounded-full shrink-0', phase === 'Running' ? 'bg-green-500' : phase === 'Provisioning' ? 'bg-yellow-500' : 'bg-red-500')} />
                <div className="min-w-0">
                  <span className="text-sm text-slate-200 truncate block">{m.metadata.name}</span>
                  {nodeRef && <span className="text-xs text-slate-500 truncate block">{nodeRef}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {instanceType && <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono">{instanceType}</span>}
                <span className={cn('text-xs px-1.5 py-0.5 rounded',
                  phase === 'Running' ? 'bg-green-900/50 text-green-300' :
                  phase === 'Provisioning' ? 'bg-yellow-900/50 text-yellow-300' :
                  'bg-red-900/50 text-red-300'
                )}>{phase}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function HealthChecksCard({ healthChecks, go }: { healthChecks: K8sResource[]; go: (path: string, title: string) => void }) {
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Machine Health Checks ({healthChecks.length})</h2>
        <button onClick={() => go('/r/machine.openshift.io~v1beta1~machinehealthchecks', 'HealthChecks')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
      </div>
      <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
        {healthChecks.length === 0 ? <div className="px-4 py-6 text-center text-sm text-slate-500">No health checks configured</div> : (healthChecks as MachineHealthCheckResource[]).map((hc) => {
          const maxUnhealthy = hc.spec?.maxUnhealthy || '100%';
          const conditions = hc.spec?.unhealthyConditions || [];
          const currentHealthy = hc.status?.currentHealthy ?? 0;
          const expectedMachines = hc.status?.expectedMachines ?? 0;
          return (
            <button key={hc.metadata.uid} onClick={() => go(`/r/machine.openshift.io~v1beta1~machinehealthchecks/${hc.metadata.namespace}/${hc.metadata.name}`, hc.metadata.name)}
              className="w-full px-4 py-3 hover:bg-slate-800/50 text-left">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-slate-200">{hc.metadata.name}</span>
                <span className={cn('text-xs font-mono', currentHealthy === expectedMachines ? 'text-green-400' : 'text-yellow-400')}>
                  {currentHealthy}/{expectedMachines} healthy
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>Max unhealthy: {maxUnhealthy}</span>
                {conditions.map((c, i) => <span key={i}>{c.type}≠{c.status} → {c.timeout}</span>)}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function AutoscalingCard({ clusterAutoscaler, machineAutoscalers, go }: { clusterAutoscaler: K8sResource[]; machineAutoscalers: K8sResource[]; go: (path: string, title: string) => void }) {
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Autoscaling</h2>
        {clusterAutoscaler.length > 0 && <span className="text-xs px-1.5 py-0.5 bg-green-900/50 text-green-300 rounded">Enabled</span>}
      </div>
      <div className="p-4 space-y-3">
        {clusterAutoscaler.length === 0 && machineAutoscalers.length === 0 ? (
          <div className="py-3 space-y-4">
            <div className="text-sm text-slate-400">Autoscaling is not configured</div>

            <div className="space-y-3 text-xs text-slate-500">
              <div className="flex gap-3">
                <span className="text-blue-400 font-bold shrink-0">Step 1</span>
                <div>
                  <div className="text-slate-300 font-medium">Create a ClusterAutoscaler</div>
                  <div>Sets cluster-wide limits: max total nodes, max cores, max memory. Only one per cluster.</div>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-blue-400 font-bold shrink-0">Step 2</span>
                <div>
                  <div className="text-slate-300 font-medium">Create MachineAutoscalers (one per MachineSet)</div>
                  <div>Sets min/max replicas per MachineSet. The autoscaler adds nodes when pods are pending due to insufficient resources, and removes them when utilization is low.</div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={() => go('/create/autoscaling.openshift.io~v1~clusterautoscalers', 'Create ClusterAutoscaler')} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 flex items-center gap-1">
                Create ClusterAutoscaler <ArrowRight className="w-3 h-3" />
              </button>
              <button onClick={() => go('/create/autoscaling.openshift.io~v1beta1~machineautoscalers', 'Create MachineAutoscaler')} className="px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700 flex items-center gap-1">
                Create MachineAutoscaler <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        ) : (
          <>
            {(clusterAutoscaler as ClusterAutoscalerResource[]).map((ca) => (
              <div key={ca.metadata.uid} className="p-3 bg-slate-800/50 rounded border border-slate-700">
                <div className="text-sm text-slate-200 mb-2">Cluster Autoscaler</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-slate-500">Min nodes:</span> <span className="text-slate-300">{ca.spec?.resourceLimits?.minNodesTotal ?? '—'}</span></div>
                  <div><span className="text-slate-500">Max nodes:</span> <span className="text-slate-300">{ca.spec?.resourceLimits?.maxNodesTotal ?? '—'}</span></div>
                  <div><span className="text-slate-500">Scale down:</span> <span className="text-slate-300">{ca.spec?.scaleDown?.enabled ? 'enabled' : 'disabled'}</span></div>
                  <div><span className="text-slate-500">Delay:</span> <span className="text-slate-300">{ca.spec?.scaleDown?.delayAfterAdd ?? '—'}</span></div>
                </div>
              </div>
            ))}
            {machineAutoscalers.length > 0 && (
              <div>
                <div className="text-xs text-slate-500 mb-2">Machine Autoscalers ({machineAutoscalers.length})</div>
                {(machineAutoscalers as MachineAutoscalerResource[]).map((ma) => (
                  <div key={ma.metadata.uid} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-slate-300">{ma.spec?.scaleTargetRef?.name || ma.metadata.name}</span>
                    <span className="text-xs text-slate-400 font-mono">{ma.spec?.minReplicas}–{ma.spec?.maxReplicas} replicas</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
