import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users, Eye, LayoutDashboard, Bot, Timer,
  MousePointerClick, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { safeQuery } from '../../engine/safeQuery';
import { fetchSessionAnalytics } from '../../engine/analyticsApi';
import { StatCard } from './StatCard';

export function SessionAnalyticsSection() {
  const [days, setDays] = useState(7);

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'sessions', days],
    queryFn: () => safeQuery(() => fetchSessionAnalytics(days)),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Users className="w-4 h-4 text-sky-400" />
          User Sessions
        </h2>
        <div className="flex justify-center py-8"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>
      </div>
    );
  }

  if (!data || (data.summary.total_sessions === 0 && data.pages.length === 0)) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Users className="w-4 h-4 text-sky-400" />
          User Sessions
        </h2>
        <div className="text-center py-8 text-sm text-slate-500">
          No session data yet. User activity will appear once the SessionTracker records page views.
        </div>
      </div>
    );
  }

  const { summary, pages, time_on_page, agent_queries_by_page, top_suggestions, feature_usage } = data;
  const maxViews = Math.max(...pages.slice(0, 12).map((p) => p.views), 1);
  const maxQueries = Math.max(...agent_queries_by_page.slice(0, 10).map((q) => q.queries), 1);

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  const formatPage = (path: string) => {
    if (path === '/' || path === '') return 'Home';
    const clean = path.replace(/^\//, '').replace(/\/$/, '');
    const parts = clean.split('/');
    if (parts.length <= 2) return '/' + clean;
    return '/' + parts[0] + '/...' + '/' + parts[parts.length - 1];
  };

  return (
    <div className="space-y-4">
      {/* Header with time range selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-400" />
            User Sessions
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">How users navigate, where they ask the agent, and what suggestions they click.</p>
        </div>
        <div className="flex gap-1">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                'px-2 py-0.5 text-[11px] rounded-sm transition-colors',
                days === d ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="Sessions" value={summary.total_sessions.toLocaleString()} icon={<Users className="w-4 h-4 text-sky-400" />} />
        <StatCard label="Page Views" value={summary.total_page_views.toLocaleString()} icon={<Eye className="w-4 h-4 text-indigo-400" />} />
        <StatCard label="Pages Visited" value={String(summary.unique_pages)} icon={<LayoutDashboard className="w-4 h-4 text-violet-400" />} />
        <StatCard label="Agent Queries" value={summary.total_queries.toLocaleString()} icon={<Bot className="w-4 h-4 text-emerald-400" />} />
        <StatCard label="Avg Time on Page" value={formatDuration(summary.avg_duration_seconds)} icon={<Timer className="w-4 h-4 text-amber-400" />} />
      </div>

      {/* Top pages + time on page — side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Top Pages */}
        {pages.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs font-medium text-slate-300 mb-3 flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-indigo-400" />
              Top Pages
            </h3>
            <div className="space-y-1.5">
              {pages.slice(0, 8).map((p) => (
                <div key={p.page} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate font-mono text-slate-300" title={p.page}>{formatPage(p.page)}</span>
                  <div className="flex-1 h-4 bg-slate-800 rounded-xs overflow-hidden" role="meter" aria-label={`${p.page}: ${p.views} views`} aria-valuenow={p.views} aria-valuemin={0} aria-valuemax={maxViews}>
                    <div className="h-full bg-indigo-600/50 rounded-xs" style={{ width: `${(p.views / maxViews) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right text-slate-400">{p.views}</span>
                  <span className="w-12 text-right text-slate-500 text-[10px]">{p.sessions} sess</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Time on Page */}
        {time_on_page.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs font-medium text-slate-300 mb-3 flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5 text-amber-400" />
              Time on Page
            </h3>
            <div className="space-y-1.5">
              {time_on_page.slice(0, 8).map((t) => {
                const maxSec = Math.max(...time_on_page.slice(0, 8).map((x) => x.avg_seconds), 1);
                return (
                  <div key={t.page} className="flex items-center gap-2 text-xs">
                    <span className="w-28 truncate font-mono text-slate-300" title={t.page}>{formatPage(t.page)}</span>
                    <div className="flex-1 h-4 bg-slate-800 rounded-xs overflow-hidden" role="meter" aria-label={`${t.page}: ${formatDuration(t.avg_seconds)} avg`} aria-valuenow={t.avg_seconds} aria-valuemin={0} aria-valuemax={maxSec}>
                      <div className="h-full bg-amber-600/40 rounded-xs" style={{ width: `${(t.avg_seconds / maxSec) * 100}%` }} />
                    </div>
                    <span className="w-12 text-right text-slate-400">{formatDuration(t.avg_seconds)}</span>
                    <span className="w-8 text-right text-slate-500 text-[10px]">n={t.samples}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Agent queries + Suggestions + Features — side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Agent Queries by Page */}
        {agent_queries_by_page.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs font-medium text-slate-300 mb-1 flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
              Agent Queries by Page
            </h3>
            <p className="text-[10px] text-slate-500 mb-3">Where users ask the agent most.</p>
            <div className="space-y-1.5">
              {agent_queries_by_page.slice(0, 8).map((q) => (
                <div key={q.page} className="flex items-center gap-2 text-xs">
                  <span className="w-24 truncate font-mono text-slate-300" title={q.page}>{formatPage(q.page)}</span>
                  <div className="flex-1 h-3 bg-slate-800 rounded-xs overflow-hidden">
                    <div className="h-full bg-emerald-600/50 rounded-xs" style={{ width: `${(q.queries / maxQueries) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right text-slate-400">{q.queries}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Popular Suggestions */}
        {top_suggestions.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs font-medium text-slate-300 mb-1 flex items-center gap-1.5">
              <MousePointerClick className="w-3.5 h-3.5 text-sky-400" />
              Top Suggestion Clicks
            </h3>
            <p className="text-[10px] text-slate-500 mb-3">Follow-up prompts users click most.</p>
            <div className="space-y-2">
              {top_suggestions.slice(0, 6).map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 w-5 h-5 rounded-sm bg-sky-900/40 text-sky-400 flex items-center justify-center text-[10px] font-medium">{s.clicks}</span>
                  <span className="text-slate-300 leading-tight line-clamp-2">{s.suggestion}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feature Usage */}
        {feature_usage.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs font-medium text-slate-300 mb-1 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
              Feature Usage
            </h3>
            <p className="text-[10px] text-slate-500 mb-3">Interactive features users engage with.</p>
            <div className="space-y-1.5">
              {feature_usage.slice(0, 8).map((f) => (
                <div key={f.feature} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-mono">{f.feature}</span>
                  <span className="text-slate-400">{f.uses}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
