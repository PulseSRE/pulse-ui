import { ChevronRight, ChevronDown, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TimelineEntry, TimelineCategory, CorrelationGroup } from '../../../engine/types/timeline';

const CATEGORY_LABELS: Record<TimelineCategory, string> = {
  alert: 'Alerts',
  event: 'Events',
  rollout: 'Rollouts',
  config: 'Config',
};

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
  normal: 'bg-slate-500',
};

export function summarizeEventPattern(entries: TimelineEntry[]): string | null {
  const titles = entries.map((e) => e.title.toLowerCase());
  const hasFailed = titles.some((t) => t.includes('failed'));
  const hasBackoff = titles.some((t) => t.includes('backoff') || t.includes('back-off'));
  const hasPulling = titles.some((t) => t.includes('pulling'));
  const hasOOM = titles.some((t) => t.includes('oomkill') || t.includes('oom'));
  const hasCrash = titles.some((t) => t.includes('crashloop') || t.includes('backoff'));
  const hasEviction = titles.some((t) => t.includes('evict'));
  const hasScaling = titles.some((t) => t.includes('scaled') || t.includes('replica'));

  if (hasOOM) return 'Container killed by OOM — may need higher memory limits';
  if (hasCrash && hasFailed) return 'Pod is crash-looping — container starts then exits repeatedly';
  if (hasFailed && hasPulling && hasBackoff) return 'Image pull failure — container image could not be fetched';
  if (hasFailed && hasBackoff) return 'Pod failing to start — check container logs and events';
  if (hasEviction) return 'Pod evicted — node under resource pressure';
  if (hasScaling) return 'Replica count changed — scaling event';
  if (hasFailed) return 'Resource entered failed state';
  return null;
}

export function CorrelationGroupRow({
  group,
  expanded,
  onToggle,
  onEntryClick,
  onInvestigate,
}: {
  group: CorrelationGroup;
  expanded: boolean;
  onToggle: () => void;
  onEntryClick: (entry: TimelineEntry) => void;
  onInvestigate: () => void;
}) {
  const categoryCounts = new Map<TimelineCategory, number>();
  for (const e of group.entries || []) {
    categoryCounts.set(e.category, (categoryCounts.get(e.category) || 0) + 1);
  }
  const label = (group.key || '').split('/').slice(0, 2).join(' / ');
  const ns = (group.key || '').split('/')[2];
  const pattern = summarizeEventPattern(group.entries);

  const severityColor: Record<string, string> = {
    critical: 'text-red-400',
    warning: 'text-amber-400',
    info: 'text-blue-400',
    normal: 'text-slate-400',
  };

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
          )}
          <span
            className={cn(
              'w-2 h-2 rounded-full shrink-0',
              group.severity === 'critical' ? 'bg-red-500' : group.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500',
            )}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('text-sm font-medium truncate', severityColor[group.severity] || 'text-slate-400')}>
                {label}
              </span>
              {ns && ns !== '_' && <span className="text-xs text-slate-600 shrink-0">{ns}</span>}
            </div>
            {pattern && (
              <div className="text-xs text-slate-500 mt-0.5">{pattern}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {Array.from(categoryCounts.entries()).map(([cat, count]) => (
            <span key={cat} className="flex items-center gap-1 text-xs text-slate-500">
              {CATEGORY_LABELS[cat]} {count}
            </span>
          ))}
          <span className="text-xs text-slate-600">{group.entries.length} entries</span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 ml-7">
          <button
            onClick={(e) => { e.stopPropagation(); onInvestigate(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 mb-3 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-md transition-colors"
          >
            <Bot className="w-3.5 h-3.5" />
            Investigate with AI
          </button>
          <div className="space-y-1">
            {group.entries.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  'flex items-center gap-3 px-2 py-1.5 rounded-sm text-sm',
                  entry.resource && 'cursor-pointer hover:bg-slate-800/50',
                )}
                role={entry.resource ? 'button' : undefined}
                tabIndex={entry.resource ? 0 : undefined}
                onClick={() => entry.resource && onEntryClick(entry)}
                onKeyDown={entry.resource ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEntryClick(entry); } } : undefined}
              >
                <span className="text-xs text-slate-600 w-16 shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', SEVERITY_DOT[entry.severity] || 'bg-slate-500')} />
                <span className="text-slate-300 truncate">{entry.title}</span>
                {entry.detail && <span className="text-xs text-slate-600 truncate max-w-[200px]">{entry.detail}</span>}
                <span className="text-xs text-slate-600 shrink-0 ml-auto">{CATEGORY_LABELS[entry.category]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
