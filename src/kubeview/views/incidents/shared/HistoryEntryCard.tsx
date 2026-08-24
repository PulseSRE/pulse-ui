import React from 'react';
import { Bell, Activity, RefreshCw, Settings, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TimelineEntry, TimelineCategory } from '../../../engine/types/timeline';

export const CATEGORY_CONFIG: Record<TimelineCategory, { label: string; icon: React.ElementType; color: string }> = {
  alert: { label: 'Alerts', icon: Bell, color: 'text-red-400' },
  event: { label: 'Events', icon: Activity, color: 'text-blue-400' },
  rollout: { label: 'Rollouts', icon: RefreshCw, color: 'text-emerald-400' },
  config: { label: 'Config', icon: Settings, color: 'text-amber-400' },
};

export function HistoryEntryCard({ entry, onClick, onRollback }: {
  entry: TimelineEntry;
  onClick: () => void;
  onRollback?: () => void;
}) {
  const cfg = CATEGORY_CONFIG[entry.category];
  const Icon = cfg.icon;
  const hasResource = !!entry.resource;

  const severityDot: Record<string, string> = {
    critical: 'bg-red-500',
    warning: 'bg-amber-500',
    info: 'bg-blue-500',
    normal: 'bg-slate-500',
  };

  return (
    <div
      className={cn(
        'relative bg-slate-900 rounded-lg border border-slate-800 p-4',
        hasResource && 'cursor-pointer hover:border-slate-700 transition-colors',
      )}
      role={hasResource ? 'button' : undefined}
      tabIndex={hasResource ? 0 : undefined}
      onClick={hasResource ? onClick : undefined}
      onKeyDown={hasResource ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {/* Timeline dot */}
      <div className={cn('absolute left-[-25px] top-5 w-3 h-3 rounded-full border-2 border-slate-950', severityDot[entry.severity] || 'bg-slate-500')} />

      <div className="flex items-start gap-3">
        <div className={cn('shrink-0 mt-0.5', cfg.color)}>
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-slate-500">
              {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span
              className={cn('px-1.5 py-0.5 text-xs rounded-sm', {
                'bg-red-900/50 text-red-300': entry.severity === 'critical',
                'bg-amber-900/50 text-amber-300': entry.severity === 'warning',
                'bg-blue-900/50 text-blue-300': entry.severity === 'info',
                'bg-slate-800 text-slate-400': entry.severity === 'normal',
              })}
            >
              {cfg.label}
            </span>
            {entry.namespace && <span className="text-xs text-slate-600">{entry.namespace}</span>}
          </div>

          {entry.resource && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-slate-500">{entry.resource.kind}</span>
              <span className="text-sm font-medium text-blue-400">{entry.resource.name}</span>
            </div>
          )}

          <div className="text-sm font-medium text-slate-200">{entry.title}</div>
          {entry.detail && <div className="text-sm text-slate-400 mt-0.5 line-clamp-2">{entry.detail}</div>}
        </div>

        {onRollback && (
          <button
            onClick={(e) => { e.stopPropagation(); onRollback(); }}
            onKeyDown={(e) => e.stopPropagation()}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-sm border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            aria-label={`Roll back: ${entry.title}`}
          >
            <Undo2 className="w-3.5 h-3.5" />
            Rollback
          </button>
        )}
      </div>
    </div>
  );
}
