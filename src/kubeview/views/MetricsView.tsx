import { useState, useMemo } from 'react';
import { LoadError } from '../components/primitives/LoadError';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { SubpageHeader } from '../components/primitives/SubpageHeader';
import { useClusterStore } from '../store/clusterStore';
import { kindFromPlural } from '../engine/topologyLinks';
import { MetricsChart } from '../components/metrics/MetricsChart';
import { getMetricsForResource, resolveQuery, formatYAxisValue } from '../components/metrics/AutoMetrics';
import { buildApiPath } from '../hooks/useResourceUrl';
import { CHART_COLOR_SEQUENCE } from '../engine/colors';
import { queryRange } from '../components/metrics/prometheus';
import { RemoteMetricsNotice } from '../components/metrics/RemoteMetricsNotice';
import { useActiveClusterId, useMetricsAvailable } from '../hooks/useClusterBase';
import { useMetricsWindow } from '../hooks/useMetricsWindow';

interface MetricsViewProps {
  gvrKey: string;
  namespace?: string;
  name: string;
}

type TimeRange = '1h' | '6h' | '24h' | '7d';

const TIME_RANGES: Record<TimeRange, number> = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '7d': 604800,
};

export default function MetricsView({ gvrKey, namespace, name }: MetricsViewProps) {
  const go = useNavigateTab();
  const clusterId = useActiveClusterId();
  const registry = useClusterStore((s) => s.resourceRegistry);
  const [timeRange, setTimeRange] = useState<TimeRange>('6h');
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const metricsAvailable = useMetricsAvailable();

  // The window is state that advances each minute, not Date.now() per render:
  // hovering a chart re-renders this view, and must not refetch every chart.
  const { start, end, step } = useMetricsWindow(TIME_RANGES[timeRange]);

  const metricQueries = useMemo(() => {
    return getMetricsForResource(gvrKey, { metadata: { name, namespace } });
  }, [gvrKey, name, namespace]);

  const vars = useMemo(() => ({
    name,
    namespace: namespace || 'default',
    pod: name,
    node: name,
  }), [name, namespace]);

  const gvrUrl = gvrKey.replace(/\//g, '~');
  const gvrParts = gvrKey.split('/');
  const plural = gvrParts[gvrParts.length - 1];
  const kind = (registry?.get(gvrKey) ?? registry?.get(`core/${gvrKey}`))?.kind || kindFromPlural(plural);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <SubpageHeader
        subpage="Metrics"
        resource={{ gvrUrl, kind, namespace, name }}
        go={go}
        clusterId={clusterId}
        actions={
          <div className="flex bg-slate-800 rounded-sm text-xs" role="group" aria-label="Time range">
            {(Object.keys(TIME_RANGES) as TimeRange[]).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setTimeRange(range)}
                aria-pressed={timeRange === range}
                className={cn(
                  'px-3 py-1.5 rounded-sm transition-colors',
                  timeRange === range
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {range}
              </button>
            ))}
          </div>
        }
      />

      {/* Charts */}
      <div className="flex-1 p-4 space-y-4 overflow-auto">
        {!metricsAvailable ? (
          <RemoteMetricsNotice />
        ) : metricQueries.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-slate-400">
            No metrics available for {plural}
          </div>
        ) : (
          metricQueries.map((mq) => (
            <MetricPanel
              key={mq.id}
              query={mq}
              vars={vars}
              start={start}
              end={end}
              step={step}
              hoverTime={hoverTime}
              onHover={setHoverTime}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface MetricPanelProps {
  query: { id: string; title: string; query: string; yAxisLabel: string; yAxisFormat: string; thresholds?: Array<{ query: string; label: string; color: string }> };
  vars: Record<string, string>;
  start: number;
  end: number;
  step: number;
  hoverTime: number | null;
  onHover: (t: number | null) => void;
}

function MetricPanel({ query: mq, vars, start, end, step, hoverTime, onHover }: MetricPanelProps) {
  const resolvedQuery = resolveQuery(mq.query, vars);
  const clusterId = useActiveClusterId();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['prometheus', resolvedQuery, start, end, step, clusterId],
    // Throws on a failed request, so the panel says so instead of "No data".
    queryFn: () => queryRange(resolvedQuery, start, end, step, clusterId),
    // The window advances every minute; keep the last chart on screen while
    // the next one loads instead of flashing a skeleton.
    placeholderData: (prev) => prev,
  });

  const series = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    const colors = [...CHART_COLOR_SEQUENCE];
    return data.map((result: { metric: Record<string, string>; values: [number, string][] }, idx: number) => ({
      id: `series-${idx}`,
      label: Object.entries(result.metric || {}).map(([k, v]) => `${k}="${v}"`).join(', ') || mq.title,
      data: (result.values || []).map(([ts, val]: [number, string]) => ({
        timestamp: ts,
        value: parseFloat(val),
      })),
      color: colors[idx % colors.length],
      type: 'line' as const,
    }));
  }, [data, mq.title]);

  const yFormat = (v: number) => formatYAxisValue(v, mq.yAxisFormat);

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-200">{mq.title}</h3>
        <span className="text-xs text-slate-500">{mq.yAxisLabel}</span>
      </div>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-sm text-slate-400" role="status">
          Checking…
        </div>
      ) : error ? (
        <div className="h-48 flex flex-col justify-center">
          <LoadError title="Could not load metrics" error={error} onRetry={() => { void refetch(); }} />
        </div>
      ) : series.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-400 text-sm" role="status">
          No data for this period
        </div>
      ) : (
        <MetricsChart
          series={series}
          height={200}
          timeRange={[start, end]}
          yAxisLabel={mq.yAxisLabel}
          yAxisFormat={yFormat}
          hoverTimestamp={hoverTime}
          onHover={onHover}
        />
      )}
    </div>
  );
}
