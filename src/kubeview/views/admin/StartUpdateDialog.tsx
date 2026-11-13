import React from 'react';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { clusterDisplayName } from '../../engine/pendingCluster';
import { parseMinor } from '../../engine/upgradeApiRemovals';
import type { MachineConfigPool } from '../../engine/types';
import type { UpgradeHistoryEntry, UpgradeTarget } from '../../engine/upgradeGraph';
import type { ReadinessCheck } from '../../engine/upgradeReadiness';
import { estimateFromHistory, UPDATE_LOG_MAX, UPDATE_REASON_MAX } from '../../engine/upgradeLog';

export interface StartUpdateDialogProps {
  target: UpgradeTarget;
  fromVersion: string;
  /** The cluster the update was requested on; the write goes there or nowhere. */
  clusterId: string;
  /** Readiness rows that are blockers now (computed live, so a late result still shows). */
  blockers: ReadinessCheck[];
  /** How many readiness checks could not be completed. */
  unknownCount: number;
  /** The target readiness was checked for; when it is not this one, the dialog says so. */
  readinessFor?: string;
  pools: MachineConfigPool[] | null;
  history: UpgradeHistoryEntry[];
  username: string | null;
  usernameLoading: boolean;
  /** Present and false when the existing update-log annotation is not valid JSON and would be replaced. */
  logState: { valid: boolean; unrecognised: number; overflow: number };
  impersonating?: boolean;
  /** The merge patch the confirm sends, for display. */
  patchPreview: (reason: string) => unknown;
  /** Sends the patch (dry run first); rejects with the server's error. */
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

function poolState(pools: MachineConfigPool[] | null): string {
  if (!pools) return 'MachineConfigPools could not be read';
  if (pools.length === 0) return 'No MachineConfigPools';
  return pools.map((p) => {
    const name = p.metadata.name;
    if (p.spec?.paused) return `${name} paused`;
    return name === 'master' ? `${name} updates with the control plane` : `${name} updates after the control plane`;
  }).join(' · ');
}

/**
 * The start-update confirmation: blockers listed with an explicit
 * "update anyway", a required reason (saved on ClusterVersion with the
 * update), what happens to worker pools, and whether it can be undone.
 */
export function StartUpdateDialog({
  target, fromVersion, clusterId, blockers, unknownCount, readinessFor, pools, history, username, usernameLoading, logState, impersonating,
  patchPreview, onConfirm, onClose,
}: StartUpdateDialogProps) {
  const [reason, setReason] = React.useState('');
  const [understood, setUnderstood] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cur = parseMinor(fromVersion);
  const tgt = parseMinor(target.version);
  const isMinor = !!cur && !!tgt && (tgt.major > cur.major || (tgt.major === cur.major && tgt.minor > cur.minor));
  const estimate = estimateFromHistory(history);
  const trimmed = reason.trim();
  const needsAck = blockers.length > 0;

  const confirm = async () => {
    if (!trimmed || (needsAck && !understood) || usernameLoading) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open
      onClose={() => { if (!busy) onClose(); }}
      onConfirm={() => { void confirm(); }}
      title={`Update ${clusterDisplayName(clusterId)} from ${fromVersion || 'the installed version'} to ${target.version}?`}
      description={`Control plane first, then worker pools${estimate ? ` · estimated ${estimate.text}` : ''}`}
      confirmLabel={`Start update to ${target.version}`}
      variant="warning"
      size="lg"
      loading={busy}
      // Waits for the username so the log does not record "unknown" for someone who is known.
      confirmDisabled={!trimmed || (needsAck && !understood) || usernameLoading}
    >
      <div className="mt-4 space-y-4 text-xs">
        {needsAck && (
          <div className="rounded-md border border-orange-900 bg-orange-950/40 px-3 py-2.5 space-y-2" data-testid="start-update-blockers">
            <div className="font-semibold text-orange-200">{blockers.length} readiness blocker{blockers.length === 1 ? ' is' : 's are'} still open</div>
            <ul className="list-disc pl-5 space-y-1 text-orange-100/90">
              {blockers.map((b) => <li key={b.id} className="break-words"><span className="font-medium">{b.label}:</span> {b.detail}</li>)}
            </ul>
            <label className="flex items-center gap-2 text-slate-100 min-h-8">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="w-4 h-4" />
              I understand and want to update anyway
            </label>
          </div>
        )}
        {readinessFor && readinessFor !== target.version && (
          <p className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-slate-300" data-testid="start-update-other-target">
            Readiness on this page was checked for {readinessFor}, not {target.version}, so its blockers are not listed here.
          </p>
        )}
        {!needsAck && unknownCount > 0 && (
          <p className="rounded-md border border-amber-900 bg-amber-950/30 px-3 py-2 text-amber-200" data-testid="start-update-unknown">
            {unknownCount} readiness check{unknownCount === 1 ? '' : 's'} could not be completed, so this update has not been shown to be safe.
          </p>
        )}

        <div className="space-y-1.5">
          <label htmlFor="start-update-reason" className="block font-semibold text-slate-200">
            Reason <span className="font-normal text-slate-400">(required, saved on ClusterVersion with the update)</span>
          </label>
          <textarea
            id="start-update-reason"
            rows={3}
            maxLength={UPDATE_REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why now, and the change ticket if there is one"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-200 resize-y"
          />
          <p className="text-faint">
            Recorded as started by{' '}
            {usernameLoading ? 'you (reading your username…)' : username ? <span className="font-mono text-slate-300">{username}</span> : 'an unknown user (your username could not be read)'}.
            {impersonating && ' (you are impersonating this user; the entry says so)'}
            {!logState.valid && ' The existing update log on ClusterVersion is not valid JSON and will be replaced.'}
            {logState.valid && logState.unrecognised > 0 && ` ${logState.unrecognised === 1 ? '1 existing log entry' : `${logState.unrecognised} existing log entries`} Pulse does not understand will be kept unchanged.`}
            {logState.overflow > 0 && ` The log keeps the last ${UPDATE_LOG_MAX} entries, so the oldest ${logState.overflow === 1 ? 'entry is' : `${logState.overflow} entries are`} removed.`}
          </p>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
          <div>
            <dt className="text-faint">Worker pools</dt>
            <dd className="text-slate-200" data-testid="start-update-pools">{poolState(pools)}</dd>
          </div>
          <div>
            <dt className="text-faint">Can it be undone?</dt>
            <dd className="text-slate-200" data-testid="start-update-undo">
              {isMinor ? "No. Minor updates can't be rolled back." : 'No. OpenShift does not support rolling back an update.'}
            </dd>
          </div>
        </dl>

        <details>
          <summary className="cursor-pointer text-slate-400">Merge patch sent to ClusterVersion version (dry run first)</summary>
          <pre data-testid="start-update-patch" className="mt-1 max-h-48 overflow-auto font-mono text-[11px] text-slate-300 bg-slate-950 border border-slate-800 rounded-sm px-2 py-1.5 whitespace-pre-wrap break-all">
            {JSON.stringify(patchPreview(trimmed || '<reason>'), null, 2)}
          </pre>
        </details>

        {error && <p role="alert" className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-red-300">Update not started: {error}</p>}
      </div>
    </ConfirmDialog>
  );
}
