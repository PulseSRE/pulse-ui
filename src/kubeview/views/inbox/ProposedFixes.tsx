import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, GitBranch, Loader2, Wrench, XCircle } from 'lucide-react';
import { Button } from '../../components/primitives/Button';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { type ActionRecord } from '../../engine/fixHistory';
import { formatElapsed } from '../../engine/dateUtils';
import { resourceDetailUrl } from '../../engine/gvr';
import { useApprovalsStore } from '../../store/approvalsStore';
import { useInboxStore } from '../../store/inboxStore';

/** What happened to a proposal a person just answered, shown in place of it. */
export interface ProposalOutcome {
  message: string;
  ok: boolean;
  /** Answered "no" — nothing ran, so it is neither an applied nor a failed fix. */
  rejected?: boolean;
  /** The agent refused to run it (condition cleared, already answered). Nothing ran. */
  refused?: boolean;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Ask for the reason, then reject. The reason is required: it is what fix learning and the next person read. */
export function RejectFixDialog({
  action,
  open,
  onClose,
  onRejected,
}: {
  action: ActionRecord;
  open: boolean;
  onClose: () => void;
  onRejected: (outcome: ProposalOutcome) => void;
}) {
  const reject = useApprovalsStore((s) => s.reject);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setError('');
    }
  }, [open]);

  const submit = async () => {
    if (!reason.trim()) {
      setError('Say why — Pulse learns from it, and the next person reads it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await reject(action.id, reason.trim());
      onRejected({
        ok: true,
        rejected: true,
        message:
          result.learned === false
            ? 'Rejected. Fix learning did not count it (already counted for this workload, or an older proposal).'
            : 'Rejected — Pulse will count this against that fix for this cause.',
      });
      onClose();
    } catch (e) {
      // Already answered, or not allowed: the agent's own words.
      setError(e instanceof Error ? e.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={submit}
      title="Reject this fix?"
      description={`${str(action.input?.fixDescription) || action.reasoning || 'The proposed fix'} will not run. The problem stays in the inbox.`}
      confirmLabel="Reject fix"
      variant="warning"
      loading={busy}
    >
      <label htmlFor={`reject-reason-${action.id}`} className="mt-3 block text-xs text-slate-400">
        Reason
      </label>
      <textarea
        id={`reject-reason-${action.id}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="e.g. restarting hides a memory leak — the owner is rolling back instead"
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
      />
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}

/** The plan as the agent sent it: what it would do, to what, and why. */
function ProposalDetails({ action }: { action: ActionRecord }) {
  const setSelectedItem = useInboxStore((s) => s.setSelectedItem);
  const input = action.input || {};
  const description = str(input.fixDescription);
  const strategy = str(input.fixStrategy);
  const cause = str(input.causeCategory);
  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-slate-700/60 bg-slate-900/60 p-2 text-xs">
      {description && (
        <div>
          <span className="text-slate-500">Would do: </span>
          <span className="text-slate-200">{description}</span>
        </div>
      )}
      {(strategy || cause) && (
        <div className="text-slate-400">
          {strategy && (
            <>
              <span className="text-slate-500">Strategy </span>
              <code className="text-slate-300">{strategy}</code>
            </>
          )}
          {cause && (
            <>
              <span className="ml-2 text-slate-500">for cause </span>
              <code className="text-slate-300">{cause}</code>
            </>
          )}
        </div>
      )}
      {action.reasoning && <div className="text-slate-400">{action.reasoning}</div>}
      {action.resources?.length > 0 && (
        <ul className="space-y-0.5">
          {action.resources.map((r) => (
            <li key={`${r.kind}/${r.namespace}/${r.name}`}>
              <Link
                to={resourceDetailUrl({ kind: r.kind, metadata: { name: r.name, namespace: r.namespace } })}
                className="text-blue-400 hover:underline"
              >
                {r.kind} {r.namespace ? `${r.namespace}/` : ''}
                {r.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {action.beforeState && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-slate-950 p-1.5 text-[11px] text-slate-400">
          {action.beforeState}
        </pre>
      )}
      {action.inboxItemId && (
        <button
          type="button"
          onClick={() => setSelectedItem(action.inboxItemId!)}
          className="text-blue-400 hover:underline"
        >
          Open the inbox item
        </button>
      )}
    </div>
  );
}

/** Approve / Reject for one proposed fix. Used in the Approvals queue and the item drawer. */
export function ProposalActions({
  action,
  onOutcome,
}: {
  action: ActionRecord;
  onOutcome: (outcome: ProposalOutcome) => void;
}) {
  const approve = useApprovalsStore((s) => s.approve);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const doApprove = async () => {
    setBusy(true);
    try {
      const result = await approve(action.id);
      const ok = result.status === 'completed';
      onOutcome({ ok, message: ok ? `Ran ${result.tool || 'the fix'}` : `Failed: ${result.error ?? 'unknown error'}` });
    } catch (e) {
      // The agent refuses on purpose — the condition cleared, somebody else
      // answered it, no strategy applies. Show what it said. Reported as an
      // outcome, not row state: the list is re-read after a refusal and the
      // row (with anything shown in it) may be gone by then.
      onOutcome({ ok: false, refused: true, message: e instanceof Error ? e.message : 'Approve failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <Button size="sm" onClick={doApprove} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-label="Approving" /> : 'Approve'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>
          Reject
        </Button>
      </div>
      <RejectFixDialog action={action} open={rejecting} onClose={() => setRejecting(false)} onRejected={onOutcome} />
    </div>
  );
}

/**
 * Fixes the agent proposed and nobody has answered.
 *
 * Trust level 2 means ask first, and the question used to be asked over a
 * WebSocket with 120 seconds to reply — so at 03:00 it was never answered and
 * the agent took no action at all. Proposals now outlive the moment, which
 * only helps if there is somewhere to see them: the Inbox's Approvals tab.
 */
export function ProposedFixes() {
  const proposals = useApprovalsStore((s) => s.proposals);
  const refreshProposals = useApprovalsStore((s) => s.refreshProposals);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<Record<string, ProposalOutcome & { title: string }>>({});

  useEffect(() => {
    refreshProposals();
    const timer = setInterval(refreshProposals, 60_000);
    return () => clearInterval(timer);
  }, [refreshProposals]);

  const finished = Object.entries(done);
  if (proposals.length === 0 && finished.length === 0) return null;

  // The header must not celebrate a failure: "Fixes applied" over a red
  // "Failed: …" row is how a 403 got reported as success on the reference
  // cluster. Name what actually happened.
  const anyFailed = finished.some(([, f]) => !f.ok && !f.refused);
  const allFailed = finished.length > 0 && finished.every(([, f]) => !f.ok && !f.refused);
  const allRefused = finished.length > 0 && finished.every(([, f]) => f.refused);
  const allRejected = finished.length > 0 && finished.every(([, f]) => f.rejected);
  const finishedLabel = allFailed
    ? `Fix${finished.length === 1 ? '' : 'es'} failed`
    : allRefused
      ? 'Not run'
      : allRejected
      ? 'Answered'
      : anyFailed || finished.some(([, f]) => f.rejected || f.refused)
        ? 'Fix results'
        : 'Fixes applied';

  return (
    <div className="rounded-md border border-amber-700/40 bg-amber-500/5">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-700/30">
        <Wrench className="w-4 h-4 text-amber-400" />
        <span className={`text-xs font-medium ${proposals.length === 0 && allFailed ? 'text-red-300' : 'text-amber-200'}`}>
          {proposals.length > 0
            ? `${proposals.length} fix${proposals.length === 1 ? '' : 'es'} waiting on you`
            : finishedLabel}
        </span>
      </div>

      <ul className="divide-y divide-amber-700/20">
        {proposals.map((action) => (
          <li key={action.id} className="flex items-start gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-200 truncate">
                {action.reasoning || action.tool || action.category}
              </div>
              <div className="text-xs text-slate-500">
                {action.resources?.[0] ? `${action.resources[0].kind} ${action.resources[0].name}` : action.category}
                {action.timestamp ? ` · proposed ${formatElapsed(Math.floor(action.timestamp / 1000))} ago` : ''}
              </div>
              {/* The agent's causal model already knows this is a symptom.
                  Measured on the reference cluster: all four fixes awaiting
                  approval targeted the exact four pods the same screen called
                  "Explained by the cause above — not separate problems".
                  Said out loud rather than suppressed — a stopgap restart is
                  sometimes the right call, but never a blind one. */}
              {action.explainedBy && (
                <div className="mt-1 flex items-start gap-1.5 text-xs text-amber-400/90">
                  <GitBranch className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>
                    Symptom of <span className="font-medium">{action.explainedBy}</span> — fixing this
                    treats the symptom, not the cause
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [action.id]: !o[action.id] }))}
                aria-expanded={!!open[action.id]}
                className="mt-1 inline-flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-200"
              >
                {open[action.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Details
              </button>
              {open[action.id] && <ProposalDetails action={action} />}
            </div>
            <ProposalActions
              action={action}
              onOutcome={(outcome) =>
                setDone((d) => ({ ...d, [action.id]: { ...outcome, title: action.reasoning || action.category } }))
              }
            />
          </li>
        ))}
      </ul>

      {finished.map(([id, { message, ok }]) => (
        <div key={id} className={`flex items-center gap-2 px-3 py-2 text-xs ${ok ? 'text-slate-400' : 'text-red-300'}`}>
          {ok ? (
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          )}
          {/* A single-line clamp is a cheap safety net against a long backend
              message blowing out this row's layout; the full text is in title. */}
          <span className="min-w-0 truncate" title={message}>
            {message}
          </span>
        </div>
      ))}
    </div>
  );
}
