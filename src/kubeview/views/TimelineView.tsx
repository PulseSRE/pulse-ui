import React from 'react';
import {
  Clock, AlertTriangle, CheckCircle, Info, XCircle, Activity, RefreshCw,
  Settings, Bell, ChevronRight, ChevronDown, ArrowRight, Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { resourceDetailUrl } from '../engine/gvr';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useUIStore } from '../store/uiStore';
import { useIncidentTimeline, type TimeRange } from '../hooks/useIncidentTimeline';
import type { TimelineEntry, TimelineCategory, CorrelationGroup } from '../engine/types/timeline';
import { Card } from '../components/primitives/Card';
import { CHART_COLORS } from '../engine/colors';

const TIME_RANGES: TimeRange[] = ['15m', '1h', '6h', '24h', '3d', '7d'];

const CATEGORY_CONFIG: Record<TimelineCategory, { label: string; icon: React.ElementType; color: string }> = {
  alert: { label: 'Alerts', icon: Bell, color: 'text-red-400' },
  event: { label: 'Events', icon: Activity, color: 'text-blue-400' },
  rollout: { label: 'Rollouts', icon: RefreshCw, color: 'text-emerald-400' },
  config: { label: 'Config', icon: Settings, color: 'text-amber-400' },
};

export default function TimelineView() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  // URL-persisted state
  const urlParams = new URLSearchParams(window.location.search);
  const [timeRange, setTimeRangeState] = React.useState<TimeRange>((urlParams.get('range') as TimeRange) || '6h');
  const [categories, setCategories] = React.useState<Set<TimelineCategory>>(() => {
    const cat = urlParams.get('cat');
    return cat ? new Set(cat.split(',') as TimelineCategory[]) : new Set<TimelineCategory>(['alert', 'event', 'rollout', 'config']);
  });
  const [selectedCorrelation, setSelectedCorrelation] = React.useState<string | null>(null);

  const setTimeRange = (r: TimeRange) => {
    setTimeRangeState(r);
    const url = new URL(window.location.href);
    url.searchParams.set('range', r);
    window.history.replaceState(null, '', url.toString());
  };

  const toggleCategory = (cat: TimelineCategory) => {
    setCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      const url = new URL(window.location.href);
      url.searchParams.set('cat', [...next].join(','));
      window.history.replaceState(null, '', url.toString());
      return next;
    });
  };

  const { entries, correlationGroups, counts, isLoading } = useIncidentTimeline({
    timeRange,
    namespace: nsFilter,
    categories,
  });

  // Group entries by date
  const groupedEntries = React.useMemo(() => {
    const groups: Record<string, TimelineEntry[]> = {};
    for (const entry of entries) {
      const dateKey = getDateKey(new Date(entry.timestamp));
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(entry);
    }
    return groups;
  }, [entries]);

  const handleEntryClick = (entry: TimelineEntry) => {
    if (entry.resource) {
      const path = resourceDetailUrl({
        apiVersion: entry.resource.apiVersion,
        kind: entry.resource.kind,
        metadata: { name: entry.resource.name, namespace: entry.resource.namespace },
      });
      go(path, entry.resource.name);
    }
  };

  return (
    <div className="h-full overflow-auto bg-slate-950">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Clock className="w-6 h-6 text-blue-500" />
              Cluster Timeline
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Alerts, events, rollouts, and config changes — correlated for incident analysis
              {nsFilter && <span className="text-blue-400 ml-1">· {nsFilter}</span>}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Time Range */}
          <Card className="flex gap-1 p-1">
            {TIME_RANGES.map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded transition-colors',
                  timeRange === range ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {range}
              </button>
            ))}
          </Card>

          {/* Category Toggles */}
          <Card className="flex gap-1 p-1">
            {(Object.entries(CATEGORY_CONFIG) as [TimelineCategory, typeof CATEGORY_CONFIG.alert][]).map(([cat, cfg]) => {
              const Icon = cfg.icon;
              const active = categories.has(cat);
              const count = counts[cat];
              return (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors',
                    active ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-400'
                  )}
                >
                  <Icon className={cn('w-3.5 h-3.5', active ? cfg.color : 'text-slate-600')} />
                  {cfg.label}
                  {count > 0 && <span className="text-xs opacity-60">{count}</span>}
                </button>
              );
            })}
          </Card>
        </div>

        {/* Summary bar */}
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>{entries.length} entries</span>
          <span>·</span>
          <span>{correlationGroups.length} correlated incidents</span>
          {correlationGroups.filter(g => g.severity === 'critical').length > 0 && (
            <>
              <span>·</span>
              <span className="text-red-400">{correlationGroups.filter(g => g.severity === 'critical').length} critical</span>
            </>
          )}
        </div>

        {/* Correlated Incidents */}
        {correlationGroups.length > 0 && (
          <Card>
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-violet-400" />
                Correlated Incidents ({correlationGroups.length})
              </h2>
            </div>
            <div className="divide-y divide-slate-800">
              {correlationGroups.slice(0, 10).map((group) => (
                <CorrelationRow
                  key={group.key}
                  group={group}
                  expanded={selectedCorrelation === group.key}
                  onToggle={() => setSelectedCorrelation(selectedCorrelation === group.key ? null : group.key)}
                  onEntryClick={handleEntryClick}
                />
              ))}
            </div>
          </Card>
        )}

        {/* Timeline stream */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-slate-500 text-sm">Loading timeline...</div>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Info className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No timeline entries found</p>
              <p className="text-slate-500 text-xs mt-1">Try adjusting the time range or enabling more categories</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedEntries).map(([dateKey, dateEntries]) => (
              <div key={dateKey}>
                <div className="sticky top-0 z-10 bg-slate-950 py-2 mb-3">
                  <h2 className="text-sm font-semibold text-slate-100 uppercase tracking-wide">{dateKey}</h2>
                </div>
                <div className="relative pl-6 border-l-2 border-slate-800 space-y-3">
                  {dateEntries.map((entry) => (
                    <TimelineEntryCard key={entry.id} entry={entry} onClick={() => handleEntryClick(entry)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {entries.length >= 500 && (
          <div className="text-center py-4">
            <p className="text-xs text-slate-500">Showing first 500 events. Adjust time range to narrow results.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function TimelineEntryCard({ entry, onClick }: { entry: TimelineEntry; onClick: () => void }) {
  const cfg = CATEGORY_CONFIG[entry.category];
  const Icon = cfg.icon;
  const hasResource = !!entry.resource;

  const severityDot = {
    critical: 'bg-red-500',
    warning: 'bg-amber-500',
    info: 'bg-blue-500',
    normal: 'bg-slate-500',
  }[entry.severity];

  return (
    <div
      className={cn(
        'relative bg-slate-900 rounded-lg border border-slate-800 p-4',
        hasResource && 'cursor-pointer hover:border-slate-700 transition-colors'
      )}
      onClick={hasResource ? onClick : undefined}
    >
      {/* Timeline dot */}
      <div className={cn('absolute -left-[25px] top-5 w-3 h-3 rounded-full border-2 border-slate-950', severityDot)} />

      <div className="flex items-start gap-3">
        <div className={cn('flex-shrink-0 mt-0.5', cfg.color)}>
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-slate-500">
              {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className={cn('px-1.5 py-0.5 text-xs rounded', {
              'bg-red-900/50 text-red-300': entry.severity === 'critical',
              'bg-amber-900/50 text-amber-300': entry.severity === 'warning',
              'bg-blue-900/50 text-blue-300': entry.severity === 'info',
              'bg-slate-800 text-slate-400': entry.severity === 'normal',
            })}>
              {cfg.label}
            </span>
            {entry.namespace && (
              <span className="text-xs text-slate-600">{entry.namespace}</span>
            )}
          </div>

          {entry.resource && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-slate-500">{entry.resource.kind}</span>
              <span className="text-sm font-medium text-blue-400">{entry.resource.name}</span>
            </div>
          )}

          <div className="text-sm font-medium text-slate-200">{entry.title}</div>
          {entry.detail && (
            <div className="text-sm text-slate-400 mt-0.5 line-clamp-2">{entry.detail}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function CorrelationRow({ group, expanded, onToggle, onEntryClick }: {
  group: CorrelationGroup;
  expanded: boolean;
  onToggle: () => void;
  onEntryClick: (entry: TimelineEntry) => void;
}) {
  const categoryCounts = new Map<TimelineCategory, number>();
  for (const e of group.entries) {
    categoryCounts.set(e.category, (categoryCounts.get(e.category) || 0) + 1);
  }
  const label = group.key.split('/').slice(0, 2).join(' / ');
  const ns = group.key.split('/')[2];

  const severityColor = {
    critical: 'text-red-400',
    warning: 'text-amber-400',
    info: 'text-blue-400',
    normal: 'text-slate-400',
  }[group.severity];

  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/30 transition-colors">
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
          <span className={cn('w-2 h-2 rounded-full', group.severity === 'critical' ? 'bg-red-500' : group.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500')} />
          <span className={cn('text-sm font-medium', severityColor)}>{label}</span>
          {ns && ns !== '_' && <span className="text-xs text-slate-600">{ns}</span>}
        </div>
        <div className="flex items-center gap-2">
          {Array.from(categoryCounts.entries()).map(([cat, count]) => {
            const cfg = CATEGORY_CONFIG[cat];
            const CatIcon = cfg.icon;
            return (
              <span key={cat} className="flex items-center gap-1 text-xs text-slate-500">
                <CatIcon className={cn('w-3 h-3', cfg.color)} />
                {count}
              </span>
            );
          })}
          <span className="text-xs text-slate-600">{group.entries.length} entries</span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2 ml-7">
          {group.entries.map((entry) => (
            <div
              key={entry.id}
              className={cn('flex items-center gap-3 p-2 rounded text-sm', entry.resource && 'cursor-pointer hover:bg-slate-800/50')}
              onClick={() => entry.resource && onEntryClick(entry)}
            >
              <span className="text-xs text-slate-600 w-16 shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', {
                'bg-red-500': entry.severity === 'critical',
                'bg-amber-500': entry.severity === 'warning',
                'bg-blue-500': entry.severity === 'info',
                'bg-slate-500': entry.severity === 'normal',
              })} />
              <span className="text-slate-300 truncate">{entry.title}</span>
              <span className="text-xs text-slate-600 shrink-0">{CATEGORY_CONFIG[entry.category].label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

function getDateKey(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const eventDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (eventDate.getTime() === today.getTime()) return 'Today';
  if (eventDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
