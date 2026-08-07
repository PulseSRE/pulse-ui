import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { MetricsChart } from '../components/metrics/MetricsChart';
import { getMetricsForResource, resolveQuery, formatYAxisValue } from '../components/metrics/AutoMetrics';
import { buildApiPath } from '../hooks/useResourceUrl';
import { CHART_COLOR_SEQUENCE } from '../engine/colors';

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
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState<TimeRange>('6h');
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const rangeSeconds = TIME_RANGES[timeRange];
  const end = Math.floor(Date.now() / 1000);
  const start = end - rangeSeconds;
  const step = Math.max(15, Math.floor(rangeSeconds / 200));

  const metricQueries = useMemo(() => {
    return getMetricsForResource(gvrKey, { metadata: { name, namespace } });
  }, [gvrKey, name, namespace]);

  const vars = useMemo(() => ({
    name,
    namespace: namespace || 'default',
    pod: name,
    node: name,
  }), [name, namespace]);

  const backPath = namespace
    ? `/r/${gvrKey.replace(/\//g, '~')}/${namespace}/${name}`
    : `/r/${gvrKey.replace(/\//g, '~')}/_/${name}`;

  const gvrParts = gvrKey.split('/');
  const kind = gvrParts[gvrParts.length - 1];

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(backPath)}
            className="p-1 rounded-sm hover:bg-slate-700 text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-sm text-slate-400">Metrics</span>
          <span className="text-sm font-medium">{name}</span>
          {namespace && (
            <span className="text-xs px-2 py-0.5 bg-slate-700 rounded-sm text-slate-300">{namespace}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-800 rounded-sm text-xs">
            {(Object.keys(TIME_RANGES) as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
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
        </div>
      </div>

      {/* Charts */}
      <div className="flex-1 p-4 space-y-4 overflow-auto">
        {metricQueries.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-slate-400">
            No metrics available for {kind}
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

  const { data, isLoading, error } = useQuery({
    queryKey: ['prometheus', resolvedQuery, start, end, step],
    queryFn: async () => {
      const params = new URLSearchParams({
        query: resolvedQuery,
        start: String(start),
        end: String(end),
        step: String(step),
      });
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
        <div className="h-48 flex items-center justify-center">
          <div className="kv-skeleton w-full h-full rounded-sm" />
        </div>
      ) : error || series.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
          {error ? 'Failed to fetch metrics' : 'No data available'}
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
