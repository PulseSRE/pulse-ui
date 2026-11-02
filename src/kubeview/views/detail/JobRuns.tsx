/**
 * Runs of a Job or CronJob, so a failed run leads to its pod and that pod's
 * log on the same page.
 *
 * - Job: each pod is an attempt (backoffLimit retries make more than one).
 *   The most recent failed attempt opens with its log.
 * - CronJob: each Job it created is a run, newest first. Opening a run lists
 *   its pods; the failed one opens with its log.
 */
import React from 'react';
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { K8sResource } from '../../engine/renderers';
import type { Pod } from '../../engine/types';
import { useK8sListWatch } from '../../hooks/useK8sListWatch';
import { LoadError } from '../../components/primitives/LoadError';
import { TONE_CLASSES, type StatusTone } from '../../engine/statusColors';
import { formatDurationBetween, formatRelative } from '../../engine/format';
import { PodLogTail } from './PodLogTail';

type Go = (path: string, title: string) => void;

function podOutcome(pod: K8sResource): { label: string; tone: StatusTone; detail?: string } {
  const st = pod.status as Pod['status'] | undefined;
  const cs = st?.containerStatuses ?? [];
  const term = cs.map((c) => c.state?.terminated ?? c.lastState?.terminated).find((t) => t && (t.exitCode ?? 0) !== 0);
  const waiting = cs.map((c) => c.state?.waiting?.reason).find(Boolean);
  if (st?.phase === 'Succeeded') return { label: 'Succeeded', tone: 'success' };
  if (st?.phase === 'Failed' || term) {
    return { label: 'Failed', tone: 'danger', detail: term ? `${term.reason || 'Error'} · exit ${term.exitCode ?? '—'}` : st?.reason };
  }
  if (waiting) return { label: waiting, tone: 'warning' };
  if (st?.phase === 'Running') return { label: 'Running', tone: 'progress' };
  return { label: st?.phase || 'Pending', tone: 'neutral' };
}

export function jobOutcome(job: K8sResource): { label: string; tone: StatusTone; detail?: string } {
  const st = (job.status || {}) as { conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>; active?: number };
  const failed = st.conditions?.find((c) => c.type === 'Failed' && c.status === 'True');
  if (failed) return { label: 'Failed', tone: 'danger', detail: failed.reason || failed.message };
  if (st.conditions?.some((c) => c.type === 'Complete' && c.status === 'True')) return { label: 'Complete', tone: 'success' };
  if (st.conditions?.some((c) => c.type === 'Suspended' && c.status === 'True')) return { label: 'Suspended', tone: 'neutral' };
  if ((st.active ?? 0) > 0) return { label: 'Running', tone: 'progress' };
  return { label: 'Pending', tone: 'neutral' };
}

function created(r: K8sResource): number {
  return new Date(r.metadata.creationTimestamp || 0).getTime();
}

function Chip({ label, tone }: { label: string; tone: StatusTone }) {
  return <span className={cn('rounded-sm border px-1.5 py-0.5 text-xs', TONE_CLASSES[tone].chip)}>{label}</span>;
}

function PodAttempt({ pod, go, open, onToggle }: { pod: K8sResource; go: Go; open: boolean; onToggle: () => void }) {
  const o = podOutcome(pod);
  const st = pod.status as Pod['status'] | undefined;
  const container = (pod.spec as Pod['spec'] | undefined)?.containers?.[0]?.name;
  const ns = pod.metadata.namespace || '';
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} log of ${pod.metadata.name}`} className="text-slate-500 hover:text-slate-300">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => go(`/r/v1~pods/${ns}/${pod.metadata.name}`, pod.metadata.name)} className="font-mono text-xs text-blue-400 hover:text-blue-300">
          {pod.metadata.name}
        </button>
        <Chip label={o.label} tone={o.tone} />
        {o.detail && <span className="text-xs text-red-300">{o.detail}</span>}
        <span className="ml-auto text-xs text-slate-500">
          {formatRelative(pod.metadata.creationTimestamp)}{st?.startTime ? ` · ran ${formatDurationBetween(st.startTime, (st.containerStatuses?.[0]?.state?.terminated?.finishedAt) || undefined)}` : ''}
        </span>
      </div>
      {open && (
        <div className="mt-2 pl-6">
          <PodLogTail namespace={ns} pod={pod.metadata.name} container={container} lines={60} />
        </div>
      )}
    </li>
  );
}

function AttemptList({ pods, go }: { pods: K8sResource[]; go: Go }) {
  const sorted = React.useMemo(() => [...pods].sort((a, b) => created(b) - created(a)), [pods]);
  const firstFailed = sorted.find((p) => podOutcome(p).tone === 'danger')?.metadata.name;
  const [openSet, setOpenSet] = React.useState<Set<string> | null>(null);
  const isOpen = (n: string) => (openSet ? openSet.has(n) : n === firstFailed);
  const toggle = (n: string) => setOpenSet((prev) => {
    const next = new Set(prev ?? (firstFailed ? [firstFailed] : []));
    if (next.has(n)) next.delete(n); else next.add(n);
    return next;
  });
  if (sorted.length === 0) return <p className="py-2 text-sm text-slate-500">No pods: they may have been cleaned up (ttlSecondsAfterFinished) or not created yet.</p>;
  return (
    <ul className="divide-y divide-slate-800">
      {sorted.map((p) => <PodAttempt key={p.metadata.uid ?? p.metadata.name} pod={p} go={go} open={isOpen(p.metadata.name)} onToggle={() => toggle(p.metadata.name)} />)}
    </ul>
  );
}

export function JobRuns({ resource, managedPods, go }: { resource: K8sResource; managedPods: K8sResource[]; go: Go }) {
  const isCron = resource.kind === 'CronJob';
  const ns = resource.metadata.namespace || '';
  const jobs = useK8sListWatch<K8sResource>({ apiPath: '/apis/batch/v1/jobs', namespace: ns, enabled: isCron && !!ns });
  const runs = React.useMemo(() => {
    if (!isCron || !jobs.data) return [];
    return jobs.data
      .filter((j) => j.metadata.ownerReferences?.some((o) => o.kind === 'CronJob' && (resource.metadata.uid ? o.uid === resource.metadata.uid : o.name === resource.metadata.name)))
      .sort((a, b) => created(b) - created(a));
  }, [isCron, jobs.data, resource.metadata.uid, resource.metadata.name]);
  const firstFailedRun = runs.find((j) => jobOutcome(j).tone === 'danger')?.metadata.name;
  const [openRun, setOpenRun] = React.useState<string | null | undefined>(undefined);
  const shownRun = openRun === undefined ? firstFailedRun : openRun;

  return (
    <section aria-label={isCron ? 'Runs' : 'Attempts'} className="rounded-lg border border-slate-800 bg-slate-900">
      <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-100">
        <ListChecks className="h-4 w-4 text-slate-400" aria-hidden />
        {isCron ? 'Runs' : 'Attempts'}
        <span className="ml-auto text-xs font-normal text-slate-500">
          {isCron ? (jobs.data ? `${runs.length} job${runs.length === 1 ? '' : 's'}` : '') : `${managedPods.length} pod${managedPods.length === 1 ? '' : 's'}`}
        </span>
      </header>
      <div className="px-4 py-2">
        {!isCron && <AttemptList pods={managedPods} go={go} />}
        {isCron && jobs.isError && <LoadError title="Runs could not be loaded" error={jobs.error} onRetry={() => jobs.refetch()} />}
        {isCron && jobs.isLoading && <p className="py-2 text-sm text-slate-500">Loading runs…</p>}
        {isCron && jobs.data && runs.length === 0 && <p className="py-2 text-sm text-slate-500">No runs kept: the CronJob has not run yet, or its history limits removed them.</p>}
        {isCron && runs.length > 0 && (
          <ul className="divide-y divide-slate-800">
            {runs.map((j) => {
              const o = jobOutcome(j);
              const open = shownRun === j.metadata.name;
              const st = (j.status || {}) as { startTime?: string; completionTime?: string };
              const pods = managedPods.filter((p) => p.metadata.ownerReferences?.some((r) => r.kind === 'Job' && r.name === j.metadata.name));
              return (
                <li key={j.metadata.uid ?? j.metadata.name} className="py-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <button type="button" onClick={() => setOpenRun(open ? null : j.metadata.name)} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} pods of ${j.metadata.name}`} className="text-slate-500 hover:text-slate-300">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <button type="button" onClick={() => go(`/r/batch~v1~jobs/${ns}/${j.metadata.name}`, j.metadata.name)} className="font-mono text-xs text-blue-400 hover:text-blue-300">
                      {j.metadata.name}
                    </button>
                    <Chip label={o.label} tone={o.tone} />
                    {o.detail && <span className="text-xs text-red-300">{o.detail}</span>}
                    <span className="ml-auto text-xs text-slate-500">
                      {formatRelative(st.startTime || j.metadata.creationTimestamp)}{st.startTime ? ` · ${formatDurationBetween(st.startTime, st.completionTime || undefined)}` : ''}
                    </span>
                  </div>
                  {open && <div className="mt-1 pl-6"><AttemptList pods={pods} go={go} /></div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
