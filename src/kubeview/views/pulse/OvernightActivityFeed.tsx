import React, { useState, useMemo } from 'react';
import { Moon, CheckCircle, XCircle, SkipForward, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMonitorStore } from '../../store/monitorStore';
import type { ActionReport } from '../../engine/monitorClient';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { Badge } from '../../components/primitives/Badge';

const INITIAL_VISIBLE = 3;

type ResultKey = 'completed' | 'failed' | 'other';

const resultConfig: Record<ResultKey, { icon: React.ReactNode; variant: 'success' | 'error' | 'warning' }> = {
  completed: { icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />, variant: 'success' },
  failed: { icon: <XCircle className="h-3.5 w-3.5 text-red-400" />, variant: 'error' },
  other: { icon: <SkipForward className="h-3.5 w-3.5 text-amber-400" />, variant: 'warning' },
};

function mapStatus(status: ActionReport['status']): ResultKey {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'rolled_back') return 'failed';
  return 'other';
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatLabel(status: ActionReport['status']): string {
  if (status === 'rolled_back') return 'rolled back';
  return status;
}

export function OvernightActivityFeed({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const go = useNavigateTab();
  const recentActions = useMonitorStore((s) => s.recentActions);

  const items = useMemo(() => {
    return [...recentActions].sort((a, b) => b.timestamp - a.timestamp);
  }, [recentActions]);

  const visible = expanded ? items : items.slice(0, INITIAL_VISIBLE);
  const hasMore = items.length > INITIAL_VISIBLE;

  if (items.length === 0) {
    return (
      <div className={cn('rounded-lg border border-slate-800 bg-slate-900 px-4 py-3', className)}>
        <div className="flex items-center gap-2 text-slate-500">
          <Moon className="h-4 w-4 text-indigo-400" />
          <span className="text-sm font-medium text-slate-400">Overnight Activity</span>
          <span className="ml-auto text-xs">No recent actions</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border border-slate-800 bg-slate-900 p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Moon className="h-4 w-4 text-indigo-400" />
        <h3 className="text-sm font-semibold text-slate-100">Overnight Activity</h3>
        <button
          onClick={() => go('/incidents', 'Incidents')}
          className="ml-auto text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
        >
          {items.length} actions
        </button>
      </div>

      <div className="space-y-1">
        {visible.map((item) => {
          const resultKey = mapStatus(item.status);
          const cfg = resultConfig[resultKey];
          return (
            <button
              key={item.id}
              onClick={() => go('/incidents', 'Incidents')}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-slate-800/70 transition-colors text-left"
            >
              {cfg.icon}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-200 truncate">{item.reasoning || item.tool}</p>
              </div>
              <Badge variant={cfg.variant} size="sm">{formatLabel(item.status)}</Badge>
              <span className="text-[11px] text-slate-600 shrink-0">{formatTime(item.timestamp)}</span>
            </button>
          );
        })}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          {expanded ? (
            <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
          ) : (
            <><ChevronDown className="h-3.5 w-3.5" /> Show {items.length - INITIAL_VISIBLE} more</>
          )}
        </button>
      )}
    </div>
  );
}
