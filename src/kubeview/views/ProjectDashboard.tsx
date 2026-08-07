import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Package, Server, Globe, Shield, Clock, AlertTriangle, CheckCircle, XCircle,
  Layers, FileText, BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../components/primitives/Card';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { MetricCard } from '../components/metrics/Sparkline';
import { MetricsChart } from '../components/metrics/MetricsChart';
import { getMetricsForResource, resolveQuery, formatYAxisValue } from '../components/metrics/AutoMetrics';
import { CHART_COLOR_SEQUENCE, CHART_COLORS } from '../engine/colors';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { formatRelativeTime } from '../engine/formatters';
import { sanitizePromQL } from '../engine/query';
import type { Pod, Deployment, StatefulSet, DaemonSet, Service } from '../engine/types';
import type { K8sResource } from '../engine/renderers';
import { getPodStatus } from '../engine/renderers/statusUtils';

export default function ProjectDashboard() {
  const { namespace } = useParams<{ namespace: string }>();
  const go = useNavigateTab();
  const ns = namespace || 'default';
  const safeNs = sanitizePromQL(ns);

  const { data: pods = [] } = useK8sListWatch<Pod>({ apiPath: '/api/v1/pods', namespace: ns });
  const { data: deployments = [] } = useK8sListWatch<Deployment>({ apiPath: '/apis/apps/v1/deployments', namespace: ns });
  const { data: statefulsets = [] } = useK8sListWatch<StatefulSet>({ apiPath: '/apis/apps/v1/statefulsets', namespace: ns });
  const { data: daemonsets = [] } = useK8sListWatch<DaemonSet>({ apiPath: '/apis/apps/v1/daemonsets', namespace: ns });
  const { data: services = [] } = useK8sListWatch<K8sResource>({ apiPath: '/api/v1/services', namespace: ns });
  const { data: configmaps = [] } = useK8sListWatch<K8sResource>({ apiPath: '/api/v1/configmaps', namespace: ns });
  const { data: events = [] } = useK8sListWatch<K8sResource>({ apiPath: '/api/v1/events', namespace: ns });

  const podStats = useMemo(() => {
    const s = { running: 0, pending: 0, failed: 0, total: pods.length };
    for (const p of pods) {
      const status = getPodStatus(p);
      const phase = typeof status === 'string' ? status : status?.phase || '';
      if (phase === 'Running') s.running++;
      else if (phase === 'Pending') s.pending++;
      else if (phase === 'Failed' || phase === 'CrashLoop' || phase === 'Error') s.failed++;
    }
    return s;
  }, [pods]);

  const warningEvents = useMemo(
    () => events.filter((e: any) => e.type === 'Warning').slice(0, 10),
    [events],
  );

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Layers className="w-6 h-6 text-blue-500" />
            {ns}
          </h1>
          <p className="text-sm text-slate-400 mt-1">Project overview — all resources at a glance</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <SummaryCard label="Pods" count={pods.length} icon={<Server className="w-4 h-4" />}
            color={podStats.failed > 0 ? 'text-red-400' : 'text-emerald-400'} />
          <SummaryCard label="Deployments" count={deployments.length} icon={<Package className="w-4 h-4" />} color="text-blue-400" />
          <SummaryCard label="StatefulSets" count={statefulsets.length} icon={<Layers className="w-4 h-4" />} color="text-violet-400" />
          <SummaryCard label="DaemonSets" count={daemonsets.length} icon={<Shield className="w-4 h-4" />} color="text-amber-400" />
          <SummaryCard label="Services" count={services.length} icon={<Globe className="w-4 h-4" />} color="text-cyan-400" />
          <SummaryCard label="ConfigMaps" count={configmaps.length} icon={<FileText className="w-4 h-4" />} color="text-slate-400" />
          <SummaryCard label="Events" count={warningEvents.length} icon={<AlertTriangle className="w-4 h-4" />}
            color={warningEvents.length > 0 ? 'text-amber-400' : 'text-slate-400'} />
        </div>

        {/* Metrics */}
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

        {/* Time-series metrics */}
        <NamespaceCharts namespace={ns} />

        {/* Pods */}
        <Card>
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-400" />
              Pods ({pods.length})
            </h2>
            <div className="flex gap-2 text-xs">
              <span className="text-emerald-400">{podStats.running} running</span>
              {podStats.pending > 0 && <span className="text-amber-400">{podStats.pending} pending</span>}
              {podStats.failed > 0 && <span className="text-red-400">{podStats.failed} failing</span>}
            </div>
          </div>
          <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
            {pods.map((pod) => {
              const rawStatus = getPodStatus(pod);
              const status = typeof rawStatus === 'string' ? rawStatus : rawStatus?.phase || 'Unknown';
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

        {/* Warning Events */}
        {warningEvents.length > 0 && (
          <Card>
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Recent Warning Events ({warningEvents.length})
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
  // Each chart manages its own hover state independently

  const rangeSeconds = { '1h': 3600, '6h': 21600, '24h': 86400 }[timeRange];
  const end = Math.floor(Date.now() / 1000);
  const start = end - rangeSeconds;
  const step = Math.max(15, Math.floor(rangeSeconds / 200));

  const metricQueries = useMemo(
    () => getMetricsForResource('v1/namespaces', { metadata: { name: namespace } }),
    [namespace],
  );

  const vars = useMemo(() => ({ name: namespace, namespace }), [namespace]);

  // Show first 4 charts (CPU, CPU by pod, Memory, Memory by pod)
  const charts = metricQueries.slice(0, 4);

  if (charts.length === 0) return null;

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
  const { data, isLoading } = useQuery({
    queryKey: ['prometheus', query, start, end, step],
    queryFn: async () => {
      const params = new URLSearchParams({ query, start: String(start), end: String(end), step: String(step) });
      const res = await fetch(`/api/prometheus/api/v1/query_range?${params}`);
      if (!res.ok) return null;
      const json = await res.json();
      if (json.status !== 'success') return null;
      return json.data?.result || [];
    },
    refetchInterval: 60000,
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
    return <div className="h-48 flex items-center justify-center"><div className="kv-skeleton w-6 h-6 rounded-full" /></div>;
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

function SummaryCard({ label, count, icon, color }: { label: string; count: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-center">
      <div className={cn('flex items-center justify-center gap-1.5 mb-1', color)}>
        {icon}
        <span className="text-xl font-bold">{count}</span>
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
