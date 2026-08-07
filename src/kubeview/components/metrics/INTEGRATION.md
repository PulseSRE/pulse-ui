# KubeView Metrics Integration Guide

This guide shows how to integrate the metrics components into KubeView views.

## Quick Start

### 1. Basic Chart with Auto-Metrics

```tsx
import React, { useEffect, useState } from 'react';
import {
  MetricsChart,
  getMetricsForResource,
  resolveQuery,
  queryRange,
  seriesToDataPoints,
  formatYAxisValue,
} from '@/kubeview/components/metrics';
import type { ChartSeries } from '@/kubeview/components/metrics';

export function PodMetricsView({ pod }: { pod: K8sResource }) {
  const [series, setSeries] = useState<ChartSeries[]>([]);
  const timeRange: [number, number] = [
    Math.floor(Date.now() / 1000) - 3600,
    Math.floor(Date.now() / 1000),
  ];

  useEffect(() => {
    async function loadMetrics() {
      // Get auto-generated queries for this pod
      const queries = getMetricsForResource('v1/pods', pod);
      const cpuQuery = queries.find((q) => q.id === 'pod-cpu');

      if (!cpuQuery) return;

      // Resolve template variables
      const query = resolveQuery(cpuQuery.query, {
        name: pod.metadata.name,
        namespace: pod.metadata.namespace || 'default',
      });

      // Fetch data from Prometheus
      const results = await queryRange(query, timeRange[0], timeRange[1]);

      // Convert to chart series
      const chartSeries: ChartSeries[] = results.map((result, i) => ({
        id: `cpu-${i}`,
        label: result.metric.container || 'Container',
        color: ['#3b82f6', '#10b981', '#f59e0b'][i % 3],
        data: seriesToDataPoints(result),
      }));

      setSeries(chartSeries);
    }

    loadMetrics();
  }, [pod.metadata.name, pod.metadata.namespace]);

  return (
    <MetricsChart
      series={series}
      height={250}
      timeRange={timeRange}
      yAxisLabel="CPU Cores"
      yAxisFormat={(v) => formatYAxisValue(v, 'cores')}
      showLegend={true}
    />
  );
}
```

### 2. Self-Fetching Sparkline / MetricCard

`Sparkline` and `MetricCard` (in `Sparkline.tsx`, imported directly — not part of the `index.ts` barrel) handle their own data fetching, so you don't need to wire up `queryRange`/`useState` yourself for simple cases:

```tsx
import { Sparkline, MetricCard } from '@/kubeview/components/metrics/Sparkline';

export function QuickResourceMetrics() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <MetricCard
        title="CPU Usage"
        query='rate(container_cpu_usage_seconds_total{pod="nginx-abc",container!="",container!="POD"}[5m])'
        unit=""
        thresholds={{ warning: 0.8, critical: 1.2 }}
      />
      <Sparkline
        query='container_memory_working_set_bytes{pod="nginx-abc"}'
        unit=" B"
        label="Mem"
      />
    </div>
  );
}
```

Both components refresh themselves on an interval (`refreshInterval`, default 60s) via React Query, so no manual polling is needed.

### 3. Synchronized Charts

```tsx
import { MetricsChart } from '@/kubeview/components/metrics';

export function CorrelationView() {
  const [timeRange, setTimeRange] = useState<[number, number]>([
    Math.floor(Date.now() / 1000) - 3600,
    Math.floor(Date.now() / 1000),
  ]);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      {/* CPU Chart - synchronized hover */}
      <MetricsChart
        series={cpuSeries}
        height={200}
        timeRange={timeRange}
        yAxisLabel="CPU"
        hoverTimestamp={hoverTime}
        onHover={setHoverTime}
      />

      {/* Memory Chart - synchronized hover */}
      <MetricsChart
        series={memorySeries}
        height={200}
        timeRange={timeRange}
        yAxisLabel="Memory"
        hoverTimestamp={hoverTime}
        onHover={setHoverTime}
      />
    </div>
  );
}
```

### 4. Incident Narrative

```tsx
import { buildNarrative, groupEvents } from '@/kubeview/components/metrics';

export function IncidentAnalysis() {
  const [narrative, setNarrative] = useState(null);

  useEffect(() => {
    async function analyze() {
      // Fetch K8s events
      const k8sEvents = await fetchEvents(namespace);

      // Fetch Prometheus alerts
      const alerts = await fetchAlerts();

      // Build narrative
      const result = buildNarrative({
        events: k8sEvents,
        alerts,
      });

      setNarrative(result);
    }

    analyze();
  }, []);

  if (!narrative) return <div>Loading...</div>;

  const groups = groupEvents(narrative.events);

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded p-4">
        <h3 className="font-medium mb-2">Summary</h3>
        <p className="text-sm">{narrative.summary}</p>

        {narrative.rootCause && (
          <>
            <h3 className="font-medium mt-4 mb-2">Root Cause</h3>
            <p className="text-sm text-amber-400">{narrative.rootCause}</p>
          </>
        )}
      </div>

      {/* Timeline grouped by time windows */}
      {groups.map((group, i) => (
        <div key={i} className="bg-slate-800 rounded p-3">
          <h4 className="text-sm font-medium mb-2">{group.title}</h4>
          {group.events.map((event, j) => (
            <div key={j} className="text-sm">
              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                event.type === 'action' ? 'bg-blue-500' :
                event.type === 'symptom' ? 'bg-red-500' : 'bg-green-500'
              }`} />
              {event.description}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

## Common Patterns

### Time Range Selector

```tsx
function TimeRangeSelector({ onChange }: { onChange: (range: [number, number]) => void }) {
  const ranges = [
    { label: '1h', seconds: 3600 },
    { label: '6h', seconds: 21600 },
    { label: '24h', seconds: 86400 },
    { label: '7d', seconds: 604800 },
  ];

  return (
    <div className="flex gap-2">
      {ranges.map((range) => (
        <button
          key={range.label}
          onClick={() => {
            const now = Math.floor(Date.now() / 1000);
            onChange([now - range.seconds, now]);
          }}
          className="px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-600"
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
```

### Multi-Chart Dashboard

```tsx
function MetricsDashboard({ resource }: { resource: K8sResource }) {
  const queries = getMetricsForResource(gvrKey, resource);
  const [timeRange, setTimeRange] = useState<[number, number]>([
    Math.floor(Date.now() / 1000) - 3600,
    Math.floor(Date.now() / 1000),
  ]);

  return (
    <div className="space-y-4">
      <TimeRangeSelector onChange={setTimeRange} />

      {queries.map((query) => (
        <ResourceMetricChart
          key={query.id}
          query={query}
          resource={resource}
          timeRange={timeRange}
        />
      ))}
    </div>
  );
}

// Note: this is a hand-rolled example component distinct from the real
// `MetricCard` exported by `Sparkline.tsx` (see above) — it's named
// differently here to avoid confusion with that self-fetching component.
function ResourceMetricChart({ query, resource, timeRange }) {
  const [series, setSeries] = useState<ChartSeries[]>([]);

  useEffect(() => {
    async function load() {
      const resolved = resolveQuery(query.query, {
        name: resource.metadata.name,
        namespace: resource.metadata.namespace || 'default',
      });

      const results = await queryRange(resolved, timeRange[0], timeRange[1]);
      setSeries(results.map((r, i) => ({
        id: `${query.id}-${i}`,
        label: r.metric[query.series?.replace('${', '').replace('}', '')] || query.title,
        color: ['#3b82f6', '#10b981'][i % 2],
        data: seriesToDataPoints(r),
      })));
    }

    load();
  }, [query, resource, timeRange]);

  return (
    <div className="bg-slate-800 rounded p-4">
      <h3 className="text-sm font-medium mb-2">{query.title}</h3>
      <MetricsChart
        series={series}
        height={200}
        timeRange={timeRange}
        yAxisLabel={query.yAxisLabel}
        yAxisFormat={(v) => formatYAxisValue(v, query.yAxisFormat)}
      />
    </div>
  );
}
```

### React Hooks for Prometheus

```tsx
import { usePrometheusRange } from '@/kubeview/components/metrics';

function QuickMetrics({ query }: { query: string }) {
  const timeRange: [number, number] = [
    Math.floor(Date.now() / 1000) - 3600,
    Math.floor(Date.now() / 1000),
  ];

  const { data, loading, error } = usePrometheusRange(query, timeRange);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  const series: ChartSeries[] = data.map((result, i) => ({
    id: `series-${i}`,
    label: result.metric.__name__ || `Series ${i + 1}`,
    color: '#3b82f6',
    data: seriesToDataPoints(result),
  }));

  return <MetricsChart series={series} height={250} timeRange={timeRange} />;
}
```

## Adding to Resource Detail Pages

Add a "Metrics" tab to any resource detail page:

```tsx
// In ResourceDetailPage.tsx or similar

import { MetricsChart, getMetricsForResource } from '@/kubeview/components/metrics';

function PodDetailPage({ pod }: { pod: K8sResource }) {
  const tabs = [
    { id: 'overview', label: 'Overview', content: <PodOverview pod={pod} /> },
    { id: 'metrics', label: 'Metrics', content: <PodMetrics pod={pod} /> },
    { id: 'logs', label: 'Logs', content: <PodLogs pod={pod} /> },
    { id: 'yaml', label: 'YAML', content: <YAMLEditor resource={pod} /> },
  ];

  return <TabbedView tabs={tabs} />;
}

function PodMetrics({ pod }: { pod: K8sResource }) {
  const queries = getMetricsForResource('v1/pods', pod);
  // Render charts for each query...
}
```

## Performance Tips

1. **Debounce time range changes**: Avoid re-fetching on every slider move
2. **Limit step size**: Use `Math.max(15, (end - start) / 200)` for reasonable data density
3. **Cache queries**: Store recent query results to avoid duplicate fetches
4. **Use instant queries for current values**: For dashboards showing "current CPU", use `queryInstant()`
5. **Aggregate long time ranges**: For 7d+ views, use larger step sizes or aggregate queries

## Troubleshooting

### "Prometheus query failed: 404"
- Verify `/api/prometheus` proxy is configured in rspack.config.ts
- Check that Thanos or Prometheus is running and accessible

### Charts not updating
- Ensure `timeRange` prop changes trigger useEffect dependencies
- Check browser console for fetch errors

### Threshold lines not showing
- Ensure threshold queries return scalar values
- Check that threshold values are within the Y-axis range

## Next Steps

- Implement zoom controls (brush selection already supported)
- Add export to CSV/PNG
- Integrate with Alertmanager for silencing
- Add custom dashboard builder with drag-and-drop
