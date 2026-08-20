import { useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '../../components/primitives/Button';
import { resetInbox, type InboxResetResult } from '../../engine/inboxApi';
import { useInboxStore } from '../../store/inboxStore';

/**
 * Re-baseline the inbox: archive what is open, then count from now.
 *
 * The confirmation names what it is about to take rather than asking a generic
 * "are you sure?". Pinned and claimed items go too — that is what a reset
 * means — but taking somebody's marked work silently is not the same as taking
 * it with their agreement.
 */
export function InboxResetButton() {
  const stats = useInboxStore((s) => s.stats);
  const refresh = useInboxStore((s) => s.refresh);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<InboxResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openCount = stats.needs_attention ?? 0;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const outcome = await resetInbox();
      setResult(outcome);
      setConfirming(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setRunning(false);
    }
  }

  if (result) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400" role="status">
        <span>
          Counting from now — {result.items_archived} item{result.items_archived === 1 ? '' : 's'} archived
          {result.episodes_closed > 0 && `, ${result.episodes_closed} episode${result.episodes_closed === 1 ? '' : 's'} closed`}
          {result.rescanned ? '. Rescanned.' : '. Rescan failed, next cycle will refill.'}
        </span>
        <button onClick={() => setResult(null)} className="text-slate-500 hover:text-slate-300 underline">
          Dismiss
        </button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-slate-800 border border-slate-700">
        <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
        <div className="text-xs text-slate-300">
          <div>
            Archive {openCount} open item{openCount === 1 ? '' : 's'} and count from now.
          </div>
          <div className="text-slate-500">
            Nothing is deleted — archived items keep their history. Anything still wrong comes straight back
            on the rescan.
          </div>
          {error && <div className="text-red-400 mt-1">{error}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={run} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Reset'}
          </Button>
          <button
            onClick={() => setConfirming(false)}
            disabled={running}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setConfirming(true)}
        title="Archive everything open and count from now"
      >
        <RotateCcw className="w-4 h-4 mr-1" />
        Reset
      </Button>
    </div>
  );
}
