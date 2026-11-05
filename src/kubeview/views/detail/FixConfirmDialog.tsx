/**
 * Confirm a guided fix: the exact change, a server-side dry run, the impact,
 * quota after the change and how to undo it, then apply it to the cluster the
 * dialog was opened on.
 *
 * The dry run (`dryRun=All`) sends the same request the apply will send, so
 * RBAC, validation and admission for that object answer before anything
 * changes; Apply stays disabled until it passes. It does not create pods, so
 * a ResourceQuota that would refuse the new pods is not checked by it — the
 * quota line is computed separately. A failed apply stays in the dialog.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog } from '../../components/primitives/Dialog';
import { describeWriteError } from '../../components/ActionDialog';
import { sendWrite } from '../../engine/workloadActions';
import { assertActiveCluster, clusterDisplayName } from '../../engine/pendingCluster';
import { dryRunRequest, withChangeCause, type GuidedFix } from '../../engine/podFixes';
import type { K8sResource } from '../../engine/renderers';
import type { Headroom } from '../../engine/quotaHeadroom';
import { useUIStore } from '../../store/uiStore';
import { TONE_CLASSES } from '../../engine/statusColors';

export function DiffBlock({ fix }: { fix: GuidedFix }) {
  const isList = fix.diff.every((d) => !d.before && !d.after);
  return (
    <pre className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950 px-3.5 py-3 font-mono text-[12.5px] leading-relaxed" aria-label="What will change">
      <span className="text-slate-400">{fix.diffHeader}</span>
      {fix.diff.map((d) => (isList ? (
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

type DryRun = { state: 'running' } | { state: 'passed' } | { state: 'failed'; message: string };

interface FixConfirmDialogProps {
  fix: GuidedFix;
  /** The object the fix patches, as read (for the change-cause annotation). */
  targetObject: K8sResource | null;
  clusterId: string;
  canPatch: boolean;
  headroom?: Headroom;
  onClose: () => void;
  onApplied: (result: unknown, note: string) => void;
}

export function FixConfirmDialog({ fix, targetObject, clusterId, canPatch, headroom, onClose, onApplied }: FixConfirmDialogProps) {
  const impersonating = useUIStore((s) => s.impersonateUser);
  const [note, setNote] = React.useState('');
  const [dry, setDry] = React.useState<DryRun>({ state: 'running' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    if (!canPatch) {
      setDry({ state: 'failed', message: `You do not have permission to patch ${fix.target.plural} in ${fix.target.namespace}` });
      return undefined;
    }
    setDry({ state: 'running' });
    (async () => {
      try {
        assertActiveCluster(clusterId, 'The dry run');
        await sendWrite(dryRunRequest(withChangeCause(fix, targetObject, '')), clusterId);
        if (live) setDry({ state: 'passed' });
      } catch (e) {
        if (live) setDry({ state: 'failed', message: describeWriteError(e) });
      }
    })();
    return () => { live = false; };
  }, [fix, targetObject, clusterId, canPatch]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      assertActiveCluster(clusterId, fix.title);
      const result = await sendWrite(withChangeCause(fix, targetObject, note), clusterId);
      onApplied(result, note);
    } catch (e) {
      setError(`Apply failed: ${describeWriteError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const target = `${fix.target.kind} ${fix.target.name}`;
  return (
    <Dialog
      open
      onClose={() => { if (!busy) onClose(); }}
      dismissible={!busy}
      size="2xl"
      title={fix.question}
      description={`${fix.target.namespace} · cluster ${clusterDisplayName(clusterId)} · ${impersonating ? `acting as ${impersonating} (impersonated)` : 'with your own credentials'}`}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy || dry.state !== 'passed' || !canPatch}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Apply to {target}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-sm font-semibold text-slate-200">What will change</div>
          <DiffBlock fix={fix} />
          {fix.target.kind !== 'ServiceAccount' && (
            <p className="mt-1 text-xs text-slate-500">Also records the change cause (kubernetes.io/change-cause) so Rollout History says why.</p>
          )}
        </div>
        <dl className="grid grid-cols-1 gap-x-5 gap-y-2.5 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-400">Impact</dt><dd className="text-slate-200">{fix.impact}</dd></div>
          <div>
            <dt className="text-slate-400">Dry run</dt>
            <dd data-testid="fix-dry-run" className={cn(dry.state === 'passed' ? TONE_CLASSES.success.text : dry.state === 'failed' ? TONE_CLASSES.danger.text : 'text-slate-300')}>
              {dry.state === 'running' && <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking the API server…</span>}
              {dry.state === 'passed' && 'Passed · admitted by the API server'}
              {dry.state === 'failed' && `Failed · ${dry.message}`}
            </dd>
          </div>
          {headroom && <div><dt className="text-slate-400">Quota after change</dt><dd className={cn(headroom.tone === 'over' ? TONE_CLASSES.danger.text : 'text-slate-200')}>{headroom.text}</dd></div>}
          <div><dt className="text-slate-400">Undo</dt><dd className="text-slate-200">{fix.undo}</dd></div>
        </dl>
        <div className="rounded-md border border-slate-800 bg-slate-900 px-3.5 py-3 text-sm text-slate-300">
          {fix.watchable
            ? <><span className="font-semibold text-slate-100">After applying,</span> Pulse watches the rollout and the new pods&apos; restarts for 10 minutes on this page and says whether it held.</>
            : <><span className="font-semibold text-slate-100">After applying,</span> nothing restarts by itself, so Pulse cannot watch whether this held: restart the workload, then check its pods.</>}
        </div>
        {fix.target.kind !== 'ServiceAccount' && (
        <div>
          <label htmlFor="fix-note" className="text-sm font-semibold text-slate-200">Note for the change cause <span className="font-normal text-slate-400">(optional)</span></label>
          <input
            id="fix-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          />
        </div>
        )}
        {error && <p role="alert" className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>}
      </div>
    </Dialog>
  );
}
