/**
 * The last lines of one container's log, inline. With `previous`, the log of
 * the instance before the current one (the one that crashed). The API answers
 * 400 or 404 when there is no previous instance; that is said in words, and
 * any other failure is an error with Retry, never an empty log.
 */
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { k8sLogs } from '../../engine/query';
import { LoadError } from '../../components/primitives/LoadError';
import { useFleetStore } from '../../store/fleetStore';

function statusOf(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null && 'statusCode' in e) return (e as { statusCode?: number }).statusCode;
  return undefined;
}

export function noPreviousInstance(e: unknown): boolean {
  const s = statusOf(e);
  if (s === 400 || s === 404) return true;
  return s === undefined && e instanceof Error && /previous terminated container/i.test(e.message);
}

export function PodLogTail({ namespace, pod, container, previous = false, lines = 40 }: {
  namespace: string;
  pod: string;
  container?: string;
  previous?: boolean;
  lines?: number;
}) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const q = useQuery({
    queryKey: ['pod-log-tail', clusterId, namespace, pod, container ?? '', previous, lines],
    queryFn: () => k8sLogs(namespace, pod, container, { tailLines: lines, previous }, clusterId),
    retry: false,
    staleTime: 15_000,
  });
  if (q.isLoading) {
    return <div className="flex items-center gap-2 py-2 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading log…</div>;
  }
  if (q.isError) {
    if (previous && noPreviousInstance(q.error)) {
      return <p className="py-1 text-xs text-slate-400">No log from a previous instance: the container has not restarted, or that log was already removed.</p>;
    }
    return <LoadError title="The log could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  }
  const text = (q.data ?? '').trimEnd();
  if (!text) return <p className="py-1 text-xs text-slate-400">The container wrote nothing to its log{previous ? ' before it ended' : ''}.</p>;
  return (
    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-slate-950 p-3 font-mono text-[11.5px] leading-relaxed text-slate-300">
      {text}
    </pre>
  );
}
