/**
 * p95 memory working set and CPU of a pod's containers over the last 6 hours,
 * from Prometheus. "Unknown" carries the reason (metrics are local-cluster
 * only, the query failed, or there are no samples) so a tile can say "—"
 * and why instead of showing 0.
 */
import { useQuery } from '@tanstack/react-query';
import { sanitizePromQL } from '../../engine/query';
import { metricsAvailableFor, queryInstant } from '../../components/metrics/prometheus';
import { useFleetStore } from '../../store/fleetStore';

export const USAGE_WINDOW = '6h';

export type UsageResult =
  | { state: 'ok'; memory: Record<string, number>; cpu: Record<string, number> }
  | { state: 'unknown'; reason: string };

export function podUsageQueries(namespace: string, pod: string): { memory: string; cpu: string } {
  const sel = `namespace="${sanitizePromQL(namespace)}",pod="${sanitizePromQL(pod)}",container!="",container!="POD"`;
  return {
    memory: `max by (container) (quantile_over_time(0.95, container_memory_working_set_bytes{${sel}}[${USAGE_WINDOW}]))`,
    cpu: `max by (container) (quantile_over_time(0.95, rate(container_cpu_usage_seconds_total{${sel}}[5m])[${USAGE_WINDOW}:5m]))`,
  };
}

/** Pods named in `pods` (e.g. a Deployment's), by container across all of them. */
export function workloadUsageQueries(namespace: string, pods: string[]): { memory: string; cpu: string } {
  const names = pods.map(sanitizePromQL).map((n) => n.replace(/\./g, '\\\\.')).join('|');
  const sel = `namespace="${sanitizePromQL(namespace)}",pod=~"${names}",container!="",container!="POD"`;
  return {
    memory: `max by (container) (quantile_over_time(0.95, container_memory_working_set_bytes{${sel}}[${USAGE_WINDOW}]))`,
    cpu: `max by (container) (quantile_over_time(0.95, rate(container_cpu_usage_seconds_total{${sel}}[5m])[${USAGE_WINDOW}:5m]))`,
  };
}

async function readUsage(q: { memory: string; cpu: string }, clusterId: string): Promise<UsageResult> {
  try {
    const [mem, cpu] = await Promise.all([queryInstant(q.memory, undefined, clusterId), queryInstant(q.cpu, undefined, clusterId)]);
    if (mem.length === 0 && cpu.length === 0) return { state: 'unknown', reason: `no samples in the last ${USAGE_WINDOW}` };
    const toMap = (rows: Array<{ metric: Record<string, string>; value: number }>) =>
      Object.fromEntries(rows.filter((r) => r.metric.container && Number.isFinite(r.value)).map((r) => [r.metric.container, r.value]));
    return { state: 'ok', memory: toMap(mem), cpu: toMap(cpu) };
  } catch (e) {
    return { state: 'unknown', reason: e instanceof Error ? e.message : 'metrics query failed' };
  }
}

export function usePodUsage(namespace: string, pods: string[]): { usage: UsageResult | undefined; isLoading: boolean } {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const remote = !metricsAvailableFor(clusterId);
  const key = [...pods].sort().join(',');
  const { data, isLoading } = useQuery({
    queryKey: ['pod-usage-p95', clusterId, namespace, key],
    queryFn: () => readUsage(pods.length === 1 ? podUsageQueries(namespace, pods[0]) : workloadUsageQueries(namespace, pods), clusterId),
    enabled: !remote && !!namespace && pods.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  if (remote) return { usage: { state: 'unknown', reason: 'metrics are only available for the local cluster' }, isLoading: false };
  if (pods.length === 0) return { usage: { state: 'unknown', reason: 'no pods to measure' }, isLoading: false };
  return { usage: data, isLoading };
}
