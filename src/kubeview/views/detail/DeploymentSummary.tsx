import React from 'react';
import { cn } from '@/lib/utils';
import {
  Box, CheckCircle, XCircle, AlertCircle, Clock,
  ArrowRight, Image, Cpu, MemoryStick, Shield, Loader2,
} from 'lucide-react';
import type { K8sResource } from '../../engine/renderers';
import type { Deployment, Pod, Container, ContainerPort, ContainerStatus } from '../../engine/types';

interface DeploymentSummaryProps {
  resource: K8sResource;
  managedPods: K8sResource[];
  go: (path: string, title: string) => void;
}

export function DeploymentSummary({ resource, managedPods, go }: DeploymentSummaryProps) {
  const spec = resource.spec as Deployment['spec'];
  const status = (resource.status as Deployment['status']) || {};
  const ns = resource.metadata.namespace;

  const replicas = spec?.replicas ?? 0;
  const readyReplicas = status.readyReplicas ?? 0;
  const updatedReplicas = status.updatedReplicas ?? 0;
  const availableReplicas = status.availableReplicas ?? 0;
  const unavailableReplicas = status.unavailableReplicas ?? 0;
  const strategy = spec?.strategy?.type || 'RollingUpdate';
  const maxUnavailable = spec?.strategy?.rollingUpdate?.maxUnavailable ?? '25%';
  const maxSurge = spec?.strategy?.rollingUpdate?.maxSurge ?? '25%';
  const containers: Container[] = spec?.template?.spec?.containers || [];
  const selector = spec?.selector?.matchLabels || {};
  const generation = resource.metadata.generation;
  const observedGeneration = status.observedGeneration;
  const isProgressing = generation !== observedGeneration;

  // Pod status breakdown
  const podsByPhase = React.useMemo(() => {
    const counts = { running: 0, pending: 0, failed: 0, succeeded: 0 };
    for (const pod of managedPods) {
      const phase = ((pod.status as Pod['status'])?.phase || 'Pending').toLowerCase();
      if (phase in counts) counts[phase as keyof typeof counts]++;
      else counts.pending++;
    }
    return counts;
  }, [managedPods]);

  const allHealthy = readyReplicas === replicas && replicas > 0 && unavailableReplicas === 0;

  // Age
  const age = React.useMemo(() => {
    const created = new Date(resource.metadata.creationTimestamp || '');
    const diff = Date.now() - created.getTime();
    const days = Math.floor(diff / 86400000);
    if (days > 30) return `${Math.floor(days / 30)}mo`;
    if (days > 0) return `${days}d`;
    const hours = Math.floor(diff / 3600000);
    if (hours > 0) return `${hours}h`;
    return `${Math.floor(diff / 60000)}m`;
  }, [resource.metadata.creationTimestamp]);

  return (
    <div className="space-y-4">
      {/* Status cards row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Replicas */}
        <div className={cn(
          'bg-slate-900 rounded-lg border p-3',
          allHealthy ? 'border-green-800/50' : unavailableReplicas > 0 ? 'border-red-800/50' : 'border-slate-800'
        )}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Replicas</span>
            {allHealthy ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> :
             isProgressing ? <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" /> :
             <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />}
          </div>
          <div className="flex items-baseline gap-1">
            <span className={cn('text-2xl font-bold', allHealthy ? 'text-green-400' : 'text-slate-100')}>{readyReplicas}</span>
            <span className="text-sm text-slate-500">/ {replicas}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {updatedReplicas} updated, {availableReplicas} available
          </div>
        </div>

        {/* Strategy */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1">Strategy</div>
          <div className="text-lg font-bold text-slate-100">{strategy}</div>
          {strategy === 'RollingUpdate' && (
            <div className="text-xs text-slate-500 mt-1">
              surge {maxSurge}, unavail {maxUnavailable}
            </div>
          )}
        </div>

        {/* Containers */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1">Containers</div>
          <div className="text-lg font-bold text-slate-100">{containers.length}</div>
          <div className="text-xs text-slate-500 mt-1 truncate">
            {containers.map(c => c.name).join(', ')}
          </div>
        </div>

        {/* Age */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1">Age</div>
          <div className="text-lg font-bold text-slate-100">{age}</div>
          <div className="text-xs text-slate-500 mt-1">
            Gen {generation}{observedGeneration !== generation ? ` (observed: ${observedGeneration})` : ''}
          </div>
        </div>
      </div>

      {/* Container images row */}
      <div className="bg-slate-900 rounded-lg border border-slate-800">
        <div className="px-4 py-2.5 border-b border-slate-800">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Container Images</h3>
        </div>
        <div className="divide-y divide-slate-800">
          {containers.map((c) => {
            const hasLimits = c.resources?.limits?.cpu && c.resources?.limits?.memory;
            const hasRequests = c.resources?.requests?.cpu && c.resources?.requests?.memory;
            const hasProbes = c.livenessProbe || c.readinessProbe;
            return (
              <div key={c.name} className="px-4 py-2.5 flex items-center gap-4">
                <Image className="w-4 h-4 text-blue-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">{c.name}</span>
                    {c.ports && (
                      <span className="text-xs text-slate-500">
                        :{(c.ports as ContainerPort[]).map(p => p.containerPort).join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 font-mono truncate mt-0.5">{c.image}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {hasLimits && (
                    <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded flex items-center gap-1">
                      <Cpu className="w-3 h-3" /> {c.resources.limits.cpu}
                      <MemoryStick className="w-3 h-3 ml-1" /> {c.resources.limits.memory}
                    </span>
                  )}
                  {!hasLimits && (
                    <span className="text-xs px-1.5 py-0.5 bg-yellow-900/30 text-yellow-400 rounded">no limits</span>
                  )}
                  {hasProbes ? (
                    <Shield className="w-3.5 h-3.5 text-green-500" title="Has probes" />
                  ) : (
                    <Shield className="w-3.5 h-3.5 text-slate-600" title="No probes" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pods breakdown */}
      <div className="bg-slate-900 rounded-lg border border-slate-800">
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Box className="w-3.5 h-3.5 text-blue-400" />
            Pods ({managedPods.length})
          </h3>
          <div className="flex items-center gap-3 text-xs">
            {podsByPhase.running > 0 && <span className="text-green-400">{podsByPhase.running} running</span>}
            {podsByPhase.pending > 0 && <span className="text-yellow-400">{podsByPhase.pending} pending</span>}
            {podsByPhase.failed > 0 && <span className="text-red-400">{podsByPhase.failed} failed</span>}
          </div>
        </div>
        <div className="divide-y divide-slate-800">
          {managedPods.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">No pods found</div>
          ) : (
            managedPods.map((pod) => {
              const podStatus = pod.status as Pod['status'];
              const podPhase = podStatus?.phase || 'Pending';
              const podContainerStatuses: ContainerStatus[] = podStatus?.containerStatuses || [];
              const ready = podContainerStatuses.filter((c) => c.ready).length;
              const total = podContainerStatuses.length || 1;
              const waiting = podContainerStatuses.find((c) => c.state?.waiting)?.state?.waiting;
              const restarts = podContainerStatuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);
              const podAge = (() => {
                const created = new Date(pod.metadata.creationTimestamp || '');
                const diff = Date.now() - created.getTime();
                const mins = Math.floor(diff / 60000);
                if (mins < 60) return `${mins}m`;
                const hours = Math.floor(mins / 60);
                if (hours < 24) return `${hours}h`;
                return `${Math.floor(hours / 24)}d`;
              })();
              const nodeName = (pod.spec as Pod['spec'] | undefined)?.nodeName || '';

              return (
                <button
                  key={pod.metadata.uid}
                  onClick={() => go(`/r/v1~pods/${pod.metadata.namespace}/${pod.metadata.name}`, pod.metadata.name)}
                  className="w-full px-4 py-2.5 text-left hover:bg-slate-800/50 transition-colors flex items-center gap-3"
                >
                  <div className={cn('w-2 h-2 rounded-full shrink-0',
                    podPhase === 'Running' && ready === total ? 'bg-green-500' :
                    podPhase === 'Failed' ? 'bg-red-500' : 'bg-yellow-500'
                  )} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-200 truncate block">{pod.metadata.name}</span>
                    {nodeName && <span className="text-xs text-slate-500">{nodeName}</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs">
                    {waiting && <span className="text-yellow-400">{waiting.reason}</span>}
                    {restarts > 0 && <span className="text-slate-500">{restarts} restarts</span>}
                    <span className="text-slate-500">{podAge}</span>
                    <span className={cn('font-mono', ready === total ? 'text-green-400' : 'text-yellow-400')}>{ready}/{total}</span>
                    <span className={cn('px-1.5 py-0.5 rounded',
                      podPhase === 'Running' ? 'bg-green-900/50 text-green-300' :
                      podPhase === 'Failed' ? 'bg-red-900/50 text-red-300' :
                      'bg-yellow-900/50 text-yellow-300'
                    )}>{podPhase}</span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Selector */}
      {Object.keys(selector).length > 0 && (
        <div className="bg-slate-900 rounded-lg border border-slate-800 px-4 py-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Selector</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(selector).map(([k, v]) => (
              <span key={k} className="text-xs font-mono px-2 py-1 bg-slate-800 text-slate-300 rounded">
                {k}={v as string}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
