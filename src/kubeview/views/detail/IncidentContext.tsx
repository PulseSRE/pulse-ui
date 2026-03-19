import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { ScrollText, Loader2 } from 'lucide-react';
import { k8sLogs } from '../../engine/query';
import { MetricCard } from '../../components/metrics/Sparkline';
import type { K8sResource } from '../../engine/renderers';
import { useK8sListWatch } from '../../hooks/useK8sListWatch';

export function IncidentContext({ resource, managedPods, events, namespace, go }: {
  resource: K8sResource;
  managedPods: K8sResource[];
  events: K8sResource[];
  namespace?: string;
  go: (path: string, title: string) => void;
}) {
  const isPod = resource.kind === 'Pod';
  const isWorkload = resource.kind === 'Deployment' || resource.kind === 'StatefulSet' || resource.kind === 'DaemonSet';
  if (!isPod && !isWorkload) return null;

  const worstPod = React.useMemo(() => {
    if (isPod) return resource;
    if (managedPods.length === 0) return null;
    const scored = (managedPods as any[]).map(p => {
      const statuses = p.status?.containerStatuses || [];
      const waiting = statuses.find((c: any) => c.state?.waiting);
      const restarts = statuses.reduce((s: number, c: any) => s + (c.restartCount || 0), 0);
      const ready = statuses.filter((c: any) => c.ready).length;
      const total = statuses.length || 1;
      let score = 0;
      if (waiting?.state?.waiting?.reason === 'CrashLoopBackOff') score = 100;
      else if (waiting?.state?.waiting?.reason === 'ImagePullBackOff') score = 90;
      else if (p.status?.phase === 'Failed') score = 80;
      else if (p.status?.phase === 'Pending') score = 70;
      else if (restarts > 5) score = 60;
      else if (ready < total) score = 50;
      else score = restarts;
      return { pod: p, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.score > 0 ? scored[0].pod : null;
  }, [isPod, resource, managedPods]);

  const worstPodName = worstPod?.metadata?.name;
  const worstPodNs = worstPod?.metadata?.namespace;
  const podEventsPath = React.useMemo(() => {
    if (!worstPodName || !worstPodNs) return '';
    const fs = encodeURIComponent(`involvedObject.name=${worstPodName},involvedObject.kind=Pod`);
    return `/api/v1/namespaces/${worstPodNs}/events?fieldSelector=${fs}`;
  }, [worstPodName, worstPodNs]);

  const { data: podEvents = [] } = useK8sListWatch({
    apiPath: podEventsPath,
    enabled: !!worstPod && !isPod && !!worstPodName && !!podEventsPath,
  });

  const containers: any[] = isPod
    ? ((resource.spec as any)?.containers || [])
    : (worstPod?.spec?.containers || []);
  const [selectedContainer, setSelectedContainer] = React.useState<string>('');
  const [showPrevious, setShowPrevious] = React.useState(false);

  const activeContainer = selectedContainer || containers[0]?.name || '';
  const logPodName = isPod ? resource.metadata.name : worstPodName;
  const logPodNs = isPod ? namespace : worstPodNs;

  const { data: logText, isLoading: logsLoading } = useQuery({
    queryKey: ['incident-logs', logPodNs, logPodName, activeContainer, showPrevious],
    queryFn: () => logPodNs && logPodName
      ? k8sLogs(logPodNs, logPodName, activeContainer || undefined, {
          tailLines: 80,
          ...(showPrevious ? {} : {}),
        }).catch(() => '')
      : Promise.resolve(''),
    enabled: !!logPodName && !!logPodNs,
    staleTime: 15000,
  });

  const relevantEvents = React.useMemo(() => {
    const all = [...(events as any[]), ...(podEvents as any[])];
    const seen = new Set<string>();
    return all.filter(e => {
      const uid = e.metadata?.uid;
      if (seen.has(uid)) return false;
      seen.add(uid);
      return true;
    }).sort((a, b) =>
      new Date(b.lastTimestamp || b.firstTimestamp || 0).getTime() -
      new Date(a.lastTimestamp || a.firstTimestamp || 0).getTime()
    ).slice(0, 15);
  }, [events, podEvents]);

  const warningEvents = relevantEvents.filter((e: any) => e.type === 'Warning');

  const metricFilter = isPod
    ? `namespace="${namespace}",pod="${resource.metadata.name}"`
    : `namespace="${namespace}"`;

  if (!worstPod && !isPod) return null;

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-amber-400" />
          {isPod ? 'Debug Context' : `Incident Context — ${worstPod?.metadata?.name}`}
        </h2>
        {worstPod && !isPod && (
          <button onClick={() => go(`/r/v1~pods/${worstPodNs}/${worstPodName}`, worstPodName || '')}
            className="text-xs text-blue-400 hover:text-blue-300">View Pod →</button>
        )}
      </div>

      <div className="divide-y divide-slate-800">
        {relevantEvents.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-xs font-medium text-slate-400 mb-2">
              Events ({relevantEvents.length}){warningEvents.length > 0 && <span className="text-amber-400 ml-1">· {warningEvents.length} warnings</span>}
            </div>
            <div className="space-y-1.5 max-h-40 overflow-auto">
              {relevantEvents.slice(0, 10).map((event: any, idx: number) => {
                const isWarning = event.type === 'Warning';
                const age = event.lastTimestamp || event.firstTimestamp || '';
                const timeStr = age ? (() => {
                  const diff = Date.now() - new Date(age).getTime();
                  const mins = Math.floor(diff / 60000);
                  if (mins < 1) return 'just now';
                  if (mins < 60) return `${mins}m ago`;
                  return `${Math.floor(mins / 60)}h ago`;
                })() : '';
                return (
                  <div key={event.metadata?.uid || idx} className="flex items-start gap-2 text-xs">
                    <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', isWarning ? 'bg-amber-500' : 'bg-blue-500')} />
                    <div className="flex-1 min-w-0">
                      <span className={cn('font-medium', isWarning ? 'text-amber-300' : 'text-slate-300')}>{event.reason}</span>
                      <span className="text-slate-500 ml-1.5">{event.message}</span>
                    </div>
                    <span className="text-slate-600 shrink-0">{timeStr}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {logPodName && (
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-400">Logs</span>
                {containers.length > 1 && (
                  <select
                    value={activeContainer}
                    onChange={(e) => setSelectedContainer(e.target.value)}
                    className="text-xs bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-slate-300"
                  >
                    {containers.map((c: any) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                )}
                {containers.length === 1 && <span className="text-xs text-slate-500">{activeContainer}</span>}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={showPrevious} onChange={(e) => setShowPrevious(e.target.checked)}
                    className="rounded border-slate-600" />
                  Previous
                </label>
                <button onClick={() => go(`/logs/${logPodNs}/${logPodName}`, `${logPodName} (Logs)`)}
                  className="text-xs text-blue-400 hover:text-blue-300">Full logs →</button>
              </div>
            </div>
            {logsLoading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-slate-500"><Loader2 className="w-3 h-3 animate-spin" /> Loading logs...</div>
            ) : logText ? (
              <pre className="text-xs text-slate-400 font-mono bg-slate-950 rounded p-3 max-h-48 overflow-auto whitespace-pre-wrap">
                {logText.split('\n').slice(-50).join('\n') || 'No log output'}
              </pre>
            ) : (
              <div className="text-xs text-slate-500 py-2">No logs available</div>
            )}
          </div>
        )}

        {namespace && (
          <div className="px-4 py-3">
            <div className="text-xs font-medium text-slate-400 mb-2">Resource Usage</div>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                title="CPU"
                query={isPod
                  ? `sum(rate(container_cpu_usage_seconds_total{${metricFilter},pod="${resource.metadata.name}",container!=""}[5m])) * 1000`
                  : `sum(rate(container_cpu_usage_seconds_total{${metricFilter},container!=""}[5m])) * 1000`}
                unit="m"
                color="#3b82f6"
              />
              <MetricCard
                title="Memory"
                query={isPod
                  ? `sum(container_memory_working_set_bytes{${metricFilter},pod="${resource.metadata.name}",container!=""}) / 1024 / 1024`
                  : `sum(container_memory_working_set_bytes{${metricFilter},container!=""}) / 1024 / 1024`}
                unit=" Mi"
                color="#8b5cf6"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
