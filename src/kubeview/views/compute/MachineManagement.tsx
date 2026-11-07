import React from 'react';
import { ArrowRight, Scale, Trash2 } from 'lucide-react';
import { useCanI } from '../../hooks/useCanI';
import { useActionDialog } from '../../components/ActionDialog';
import { deleteRequest, sendWrite, setReplicas } from '../../engine/workloadActions';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import { LoadError } from '../../components/primitives/LoadError';
import type { K8sResource } from '../../engine/renderers';
import type { Machine, MachineSet, NodePool, Condition } from '../../engine/types';
import type { MachineAutoscalerResource, ClusterAutoscalerResource, MachineHealthCheckResource } from './types';

/** A read that failed (403, 500, network): shown as an error, never as "none". */
export interface ReadFailure { error: unknown; retry: () => void }

/** Which machine-API reads failed; a missing key means the read succeeded (or is pending). */
export interface MachineReads {
  machines?: ReadFailure;
  machineSets?: ReadFailure;
  healthChecks?: ReadFailure;
  machineAutoscalers?: ReadFailure;
  clusterAutoscaler?: ReadFailure;
  nodePools?: ReadFailure;
}

function ReadFailed({ what, failure }: { what: string; failure: ReadFailure }) {
  return <LoadError title={`${what} could not be loaded`} error={failure.error} onRetry={failure.retry} className="m-3" />;
}

interface MachineManagementProps {
  isHyperShift: boolean;
  machines: Machine[];
  machineSets: MachineSet[];
  healthChecks: K8sResource[];
  machineAutoscalers: K8sResource[];
  clusterAutoscaler: K8sResource[];
  nodePools: NodePool[];
  reads?: MachineReads;
  go: (path: string, title: string) => void;
}

export function MachineManagement({
  isHyperShift, machines, machineSets, healthChecks,
  machineAutoscalers, clusterAutoscaler, nodePools, reads = {}, go,
}: MachineManagementProps) {
  if (isHyperShift) {
    return <HyperShiftSection nodePools={nodePools} failure={reads.nodePools} go={go} />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <MachineSetsCard machineSets={machineSets} machineAutoscalers={machineAutoscalers} failure={reads.machineSets} go={go} />
      <MachinesCard machines={machines} failure={reads.machines} go={go} />
      <HealthChecksCard healthChecks={healthChecks} failure={reads.healthChecks} go={go} />
      <AutoscalingCard clusterAutoscaler={clusterAutoscaler} machineAutoscalers={machineAutoscalers} failures={[reads.clusterAutoscaler, reads.machineAutoscalers]} go={go} />
    </div>
  );
}

function HyperShiftSection({ nodePools, failure, go }: { nodePools: NodePool[]; failure?: ReadFailure; go: (path: string, title: string) => void }) {
  return (
    <div className="space-y-6">
      <Card>
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            NodePools{failure ? '' : ` (${nodePools.length})`}
            <span className="text-xs px-2 py-0.5 bg-blue-900/50 text-blue-300 rounded-full">HyperShift</span>
          </h2>
        </div>
        {failure ? <ReadFailed what="NodePools" failure={failure} /> : nodePools.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-slate-500">No NodePools found</p>
            <p className="text-xs text-slate-600 mt-1">NodePool resources may not be accessible from the guest cluster, or the hypershift.openshift.io API is not available.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {nodePools.map((np) => {
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
                      {instanceType && <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm font-mono">{instanceType}</span>}
                      {autoScale && (
                        <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded-sm">
                          auto {autoScale.min}-{autoScale.max}
                        </span>
                      )}
                      {autoRepair && <span className="text-xs px-1.5 py-0.5 bg-emerald-900/50 text-emerald-300 rounded-sm">auto-repair</span>}
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

function MachineSetsCard({ machineSets, machineAutoscalers, failure, go }: { machineSets: MachineSet[]; machineAutoscalers: K8sResource[]; failure?: ReadFailure; go: (path: string, title: string) => void }) {
  const { allowed: canPatch } = useCanI('patch', 'machine.openshift.io', 'machinesets', 'openshift-machine-api');
  const { open, dialog } = useActionDialog();
  const scale = (ms: MachineSet, autoscaled: boolean) => {
    const current = ms.spec?.replicas ?? 0;
    open({
      title: `Scale MachineSet "${ms.metadata.name}"`,
      description: `Set how many machines (and so nodes) this MachineSet keeps; it has ${current}. Adding machines provisions new cloud instances (and cost); removing them deletes machines and drains their nodes.${autoscaled ? ' A MachineAutoscaler manages this MachineSet and may change the count back within its min/max.' : ''}`,
      confirmLabel: 'Scale',
      inputs: [{
        id: 'replicas', label: 'Machines', initial: String(current), type: 'number', min: 0,
        validate: (v) => (/^\d+$/.test(v.trim()) && Number(v) <= 500 ? null : 'Enter a whole number from 0 to 500'),
      }],
      warning: (v) => (Number(v.replicas) < current ? `${current - Number(v.replicas)} machine(s) will be deleted and their nodes drained.` : null),
      run: (cid, v) => sendWrite(setReplicas(ms as unknown as K8sResource, Number(v.replicas)), cid),
      success: (v) => `MachineSet "${ms.metadata.name}" scaled to ${v.replicas}`,
    });
  };
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">MachineSets{failure ? '' : ` (${machineSets.length})`}</h2>
        <button onClick={() => go('/r/machine.openshift.io~v1beta1~machinesets', 'MachineSets')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
      </div>
      <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
        {failure ? <ReadFailed what="MachineSets" failure={failure} /> : machineSets.length === 0 ? <div className="px-4 py-6 text-center text-sm text-slate-500">No MachineSets</div> : machineSets.map((ms) => {
          const desired = ms.spec?.replicas ?? 0;
          const ready = ms.status?.readyReplicas ?? 0;
          const autoscaler = (machineAutoscalers as MachineAutoscalerResource[]).find((a) => a.spec?.scaleTargetRef?.name === ms.metadata.name);
          return (
            <div key={ms.metadata.uid} className="flex items-center hover:bg-slate-800/50">
            <button onClick={() => go(`/r/machine.openshift.io~v1beta1~machinesets/${ms.metadata.namespace}/${ms.metadata.name}`, ms.metadata.name)}
              className="flex-1 min-w-0 flex items-center justify-between px-4 py-2.5 text-left">
              <div className="flex items-center gap-2 min-w-0">
                <div className={cn('w-2 h-2 rounded-full shrink-0', ready === desired ? 'bg-green-500' : 'bg-yellow-500')} />
                <span className="text-sm text-slate-200 truncate">{ms.metadata.name}</span>
                {autoscaler && <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded-sm shrink-0">autoscaled {autoscaler.spec?.minReplicas}-{autoscaler.spec?.maxReplicas}</span>}
              </div>
              <span className={cn('text-xs font-mono shrink-0', ready === desired ? 'text-green-400' : 'text-yellow-400')}>{ready}/{desired}</span>
            </button>
            <button
              onClick={() => scale(ms, !!autoscaler)}
              disabled={!canPatch}
              title={canPatch ? 'Scale' : 'You do not have permission to scale MachineSets'}
              aria-label={`Scale MachineSet ${ms.metadata.name}`}
              className="p-2 mr-2 text-slate-500 hover:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Scale className="w-3.5 h-3.5" />
            </button>
            </div>
          );
        })}
      </div>
      {dialog}
    </Card>
  );
}

function MachinesCard({ machines, failure, go }: { machines: Machine[]; failure?: ReadFailure; go: (path: string, title: string) => void }) {
  const { allowed: canDelete } = useCanI('delete', 'machine.openshift.io', 'machines', 'openshift-machine-api');
  const { open, dialog } = useActionDialog();
  const remove = (m: Machine) => {
    const node = m.status?.nodeRef?.name;
    const owners = m.metadata.ownerReferences ?? [];
    const cpms = owners.some((o) => o.kind === 'ControlPlaneMachineSet');
    const owned = cpms || owners.some((o) => o.kind === 'MachineSet');
    const controlPlane = cpms || m.metadata.labels?.['machine.openshift.io/cluster-api-machine-role'] === 'master';
    const nodePart = node ? `node "${node}" is drained and removed, and its ` : '';
    if (controlPlane && !cpms) {
      // No ControlPlaneMachineSet: nothing replaces it and etcd loses a member for good.
      open({
        title: `Machine "${m.metadata.name}" is a control-plane machine`,
        description: `It runs an etcd member and the API server, and no ControlPlaneMachineSet manages it, so nothing would replace it: deleting it shrinks etcd and can lose quorum (with three members, losing two stops the cluster). Replace control-plane machines with the documented etcd member replacement procedure, not from here.`,
        confirmLabel: 'Delete machine',
        variant: 'danger',
        inputs: [{ id: 'confirm', label: `Type the machine name to delete it anyway`, initial: '', validate: (v) => (v === m.metadata.name ? null : 'Type the exact machine name') }],
        run: (cid) => sendWrite(deleteRequest(m as unknown as K8sResource), cid),
        success: `Machine "${m.metadata.name}" is being deleted`,
      });
      return;
    }
    open({
      title: `Delete Machine "${m.metadata.name}"?`,
      description: `The machine's ${nodePart}cloud instance is deleted. ${
        cpms
          ? 'It is a control-plane machine (etcd member): its ControlPlaneMachineSet creates a replacement and moves the etcd member, one machine at a time. Do not delete another control-plane machine until the replacement is Running and etcd is healthy, or quorum can be lost.'
          : owned
            ? 'Its MachineSet then creates a replacement machine (and node) to keep its count.'
            : 'No MachineSet or ControlPlaneMachineSet owns this machine, so nothing replaces it.'
      }`,
      confirmLabel: 'Delete machine',
      variant: 'danger',
      run: (cid) => sendWrite(deleteRequest(m as unknown as K8sResource), cid),
      success: `Machine "${m.metadata.name}" is being deleted`,
    });
  };
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Machines{failure ? '' : ` (${machines.length})`}</h2>
        <button onClick={() => go('/r/machine.openshift.io~v1beta1~machines', 'Machines')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
      </div>
      <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
        {failure ? <ReadFailed what="Machines" failure={failure} /> : machines.length === 0 ? <div className="px-4 py-6 text-center text-sm text-slate-500">No Machines</div> : machines.map((m) => {
          const phase = m.status?.phase || 'Unknown';
          const instanceType = (m.spec?.providerSpec?.value?.instanceType as string) || '';
          const nodeRef = m.status?.nodeRef?.name || '';
          return (
            <div key={m.metadata.uid} className="flex items-center hover:bg-slate-800/50">
            <button onClick={() => go(`/r/machine.openshift.io~v1beta1~machines/${m.metadata.namespace}/${m.metadata.name}`, m.metadata.name)}
              className="flex-1 min-w-0 flex items-center justify-between px-4 py-2.5 text-left">
              <div className="flex items-center gap-2 min-w-0">
                <div className={cn('w-2 h-2 rounded-full shrink-0', phase === 'Running' ? 'bg-green-500' : phase === 'Provisioning' ? 'bg-yellow-500' : 'bg-red-500')} />
                <div className="min-w-0">
                  <span className="text-sm text-slate-200 truncate block">{m.metadata.name}</span>
                  {nodeRef && <span className="text-xs text-slate-500 truncate block">{nodeRef}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {instanceType && <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm font-mono">{instanceType}</span>}
                <span className={cn('text-xs px-1.5 py-0.5 rounded-sm',
                  phase === 'Running' ? 'bg-green-900/50 text-green-300' :
                  phase === 'Provisioning' ? 'bg-yellow-900/50 text-yellow-300' :
                  'bg-red-900/50 text-red-300'
                )}>{phase}</span>
              </div>
            </button>
            <button
              onClick={() => remove(m)}
              disabled={!canDelete}
              title={canDelete ? 'Delete machine' : 'You do not have permission to delete Machines'}
              aria-label={`Delete Machine ${m.metadata.name}`}
              className="p-2 mr-2 text-slate-500 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            </div>
          );
        })}
      </div>
      {dialog}
    </Card>
  );
}

function HealthChecksCard({ healthChecks, failure, go }: { healthChecks: K8sResource[]; failure?: ReadFailure; go: (path: string, title: string) => void }) {
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Machine Health Checks{failure ? '' : ` (${healthChecks.length})`}</h2>
        <button onClick={() => go('/r/machine.openshift.io~v1beta1~machinehealthchecks', 'HealthChecks')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
      </div>
      <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
        {failure ? <ReadFailed what="MachineHealthChecks" failure={failure} /> : healthChecks.length === 0 ? <div className="px-4 py-6 text-center text-sm text-slate-500">No health checks configured</div> : (healthChecks as MachineHealthCheckResource[]).map((hc) => {
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

function AutoscalingCard({ clusterAutoscaler, machineAutoscalers, failures, go }: { clusterAutoscaler: K8sResource[]; machineAutoscalers: K8sResource[]; failures: Array<ReadFailure | undefined>; go: (path: string, title: string) => void }) {
  const [caFailure, maFailure] = failures;
  if (caFailure || maFailure) {
    // "Not configured" is only an answer when both reads succeeded.
    const what = caFailure && maFailure ? 'ClusterAutoscalers and MachineAutoscalers' : caFailure ? 'ClusterAutoscalers' : 'MachineAutoscalers';
    const failure = (caFailure ?? maFailure)!;
    return (
      <Card>
        <div className="px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-100">Autoscaling</h2>
        </div>
        <ReadFailed what={what} failure={{ error: failure.error, retry: () => { caFailure?.retry(); maFailure?.retry(); } }} />
      </Card>
    );
  }
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Autoscaling</h2>
        {clusterAutoscaler.length > 0 && <span className="text-xs px-1.5 py-0.5 bg-green-900/50 text-green-300 rounded-sm">Enabled</span>}
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
              <button onClick={() => go('/create/autoscaling.openshift.io~v1~clusterautoscalers', 'Create ClusterAutoscaler')} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-sm hover:bg-blue-500 flex items-center gap-1">
                Create ClusterAutoscaler <ArrowRight className="w-3 h-3" />
              </button>
              <button onClick={() => go('/create/autoscaling.openshift.io~v1beta1~machineautoscalers', 'Create MachineAutoscaler')} className="px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded-sm hover:bg-slate-700 flex items-center gap-1">
                Create MachineAutoscaler <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        ) : (
          <>
            {(clusterAutoscaler as ClusterAutoscalerResource[]).map((ca) => (
              <div key={ca.metadata.uid} className="p-3 bg-slate-800/50 rounded-sm border border-slate-700">
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
