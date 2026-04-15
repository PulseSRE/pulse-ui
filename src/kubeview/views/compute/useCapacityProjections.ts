/**
 * useCapacityProjections — fetches predict_linear() data from Prometheus
 * and computes days-until-exhaustion for CPU, memory, disk, and pods.
 */

import { useQuery } from '@tanstack/react-query';
import { queryInstant } from '../../components/metrics/prometheus';
import { safeQuery } from '../../engine/safeQuery';
import { useClusterStore } from '../../store/clusterStore';

export type Lookback = '7d' | '30d' | '90d';

export interface ResourceProjection {
  resource: 'cpu' | 'memory' | 'disk' | 'pods';
  currentRatio: number | null;   // 0-1
  projectedRatio: number | null; // at +90 days
  daysUntilExhaustion: number | null; // null = stable/declining
  growthPerDay: number | null;   // ratio per day
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
  const isHyperShift = useClusterStore((s) => s.isHyperShift);
  const cpuDivisor = isHyperShift
    ? 'count(count by (cpu) (node_cpu_seconds_total))'
    : 'sum(machine_cpu_cores)';

  // Current usage ratios
  const { data: cpuCurrent, isLoading: l1 } = useQuery({
    queryKey: ['capacity', 'cpu-current', isHyperShift],
    queryFn: async () => (await safeQuery(() => queryInstant(`sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) / ${cpuDivisor}`))) ?? [],
    refetchInterval: 60000,
  });
  const { data: memCurrent, isLoading: l2 } = useQuery({
    queryKey: ['capacity', 'mem-current'],
    queryFn: async () => (await safeQuery(() => queryInstant('1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)'))) ?? [],
    refetchInterval: 60000,
  });
  const { data: diskCurrent, isLoading: l3 } = useQuery({
    queryKey: ['capacity', 'disk-current'],
    queryFn: async () => (await safeQuery(() => queryInstant('1 - sum(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"}) / sum(node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"})'))) ?? [],
    refetchInterval: 60000,
  });
  const { data: podsCurrent, isLoading: l4 } = useQuery({
    queryKey: ['capacity', 'pods-current'],
    queryFn: async () => (await safeQuery(() => queryInstant('sum(kubelet_running_pods) / sum(kube_node_status_allocatable{resource="pods"})'))) ?? [],
    refetchInterval: 60000,
  });

  // Projected usage at +90 days using predict_linear
  const { data: cpuProjected, isLoading: l5 } = useQuery({
    queryKey: ['capacity', 'cpu-projected', lookback, isHyperShift],
    queryFn: async () => (await safeQuery(() => queryInstant(`predict_linear(sum(rate(node_cpu_seconds_total{mode!="idle"}[5m]))[${lookback}:5m], ${HORIZON_SECONDS}) / ${cpuDivisor}`))) ?? [],
    refetchInterval: 300000,
  });
  const { data: memProjected, isLoading: l6 } = useQuery({
    queryKey: ['capacity', 'mem-projected', lookback],
    queryFn: async () => (await safeQuery(() => queryInstant(`predict_linear((sum(node_memory_MemTotal_bytes) - sum(node_memory_MemAvailable_bytes))[${lookback}:5m], ${HORIZON_SECONDS}) / sum(node_memory_MemTotal_bytes)`))) ?? [],
    refetchInterval: 300000,
  });
  const { data: diskProjected, isLoading: l7 } = useQuery({
    queryKey: ['capacity', 'disk-projected', lookback],
    queryFn: async () => (await safeQuery(() => queryInstant(`predict_linear((sum(node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"}) - sum(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"}))[${lookback}:5m], ${HORIZON_SECONDS}) / sum(node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"})`))) ?? [],
    refetchInterval: 300000,
  });
  const { data: podsProjected, isLoading: l8 } = useQuery({
    queryKey: ['capacity', 'pods-projected', lookback],
    queryFn: async () => (await safeQuery(() => queryInstant(`predict_linear(sum(kubelet_running_pods)[${lookback}:5m], ${HORIZON_SECONDS}) / sum(kube_node_status_allocatable{resource="pods"})`))) ?? [],
    refetchInterval: 300000,
  });

  const isLoading = l1 || l2 || l3 || l4 || l5 || l6 || l7 || l8;

  const cpuExh = computeExhaustion(extractValue(cpuCurrent), extractValue(cpuProjected));
  const memExh = computeExhaustion(extractValue(memCurrent), extractValue(memProjected));
  const diskExh = computeExhaustion(extractValue(diskCurrent), extractValue(diskProjected));
  const podsExh = computeExhaustion(extractValue(podsCurrent), extractValue(podsProjected));

  const projections: ResourceProjection[] = [
    { resource: 'cpu', currentRatio: extractValue(cpuCurrent), projectedRatio: extractValue(cpuProjected), daysUntilExhaustion: cpuExh.days, growthPerDay: cpuExh.growth },
    { resource: 'memory', currentRatio: extractValue(memCurrent), projectedRatio: extractValue(memProjected), daysUntilExhaustion: memExh.days, growthPerDay: memExh.growth },
    { resource: 'disk', currentRatio: extractValue(diskCurrent), projectedRatio: extractValue(diskProjected), daysUntilExhaustion: diskExh.days, growthPerDay: diskExh.growth },
    { resource: 'pods', currentRatio: extractValue(podsCurrent), projectedRatio: extractValue(podsProjected), daysUntilExhaustion: podsExh.days, growthPerDay: podsExh.growth },
  ];

  const criticalCount = projections.filter(p => p.daysUntilExhaustion !== null && p.daysUntilExhaustion <= 14).length;
  const warningCount = projections.filter(p => p.daysUntilExhaustion !== null && p.daysUntilExhaustion > 14 && p.daysUntilExhaustion <= 30).length;

  return { projections, isLoading, criticalCount, warningCount };
}
