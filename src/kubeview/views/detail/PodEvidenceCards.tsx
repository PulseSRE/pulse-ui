/**
 * Right-column evidence on the pod page: memory over the last 6h against the
 * limit (with the workload's revisions in that window), and the log of the
 * instance that crashed.
 */
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { queryRange, metricsAvailableFor, seriesToDataPoints } from '../../components/metrics/prometheus';
import { MetricsChart } from '../../components/metrics/MetricsChart';
import { RemoteMetricsNotice } from '../../components/metrics/RemoteMetricsNotice';
import { LoadError } from '../../components/primitives/LoadError';
import { sanitizePromQL } from '../../engine/query';
import { parseMem } from '../../engine/formatting';
import { formatBytesIEC, formatClock } from '../../engine/format';
import { CHART_COLORS } from '../../engine/colors';
import { useFleetStore } from '../../store/fleetStore';
import type { K8sResource } from '../../engine/renderers';
import type { Pod } from '../../engine/types';
import { primaryContainer } from '../../engine/podFacts';
import { PodLogTail } from './PodLogTail';

const SIX_H = 6 * 3600;

export function MemoryCard({ pod, revisions }: { pod: K8sResource; revisions?: Array<{ revision: number | string; at?: string }> }) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const ns = pod.metadata.namespace || '';
  const name = pod.metadata.name;
  const primary = primaryContainer(pod as never)?.name;
  const limitQ = (pod.spec as Pod['spec'] | undefined)?.containers?.find((c) => c.name === primary)?.resources?.limits?.memory;
  const remote = !metricsAvailableFor(clusterId);
  const end = Math.floor(Date.now() / 60_000) * 60;
  const start = end - SIX_H;
  const q = useQuery({
    queryKey: ['pod-memory-6h', clusterId, ns, name, end],
    queryFn: () => queryRange(
      `sum by (container) (container_memory_working_set_bytes{namespace="${sanitizePromQL(ns)}",pod="${sanitizePromQL(name)}",container!="",container!="POD"})`,
      start, end, 120, clusterId,
    ),
    enabled: !remote,
    retry: false,
    staleTime: 60_000,
  });
  const inWindow = (revisions ?? []).filter((r) => r.at && new Date(r.at).getTime() / 1000 >= start);
  const series = (q.data ?? []).map((s, i) => ({
    id: s.metric.container || `s${i}`,
    label: s.metric.container || 'memory',
    data: seriesToDataPoints(s),
    color: i === 0 ? CHART_COLORS.blue : CHART_COLORS.violet,
  }));
  return (
    <section aria-labelledby="mem-h" className="flex flex-col gap-2.5 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline gap-2">
        <h2 id="mem-h" className="text-[15px] font-semibold text-slate-100">Memory, last 6h</h2>
        <span className="ml-auto text-xs text-slate-400">working set vs limit</span>
      </div>
      {remote && <RemoteMetricsNotice what="Memory metrics" compact />}
      {!remote && q.isLoading && <p className="flex items-center gap-2 text-xs text-faint"><Loader2 className="h-3 w-3 animate-spin" /> Checking…</p>}
      {!remote && q.isError && <LoadError title="Could not load metrics" error={q.error} onRetry={() => q.refetch()} />}
      {!remote && q.data && series.length === 0 && <p className="text-xs text-slate-400">No memory samples for this pod in the last 6h.</p>}
      {!remote && series.length > 0 && (
        <MetricsChart
          series={series}
          height={140}
          timeRange={[start, end]}
          yAxisFormat={formatBytesIEC}
          showLegend={series.length > 1}
          thresholds={limitQ ? [{ value: parseMem(limitQ), label: `limit ${limitQ}`, color: '#f87171' }] : []}
        />
      )}
      {!remote && !limitQ && <p className="text-xs text-faint">Container {primary} has no memory limit.</p>}
      {inWindow.length > 0 && (
        <p className="text-xs text-slate-400" aria-label="Revisions in this window">
          {inWindow.map((r) => `rev ${r.revision} at ${formatClock(r.at)}`).join(' · ')}
        </p>
      )}
    </section>
  );
}

export function CrashLogCard({ pod, go }: { pod: K8sResource; go: (path: string, title: string) => void }) {
  const ns = pod.metadata.namespace || '';
  const primary = primaryContainer(pod as never);
  const restarted = (primary?.status?.restartCount ?? 0) > 0;
  // A container that ended and was not restarted (restartPolicy: Never): its
  // current instance is the one that crashed.
  const endedNow = !restarted && !!primary?.status?.state?.terminated;
  return (
    <section aria-labelledby="log-h" className="flex flex-col gap-2.5 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline gap-2">
        <h2 id="log-h" className="text-[15px] font-semibold text-slate-100">Log of the last crash</h2>
        <button type="button" onClick={() => go(`/logs/${ns}/${pod.metadata.name}`, `${pod.metadata.name} (Logs)`)} className="ml-auto text-xs text-blue-400 hover:text-blue-300">
          Open logs
        </button>
      </div>
      {!primary ? (
        <p className="text-xs text-slate-400">This pod has no containers.</p>
      ) : endedNow ? (
        <>
          <p className="text-xs text-faint">{primary.init ? 'Init container' : 'Container'} {primary.name}, the instance that ended</p>
          <PodLogTail namespace={ns} pod={pod.metadata.name} container={primary.name} lines={40} />
        </>
      ) : !restarted ? (
        <p className="text-xs text-slate-400">Container {primary.name} has not restarted, so there is no crashed instance to show.</p>
      ) : (
        <>
          <p className="text-xs text-faint">{primary.init ? 'Init container' : 'Container'} {primary.name}, previous instance</p>
          <PodLogTail namespace={ns} pod={pod.metadata.name} container={primary.name} previous lines={40} />
        </>
      )}
    </section>
  );
}

