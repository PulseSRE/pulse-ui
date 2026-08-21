import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Wrench } from 'lucide-react';
import { Button } from '../../components/primitives/Button';
import { approveFix, fetchFixHistory, type ActionRecord } from '../../engine/fixHistory';
import { formatElapsed } from '../../engine/dateUtils';

/**
 * Fixes the agent proposed and nobody has answered.
 *
 * Trust level 2 means ask first, and the question used to be asked over a
 * WebSocket with 120 seconds to reply — so at 03:00 it was never answered and
 * the agent took no action at all. Proposals now outlive the moment, which
 * only helps if there is somewhere to see them.
 *
 * Above the inbox rather than inside it: an unanswered proposal is the one
 * thing on this screen that is waiting on a person, and everything below it is
 * waiting on the cluster.
 */
export function ProposedFixes() {
  const [proposals, setProposals] = useState<ActionRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetchFixHistory({ filters: { status: 'proposed' } });
      setProposals(res.actions ?? []);
    } catch {
      // A proposal list that cannot load is not worth an error banner over the
      // inbox — the inbox itself is the thing the operator came for.
      setProposals([]);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  async function approve(action: ActionRecord) {
    setBusy(action.id);
    setErrors((e) => ({ ...e, [action.id]: '' }));
    try {
      const result = await approveFix(action.id);
      setDone((d) => ({
        ...d,
        [action.id]:
          result.status === 'completed'
            ? `Ran ${result.tool || 'the fix'}`
            : `Failed: ${result.error ?? 'unknown error'}`,
      }));
      setProposals((p) => p.filter((a) => a.id !== action.id));
    } catch (e) {
      // The agent refuses on purpose — the condition cleared, somebody else
      // approved it, no strategy applies. Show what it said.
      setErrors((err) => ({ ...err, [action.id]: e instanceof Error ? e.message : 'Approve failed' }));
      load();
    } finally {
      setBusy(null);
    }
  }

  const finished = Object.entries(done);
  if (proposals.length === 0 && finished.length === 0) return null;

  return (
    <div className="mx-4 mt-3 rounded-md border border-amber-700/40 bg-amber-500/5">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-700/30">
        <Wrench className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-medium text-amber-200">
          {proposals.length > 0
            ? `${proposals.length} fix${proposals.length === 1 ? '' : 'es'} waiting on you`
            : 'Fixes applied'}
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
              {errors[action.id] && <div className="text-xs text-red-400 mt-1">{errors[action.id]}</div>}
            </div>
            <Button size="sm" onClick={() => approve(action)} disabled={busy === action.id}>
              {busy === action.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve'}
            </Button>
          </li>
        ))}
      </ul>

      {finished.map(([id, message]) => (
        <div key={id} className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          {message}
        </div>
      ))}
    </div>
  );
}
