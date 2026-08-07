import { useState, useEffect, useRef } from 'react';
import {
  X, CheckCircle, XCircle, ArrowUp, Clock,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { fetchResolutions, fetchFixHistorySummary } from '../../engine/analyticsApi';
import { formatRelativeTime } from '../../engine/formatters';
import { IncidentLifecycleDrawer } from '../incidents/IncidentLifecycleDrawer';

type OutcomeFilter = 'all' | 'verified' | 'still_failing' | 'improved';

const FILTERS: { id: OutcomeFilter; label: string; color: string }[] = [
  { id: 'all', label: 'All', color: 'text-slate-300' },
  { id: 'verified', label: 'Resolved', color: 'text-emerald-400' },
  { id: 'still_failing', label: 'Still Failing', color: 'text-amber-400' },
  { id: 'improved', label: 'Improved', color: 'text-blue-400' },
];

export function OutcomesDrawer({ onClose }: { onClose: () => void }) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<OutcomeFilter>('all');
  const [lifecycleFindingId, setLifecycleFindingId] = useState<string | null>(null);

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

  const resolutions = resData?.resolutions ?? [];

  const filtered = filter === 'all'
    ? resolutions
    : resolutions.filter((r) => r.outcome === filter);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => { drawerRef.current?.focus(); }, []);

  const outcomeIcon = (outcome: string) => {
    switch (outcome) {
      case 'verified': return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
      case 'improved': return <ArrowUp className="w-3.5 h-3.5 text-blue-400" />;
      case 'still_failing': return <XCircle className="w-3.5 h-3.5 text-amber-400" />;
      default: return <Clock className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  const outcomeLabel = (outcome: string) => {
    switch (outcome) {
      case 'verified': return 'Resolved';
      case 'improved': return 'Improved';
      case 'still_failing': return 'Still Failing';
      default: return outcome;
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Outcomes" onClick={onClose}>
        <div className="absolute inset-0 bg-black/50" />
        <div
          ref={drawerRef}
          tabIndex={-1}
          className="relative w-[520px] h-full bg-slate-950 border-l border-slate-800 overflow-y-auto focus:outline-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-200">Fix Outcomes</h2>
              <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Summary stats */}
            {summary && (
              <div className="grid grid-cols-4 gap-3 mb-3">
                <div className="text-center">
                  <div className="text-lg font-bold text-slate-200">{summary.total_actions}</div>
                  <div className="text-[10px] text-slate-500 uppercase">Total</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-emerald-400">{summary.completed}</div>
                  <div className="text-[10px] text-slate-500 uppercase">Fixed</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-slate-200">{Math.round(summary.success_rate * 100)}%</div>
                  <div className="text-[10px] text-slate-500 uppercase">Success</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-slate-200">
                    {summary.avg_resolution_ms > 0 ? `${(summary.avg_resolution_ms / 60000).toFixed(1)}m` : '--'}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase">Avg Time</div>
                </div>
              </div>
            )}

            {/* Verification breakdown */}
            {summary?.verification && (
              <div className="flex items-center gap-3 text-xs mb-3">
                <span className="text-emerald-400">{summary.verification.resolved} resolved</span>
                <span className="text-amber-400">{summary.verification.still_failing} still failing</span>
                {summary.verification.improved > 0 && <span className="text-blue-400">{summary.verification.improved} improved</span>}
                <span className="text-slate-500">{summary.verification.pending} pending</span>
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
                    filter === f.id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200 bg-slate-800',
                  )}
                >
                  {f.label}
                  {f.id === 'all' && <span className="ml-1 opacity-60">{resolutions.length}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution list */}
          <div className="px-6 py-4 space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500">
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
                      'bg-amber-900/40 text-amber-300',
                    )}>
                      {outcomeLabel(r.outcome)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm">{r.category}</span>
                  </div>
                  {r.reasoning && (
                    <p className="text-xs text-slate-400 mb-1 line-clamp-2">{r.reasoning}</p>
                  )}
                  {r.evidence && (
                    <p className="text-xs text-slate-500 mb-1 line-clamp-1">{r.evidence}</p>
                  )}
                  <div className="flex items-center gap-3 text-[10px] text-slate-600">
                    <span>{formatRelativeTime(r.timestamp)}</span>
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
                    <span className="text-slate-300">{cat.category}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400">{cat.success_count}/{cat.count}</span>
                      {cat.auto_fixed > 0 && <span className="text-slate-500">{cat.auto_fixed} auto</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {lifecycleFindingId && (
        <IncidentLifecycleDrawer
          findingId={lifecycleFindingId}
          onClose={() => setLifecycleFindingId(null)}
        />
      )}
    </>
  );
}
