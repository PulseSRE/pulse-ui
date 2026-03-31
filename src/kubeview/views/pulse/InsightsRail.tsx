import React from 'react';
import { Lightbulb, ArrowRight, AlertTriangle, AlertCircle, Info, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIncidentFeed, type IncidentSeverity } from '../../hooks/useIncidentFeed';

const severityConfig: Record<IncidentSeverity, { icon: React.ReactNode; borderClass: string; hoverClass: string }> = {
  critical: {
    icon: <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />,
    borderClass: 'border-red-500/30',
    hoverClass: 'hover:border-red-500/50 hover:bg-red-950/10',
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />,
    borderClass: 'border-amber-500/30',
    hoverClass: 'hover:border-amber-500/50 hover:bg-amber-950/10',
  },
  info: {
    icon: <Info className="h-4 w-4 text-blue-400 shrink-0" />,
    borderClass: 'border-slate-800',
    hoverClass: 'hover:border-slate-600 hover:bg-slate-800/50',
  },
};

interface QuickAction {
  label: string;
  route: string;
  title: string;
}

const quickActions: QuickAction[] = [
  { label: 'Incidents', route: '/incidents', title: 'Incidents' },
  { label: 'Readiness', route: '/onboarding', title: 'Onboarding' },
  { label: 'Alerts', route: '/alerts', title: 'Alerts' },
  { label: 'Reviews', route: '/reviews', title: 'Reviews' },
];

export function InsightsRail({ className, onNavigate }: { className?: string; onNavigate?: (route: string, title: string) => void }) {
  const { incidents, isLoading, counts } = useIncidentFeed({ limit: 5 });

  return (
    <aside className={cn('space-y-3 overflow-hidden', className)}>
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Issues</h3>
          {counts.total > 0 && (
            <button
              onClick={() => onNavigate?.('/incidents', 'Incidents')}
              className="text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
            >
              View all ({counts.total})
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        ) : incidents.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-slate-500">
            <Info className="h-4 w-4 text-emerald-500" />
            <span className="text-xs">All clear — no active incidents</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {incidents.map((inc) => {
              const cfg = severityConfig[inc.severity];
              return (
                <button
                  key={inc.id}
                  onClick={() => onNavigate?.('/incidents', 'Incidents')}
                  className={cn(
                    'w-full text-left rounded-lg border bg-slate-900 p-2.5 transition-colors cursor-pointer',
                    cfg.borderClass,
                    cfg.hoverClass,
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">{cfg.icon}</div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium text-slate-200 truncate">{inc.title}</h4>
                      <p className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">{inc.detail}</p>
                    </div>
                    <ChevronRight className="h-3 w-3 text-slate-600 shrink-0 mt-0.5" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Lightbulb className="h-3.5 w-3.5 text-yellow-400" />
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quick Actions</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {quickActions.map((qa) => (
            <button
              key={qa.route}
              onClick={() => onNavigate?.(qa.route, qa.title)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300 hover:border-violet-500/50 hover:text-slate-100 transition-colors"
            >
              {qa.label}
              <ArrowRight className="h-2.5 w-2.5" />
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
