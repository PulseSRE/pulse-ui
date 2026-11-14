import { useState } from 'react';
import { DrawerShell } from '../../components/primitives/DrawerShell';
import {
  CheckCircle, XCircle, ArrowUp, Clock, RotateCcw, PauseCircle,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { fetchResolutions, fetchFixHistorySummary } from '../../engine/analyticsApi';
import { actionCategoryLabel } from '../../engine/fixHistory';
import { categoryOutcome, fixActivityLink, fixOutcomeFigures, FIX_ESCALATION_CREATOR } from '../../engine/fixOutcomes';
import { fetchInbox } from '../../engine/inboxApi';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { formatRelative } from '../../engine/format';
import { IncidentLifecycleDrawer } from '../incidents/IncidentLifecycleDrawer';

type OutcomeFilter = 'all' | 'verified' | 'still_failing' | 'improved' | 'verified_then_recurred';

const FILTERS: { id: OutcomeFilter; label: string; color: string }[] = [
  { id: 'all', label: 'All', color: 'text-slate-300' },
  { id: 'verified', label: 'Resolved', color: 'text-emerald-400' },
  { id: 'still_failing', label: 'Still Failing', color: 'text-amber-400' },
  { id: 'improved', label: 'Improved', color: 'text-blue-400' },
  { id: 'verified_then_recurred', label: 'Recurred', color: 'text-amber-400' },
];

export function OutcomesDrawer({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState<OutcomeFilter>('all');
  const [lifecycleFindingId, setLifecycleFindingId] = useState<string | null>(null);
  const go = useNavigateTab();

  const { data: summary } = useQuery({
    queryKey: ['fix-history-summary'],
    queryFn: () => fetchFixHistorySummary(7),
    staleTime: 30_000,
  });

  const { data: resData } = useQuery({
    queryKey: ['resolutions', 7],
    queryFn: () => fetchResolutions(7, 100),
    staleTime: 30_000,
  });

  // Conditions whose fix did not hold: auto-fix stopped and asked a person
  // (pulse-agent fix escalation). Older agents raise none; a failed read is
  // said, not shown as "none".
  const escalationsQ = useQuery({
    queryKey: ['fix-escalations'],
    queryFn: () => fetchInbox({ created_by: FIX_ESCALATION_CREATOR, limit: 50 }),
    staleTime: 30_000,
  });
  const escalations = (escalationsQ.data?.items ?? []).filter((i) => i.status !== 'resolved' && i.status !== 'archived');

  const resolutions = resData?.resolutions ?? [];
  const figures = summary ? fixOutcomeFigures(summary) : null;

  const filtered = filter === 'all'
    ? resolutions
    : resolutions.filter((r) => r.outcome === filter);

  const outcomeIcon = (outcome: string) => {
    switch (outcome) {
      case 'verified': return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
      case 'improved': return <ArrowUp className="w-3.5 h-3.5 text-blue-400" />;
      case 'still_failing': return <XCircle className="w-3.5 h-3.5 text-amber-400" />;
      case 'verified_then_recurred': return <RotateCcw className="w-3.5 h-3.5 text-amber-400" />;
      default: return <Clock className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  const outcomeLabel = (outcome: string) => {
    switch (outcome) {
      case 'verified': return 'Resolved';
      case 'improved': return 'Improved';
      case 'still_failing': return 'Still Failing';
      case 'pending': return 'Pending';
      case 'unverifiable': return 'Unverifiable';
      // Not "Verified": the verdict was retroactively withdrawn when the same
      // condition returned, so the label must carry the whole arc.
      case 'verified_then_recurred': return 'Verified, then recurred';
      default: return outcome;
    }
  };

  return (
    <>
      <DrawerShell
        title="Fix Outcomes"
        onClose={onClose}
        width="max-w-[520px]"
        bodyClassName=""
        subheader={<>
            {/* Summary stats */}
            {figures && summary && (
              <div className="grid grid-cols-4 gap-3 mb-3">
                <div className="text-center">
                  <div className="text-lg font-bold text-slate-200">{summary.total_actions}</div>
                  <div className="text-[10px] text-faint uppercase">Total</div>
                </div>
                <div className="text-center">
                  <button type="button" onClick={() => go(fixActivityLink('completed'), 'Activity')}
                    className="text-lg font-bold text-emerald-400 hover:underline" data-testid="outcomes-applied">
                    {figures.applied}
                  </button>
                  {/* `completed` is "applied": the write went through, held or not. */}
                  <div className="text-[10px] text-faint uppercase">Applied</div>
                </div>
                <div className="text-center" title={figures.basis}>
                  <div className="text-lg font-bold text-slate-200" data-testid="outcomes-held-pct">
                    {figures.pct !== null ? `${figures.pct}%` : '--'}
                  </div>
                  <div className="text-[10px] text-faint uppercase">{figures.reportsHeld ? 'Held' : 'Applied'}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-slate-200">
                    {summary.avg_resolution_ms > 0 ? `${(summary.avg_resolution_ms / 60000).toFixed(1)}m` : '--'}
                  </div>
                  <div className="text-[10px] text-faint uppercase">Avg Time</div>
                </div>
              </div>
            )}

            {/* Applied vs held vs failed, in words, with the window's basis. */}
            {figures && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mb-2" data-testid="outcomes-held-line">
                <span className="text-slate-300">{figures.label}: {figures.basis}</span>
                {figures.notHeld !== null && figures.notHeld > 0 && (
                  <span className="text-amber-400">{figures.notHeld} did not hold</span>
                )}
                {figures.failed > 0 && (
                  <button type="button" onClick={() => go(fixActivityLink('failed'), 'Activity')}
                    className="text-red-400 hover:underline" data-testid="outcomes-failed">
                    {figures.failed} failed to apply
                  </button>
                )}
              </div>
            )}

            {/* Verification breakdown */}
            {summary?.verification && (
              <div className="flex items-center gap-3 text-xs mb-3">
                <span className="text-emerald-400">{summary.verification.resolved} resolved</span>
                <span className="text-amber-400">{summary.verification.still_failing} still failing</span>
                {summary.verification.improved > 0 && <span className="text-blue-400">{summary.verification.improved} improved</span>}
                {(summary.verification.recurred ?? 0) > 0 && (
                  <span
                    className="text-amber-400"
                    title="Fixes that verified healthy, then the same condition returned within the recurrence window — counted against the success rate."
                  >
                    {summary.verification.recurred} recurred
                  </span>
                )}
                <span className="text-faint">{summary.verification.pending} pending</span>
              </div>
            )}

            {/* Filter chips */}
            <div className="flex gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-sm transition-colors',
                    filter === f.id ? 'bg-blue-600/20 text-blue-200' : 'text-slate-400 hover:text-slate-200 bg-slate-800',
                  )}
                >
                  {f.label}
                  {f.id === 'all' && <span className="ml-1 opacity-60">{resolutions.length}</span>}
                </button>
              ))}
            </div>
        </>}
      >
          {/* Fixes that did not hold, waiting for a person */}
          {(escalations.length > 0 || escalationsQ.isError) && (
            <div className="px-6 pt-4" data-testid="fix-escalations">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                Auto-fix stopped · waiting for a person
              </h3>
              {escalationsQ.isError ? (
                <p className="text-xs text-red-400">Stopped fixes could not be loaded from the Inbox.</p>
              ) : (
                <div className="space-y-2">
                  {escalations.map((item) => {
                    const md = item.metadata as { next_step?: unknown; owners?: { people?: Array<{ value?: unknown }> } };
                    const owner = md.owners?.people?.map((p) => String(p.value ?? '')).filter(Boolean).join(', ');
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => go(`/inbox?task=${encodeURIComponent(item.id)}`, 'Inbox')}
                        className="w-full text-left px-4 py-3 rounded-lg border border-amber-900/50 hover:bg-slate-800/50"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-xs text-slate-200">{item.title}</span>
                        </div>
                        {typeof md.next_step === 'string' && md.next_step && (
                          <p className="text-xs text-slate-400 line-clamp-2">{md.next_step}</p>
                        )}
                        <p className="text-[10px] text-faint mt-1">Owner: {owner || 'unknown'}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Resolution list */}
          <div className="px-6 py-4 space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-sm text-faint">
                No {filter === 'all' ? '' : outcomeLabel(filter).toLowerCase() + ' '}outcomes in the last 7 days
              </div>
            ) : (
              filtered.map((r) => (
                <button
                  key={r.id}
                  onClick={() => r.findingId && setLifecycleFindingId(r.findingId)}
                  className={cn(
                    'w-full text-left px-4 py-3 rounded-lg border transition-colors',
                    r.findingId ? 'cursor-pointer hover:bg-slate-800/50 border-slate-800' : 'border-slate-800/50',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {outcomeIcon(r.outcome)}
                    <span className="text-xs font-mono text-slate-300">{r.tool}</span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-sm font-medium',
                      r.outcome === 'verified' ? 'bg-emerald-900/40 text-emerald-300' :
                      r.outcome === 'improved' ? 'bg-blue-900/40 text-blue-300' :
                      // Grey, not amber: a probe that has not run (pending) or
                      // could not read the cluster (unverifiable) is not a fix
                      // having gone wrong.
                      r.outcome === 'pending' || r.outcome === 'unverifiable' ? 'bg-slate-800 text-slate-400' :
                      'bg-amber-900/40 text-amber-300',
                    )}>
                      {outcomeLabel(r.outcome)}
                    </span>
                    {/* Violet, not slate: this fix was approved by a person in
                        chat, and must not blend in with autonomous fixes. */}
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-sm',
                      r.category === 'chat_action' ? 'bg-violet-900/40 text-violet-300' : 'bg-slate-800 text-slate-400',
                    )}>
                      {actionCategoryLabel(r.category)}
                    </span>
                  </div>
                  {r.reasoning && (
                    <p className="text-xs text-slate-400 mb-1 line-clamp-2">{r.reasoning}</p>
                  )}
                  {r.evidence && (
                    <p className="text-xs text-faint mb-1 line-clamp-1">{r.evidence}</p>
                  )}
                  <div className="flex items-center gap-3 text-[10px] text-faint">
                    <span>{formatRelative(r.timestamp)}</span>
                    {r.timeToVerifyMs != null && r.timeToVerifyMs > 0 && (
                      <span>verified in {Math.round(r.timeToVerifyMs / 1000)}s</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Category breakdown */}
          {summary && summary.by_category.length > 0 && (
            <div className="px-6 py-4 border-t border-slate-800">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">By Category</h3>
              <div className="space-y-1.5">
                {summary.by_category.map((cat) => (
                  <div key={cat.category} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{actionCategoryLabel(cat.category)}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400">{categoryOutcome(cat, figures?.reportsHeld ?? false)}</span>
                      {cat.auto_fixed > 0 && <span className="text-faint">{cat.auto_fixed} auto</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
      </DrawerShell>

      {lifecycleFindingId && (
        <IncidentLifecycleDrawer
          findingId={lifecycleFindingId}
          onClose={() => setLifecycleFindingId(null)}
        />
      )}
    </>
  );
}
