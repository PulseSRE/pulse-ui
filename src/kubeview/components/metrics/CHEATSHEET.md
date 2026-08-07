# KubeView Metrics - Quick Reference

## Import Everything

```tsx
import {
  // Components
  MetricsChart,

  // Auto-Metrics
  getMetricsForResource,
  resolveQuery,
  formatYAxisValue,
  formatBytes,
  formatCores,
  formatPercent,
  formatRate,
  formatDuration,

  // Narrative
  buildNarrative,
  groupEvents,

  // Prometheus API
  queryRange,
  queryInstant,
  getMetricNames,
  seriesToDataPoints,
  getTimeRange,
  usePrometheusRange,

  // Types
  ChartSeries,
  DataPoint,
  MetricQuery,
  NarrativeEvent,
  PrometheusSeries,
} from '@/kubeview/components/metrics';
```

## Quick Examples

### Show CPU metrics for a Pod

```tsx
const queries = getMetricsForResource('v1/pods', pod);
const cpuQuery = queries.find(q => q.id === 'pod-cpu');
const resolved = resolveQuery(cpuQuery.query, {
  name: pod.metadata.name,
  namespace: pod.metadata.namespace || 'default',
});
const results = await queryRange(resolved, start, end);
const series = results.map(r => ({
  id: r.metric.container,
  label: r.metric.container,
  color: '#3b82f6',
  data: seriesToDataPoints(r),
}));
```

### Self-fetching sparkline / metric card

```tsx
import { Sparkline, MetricCard } from '@/kubeview/components/metrics/Sparkline';

<Sparkline query="rate(container_cpu_usage_seconds_total{pod=\"nginx-abc\"}[5m])" duration="1h" unit="%" />

<MetricCard
  title="API Latency (p99)"
  query='histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket[5m])) by (le))'
  unit="s"
  thresholds={{ warning: 1, critical: 5 }}
/>
```

### Synchronized charts

```tsx
const [hoverTime, setHoverTime] = useState(null);

<MetricsChart
  series={cpuSeries}
  hoverTimestamp={hoverTime}
  onHover={setHoverTime}
/>

<MetricsChart
  series={memorySeries}
  hoverTimestamp={hoverTime}
  onHover={setHoverTime}
/>
```

### Incident narrative

```tsx
const result = buildNarrative({
  events: k8sEvents,
  alerts: prometheusAlerts,
});
console.log(result.summary);
console.log(result.rootCause);
```

## Resource Type Support

| Resource Type | Metrics Available |
|--------------|-------------------|
| `v1/pods` | CPU, Memory, Network I/O, Restarts |
| `apps/v1/deployments` | CPU, Memory, Replicas, Available Replicas |
| `v1/nodes` | CPU, Memory, Disk, Pod Count |
| `apps/v1/statefulsets` | CPU, Memory, Replicas |
| `v1/namespaces` | CPU, CPU by Pod, Memory, Memory by Pod, Pod Count, Network RX/TX, Restarts |
| `project.openshift.io/v1/projects` | Same as namespaces (OpenShift Projects) |
| `apps/v1/daemonsets` | CPU, Memory, Desired Pods |

## Format Functions

| Function | Input | Output Example |
|----------|-------|----------------|
| `formatBytes(1536 * 1024 * 1024)` | bytes | `"1.50 GiB"` |
| `formatCores(0.25)` | cores | `"250m"` |
| `formatPercent(0.752)` | ratio | `"75.2%"` |
| `formatRate(1024)` | bytes/sec | `"1.0 KiB/s"` |
| `formatDuration(90)` | seconds | `"1.5m"` |

## Time Ranges

```tsx
// Last hour
const timeRange = [Math.floor(Date.now() / 1000) - 3600, Math.floor(Date.now() / 1000)];

// Or use helper
const timeRange = getTimeRange('1h');
const timeRange = getTimeRange('6h');
const timeRange = getTimeRange('24h');
const timeRange = getTimeRange('7d');
```

## React Hooks

```tsx
const { data, loading, error } = usePrometheusRange(
  'rate(container_cpu_usage_seconds_total[5m])',
  timeRange
);

const { data, loading, error } = usePrometheusInstant(
  'node_memory_MemAvailable_bytes'
);
```

## Chart Colors

Default palette:
- `#3b82f6` - Blue
- `#10b981` - Emerald
- `#f59e0b` - Amber
- `#ef4444` - Red
- `#8b5cf6` - Violet
- `#ec4899` - Pink

Thresholds:
- `#f59e0b` - Request (amber)
- `#ef4444` - Limit (red)

## Common PromQL Queries

```promql
# Pod CPU usage
rate(container_cpu_usage_seconds_total{pod="nginx-abc",namespace="default"}[5m])

# Pod memory
container_memory_working_set_bytes{pod="nginx-abc",namespace="default"}

# Node CPU
instance:node_cpu_utilisation:rate5m{instance="node-1"}

# Deployment replicas
kube_deployment_status_replicas{deployment="nginx",namespace="default"}
```

## Narrative Rules

1. **Image change + errors** → "Image update caused errors"
2. **Scale + CPU spike** → "Scaling caused resource contention"
3. **OOMKilled + memory ramp** → "Memory leak or insufficient limits"
4. **Node NotReady + pod rescheduling** → "Node failure caused pod disruption"
5. **Certificate alert** → "TLS certificate issue"
6. **Rollout + temporary errors** → "Rollout caused temporary errors"

## API Endpoints

- Range query: `/api/prometheus/api/v1/query_range`
- Instant query: `/api/prometheus/api/v1/query`
- Metric names: `/api/prometheus/api/v1/label/__name__/values`
- Label values: `/api/prometheus/api/v1/label/{name}/values`

## Testing

```bash
pnpm test -- src/kubeview/components/metrics
```

Coverage:
- ✅ Format functions (`AutoMetrics`, `prometheus.ts`)
- ✅ Narrative rules
- ✅ Query resolution
- ❌ No component-rendering or user-interaction tests exist yet

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Charts not showing | Check `/api/prometheus` proxy in rspack.config.ts |
| Threshold lines missing | Ensure threshold query returns scalar value |
| High memory usage | Reduce step size or limit time range |

## Performance

- **Step size**: `Math.max(15, (end - start) / 200)` for ~200 data points
- **Cache**: Store query results to avoid duplicate fetches
- **Debounce**: Wait 300ms before re-fetching on time range changes
- **Aggregate**: Use larger steps for 7d+ time ranges
