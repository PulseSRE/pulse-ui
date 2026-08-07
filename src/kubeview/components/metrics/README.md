# KubeView Metrics Components

This directory contains all metrics and monitoring components for KubeView.

## Components

### MetricsChart.tsx
Interactive SVG chart component for time-series metrics visualization.

**Features:**
- Pure SVG rendering (no external chart libraries)
- Multiple series support (line and area charts)
- Threshold lines (e.g., resource requests/limits)
- Hover tooltips with cross-chart synchronization
- Time range brush selection
- Responsive width, configurable height

**Usage:**
```tsx
import { MetricsChart } from '@/kubeview/components/metrics';

<MetricsChart
  series={[
    {
      id: 'cpu',
      label: 'CPU Usage',
      color: '#3b82f6',
      data: [
        { timestamp: 1704067200, value: 0.5 },
        { timestamp: 1704067260, value: 0.8 },
      ],
    },
  ]}
  height={200}
  yAxisLabel="CPU Cores"
  yAxisFormat={(v) => formatCores(v)}
  thresholds={[
    { value: 1.0, label: 'Limit', color: '#ef4444' },
  ]}
  onHover={(timestamp) => console.log('Hover:', timestamp)}
/>
```

### Sparkline.tsx
Minimal inline SVG sparkline chart for a single PromQL time series. Self-fetching — pass a query and it handles the range query, refresh, and rendering internally. **Not re-exported from the `index.ts` barrel** — import directly from the file.

**Features:**
- Pure SVG, no chart library dependency
- Self-fetches via `queryRange` + React Query, with configurable `refreshInterval` (default 60s) for live auto-refresh
- Shows current value with unit suffix
- "No data" fallback state

**Usage:**
```tsx
import { Sparkline } from '@/kubeview/components/metrics/Sparkline';

<Sparkline
  query="rate(container_cpu_usage_seconds_total{pod=\"nginx-abc\"}[5m])"
  duration="1h"
  color="#3b82f6"
  unit="%"
  label="CPU"
/>
```

### MetricCard
Also exported from `Sparkline.tsx` (same direct-import caveat as above). A card-styled sparkline with title, current value, trend arrow, and optional warning/critical thresholds that recolor the value and line. Used throughout the app (`ControlPlaneMetrics.tsx`, `ComputeView.tsx`, `NetworkingView.tsx`, `StorageView.tsx`, `WorkloadsView.tsx`, `AlertsView.tsx`, and more).

**Usage:**
```tsx
import { MetricCard } from '@/kubeview/components/metrics/Sparkline';

<MetricCard
  title="API Latency (p99)"
  query='histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket[5m])) by (le))'
  unit="s"
  color="#3b82f6"
  thresholds={{ warning: 1, critical: 5 }}
/>
```

### ControlPlaneMetrics.tsx
Production dashboard of `MetricCard`s for OpenShift control-plane health: API latency (p99), API error rate, API request rate, and (on non-HyperShift clusters) etcd leader status, etcd WAL fsync latency, and etcd DB size. On HyperShift clusters it swaps the etcd cards for a single "Hosted CP Requests" card, since etcd isn't directly observable. Also **not re-exported from the barrel** — import directly.

**Usage:**
```tsx
import { ControlPlaneMetrics } from '@/kubeview/components/metrics/ControlPlaneMetrics';

<ControlPlaneMetrics />
```

### AutoMetrics.ts
Mapping from Kubernetes resource types to Prometheus queries.

**Features:**
- Predefined metrics for Pods, Deployments, Nodes, StatefulSets, DaemonSets
- Template variable resolution (${namespace}, ${name}, etc.)
- Format helpers for bytes, cores, percent, rate, duration

**Usage:**
```tsx
import {
  getMetricsForResource,
  resolveQuery,
  formatBytes,
  formatCores,
} from '@/kubeview/components/metrics';

// Get metrics for a resource
const queries = getMetricsForResource('v1/pods', {
  metadata: { name: 'nginx-abc123', namespace: 'default' },
});

// Resolve template variables
const query = resolveQuery(queries[0].query, {
  name: 'nginx-abc123',
  namespace: 'default',
});

// Format values
console.log(formatBytes(1536 * 1024 * 1024)); // "1.50 GiB"
console.log(formatCores(0.25));                 // "250m"
```

**Supported Resource Types:**
- `v1/pods`: CPU, Memory, Network I/O, Restarts
- `apps/v1/deployments`: CPU, Memory, Replicas, Available Replicas
- `v1/nodes`: CPU, Memory, Disk, Pod Count
- `apps/v1/statefulsets`: CPU, Memory, Replicas
- `v1/namespaces`: CPU, CPU by Pod, Memory, Memory by Pod, Pod Count, Network RX/TX, Restarts
- `project.openshift.io/v1/projects`: Same metrics as namespaces (OpenShift Projects)
- `apps/v1/daemonsets`: CPU, Memory, Desired Pods

### prometheus.ts
Low-level Prometheus/Thanos API client used by `Sparkline`, `MetricCard`, and the CHEATSHEET/INTEGRATION examples above.

**Features:**
- `queryRange(query, start, end, step?)` / `queryInstant(query, time?)` — execute PromQL against the `/api/prometheus` proxy
- `getMetricNames()` / `getLabelValues(labelName)` — for autocomplete-style lookups
- `seriesToDataPoints(series)` — convert a `PrometheusSeries` into `{ timestamp, value }[]` for `MetricsChart`
- `parseDuration(duration)` / `formatDuration(seconds)` / `getTimeRange(duration)` — Prometheus duration string helpers (e.g. `"1h"`, `"6h"`, `"24h"`, `"7d"`)
- `usePrometheusRange(query, timeRange, enabled?)` / `usePrometheusInstant(query, enabled?)` — React hooks wrapping the above with `loading`/`error`/`data` state

**Usage:**
```tsx
import { queryRange, getTimeRange, usePrometheusRange } from '@/kubeview/components/metrics';

const [start, end] = getTimeRange('1h');
const series = await queryRange('rate(container_cpu_usage_seconds_total[5m])', start, end);

// or as a hook
const { data, loading, error } = usePrometheusRange(
  'rate(container_cpu_usage_seconds_total[5m])',
  getTimeRange('1h')
);
```

### Narrative.ts
Rule-based incident story builder.

**Features:**
- Analyzes K8s events, alerts, and metric anomalies
- Identifies root cause using pattern matching rules
- Generates human-readable narrative
- Groups events by time windows
- No AI/LLM required

**Usage:**
```tsx
import { buildNarrative, groupEvents } from '@/kubeview/components/metrics';

const result = buildNarrative({
  events: k8sEvents,
  alerts: prometheusAlerts,
  metricAnomalies: [
    { timestamp: 1704067200, metric: 'cpu_usage', value: 0.95, threshold: 0.8, direction: 'above' },
  ],
});

console.log(result.summary);
console.log(result.rootCause);

const groups = groupEvents(result.events);
// Display grouped events in timeline
```

**Narrative Rules:**
1. Image change + error burst → "Image update caused errors"
2. Scale event + CPU spike → "Scaling caused resource contention"
3. OOMKilled + memory ramp → "Memory leak or insufficient limits"
4. Node NotReady + pod rescheduling → "Node failure caused pod disruption"
5. Certificate alert → "TLS certificate issue"
6. Rollout + temporary errors → "Rollout caused temporary errors"

## Testing

Tests are located in `__tests__/`:
- `metrics.test.tsx` — `AutoMetrics` (`getMetricsForResource`, `resolveQuery`, format functions) and `Narrative.buildNarrative` rule matching. No component-rendering or user-interaction tests exist today.
- `prometheus.test.ts` — `prometheus.ts` API client functions (`queryRange`, `queryInstant`, `getMetricNames`, `getLabelValues`, `seriesToDataPoints`, `parseDuration`, `formatDuration`, `getTimeRange`)

Run tests with:
```bash
pnpm test -- src/kubeview/components/metrics
```

## Integration

All components use:
- React 19 with TypeScript
- Tailwind CSS for styling
- `cn()` utility from `@/lib/utils`
- lucide-react for icons
- Prometheus/Thanos at `/api/prometheus`
- K8s API at `/api/kubernetes`

## Color Palette

Default chart series colors:
- Blue: `#3b82f6`
- Emerald: `#10b981`
- Amber: `#f59e0b`
- Red: `#ef4444`
- Violet: `#8b5cf6`
- Pink: `#ec4899`

Threshold colors:
- Request: `#f59e0b` (amber)
- Limit: `#ef4444` (red)

## Dependencies

No external chart libraries required. All SVG rendering is done manually for:
- Full control over appearance
- Minimal bundle size
- No version conflicts
- Perfect Tailwind integration
