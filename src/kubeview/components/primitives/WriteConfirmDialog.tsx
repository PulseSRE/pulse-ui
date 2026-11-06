/**
 * One confirmation for every write a person approves: a guided fix, an agent
 * proposal, a durable-run phase, a plan-run phase, a chat tool call.
 *
 * The dialog says what will change (an exact diff, or the action's parameters
 * when there is none), where (namespace · cluster · acting as), what the
 * server's dry run said (or that there is none), the impact and the undo.
 * Approve stays disabled while the dry run has not passed, while the person
 * lacks the permission the write runs with, while a required reason is empty,
 * and — for agent approvals — in observe mode, saying which of these it is.
 *
 * The cluster active when the dialog opened is pinned: if it changes before
 * the person confirms, nothing is sent and the dialog says why. A failed
 * confirm stays in the dialog with the server's words.
 *
 * The body sections (WriteWhere, WriteChange, WriteFacts) are exported so the
 * chat's inline ConfirmationCard shows the same thing without being a modal.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog } from './Dialog';
import { describeWriteError } from '../ActionDialog';
import { assertActiveCluster, clusterDisplayName } from '../../engine/pendingCluster';
import { getActiveClusterId } from '../../engine/clusterConnection';
import { TONE_CLASSES } from '../../engine/statusColors';
import { useTrustStore } from '../../store/trustStore';
import { useUIStore } from '../../store/uiStore';
import { useFleetStore } from '../../store/fleetStore';

/** Shown in place of a working Approve in observe mode (trust level 0). */
export const OBSERVE_MODE_APPROVE = 'Observe mode — switch trust level to approve';

/**
 * Whose authority the write runs with, stated honestly.
 * - `user`: the browser sends it with the person's own (or impersonated) credentials.
 * - `agent-user`: the agent runs it with the person's forwarded token (token
 *   forwarding, on by default); with forwarding off it is Pulse's service account.
 * - `pulse-sa`: the agent runs it with Pulse's service account.
 */
export type ActingAs = 'user' | 'agent-user' | 'pulse-sa';

export function actingAsText(actingAs: ActingAs, impersonating?: string | null): string {
  if (actingAs === 'pulse-sa') return "acting as Pulse's service account";
  if (actingAs === 'agent-user') return 'acting as you, through the agent (Pulse\'s service account if token forwarding is off)';
  return impersonating ? `acting as ${impersonating} (impersonated)` : 'with your own credentials';
}

export interface WriteWhereProps {
  namespace?: string;
  /** Where the write lands. */
  clusterId: string;
  actingAs: ActingAs;
}

/** "payments · cluster prod-east · acting as …", plus a warning when the page shows another cluster. */
export function WriteWhere({ namespace, clusterId, actingAs }: WriteWhereProps) {
  const impersonating = useUIStore((s) => s.impersonateUser);
  const activeClusterId = useFleetStore((s) => s.activeClusterId);
  return (
    <span data-testid="write-where">
      {namespace ? `${namespace} · ` : ''}cluster <strong className="font-medium text-slate-100">{clusterDisplayName(clusterId)}</strong> · {actingAsText(actingAs, impersonating)}
      {activeClusterId && activeClusterId !== clusterId && (
        <span className="mt-1 block text-amber-300">
          You are viewing {clusterDisplayName(activeClusterId)}; this change applies to {clusterDisplayName(clusterId)}
          {actingAs === 'user' ? '.' : ', where the agent runs.'}
        </span>
      )}
    </span>
  );
}

export interface DiffLine { field: string; before?: string; after?: string }
export interface WriteDiff { header: string; lines: DiffLine[] }

export function DiffPre({ diff }: { diff: WriteDiff }) {
  const isList = diff.lines.every((d) => !d.before && !d.after);
  return (
    <pre className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950 px-3.5 py-3 font-mono text-[12.5px] leading-relaxed" aria-label="What will change">
      <span className="text-slate-400">{diff.header}</span>
      {diff.lines.map((d) => (isList ? (
        <span key={d.field} className="block text-amber-200">~   {d.field}</span>
      ) : (
        <React.Fragment key={d.field}>
          <span className="block text-red-300">-   {d.field}: {d.before}</span>
          <span className="block text-green-300">+   {d.field}: {d.after}</span>
        </React.Fragment>
      )))}
    </pre>
  );
}

export interface WriteChangeProps {
  /** The exact change, when it is known. */
  diff?: WriteDiff;
  /** Otherwise: what will be called, with which parameters. */
  params?: { action: string; input: Record<string, unknown> };
  /** A line under the change (e.g. "also records the change cause"). */
  note?: React.ReactNode;
  /** Show the parameters collapsed (the chat card has a description above them). */
  collapsed?: boolean;
}

export function WriteChange({ diff, params, note, collapsed }: WriteChangeProps) {
  const paramsPre = params && (
    <pre aria-label="Parameters" className="max-h-48 overflow-auto rounded-md border border-slate-800 bg-slate-950 px-3.5 py-3 font-mono text-xs text-slate-300">
      {JSON.stringify(params.input, null, 2)}
    </pre>
  );
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold text-slate-200">What will change</div>
      {diff ? <DiffPre diff={diff} /> : params ? (
        <>
          <p className="mb-1.5 text-xs text-slate-400">
            No exact diff is available. Pulse will run <code className="text-slate-200">{params.action}</code> with these parameters:
          </p>
          {collapsed ? (
            <details>
              <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">Show parameters</summary>
              <div className="mt-1">{paramsPre}</div>
            </details>
          ) : paramsPre}
        </>
      ) : null}
      {note && <p className="mt-1 text-xs text-slate-400">{note}</p>}
    </div>
  );
}

export type DryRunState =
  | { state: 'unavailable' }
  | { state: 'running' }
  | { state: 'passed' }
  | { state: 'failed'; message: string };

export interface WriteFact { label: string; value: React.ReactNode; tone?: 'danger' }

export interface WriteFactsProps {
  impact?: React.ReactNode;
  dryRun: DryRunState;
  undo?: React.ReactNode;
  /** More rows, e.g. quota after the change. */
  extra?: WriteFact[];
}

export function DryRunText({ dryRun }: { dryRun: DryRunState }) {
  return (
    <dd
      data-testid="write-dry-run"
      className={cn(dryRun.state === 'passed' ? TONE_CLASSES.success.text : dryRun.state === 'failed' ? TONE_CLASSES.danger.text : 'text-slate-300')}
    >
      {dryRun.state === 'unavailable' && 'No dry run available for this action'}
      {dryRun.state === 'running' && <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking the API server…</span>}
      {dryRun.state === 'passed' && 'Passed · admitted by the API server'}
      {dryRun.state === 'failed' && `Failed · ${dryRun.message}`}
    </dd>
  );
}

/** Impact, dry run, undo (and any extra rows), as a two-column list. */
export function WriteFacts({ impact, dryRun, undo, extra = [] }: WriteFactsProps) {
  return (
    <dl className="grid grid-cols-1 gap-x-5 gap-y-2.5 text-sm sm:grid-cols-2">
      <div><dt className="text-slate-400">Impact</dt><dd className="text-slate-200">{impact ?? 'Not stated for this action'}</dd></div>
      <div><dt className="text-slate-400">Dry run</dt><DryRunText dryRun={dryRun} /></div>
      {extra.map((f) => (
        <div key={f.label}><dt className="text-slate-400">{f.label}</dt><dd className={f.tone === 'danger' ? TONE_CLASSES.danger.text : 'text-slate-200'}>{f.value}</dd></div>
      ))}
      <div><dt className="text-slate-400">Undo</dt><dd className="text-slate-200">{undo ?? 'No undo is offered for this action'}</dd></div>
    </dl>
  );
}

export interface WriteConfirmDialogProps {
  /** "Verb Kind name?" */
  title: string;
  where: WriteWhereProps;
  change: WriteChangeProps;
  impact?: React.ReactNode;
  undo?: React.ReactNode;
  extraFacts?: WriteFact[];
  /** "After applying, …" — what Pulse does next. */
  after?: React.ReactNode;
  /** Runs once on open (and again if permission changes); Approve waits for it. Absent: "No dry run available". */
  dryRun?: () => Promise<unknown>;
  /** The person's permission, when the write runs as them. */
  rbac?: { allowed: boolean; loading?: boolean; deniedMessage: string };
  /** A note or reason sent with the write. Leave out when the server cannot record one. */
  reason?: { label: string; required?: boolean; placeholder?: string; id?: string };
  /** Agent approvals are disabled in observe mode. Default true; direct writes from the browser pass false. */
  observeGate?: boolean;
  /** Verb-object: "Apply to Deployment api", "Approve phase remediate". */
  confirmLabel: string;
  /** Prefix for a failed confirm. Default `${confirmLabel} failed`. */
  failurePrefix?: string;
  /** Named in the "cluster changed" refusal. */
  what?: string;
  /** The cluster to pin. Default: the cluster active when the dialog opened. */
  pinnedClusterId?: string;
  /** Throws to keep the dialog open with the error. */
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
  /** Warnings shown above the change (e.g. "fixing this treats a symptom"). */
  children?: React.ReactNode;
}

export function WriteConfirmDialog({
  title, where, change, impact, undo, extraFacts, after, dryRun, rbac, reason,
  observeGate = true, confirmLabel, failurePrefix, what, pinnedClusterId, onConfirm, onClose, children,
}: WriteConfirmDialogProps) {
  const observeMode = useTrustStore((s) => s.trustLevel === 0) && observeGate;
  const [pinned] = React.useState(() => pinnedClusterId ?? getActiveClusterId());
  const [note, setNote] = React.useState('');
  const [dry, setDry] = React.useState<DryRunState>(dryRun ? { state: 'running' } : { state: 'unavailable' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reasonId = React.useId();

  const denied = rbac && !rbac.loading && !rbac.allowed;
  React.useEffect(() => {
    if (!dryRun) { setDry({ state: 'unavailable' }); return undefined; }
    if (rbac?.loading) return undefined;
    if (denied) { setDry({ state: 'failed', message: rbac!.deniedMessage }); return undefined; }
    let live = true;
    setDry({ state: 'running' });
    (async () => {
      try {
        assertActiveCluster(pinned, 'The dry run');
        await dryRun();
        if (live) setDry({ state: 'passed' });
      } catch (e) {
        if (live) setDry({ state: 'failed', message: describeWriteError(e) });
      }
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on a new dry run or permission answer only
  }, [dryRun, denied, rbac?.loading, pinned]);

  const blocked: string | null = observeMode
    ? OBSERVE_MODE_APPROVE
    : rbac?.loading
      ? 'Checking your permission…'
      : denied
        ? rbac!.deniedMessage
        : null;
  const needsReason = !!reason?.required && !note.trim();
  const disabled = busy || !!blocked || (dryRun ? dry.state !== 'passed' : false) || needsReason;

  const confirm = async () => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      assertActiveCluster(pinned, what ?? confirmLabel);
      await onConfirm(note.trim());
    } catch (e) {
      setError(`${failurePrefix ?? `${confirmLabel} failed`}: ${describeWriteError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Portalled above any drawer: approvals open from the inbox item drawer, and a
  // fixed dialog inside a transformed panel would be positioned against it.
  return createPortal(
    <Dialog
      open
      onClose={() => { if (!busy) onClose(); }}
      dismissible={!busy}
      overlayClassName="z-60"
      size="2xl"
      title={title}
      description={<WriteWhere {...where} />}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={disabled}
            aria-describedby={blocked ? `${reasonId}-blocked` : undefined}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {blocked && (
          <p id={`${reasonId}-blocked`} data-testid="write-blocked" className="flex items-start gap-2 rounded-md border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {observeMode ? 'Observe mode: Pulse does not change the cluster from this browser. Switch the trust level to approve.' : blocked}
          </p>
        )}
        {children}
        <WriteChange {...change} />
        <WriteFacts impact={impact} dryRun={dry} undo={undo} extra={extraFacts} />
        {after && (
          <div className="rounded-md border border-slate-800 bg-slate-900 px-3.5 py-3 text-sm text-slate-300">{after}</div>
        )}
        {reason && (
          <div>
            <label htmlFor={reason.id ?? reasonId} className="text-sm font-semibold text-slate-200">
              {reason.label} <span className="font-normal text-slate-400">({reason.required ? 'required' : 'optional'})</span>
            </label>
            <input
              id={reason.id ?? reasonId}
              type="text"
              value={note}
              placeholder={reason.placeholder}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>
        )}
        {error && <p role="alert" className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>}
      </div>
    </Dialog>,
    document.body,
  );
}
