import React from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCircle, XCircle, AlertCircle, Clock, Globe,
  Server, Shield, Cpu, MemoryStick, Image,
  ChevronDown, ChevronRight, HardDrive, Play, Pause, Square,
} from 'lucide-react';
import { MetricCard } from '../../components/metrics/Sparkline';
import { sanitizePromQL } from '../../engine/query';
import type { K8sResource } from '../../engine/renderers';
import type { Pod, Container, ContainerPort, ContainerStatus, VolumeMount, Probe } from '../../engine/types';

interface PodSummaryProps {
  resource: K8sResource;
  go: (path: string, title: string) => void;
}

function formatAge(timestamp: string | undefined): string {
  if (!timestamp) return '—';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function ProbeTag({ label, probe }: { label: string; probe: Probe | undefined }) {
  if (!probe) return <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-600 rounded">{label}: none</span>;
  const type = probe.httpGet ? 'HTTP' : probe.tcpSocket ? 'TCP' : probe.exec ? 'Exec' : 'gRPC';
  const detail = probe.httpGet ? `:${probe.httpGet.port}${probe.httpGet.path || '/'}` :
    probe.tcpSocket ? `:${probe.tcpSocket.port}` : '';
  return (
    <span className="text-xs px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded" title={`${type}${detail}`}>
      {label}: {type}{detail}
    </span>
  );
}

function StateIcon({ state }: { state: ContainerStatus['state'] }) {
  if (!state) return <Square className="w-3.5 h-3.5 text-slate-500" />;
  if (state.running) return <Play className="w-3.5 h-3.5 text-green-500" />;
  if (state.waiting) return <Pause className="w-3.5 h-3.5 text-yellow-500" />;
  if (state.terminated) return <Square className="w-3.5 h-3.5 text-slate-400" />;
  return <Square className="w-3.5 h-3.5 text-slate-500" />;
}

export function PodSummary({ resource, go }: PodSummaryProps) {
  const spec = resource.spec as Pod['spec'];
  const status = (resource.status as Pod['status']) || {};
  const ns = resource.metadata.namespace || '';
  const name = resource.metadata.name;
  const [expandedContainers, setExpandedContainers] = React.useState<Set<string>>(new Set());

  const toggleContainer = (cname: string) => {
    setExpandedContainers(prev => {
      const next = new Set(prev);
      if (next.has(cname)) next.delete(cname); else next.add(cname);
      return next;
    });
  };

  const phase = status.phase || 'Unknown';
  const podIP = status.podIP || '—';
  const hostIP = status.hostIP || '';
  const nodeName = spec?.nodeName || '—';
  const qosClass = status.qosClass || '—';
  const serviceAccount = spec?.serviceAccountName || spec?.serviceAccount || '—';
  const restartPolicy = spec?.restartPolicy || 'Always';
  const containers: Container[] = spec?.containers || [];
  const initContainers: Container[] = spec?.initContainers || [];
  const volumes = spec?.volumes || [];
  const containerStatuses: ContainerStatus[] = status?.containerStatuses || [];
  const initContainerStatuses: ContainerStatus[] = status?.initContainerStatuses || [];
  const totalRestarts = containerStatuses.reduce((sum, cs) => sum + (cs.restartCount || 0), 0);
  const readyCount = containerStatuses.filter((cs) => cs.ready).length;
  const age = formatAge(resource.metadata.creationTimestamp);

  const phaseColor = phase === 'Running' ? 'text-green-400' :
    phase === 'Succeeded' ? 'text-blue-400' :
    phase === 'Failed' ? 'text-red-400' : 'text-yellow-400';
  const phaseBorder = phase === 'Running' && readyCount === containers.length ? 'border-green-800/50' :
    phase === 'Failed' ? 'border-red-800/50' : 'border-slate-800';

  const safeName = sanitizePromQL(name);
  const safeNs = sanitizePromQL(ns);

  return (
    <div className="space-y-4">
      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className={cn('bg-slate-900 rounded-lg border p-3', phaseBorder)}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Status</span>
            {phase === 'Running' && readyCount === containers.length
              ? <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              : phase === 'Failed' ? <XCircle className="w-3.5 h-3.5 text-red-500" />
              : <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />}
          </div>
          <div className={cn('text-xl font-bold', phaseColor)}>{phase}</div>
          <div className="text-xs text-slate-500 mt-0.5">{readyCount}/{containers.length} ready</div>
        </div>

        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Globe className="w-3 h-3" />Pod IP</div>
          <div className="text-sm font-mono font-bold text-slate-100 truncate">{podIP}</div>
          {hostIP && <div className="text-xs text-slate-500 mt-0.5">Host: {hostIP}</div>}
        </div>

        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Server className="w-3 h-3" />Node</div>
          <button onClick={() => nodeName !== '—' ? go(`/r/v1~nodes/_/${nodeName}`, nodeName) : undefined}
            className={cn('text-sm font-bold truncate block', nodeName !== '—' ? 'text-blue-400 hover:text-blue-300' : 'text-slate-100')}>
            {nodeName}
          </button>
          <div className="text-xs text-slate-500 mt-0.5">{qosClass}</div>
        </div>

        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1">Service Account</div>
          <div className="text-sm font-bold text-slate-100 truncate">{serviceAccount}</div>
          <div className="text-xs text-slate-500 mt-0.5">restart: {restartPolicy}</div>
        </div>

        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Clock className="w-3 h-3" />Age</div>
          <div className="text-lg font-bold text-slate-100">{age}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {resource.metadata.creationTimestamp ? new Date(resource.metadata.creationTimestamp).toLocaleDateString() : ''}
          </div>
        </div>

        <div className={cn('bg-slate-900 rounded-lg border p-3', totalRestarts > 10 ? 'border-red-800/50' : totalRestarts > 0 ? 'border-yellow-800/50' : 'border-slate-800')}>
          <div className="text-xs text-slate-400 mb-1">Restarts</div>
          <div className={cn('text-lg font-bold', totalRestarts > 10 ? 'text-red-400' : totalRestarts > 0 ? 'text-amber-400' : 'text-green-400')}>{totalRestarts}</div>
          <div className="text-xs text-slate-500 mt-0.5">{containers.length} container{containers.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* Pod metrics */}
      {ns && (
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            title="Pod CPU"
            query={`sum(rate(container_cpu_usage_seconds_total{pod="${safeName}",namespace="${safeNs}",container!="POD",container!=""}[5m])) * 1000`}
            unit=" m"
            color="#3b82f6"
          />
          <MetricCard
            title="Pod Memory"
            query={`sum(container_memory_working_set_bytes{pod="${safeName}",namespace="${safeNs}",container!="POD",container!=""}) / 1024 / 1024`}
            unit=" Mi"
            color="#8b5cf6"
          />
        </div>
      )}

      {/* Init containers */}
      {initContainers.length > 0 && (
        <div className="bg-slate-900 rounded-lg border border-slate-800">
          <div className="px-4 py-2.5 border-b border-slate-800">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Init Containers ({initContainers.length})</h3>
          </div>
          <div className="divide-y divide-slate-800">
            {initContainers.map((c, idx) => {
              const cs = initContainerStatuses.find((s) => s.name === c.name);
              const isReady = cs?.ready === true;
              const state = cs?.state;
              const stateLabel = state?.running ? 'Running' : state?.waiting ? (state.waiting.reason || 'Waiting') :
                state?.terminated ? (state.terminated.reason || 'Completed') : 'Pending';
              const terminated = state?.terminated;
              return (
                <div key={c.name} className="px-4 py-2.5 flex items-center gap-3">
                  <div className={cn('w-2 h-2 rounded-full shrink-0',
                    terminated?.exitCode === 0 ? 'bg-green-500' : isReady ? 'bg-blue-500' : state?.waiting ? 'bg-yellow-500' : 'bg-slate-500'
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{c.name}</span>
                      <span className={cn('text-xs px-1.5 py-0.5 rounded',
                        terminated?.exitCode === 0 ? 'bg-green-900/50 text-green-300' :
                        state?.waiting ? 'bg-yellow-900/50 text-yellow-300' : 'bg-slate-800 text-slate-400'
                      )}>{stateLabel}</span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono truncate mt-0.5">{c.image}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Containers — rich detail cards */}
      <div className="bg-slate-900 rounded-lg border border-slate-800">
        <div className="px-4 py-2.5 border-b border-slate-800">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Containers ({containers.length})</h3>
        </div>
        <div className="divide-y divide-slate-800">
          {containers.map((c) => {
            const cs = containerStatuses.find((s) => s.name === c.name);
            const isReady = cs?.ready === true;
            const restarts = cs?.restartCount ?? 0;
            const state = cs?.state;
            const stateLabel = state?.running ? 'Running' : state?.waiting ? (state.waiting.reason || 'Waiting') :
              state?.terminated ? (state.terminated.reason || 'Terminated') : 'Unknown';
            const started = state?.running?.startedAt;
            const hasLimits = c.resources?.limits?.cpu || c.resources?.limits?.memory;
            const hasRequests = c.resources?.requests?.cpu || c.resources?.requests?.memory;
            const envCount = (c.env?.length || 0) + (c.envFrom?.length || 0);
            const mountCount = c.volumeMounts?.length || 0;
            const isExpanded = expandedContainers.has(c.name);

            return (
              <div key={c.name}>
                <button onClick={() => toggleContainer(c.name)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-800/30 transition-colors text-left">
                  <StateIcon state={state} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-200">{c.name}</span>
                      <span className={cn('text-xs px-1.5 py-0.5 rounded',
                        isReady ? 'bg-green-900/50 text-green-300' :
                        state?.waiting ? 'bg-yellow-900/50 text-yellow-300' :
                        state?.terminated ? 'bg-slate-800 text-slate-400' : 'bg-yellow-900/50 text-yellow-300'
                      )}>{stateLabel}</span>
                      {restarts > 0 && (
                        <span className={cn('text-xs', restarts > 5 ? 'text-red-400' : 'text-orange-400')}>{restarts} restart{restarts !== 1 ? 's' : ''}</span>
                      )}
                      {c.ports && (
                        <span className="text-xs text-slate-500">
                          :{(c.ports as ContainerPort[]).map(p => p.containerPort).join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 font-mono truncate mt-0.5">{c.image}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {hasLimits ? (
                      <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded flex items-center gap-1">
                        <Cpu className="w-3 h-3" /> {c.resources.limits.cpu || '—'}
                        <MemoryStick className="w-3 h-3 ml-1" /> {c.resources.limits.memory || '—'}
                      </span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 bg-yellow-900/30 text-yellow-400 rounded">no limits</span>
                    )}
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-3 pl-10 space-y-3">
                    {/* Resources */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Requests</div>
                        {hasRequests ? (
                          <div className="text-xs text-slate-300 font-mono space-y-0.5">
                            {c.resources.requests.cpu && <div>CPU: {c.resources.requests.cpu}</div>}
                            {c.resources.requests.memory && <div>Memory: {c.resources.requests.memory}</div>}
                          </div>
                        ) : <div className="text-xs text-slate-600">none</div>}
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Limits</div>
                        {hasLimits ? (
                          <div className="text-xs text-slate-300 font-mono space-y-0.5">
                            {c.resources.limits.cpu && <div>CPU: {c.resources.limits.cpu}</div>}
                            {c.resources.limits.memory && <div>Memory: {c.resources.limits.memory}</div>}
                          </div>
                        ) : <div className="text-xs text-slate-600">none</div>}
                      </div>
                    </div>

                    {/* Probes */}
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Probes</div>
                      <div className="flex flex-wrap gap-1.5">
                        <ProbeTag label="liveness" probe={c.livenessProbe} />
                        <ProbeTag label="readiness" probe={c.readinessProbe} />
                        {c.startupProbe && <ProbeTag label="startup" probe={c.startupProbe} />}
                      </div>
                    </div>

                    {/* State details */}
                    {started && (
                      <div className="text-xs text-slate-500">
                        Started: {new Date(started).toLocaleString()}
                      </div>
                    )}
                    {state?.waiting?.message && (
                      <div className="text-xs text-yellow-400 bg-yellow-900/20 px-2 py-1 rounded">{state.waiting.message}</div>
                    )}
                    {state?.terminated && (
                      <div className="text-xs text-slate-400 space-y-0.5">
                        <div>Exit code: <span className={cn('font-mono', state.terminated.exitCode === 0 ? 'text-green-400' : 'text-red-400')}>{state.terminated.exitCode}</span></div>
                        {state.terminated.reason && <div>Reason: {state.terminated.reason}</div>}
                        {state.terminated.finishedAt && <div>Finished: {new Date(state.terminated.finishedAt).toLocaleString()}</div>}
                      </div>
                    )}

                    {/* Volume Mounts */}
                    {mountCount > 0 && (
                      <div>
                        <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Volume Mounts ({mountCount})</div>
                        <div className="space-y-0.5">
                          {(c.volumeMounts as VolumeMount[]).map((vm) => (
                            <div key={vm.mountPath} className="flex items-center gap-2 text-xs">
                              <HardDrive className="w-3 h-3 text-slate-500" />
                              <span className="text-slate-300 font-mono">{vm.mountPath}</span>
                              <span className="text-slate-500">{vm.name}</span>
                              {vm.readOnly && <span className="text-xs text-slate-600">(ro)</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Env summary */}
                    {envCount > 0 && (
                      <div className="text-xs text-slate-500">{envCount} environment variable{envCount !== 1 ? 's' : ''}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Volumes */}
      {volumes.length > 0 && (
        <div className="bg-slate-900 rounded-lg border border-slate-800">
          <div className="px-4 py-2.5 border-b border-slate-800">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Volumes ({volumes.length})</h3>
          </div>
          <div className="divide-y divide-slate-800">
            {volumes.map((v) => {
              const vol = v as { name: string; [key: string]: unknown };
              const type = vol.configMap ? 'ConfigMap' : vol.secret ? 'Secret' : vol.persistentVolumeClaim ? 'PVC' :
                vol.emptyDir ? 'EmptyDir' : vol.hostPath ? 'HostPath' : vol.downwardAPI ? 'DownwardAPI' :
                vol.projected ? 'Projected' : 'Other';
              const ref = (vol.configMap as Record<string, string> | undefined)?.name || (vol.secret as Record<string, string> | undefined)?.secretName || (vol.persistentVolumeClaim as Record<string, string> | undefined)?.claimName ||
                (vol.hostPath as Record<string, string> | undefined)?.path || '';
              return (
                <div key={v.name} className="px-4 py-2 flex items-center gap-3">
                  <HardDrive className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-200">{v.name}</span>
                  </div>
                  <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{type}</span>
                  {ref && (
                    <span className="text-xs text-slate-500 font-mono truncate max-w-48">{ref}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
