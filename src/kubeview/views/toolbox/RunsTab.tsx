import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, CheckCircle2, XCircle, Ban, Clock, RefreshCw, Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentFetch } from '../../engine/safeQuery';

interface RunMemo {
  kind?: string;
  finding_id?: string;
  incident_type?: string;
  strategy?: string;
  resource_kind?: string;
  resource_name?: string;
  resource_namespace?: string;
}

interface WorkflowRun {
  workflow_id: string;
  run_id: string;
  type: string;
  status: string;
  started_at: string;
  closed_at: string;
  memo?: RunMemo;
}

/**
 * Every durable run Pulse has executed, from Temporal's own visibility store.
 *
 * This is the list the agent could not show before: a fix that a pod restart
 * would previously have erased mid-flight now has a row here with a status,
 * and a running one can be stopped.
 *
 * Cancelling an incident run means undo, not "stop watching" — if the fix has
 * already been applied the workflow restores its snapshot and records a
 * `cancelled` verdict before finishing. The confirmation text says so, because
 * a button labelled "Cancel" that mutates the cluster should not be a surprise.
 */
export function RunsTab() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery<{ runs: WorkflowRun[] }>({
    queryKey: ['workflow-runs'],
    // Poll while anything is still running; idle otherwise.
    refetchInterval: (q) =>
      q.state.data?.runs?.some((r) => r.status === 'RUNNING') ? 3000 : false,
    queryFn: async () => {
      const res = await agentFetch('/api/agent/workflow-runs?limit=50');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // 503 carries the "set PULSE_AGENT_TEMPORAL_HOST" explanation.
        throw new Error(body.detail || `Failed to load runs (${res.status})`);
      }
      return res.json();
    },
  });

  const cancel = async (run: WorkflowRun) => {
    const target = describe(run);
    const undoes = run.memo?.kind === 'incident';
    const message = undoes
      ? `Cancel the fix for ${target}?\n\nIf the change has already been applied, cancelling rolls it back from the snapshot and records a "cancelled" verdict.`
      : `Cancel ${target}?`;
    if (!window.confirm(message)) return;

    setBusy(run.workflow_id);
    setError('');
    try {
      const res = await agentFetch(
        `/api/agent/workflow-runs/${encodeURIComponent(run.workflow_id)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'cancelled from the Pulse console' }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || `Could not cancel (${res.status})`);
      }
      // Compensation runs after the request is delivered, so the row keeps
      // moving for a moment; the poll picks up the terminal state.
      queryClient.invalidateQueries({ queryKey: ['workflow-runs'] });
    } catch {
      setError('Network error — could not reach agent');
    } finally {
      setBusy(null);
    }
  };

  const runs = data?.runs ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Workflow className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-medium text-slate-200">Durable runs</h2>
          <span className="text-[10px] text-slate-500">
            Executed on Temporal — these survive an agent restart
          </span>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })}
          className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 rounded-sm border border-slate-800 flex items-center gap-1 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs rounded-md border bg-amber-950/40 border-amber-900/40 text-amber-300">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="text-slate-500 text-sm p-4 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading runs…
        </div>
      )}

      {isError && (
        <div className="px-3 py-2 text-xs rounded-md border bg-slate-900 border-slate-800 text-slate-400">
          Durable execution is not configured on this agent, so there are no runs
          to show. Enable <code className="text-slate-300">spec.temporal</code> on
          the OpenShiftPulse resource to turn it on.
        </div>
      )}

      {!isLoading && !isError && runs.length === 0 && (
        <div className="px-3 py-6 text-xs text-center rounded-md border bg-slate-900/40 border-slate-800 text-slate-500">
          No durable runs yet.
        </div>
      )}

      {runs.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-md divide-y divide-slate-800">
          {runs.map((run) => (
            <div key={`${run.workflow_id}:${run.run_id}`} className="flex items-center gap-3 px-3 py-2">
              <StatusIcon status={run.status} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-200 truncate">{describe(run)}</div>
                <div className="text-[10px] text-slate-500 truncate">
                  {run.workflow_id} · {formatWhen(run)}
                </div>
              </div>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-sm border shrink-0', statusClass(run.status))}>
                {run.status}
              </span>
              {run.status === 'RUNNING' && (
                <button
                  onClick={() => cancel(run)}
                  disabled={busy === run.workflow_id}
                  className="px-2 py-0.5 text-[10px] bg-red-600/20 hover:bg-red-600/40 disabled:opacity-40 text-red-300 rounded-sm border border-red-800/30 flex items-center gap-1 shrink-0 transition-colors"
                >
                  {busy === run.workflow_id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Ban className="w-3 h-3" />}
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A readable label for the run, from the memo Temporal carries with it. */
function describe(run: WorkflowRun): string {
  const m = run.memo ?? {};
  const where = [m.resource_name, m.resource_namespace].filter(Boolean).join(' in ');
  if (m.kind === 'incident') {
    return [m.strategy || 'fix', where && `on ${where}`].filter(Boolean).join(' ');
  }
  if (m.kind === 'plan') {
    return [m.incident_type || 'plan', where && `on ${where}`].filter(Boolean).join(' ');
  }
  // Runs started before memo was attached still list, just without a label.
  return run.type;
}

function formatWhen(run: WorkflowRun): string {
  const started = run.started_at ? new Date(run.started_at) : null;
  if (!started || Number.isNaN(started.getTime())) return '';
  return run.closed_at ? `finished ${started.toLocaleString()}` : `started ${started.toLocaleString()}`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'RUNNING') return <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />;
  if (status === 'COMPLETED') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  if (status === 'CANCELED' || status === 'TERMINATED') return <Ban className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
  if (status === 'FAILED' || status === 'TIMED_OUT') return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  return <Clock className="w-3.5 h-3.5 text-slate-600 shrink-0" />;
}

function statusClass(status: string): string {
  if (status === 'COMPLETED') return 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40';
  if (status === 'RUNNING') return 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40';
  if (status === 'CANCELED' || status === 'TERMINATED') return 'bg-slate-800/60 text-slate-400 border-slate-700/40';
  return 'bg-red-900/40 text-red-300 border-red-700/40';
}
