import { useEffect, useState } from 'react';
import { Check, Loader2, Play, UserCheck, X } from 'lucide-react';
import {
  answerApproval,
  describeAwaiting,
  fetchInboxPlan,
  startInboxDurableRun,
  type AwaitingRun,
  type InboxPlan,
} from '../../engine/durableRunsApi';

/**
 * Approve or deny a durable run's waiting phase, wherever the question shows up.
 *
 * Approving asks first: an approved phase is allowed to change the cluster,
 * and the person should see which phase and which target before saying yes.
 */
export function ApprovalButtons({
  run,
  onAnswered,
}: {
  run: Pick<AwaitingRun, 'workflow_id' | 'phase_id' | 'memo'>;
  onAnswered?: (approved: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  const answer = async (approved: boolean) => {
    const what = describeAwaiting(run);
    const prompt = approved
      ? `Approve ${what}?\n\nAn approved phase may change the cluster. It runs under Pulse's service account, within the server's trust level.`
      : `Deny ${what}?\n\nThe phase will not run and is recorded as needs_escalation.`;
    if (!window.confirm(prompt)) return;
    setBusy(true);
    setError('');
    try {
      await answerApproval(run.workflow_id, run.phase_id, approved);
      setAnswered(approved);
      onAnswered?.(approved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not deliver the verdict');
    } finally {
      setBusy(false);
    }
  };

  if (answered !== null) {
    return (
      <span className="text-[11px] text-slate-400">
        {answered ? 'Approved' : 'Denied'} — the run continues on its own.
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <button
          onClick={() => answer(true)}
          disabled={busy}
          className="px-2 py-0.5 text-[11px] bg-emerald-600/20 hover:bg-emerald-600/40 disabled:opacity-40 text-emerald-300 rounded-sm border border-emerald-800/30 flex items-center gap-1 transition-colors"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Approve
        </button>
        <button
          onClick={() => answer(false)}
          disabled={busy}
          className="px-2 py-0.5 text-[11px] bg-red-600/20 hover:bg-red-600/40 disabled:opacity-40 text-red-300 rounded-sm border border-red-800/30 flex items-center gap-1 transition-colors"
        >
          <X className="w-3 h-3" />
          Deny
        </button>
      </div>
      {error && <span className="text-[10px] text-amber-300">{error}</span>}
    </div>
  );
}

/** The inbox item for a waiting durable run: say what waits, and answer it here. */
export function DurableApprovalPanel({ workflowId, phaseId }: { workflowId: string; phaseId: string }) {
  return (
    <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-amber-300">
        <UserCheck className="w-3.5 h-3.5" />
        A durable run is waiting for your approval
      </div>
      <p className="text-xs text-slate-400">
        Phase <span className="text-slate-200">{phaseId}</span> of run{' '}
        <span className="font-mono text-slate-300">{workflowId}</span> will not run until someone answers.
        Unanswered, it times out and is recorded as needs_escalation.
      </p>
      <div className="flex justify-end">
        <ApprovalButtons run={{ workflow_id: workflowId, phase_id: phaseId }} />
      </div>
    </div>
  );
}

/**
 * Start the plan that matches this item, durably, against this item's finding.
 *
 * Hidden when no plan matches. "Run durably" in the plan panel had no target,
 * so the plan investigated nothing in particular; starting from the finding
 * gives it one.
 */
export function DurableRunStarter({ itemId }: { itemId: string }) {
  const [plan, setPlan] = useState<InboxPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<string>('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    setStarted('');
    setError('');
    fetchInboxPlan(itemId)
      .then((p) => { if (!cancelled) setPlan(p); })
      .catch(() => { if (!cancelled) setPlan(null); });
    return () => { cancelled = true; };
  }, [itemId]);

  if (!plan) return null;
  const gated = plan.phases.filter((p) => p.approval_required).map((p) => p.id);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const out = await startInboxDurableRun(itemId);
      setStarted(out.workflow_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the run');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-cyan-300">Run “{plan.plan_name}” durably</div>
          <div className="text-[11px] text-slate-500">
            Survives an agent restart.
            {gated.length > 0 && ` Stops and asks before ${gated.join(', ')}.`}
          </div>
        </div>
        {!started && (
          <button
            onClick={start}
            disabled={busy}
            className="px-2 py-1 text-xs bg-cyan-600/20 hover:bg-cyan-600/40 disabled:opacity-40 text-cyan-300 rounded-sm border border-cyan-800/30 flex items-center gap-1 shrink-0 transition-colors"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Start
          </button>
        )}
      </div>
      {started && (
        <p className="text-[11px] text-slate-400">
          Started <span className="font-mono text-slate-300">{started}</span>. Follow it in{' '}
          <a href="/agent?tab=runs" className="text-cyan-300 hover:underline">Pulse Agent → Runs</a>; when it needs
          approval it also appears in the inbox.
        </p>
      )}
      {error && <p className="text-[11px] text-amber-300">{error}</p>}
    </div>
  );
}
