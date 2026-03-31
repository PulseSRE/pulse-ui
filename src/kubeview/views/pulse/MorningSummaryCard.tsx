import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Bot, ClipboardList, AlertTriangle, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchBriefing, type BriefingResponse } from '../../engine/fixHistory';
import { useMonitorStore } from '../../store/monitorStore';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { useIncidentFeed } from '../../hooks/useIncidentFeed';

export function MorningSummaryCard({ className }: { className?: string }) {
  const go = useNavigateTab();
  const { data: briefing, isLoading, isError } = useQuery<BriefingResponse>({
    queryKey: ['briefing'],
    queryFn: () => fetchBriefing(12),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const pendingReviews = useMonitorStore((s) => s.pendingActions.length);
  const { counts } = useIncidentFeed({ limit: 0 });

  if (isLoading) {
    return (
      <div className={cn('relative rounded-lg border border-violet-500/30 bg-slate-900 p-5 overflow-hidden animate-pulse', className)}>
        <div className="h-6 w-48 bg-slate-700 rounded mb-4" />
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-14 bg-slate-700 rounded" />)}
        </div>
        <div className="h-4 bg-slate-700 rounded w-3/4" />
      </div>
    );
  }

  if (isError || !briefing) {
    return (
      <div className={cn('relative rounded-lg border border-slate-700 bg-slate-900 p-5 overflow-hidden', className)}>
        <div className="flex items-center gap-2 text-slate-400">
          <AlertTriangle className="h-5 w-5" />
          <span className="text-sm">Unable to load briefing. Agent may be unavailable.</span>
        </div>
      </div>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const highlights: string[] = [];
  if (briefing.summary) highlights.push(briefing.summary);
  if (briefing.categoriesFixed.length > 0) {
    highlights.push(`Agent addressed issues in: ${briefing.categoriesFixed.join(', ')}.`);
  }
  if (briefing.investigations > 0) {
    highlights.push(`${briefing.investigations} investigation${briefing.investigations > 1 ? 's' : ''} conducted in the last ${briefing.hours}h.`);
  }

  return (
    <div className={cn('relative rounded-lg border border-violet-500/30 bg-slate-900 p-5 overflow-hidden', className)}>
      <div className="pointer-events-none absolute -inset-px rounded-lg bg-violet-500/5" />

      <div className="relative flex items-center gap-2 mb-4">
        <Sparkles className="h-5 w-5 text-violet-400" />
        <h2 className="text-lg font-semibold text-slate-100">{briefing.greeting || greeting}</h2>
        <span className="text-xs text-slate-500 ml-auto">AI Briefing · last {briefing.hours}h</span>
      </div>

      <div className="relative grid grid-cols-4 gap-3 mb-4">
        <ClickableStat
          icon={<Bot className="h-4 w-4 text-blue-400" />}
          label="Actions"
          value={briefing.actions.total}
          onClick={() => go('/incidents', 'Incidents')}
        />
        <ClickableStat
          icon={<Bot className="h-4 w-4 text-emerald-400" />}
          label="Completed"
          value={briefing.actions.completed}
          valueClass={briefing.actions.completed > 0 ? 'text-emerald-400' : undefined}
          onClick={() => go('/incidents', 'Incidents')}
        />
        <ClickableStat
          icon={<Bell className="h-4 w-4 text-red-400" />}
          label="Incidents"
          value={counts.total}
          valueClass={counts.critical > 0 ? 'text-red-400' : counts.total > 0 ? 'text-amber-400' : undefined}
          onClick={() => go('/incidents', 'Incidents')}
        />
        <ClickableStat
          icon={<ClipboardList className="h-4 w-4 text-amber-400" />}
          label="Reviews"
          value={pendingReviews}
          valueClass={pendingReviews > 0 ? 'text-amber-400' : undefined}
          onClick={() => go('/reviews', 'Reviews')}
        />
      </div>

      {highlights.length > 0 && (
        <ul className="relative space-y-1.5">
          {highlights.map((h, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
              {h}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClickableStat({
  icon,
  label,
  value,
  valueClass,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  valueClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2 hover:border-violet-500/30 hover:bg-slate-800 transition-colors text-left"
    >
      {icon}
      <div>
        <div className={cn('text-lg font-bold text-slate-100 leading-tight', valueClass)}>
          {value}
        </div>
        <div className="text-[11px] text-slate-500">{label}</div>
      </div>
    </button>
  );
}
