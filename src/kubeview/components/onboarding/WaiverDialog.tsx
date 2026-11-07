import React from 'react';
import { cn } from '@/lib/utils';
import { Dialog } from '../primitives/Dialog';
import type { WaiverStorage } from '../../engine/readiness/waivers';

interface WaiverDialogProps {
  gateTitle: string;
  open: boolean;
  onClose: () => void;
  /**
   * Save the waiver. The dialog stays open until this resolves; if it throws,
   * the error is shown and nothing is closed or dropped.
   */
  onConfirm: (reason: string, expiresAt: number | null) => void | Promise<void>;
  /** Where the waiver will be kept. Unknown (undefined) while the agent is being asked, or if it could not be. */
  storage?: WaiverStorage;
  /** Why the waiver list could not be loaded, if it could not; saving is then refused. */
  loadError?: string;
}

/** Local end of the chosen day, as epoch ms. */
function endOfDay(date: string): number {
  return new Date(`${date}T23:59:59`).getTime();
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Modal dialog for capturing a waiver reason when marking a gate as accepted-risk. */
export function WaiverDialog({ gateTitle, open, onClose, onConfirm, storage, loadError }: WaiverDialogProps) {
  const [reason, setReason] = React.useState('');
  const [expiry, setExpiry] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reasonRef = React.useRef<HTMLTextAreaElement>(null);

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setReason('');
      setExpiry('');
      setSaving(false);
      setError(null);
    }
  }, [open]);

  // Expiry is kept by the agent; the browser fallback has nowhere to store it.
  const canExpire = storage === 'cluster';
  const expiresAt = canExpire && expiry ? endOfDay(expiry) : null;
  const expiryInPast = expiresAt !== null && (Number.isNaN(expiresAt) || expiresAt <= Date.now());
  const canSubmit = !!reason.trim() && !saving && !expiryInPast;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(reason.trim(), expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Waive Gate"
      initialFocusRef={reasonRef}
      className="bg-slate-900 rounded-xl shadow-2xl"
      bodyClassName="pb-6"
      description={
        <>
          You are waiving <span className="text-slate-200 font-medium">{gateTitle}</span>.
          Please provide a reason for accepting this risk.{' '}
          {storage === 'cluster' ? (
            <>
              The waiver is saved on this cluster with your name and the time, and everyone using Pulse on
              this cluster sees it. Waiving requires Pulse administrator access (if configured).
            </>
          ) : storage === 'browser' ? (
            <span data-testid="waiver-browser-notice" className="text-amber-300">
              This agent does not provide shared waivers, so this waiver is stored in
              this browser only, for this cluster; other people and other browsers do not see it.
            </span>
          ) : loadError ? (
            <span data-testid="waiver-load-error" className="text-red-300">
              Waivers could not be loaded from the agent, so this waiver cannot be saved yet: {loadError}
            </span>
          ) : (
            <>Checking where waivers are kept…</>
          )}
        </>
      }
    >
        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for waiving this gate..."
            rows={3}
            className={cn(
              'w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200',
              'placeholder:text-faint focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent',
              'resize-none',
            )}
            ref={reasonRef}
            aria-label="Waiver reason"
            disabled={saving}
          />
          {canExpire && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Expires (optional)
              <input
                type="date"
                value={expiry}
                min={today()}
                onChange={(e) => setExpiry(e.target.value)}
                aria-label="Waiver expiry date"
                disabled={saving}
                className="rounded-md bg-slate-800 border border-slate-700 px-2 py-1 text-xs text-slate-200"
              />
              {expiryInPast && <span className="text-amber-300">Choose a date in the future.</span>}
            </label>
          )}
          {error && (
            <div role="alert" className="text-xs text-red-300 bg-red-950/40 border border-red-900/60 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                'px-4 py-1.5 text-sm rounded-lg font-medium transition-colors',
                canSubmit
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed',
              )}
            >
              {saving ? 'Saving…' : 'Waive'}
            </button>
          </div>
        </form>
    </Dialog>
  );
}
