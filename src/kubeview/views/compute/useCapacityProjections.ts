/**
 * useCapacityProjections — fetches predict_linear() data from Prometheus
 * and computes days-until-exhaustion for CPU, memory, disk, and pods.
 */

import { useQuery } from '@tanstack/react-query';
import { queryInstant } from '../../components/metrics/prometheus';
import { safeQuery } from '../../engine/safeQuery';
import { useClusterStore } from '../../store/clusterStore';
import { useActiveClusterId } from '../../hooks/useClusterBase';

export type Lookback = '7d' | '30d' | '90d';

export interface ResourceProjection {
  resource: 'cpu' | 'memory' | 'disk' | 'pods';
  currentRatio: number | null;   // 0-1
  projectedRatio: number | null; // at +90 days
  daysUntilExhaustion: number | null; // null = stable/declining
  growthPerDay: number | null;   // ratio per day
  /**
   * Why there is no projection, when there is none: the query failed, or it
   * answered with no series. Unset when there is data.
   */
  noDataReason?: string;
  /** True when a query behind this projection failed (vs. answered empty). */
  failed?: boolean;
}

export interface CapacityProjections {
  projections: ResourceProjection[];
  isLoading: boolean;
  criticalCount: number; // resources exhausting within 14 days
  warningCount: number;  // resources exhausting within 30 days
}

const HORIZON_DAYS = 90;
const HORIZON_SECONDS = HORIZON_DAYS * 86400;

export function computeExhaustion(current: number | null, projected: number | null): { days: number | null; growth: number | null } {
  if (current === null || projected === null) return { days: null, growth: null };
  const growthPerDay = (projected - current) / HORIZON_DAYS;
  if (growthPerDay <= 0) return { days: null, growth: growthPerDay }; // stable or declining
  const remaining = 1.0 - current;
  if (remaining <= 0) return { days: 0, growth: growthPerDay }; // already exhausted
  return { days: Math.round(remaining / growthPerDay), growth: growthPerDay };
}

function extractValue(data: unknown): number | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const val = data[0]?.value;
  if (val === undefined || val === null || isNaN(Number(val))) return null;
  return Number(val);
}

export function useCapacityProjections(lookback: Lookback = '30d'): CapacityProjections {
  const clusterId = useActiveClusterId();
  const isHyperShift = useClusterStore((s) => s.isHyperShift);
  const cpuDivisor = isHyperShift
    ? 'count(count by (cpu) (node_cpu_seconds_total))'
    : 'sum(machine_cpu_cores)';

  // Current usage ratios
  const cpuCurrentQ = useQuery({
    queryKey: ['capacity', 'cpu-current', isHyperShift, clusterId],
    queryFn: async () => (await safeQuery(() => queryInstant(`sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) / ${cpuDivisor}`, undefined, clusterId))) ?? [],
    refetchInterval: 60000,
  });
  const memCurrentQ = useQuery({
    queryKey: ['capacity', 'mem-current', clusterId],
    queryFn: async () => (await safeQuery(() => queryInstant('1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)', undefined, clusterId))) ?? [],
    refetchInterval: 60000,
  });
  const diskCurrentQ = useQuery({
    queryKey: ['capacity', 'disk-current', clusterId],
    queryFn: async () => (await safeQuery(() => queryInstant('1 - sum(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"}) / sum(node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"})', undefined, clusterId))) ?? [],
    refetchInterval: 60000,
  });
  const podsCurrentQ = useQuery({
    queryKey: ['capacity', 'pods-current', clusterId],
    queryFn: async () => (await safeQuery(() => queryInstant('sum(kubelet_running_pods) / sum(kube_node_status_allocatable{resource="pods"})', undefined, clusterId))) ?? [],
    refetchInterval: 60000,
  });

  // Projected usage at +90 days using predict_linear
  const cpuProjectedQ = useQuery({
    queryKey: ['capacity', 'cpu-projected', lookback, isHyperShift, clusterId],
    queryFn: async () => (await safeQuery(() => queryInstant(`predict_linear(sum(rate(node_cpu_seconds_total{mode!="idle"}[5m]))[${lookback}:5m], ${HORIZON_SECONDS}) / ${cpuDivisor}`, undefined, clusterId))) ?? [],
    refetchInterval: 300000,
  });
  const memProjectedQ = useQuery({
    queryKey: ['capacity', 'mem-projected', lookback, clusterId],
    queryFn: async () => (await safeQuery(() => queryInstant(`predict_linear((sum(node_memory_MemTotal_bytes) - sum(node_memory_MemAvailable_bytes))[${lookback}:5m], ${HORIZON_SECONDS}) / sum(node_memory_MemTotal_bytes)`, undefined, clusterId))) ?? [],
    refetchInterval: 300000,
  });
  const diskProjectedQ = useQuery({
    queryKey: ['capacity', 'disk-projected', lookback, clusterId],
    queryFn: async () => (await safeQuery(() => queryInstant(`predict_linear((sum(node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"}) - sum(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"}))[${lookback}:5m], ${HORIZON_SECONDS}) / sum(node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"})`, undefined, clusterId))) ?? [],
    refetchInterval: 300000,
  });
  const podsProjectedQ = useQuery({
    queryKey: ['capacity', 'pods-projected', lookback, clusterId],
    queryFn: async () => (await safeQuery(() => queryInstant(`predict_linear(sum(kubelet_running_pods)[${lookback}:5m], ${HORIZON_SECONDS}) / sum(kube_node_status_allocatable{resource="pods"})`, undefined, clusterId))) ?? [],
    refetchInterval: 300000,
  });

  const isLoading = [cpuCurrentQ, memCurrentQ, diskCurrentQ, podsCurrentQ, cpuProjectedQ, memProjectedQ, diskProjectedQ, podsProjectedQ].some((q) => q.isLoading);

  type Q = { data?: unknown; isError: boolean; error: unknown };
  const project = (resource: ResourceProjection['resource'], cur: Q, proj: Q): ResourceProjection => {
    const currentRatio = cur.isError ? null : extractValue(cur.data);
    const projectedRatio = proj.isError ? null : extractValue(proj.data);
    const exh = computeExhaustion(currentRatio, projectedRatio);
    const failedQ = cur.isError ? cur : proj.isError ? proj : null;
    // queryInstant's errors already start "Prometheus query failed: …" or
    // "Prometheus error: …"; add the prefix only when they do not.
    const message = failedQ?.error instanceof Error ? failedQ.error.message : '';
    const noDataReason = failedQ
      ? (/^Prometheus /.test(message) ? message : `Prometheus query failed${message ? `: ${message}` : ''}`)
      : currentRatio === null
        ? 'Prometheus returned no usage series'
        : projectedRatio === null
          ? `Not enough history for a ${lookback} trend`
          : undefined;
    return { resource, currentRatio, projectedRatio, daysUntilExhaustion: exh.days, growthPerDay: exh.growth, noDataReason, failed: !!failedQ };
  };

  const projections: ResourceProjection[] = [
    project('cpu', cpuCurrentQ, cpuProjectedQ),
    project('memory', memCurrentQ, memProjectedQ),
    project('disk', diskCurrentQ, diskProjectedQ),
    project('pods', podsCurrentQ, podsProjectedQ),
  ];

  const criticalCount = projections.filter(p => p.daysUntilExhaustion !== null && p.daysUntilExhaustion <= 14).length;
  const warningCount = projections.filter(p => p.daysUntilExhaustion !== null && p.daysUntilExhaustion > 14 && p.daysUntilExhaustion <= 30).length;

  return { projections, isLoading, criticalCount, warningCount };
}
