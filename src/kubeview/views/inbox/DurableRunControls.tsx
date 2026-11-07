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
import { useTrustStore } from '../../store/trustStore';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { OBSERVE_MODE_APPROVE, WriteConfirmDialog } from '../../components/primitives/WriteConfirmDialog';

type WaitingRun = Pick<AwaitingRun, 'workflow_id' | 'phase_id' | 'memo'>;

/**
 * Approve a waiting phase in the shared write-confirm dialog. The phase runs
 * inside the agent with Pulse's service account; the agent offers no dry run
 * of a phase, and the dialog says so.
 */
export function ApprovePhaseDialog({ run, onClose, onApproved }: { run: WaitingRun; onClose: () => void; onApproved: () => void }) {
  const m = run.memo ?? {};
  const target = m.resource_name ? `${m.resource_kind ? `${m.resource_kind} ` : ''}${m.resource_name}` : '';
  return (
    <WriteConfirmDialog
      title={`Approve phase ${run.phase_id}${target ? ` on ${target}` : ''}?`}
      where={{ namespace: m.resource_namespace, clusterId: LOCAL_CLUSTER_ID, actingAs: 'pulse-sa' }}
      change={{
        params: {
          action: `${m.incident_type ? `${m.incident_type} plan` : 'plan'} · phase ${run.phase_id}`,
          input: { workflow_id: run.workflow_id, phase_id: run.phase_id, ...(target ? { target } : {}) },
        },
      }}
      impact={`${describeAwaiting(run)} runs and may change the cluster, within the server's trust level. The run then continues on its own.`}
      undo="Depends on what the phase does; the run's report records each change"
      confirmLabel={`Approve phase ${run.phase_id}`}
      what="This approval"
      onConfirm={async () => {
        await answerApproval(run.workflow_id, run.phase_id, true);
        onApproved();
      }}
      onClose={onClose}
    />
  );
}

/**
 * Approve or deny a durable run's waiting phase, wherever the question shows up.
 *
 * Approving opens the write-confirm dialog: an approved phase is allowed to
 * change the cluster, and the person should see which phase and which target
 * before saying yes. Denying asks once, since the phase is then not run.
 */
export function ApprovalButtons({
  run,
  onAnswered,
}: {
  run: WaitingRun;
  onAnswered?: (approved: boolean) => void;
}) {
  const observeMode = useTrustStore((s) => s.trustLevel === 0);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<'approve' | 'deny' | null>(null);
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  const done = (approved: boolean) => {
    setAsking(null);
    setAnswered(approved);
    onAnswered?.(approved);
  };

  const deny = async () => {
    setBusy(true);
    setError('');
    try {
      await answerApproval(run.workflow_id, run.phase_id, false);
      done(false);
    } catch (e) {
      setAsking(null);
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
          onClick={() => { setError(''); setAsking('approve'); }}
          disabled={busy || observeMode}
          title={observeMode ? OBSERVE_MODE_APPROVE : undefined}
          className="px-2 py-0.5 text-[11px] bg-emerald-600/20 hover:bg-emerald-600/40 disabled:opacity-40 text-emerald-300 rounded-sm border border-emerald-800/30 flex items-center gap-1 transition-colors"
        >
          <Check className="w-3 h-3" />
          Approve
        </button>
        <button
          onClick={() => { setError(''); setAsking('deny'); }}
          disabled={busy}
          className="px-2 py-0.5 text-[11px] bg-red-600/20 hover:bg-red-600/40 disabled:opacity-40 text-red-300 rounded-sm border border-red-800/30 flex items-center gap-1 transition-colors"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
          Deny
        </button>
      </div>
      {observeMode && <span className="text-[10px] text-faint">{OBSERVE_MODE_APPROVE}</span>}
      {error && <span role="alert" className="text-[10px] text-amber-300">{error}</span>}
      {asking === 'approve' && <ApprovePhaseDialog run={run} onClose={() => setAsking(null)} onApproved={() => done(true)} />}
      <ConfirmDialog
        open={asking === 'deny'}
        onClose={() => setAsking(null)}
        onConfirm={deny}
        title={`Deny ${describeAwaiting(run)}?`}
        description="The phase will not run and is recorded as needs_escalation."
        confirmLabel="Deny phase"
        variant="warning"
        loading={busy}
      />
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
          <div className="text-[11px] text-faint">
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
