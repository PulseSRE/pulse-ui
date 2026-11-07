import { useMemo, useState } from 'react';
import { PageHeader } from '../components/primitives/PageHeader';
import { useMetricsWindow } from '../hooks/useMetricsWindow';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Package, Server, Globe, Shield, Clock, AlertTriangle, CheckCircle, XCircle,
  Layers, FileText, BarChart3, HardDrive, Gauge, ExternalLink, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatCard } from '../components/primitives/StatCard';
import { Card } from '../components/primitives/Card';
import { LoadError } from '../components/primitives/LoadError';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { MetricCard } from '../components/metrics/Sparkline';
import { MetricsScope } from '../components/metrics/MetricsScope';
import { MetricsChart } from '../components/metrics/MetricsChart';
import { getMetricsForResource, resolveQuery, formatYAxisValue } from '../components/metrics/AutoMetrics';
import { CHART_COLOR_SEQUENCE, CHART_COLORS } from '../engine/colors';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { formatRelativeTime } from '../engine/formatters';
import { sanitizePromQL } from '../engine/query';
import { queryRange } from '../components/metrics/prometheus';
import { RemoteMetricsNotice } from '../components/metrics/RemoteMetricsNotice';
import { useActiveClusterId, useMetricsAvailable } from '../hooks/useClusterBase';
import type { Pod, Deployment, StatefulSet, DaemonSet, Service } from '../engine/types';
import type { K8sResource } from '../engine/renderers';
import { getPodStatus } from '../engine/renderers/statusUtils';
import { quantityToBytes, routeUrl } from '../engine/workloadActions';
import { Button } from '../components/primitives/Button';

/**
 * What the pod list shows: the raw phase, unless a container is failing.
 * A CrashLoopBackOff pod's phase is "Running", so the phase alone counted it
 * as healthy and drew a green check next to it.
 */
/** Reasons that mean "still starting", not "failing". */
const STARTING_REASONS = new Set(['PodInitializing', 'ContainerCreating']);

function podDisplayStatus(pod: K8sResource): string {
  const s = getPodStatus(pod);
  if (s.phase === 'Failed') return 'Failed';
  if (s.phase === 'Succeeded') return 'Succeeded';
  if (s.reason && STARTING_REASONS.has(s.reason)) return 'Pending';
  if (s.reason) return s.reason;
  return s.phase || 'Unknown';
}

export default function ProjectDashboard() {
  const { namespace } = useParams<{ namespace: string }>();
  const go = useNavigateTab();
  const ns = namespace || 'default';
  const safeNs = sanitizePromQL(ns);

  const { data: pods = [], isError: podsError } = useK8sListWatch<Pod>({ apiPath: '/api/v1/pods', namespace: ns });
  const { data: deployments = [], isError: deploymentsError } = useK8sListWatch<Deployment>({ apiPath: '/apis/apps/v1/deployments', namespace: ns });
  const { data: statefulsets = [], isError: statefulsetsError } = useK8sListWatch<StatefulSet>({ apiPath: '/apis/apps/v1/statefulsets', namespace: ns });
  const { data: daemonsets = [], isError: daemonsetsError } = useK8sListWatch<DaemonSet>({ apiPath: '/apis/apps/v1/daemonsets', namespace: ns });
  const { data: services = [], isError: servicesError } = useK8sListWatch<K8sResource>({ apiPath: '/api/v1/services', namespace: ns });
  const { data: configmaps = [], isError: configmapsError } = useK8sListWatch<K8sResource>({ apiPath: '/api/v1/configmaps', namespace: ns });
  const { data: events = [], isError: eventsError } = useK8sListWatch<K8sResource>({ apiPath: '/api/v1/events', namespace: ns });
  const { data: routes = [], isError: routesError } = useK8sListWatch<K8sResource>({ apiPath: '/apis/route.openshift.io/v1/routes', namespace: ns });
  const { data: pvcs = [], isError: pvcsError } = useK8sListWatch<K8sResource>({ apiPath: '/api/v1/persistentvolumeclaims', namespace: ns });
  const { data: quotas = [], isError: quotasError } = useK8sListWatch<K8sResource>({ apiPath: '/api/v1/resourcequotas', namespace: ns });
  /** The resource list for one kind, filtered to this project. */
  const list = (gvr: string, label: string) => () => go(`/r/${gvr}?ns=${encodeURIComponent(ns)}`, `${label} (${ns})`);

  const podStats = useMemo(() => {
    const s = { running: 0, pending: 0, failed: 0, total: pods.length };
    for (const p of pods) {
      const status = podDisplayStatus(p);
      if (status === 'Running') s.running++;
      else if (status === 'Pending') s.pending++;
      else if (status !== 'Succeeded') s.failed++;
    }
    return s;
  }, [pods]);

  // Count every warning; show the newest ten. (The count used to be capped at
  // 10 by the same slice that trimmed the list, which was not sorted.)
  const allWarningEvents = useMemo(
    () => events
      .filter((e: any) => e.type === 'Warning')
      .sort((a: any, b: any) => new Date(b.lastTimestamp || b.metadata?.creationTimestamp || 0).getTime() - new Date(a.lastTimestamp || a.metadata?.creationTimestamp || 0).getTime()),
    [events],
  );
  const warningEvents = useMemo(() => allWarningEvents.slice(0, 10), [allWarningEvents]);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-content mx-auto space-y-6">
        {/* Header */}
        <PageHeader
          icon={<Layers className="w-6 h-6 text-blue-500" />}
          title={ns}
          subtitle="Project overview — all resources at a glance"
          actions={<Button size="sm" onClick={() => go(`/create/apps~v1~deployments?ns=${encodeURIComponent(ns)}`, `Create in ${ns}`)}>
            <Plus className="w-3.5 h-3.5" /> Create in {ns}
          </Button>}
        />

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {/* A list that could not be read shows "—", not 0. */}
          <StatCard label="Pods" value={podsError ? '—' : pods.length} icon={<Server className="w-4 h-4 text-slate-400" />} ariaLabel={`Pods: ${podsError ? 'unknown' : pods.length} — open list`} onClick={list('v1~pods', 'Pods')}
            tone={podsError ? 'neutral' : podStats.failed > 0 ? 'danger' : 'success'} />
          <StatCard label="Deployments" value={deploymentsError ? '—' : deployments.length} icon={<Package className="w-4 h-4 text-blue-400" />} ariaLabel={`Deployments: ${deploymentsError ? 'unknown' : deployments.length} — open list`} onClick={list('apps~v1~deployments', 'Deployments')} />
          <StatCard label="StatefulSets" value={statefulsetsError ? '—' : statefulsets.length} icon={<Layers className="w-4 h-4 text-blue-400" />} ariaLabel={`StatefulSets: ${statefulsetsError ? 'unknown' : statefulsets.length} — open list`} onClick={list('apps~v1~statefulsets', 'StatefulSets')} />
          <StatCard label="DaemonSets" value={daemonsetsError ? '—' : daemonsets.length} icon={<Shield className="w-4 h-4 text-amber-400" />} ariaLabel={`DaemonSets: ${daemonsetsError ? 'unknown' : daemonsets.length} — open list`} onClick={list('apps~v1~daemonsets', 'DaemonSets')} />
          <StatCard label="Services" value={servicesError ? '—' : services.length} icon={<Globe className="w-4 h-4 text-cyan-400" />} ariaLabel={`Services: ${servicesError ? 'unknown' : services.length} — open list`} onClick={list('v1~services', 'Services')} />
          <StatCard label="ConfigMaps" value={configmapsError ? '—' : configmaps.length} icon={<FileText className="w-4 h-4 text-slate-400" />} ariaLabel={`ConfigMaps: ${configmapsError ? 'unknown' : configmaps.length} — open list`} onClick={list('v1~configmaps', 'ConfigMaps')} />
          <StatCard label="Events" value={eventsError ? '—' : allWarningEvents.length} icon={<AlertTriangle className="w-4 h-4 text-amber-400" />} ariaLabel={`Events: ${eventsError ? 'unknown' : allWarningEvents.length} — open list`} onClick={list('v1~events', 'Events')}
            tone={!eventsError && allWarningEvents.length > 0 ? 'warning' : undefined} />
        </div>

        {/* Metrics */}
        <MetricsScope>
        <MetricGrid>
          <MetricCard
            title="Pod CPU Usage"
            query={`sum(rate(container_cpu_usage_seconds_total{namespace="${safeNs}",container!=""}[5m])) / sum(kube_pod_container_resource_requests{namespace="${safeNs}",resource="cpu"}) * 100`}
            unit="%"
            color={CHART_COLORS.blue}
            thresholds={{ warning: 70, critical: 90 }}
          />
          <MetricCard
            title="Pod Memory Usage"
            query={`sum(container_memory_working_set_bytes{namespace="${safeNs}",container!=""}) / sum(kube_pod_container_resource_requests{namespace="${safeNs}",resource="memory"}) * 100`}
            unit="%"
            color={CHART_COLORS.violet}
            thresholds={{ warning: 75, critical: 90 }}
          />
          <MetricCard
            title="Container Restarts"
            query={`sum(rate(kube_pod_container_status_restarts_total{namespace="${safeNs}"}[1h])) * 3600`}
            unit="/h"
            color={CHART_COLORS.amber}
            thresholds={{ warning: 5, critical: 20 }}
          />
          <MetricCard
            title="Network Received"
            query={`sum(rate(container_network_receive_bytes_total{namespace="${safeNs}"}[5m])) / 1024`}
            unit=" KB/s"
            color={CHART_COLORS.cyan}
          />
        </MetricGrid>
        </MetricsScope>

        {/* Time-series metrics */}
        <NamespaceCharts namespace={ns} />

        {/* Pods */}
        <Card>
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-400" />
              Pods
            </h2>
            <div className="flex gap-2 text-xs">
              <span className="text-emerald-400">{podStats.running} running</span>
              {podStats.pending > 0 && <span className="text-amber-400">{podStats.pending} pending</span>}
              {podStats.failed > 0 && <span className="text-red-400">{podStats.failed} failing</span>}
            </div>
          </div>
          {podsError && <LoadError className="m-3" title="Pods could not be loaded" />}
          <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
            {pods.map((pod) => {
              const status = podDisplayStatus(pod);
              return (
                <button
                  key={pod.metadata.uid}
                  onClick={() => go(`/r/v1~pods/${ns}/${pod.metadata.name}`, pod.metadata.name)}
                  className="w-full px-4 py-2 flex items-center gap-3 text-left hover:bg-slate-800/50 transition-colors"
                >
                  {status === 'Running' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  ) : status === 'Pending' ? (
                    <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  )}
                  <span className="text-xs font-mono text-slate-300 truncate flex-1">{pod.metadata.name}</span>
                  <span className={cn('text-xs', status === 'Running' ? 'text-slate-500' : 'text-amber-400')}>{status}</span>
                </button>
              );
            })}
          </div>
        </Card>

        {deploymentsError && <LoadError title="Deployments could not be loaded" />}

        {/* Deployments */}
        {deployments.length > 0 && (
          <Card>
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-400" />
                Deployments ({deployments.length})
              </h2>
            </div>
            <div className="divide-y divide-slate-800">
              {deployments.map((dep) => {
                const ready = dep.status?.readyReplicas ?? 0;
                const desired = dep.spec?.replicas ?? 0;
                const healthy = ready === desired;
                return (
                  <button
                    key={dep.metadata.uid}
                    onClick={() => go(`/r/apps~v1~deployments/${ns}/${dep.metadata.name}`, dep.metadata.name)}
                    className="w-full px-4 py-2 flex items-center gap-3 text-left hover:bg-slate-800/50 transition-colors"
                  >
                    {healthy ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}
                    <span className="text-xs font-mono text-slate-300 truncate flex-1">{dep.metadata.name}</span>
                    <span className={cn('text-xs', healthy ? 'text-slate-500' : 'text-amber-400')}>
                      {ready}/{desired} ready
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {/* Quota usage */}
        <QuotaUsage quotas={quotas} error={quotasError} onOpen={list('v1~resourcequotas', 'ResourceQuotas')} />

        {/* Routes */}
        <Card>
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Globe className="w-4 h-4 text-cyan-400" /> Routes ({routesError ? '—' : routes.length})
            </h2>
            <button onClick={list('route.openshift.io~v1~routes', 'Routes')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
          </div>
          {routesError ? <LoadError className="m-3" title="Routes could not be loaded" /> : routes.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-500">No routes in {ns}.</p>
          ) : (
            <div className="divide-y divide-slate-800 max-h-48 overflow-auto">
              {routes.map((r) => {
                const url = routeUrl(r);
                return (
                  <div key={r.metadata.uid ?? r.metadata.name} className="flex items-center hover:bg-slate-800/50">
                    <button onClick={() => go(`/r/route.openshift.io~v1~routes/${ns}/${r.metadata.name}`, r.metadata.name)} className="flex-1 min-w-0 px-4 py-2 flex items-center gap-3 text-left">
                      <span className="text-xs font-mono text-slate-300 truncate">{r.metadata.name}</span>
                      <span className="text-xs text-slate-500 truncate">{url ?? 'no host yet'}</span>
                    </button>
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="p-2 mr-2 text-slate-500 hover:text-blue-400" aria-label={`Open ${url}`} title={`Open ${url}`}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* PVCs */}
        <Card>
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-orange-400" /> PersistentVolumeClaims ({pvcsError ? '—' : pvcs.length})
            </h2>
            <button onClick={list('v1~persistentvolumeclaims', 'PVCs')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
          </div>
          {pvcsError ? <LoadError className="m-3" title="PersistentVolumeClaims could not be loaded" /> : pvcs.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-500">No PersistentVolumeClaims in {ns}.</p>
          ) : (
            <div className="divide-y divide-slate-800 max-h-48 overflow-auto">
              {pvcs.map((p) => {
                const phase = (p.status as { phase?: string } | undefined)?.phase ?? 'Unknown';
                const spec = p.spec as { storageClassName?: string; resources?: { requests?: { storage?: string } } } | undefined;
                return (
                  <button key={p.metadata.uid ?? p.metadata.name} onClick={() => go(`/r/v1~persistentvolumeclaims/${ns}/${p.metadata.name}`, p.metadata.name)}
                    className="w-full px-4 py-2 flex items-center gap-3 text-left hover:bg-slate-800/50">
                    <span className="text-xs font-mono text-slate-300 truncate flex-1">{p.metadata.name}</span>
                    <span className="text-xs text-slate-500">{spec?.resources?.requests?.storage ?? '?'} · {spec?.storageClassName ?? 'default class'}</span>
                    <span className={cn('text-xs', phase === 'Bound' ? 'text-slate-500' : 'text-amber-400')}>{phase}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {eventsError && <LoadError title="Events could not be loaded" />}

        {/* Warning Events */}
        {warningEvents.length > 0 && (
          <Card>
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Recent Warning Events ({allWarningEvents.length}{allWarningEvents.length > warningEvents.length ? `, newest ${warningEvents.length} shown` : ''})
              </h2>
            </div>
            <div className="divide-y divide-slate-800 max-h-48 overflow-auto">
              {warningEvents.map((event: any, i: number) => (
                <div key={i} className="px-4 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-amber-400 font-medium">{event.reason}</span>
                    <span className="text-slate-500">{event.involvedObject?.kind}/{event.involvedObject?.name}</span>
                    <span className="ml-auto text-slate-600">{event.lastTimestamp ? formatRelativeTime(new Date(event.lastTimestamp).getTime()) : ''}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{event.message}</p>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function NamespaceCharts({ namespace }: { namespace: string }) {
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h'>('6h');
  const metricsAvailable = useMetricsAvailable();
  // Each chart manages its own hover state independently

  // A window held in state (advanced each minute), not Date.now() per render,
  // so re-renders do not change every chart's query key and refetch it.
  const { start, end, step } = useMetricsWindow({ '1h': 3600, '6h': 21600, '24h': 86400 }[timeRange]);

  const metricQueries = useMemo(
    () => getMetricsForResource('v1/namespaces', { metadata: { name: namespace } }),
    [namespace],
  );

  const vars = useMemo(() => ({ name: namespace, namespace }), [namespace]);

  // Show first 4 charts (CPU, CPU by pod, Memory, Memory by pod)
  const charts = metricQueries.slice(0, 4);

  if (charts.length === 0) return null;

  if (!metricsAvailable) {
    return (
      <Card>
        <RemoteMetricsNotice what="Resource metrics" />
      </Card>
    );
  }

  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          Resource Metrics
        </h2>
        <div className="flex bg-slate-800 rounded-sm text-xs">
          {(['1h', '6h', '24h'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={cn(
                'px-2.5 py-1 rounded-sm transition-colors',
                timeRange === range ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        {charts.map((mq, i) => (
          <NsMetricPanel
            key={mq.id}
            query={resolveQuery(mq.query, vars)}
            title={mq.title}
            yAxisLabel={mq.yAxisLabel}
            yAxisFormat={mq.yAxisFormat}
            colorIndex={i}
            start={start}
            end={end}
            step={step}
          />
        ))}
      </div>
    </Card>
  );
}

function NsMetricPanel({ query, title, yAxisLabel, yAxisFormat, colorIndex, start, end, step }: {
  query: string; title: string; yAxisLabel: string; yAxisFormat: string; colorIndex: number;
  start: number; end: number; step: number;
}) {
  const clusterId = useActiveClusterId();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['prometheus', query, start, end, step, clusterId],
    // Throws on a failed request, so the panel says so instead of "No data".
    queryFn: () => queryRange(query, start, end, step, clusterId),
    placeholderData: (prev) => prev,
  });

  const series = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    return data.map((result: { metric: Record<string, string>; values: [number, string][] }, idx: number) => ({
      id: `series-${idx}`,
      label: Object.values(result.metric || {}).join(', ') || title,
      data: (result.values || []).map(([ts, val]: [number, string]) => ({ timestamp: ts, value: parseFloat(val) })),
      color: CHART_COLOR_SEQUENCE[(colorIndex + idx) % CHART_COLOR_SEQUENCE.length],
      type: 'line' as const,
    }));
  }, [data, title, colorIndex]);

  const [localHover, setLocalHover] = useState<number | null>(null);

  if (isLoading) {
    return <div className="h-48 flex items-center justify-center text-sm text-slate-400" role="status">Checking…</div>;
  }
  if (isError) {
    return (
      <div className="h-48 flex flex-col justify-center">
        <LoadError title={`${title}: could not load metrics`} error={error} onRetry={() => { void refetch(); }} />
      </div>
    );
  }
  if (series.length === 0) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-1 text-sm text-slate-400" role="status">
        No data for this period
        <span className="text-[11px] text-slate-500">{title}</span>
      </div>
    );
  }


  return (
    <div className="h-48">
      <MetricsChart
        series={series}
        height={180}
        timeRange={[start, end]}
        yAxisLabel={yAxisLabel}
        yAxisFormat={(v: number) => formatYAxisValue(v, yAxisFormat)}
        showLegend={series.length > 1 && series.length <= 5}
        hoverTimestamp={localHover}
        onHover={setLocalHover}
      />
      <div className="text-[11px] text-slate-500 text-center mt-1">{title}</div>
    </div>
  );
}

/** Used/hard as a fraction; quantities compared in a common unit (cpu "500m" vs "2"). */
function quotaFraction(used: string | undefined, hard: string): number | null {
  const toNum = (q: string) => (/^\d+(\.\d+)?m$/.test(q) ? parseFloat(q) / 1000 : quantityToBytes(q));
  const h = toNum(hard);
  const u = toNum(used ?? '0');
  if (!Number.isFinite(h) || !Number.isFinite(u) || h <= 0) return null;
  return u / h;
}

function QuotaUsage({ quotas, error, onOpen }: { quotas: K8sResource[]; error: boolean; onOpen: () => void }) {
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-emerald-400" /> Quota usage
        </h2>
        <button onClick={onOpen} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
      </div>
      {error ? <LoadError className="m-3" title="ResourceQuotas could not be loaded" /> : quotas.length === 0 ? (
        <p className="px-4 py-3 text-xs text-slate-500">No ResourceQuota in this project: its usage is not limited.</p>
      ) : (
        <div className="p-4 space-y-4">
          {quotas.map((q) => {
            const status = q.status as { hard?: Record<string, string>; used?: Record<string, string> } | undefined;
            const hard = status?.hard ?? {};
            return (
              <div key={q.metadata.uid ?? q.metadata.name}>
                <div className="text-xs text-slate-400 mb-2">{q.metadata.name}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                  {Object.entries(hard).map(([res, h]) => {
                    const used = status?.used?.[res];
                    const f = quotaFraction(used, h);
                    const pct = f === null ? null : Math.round(f * 100);
                    return (
                      <div key={res}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-300 font-mono">{res}</span>
                          <span className={cn(pct !== null && pct >= 90 ? 'text-red-400' : pct !== null && pct >= 75 ? 'text-amber-400' : 'text-slate-400')}>
                            {used ?? '0'} / {h}{pct !== null ? ` (${pct}%)` : ''}
                          </span>
                        </div>
                        {pct !== null && (
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                            <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
