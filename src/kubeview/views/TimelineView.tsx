import React from 'react';
import { PageHeader } from '../components/primitives/PageHeader';
import { useSearchParams } from 'react-router-dom';
import { useSearchParamUpdater } from '../components/primitives/Tabs';
import {
  Clock, AlertTriangle, CheckCircle, Info, XCircle, Activity, RefreshCw,
  Settings, Bell, ChevronRight, ChevronDown, ArrowRight, Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { resourceDetailUrl } from '../engine/gvr';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useUIStore } from '../store/uiStore';
import { useNamespaceScope } from '../hooks/useNamespaceScope';
import { useIncidentTimeline, TIME_RANGE_MS, CLUSTER_EVENTS_CAP, type TimeRange } from '../hooks/useIncidentTimeline';
import { bucketEntries } from '../engine/timeline';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { TimelineEntry, TimelineCategory, CorrelationGroup } from '../engine/types/timeline';
import { Card } from '../components/primitives/Card';
import { LoadError } from '../components/primitives/LoadError';
import { CHART_COLORS } from '../engine/colors';
import { CorrelationGroupRow } from './incidents/shared/CorrelationGroupRow';
import { useAgentStore } from '../store/agentStore';
import { formatTime, getDateKey } from '../engine/format';

/** Ask the agent about a correlated incident (moved here from Inbox › Activity). */
function investigateGroup(group: CorrelationGroup) {
  const label = (group.key || '').split('/').slice(0, 2).join(' ');
  const ns = (group.key || '').split('/')[2];
  const eventSummary = group.entries.slice(0, 8).map((e) => e.title).join(', ');
  const query = `Investigate ${label}${ns && ns !== '_' ? ` in namespace ${ns}` : ''}. Recent events: ${eventSummary}. What is the root cause and how should I fix it?`;
  useAgentStore.getState().sendMessage(query);
  useUIStore.getState().expandAISidebar();
  useUIStore.getState().setAISidebarMode('chat');
}

const TIME_RANGES: TimeRange[] = ['15m', '1h', '6h', '24h', '3d', '7d'];

const CATEGORY_CONFIG: Record<TimelineCategory, { label: string; icon: React.ElementType; color: string }> = {
  alert: { label: 'Alerts', icon: Bell, color: 'text-red-400' },
  event: { label: 'Events', icon: Activity, color: 'text-blue-400' },
  rollout: { label: 'Rollouts', icon: RefreshCw, color: 'text-emerald-400' },
  config: { label: 'Config', icon: Settings, color: 'text-amber-400' },
};

export default function TimelineView() {
  const go = useNavigateTab();
  const { namespace: selectedNamespace } = useNamespaceScope();
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  // URL-persisted state, written through the router
  const [searchParams] = useSearchParams();
  const updateSearch = useSearchParamUpdater();
  const [timeRange, setTimeRangeState] = React.useState<TimeRange>((searchParams.get('range') as TimeRange) || '6h');
  const [categories, setCategories] = React.useState<Set<TimelineCategory>>(() => {
    const cat = searchParams.get('cat');
    return cat ? new Set(cat.split(',') as TimelineCategory[]) : new Set<TimelineCategory>(['alert', 'event', 'rollout', 'config']);
  });
  const [selectedCorrelation, setSelectedCorrelation] = React.useState<string | null>(null);

  const setTimeRange = (r: TimeRange) => {
    setTimeRangeState(r);
    updateSearch((next) => next.set('range', r));
  };

  const toggleCategory = (cat: TimelineCategory) => {
    const next = new Set(categories);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    setCategories(next);
    updateSearch((params) => params.set('cat', [...next].join(',')));
  };

  const timeline = useIncidentTimeline({
    timeRange,
    namespace: nsFilter,
    categories,
  });
  const entries = timeline.entries || [];
  const correlationGroups = timeline.correlationGroups || [];
  const counts = timeline.counts || { alert: 0, event: 0, rollout: 0, config: 0 };
  const isLoading = timeline.isLoading;
  const failedSources = timeline.failedSources || [];
  const unavailableSources = timeline.unavailableSources || [];
  // Every requested source failed: an error, not an empty timeline.
  const allFailed = !isLoading && failedSources.length > 0 && failedSources.length >= (timeline.requestedSources ?? categories.size);

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
        <PageHeader
          icon={<Clock className="w-6 h-6 text-blue-500" />}
          title="Cluster Timeline"
          subtitle={<>Alerts, events, rollouts, and config changes — correlated for incident analysis{nsFilter && <span className="text-blue-400 ml-1">· {nsFilter}</span>}</>}
        />

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Time Range */}
          <Card className="flex gap-1 p-1">
            {TIME_RANGES.map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-sm transition-colors',
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
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm transition-colors',
                    active ? 'bg-slate-700 text-slate-200' : 'text-faint hover:text-slate-400'
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
        <div className="flex items-center gap-4 text-xs text-faint">
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

        {/* Density per category over the range */}
        {!isLoading && !allFailed && (
          <TimelineDensity entries={entries} timeRange={timeRange} categories={categories} />
        )}

        {/* Correlated Incidents */}
        {correlationGroups.length > 0 && (
          <Card>
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-blue-400" />
                Correlated Incidents ({correlationGroups.length})
              </h2>
            </div>
            <div className="divide-y divide-slate-800">
              {correlationGroups.slice(0, 10).map((group) => (
                <CorrelationGroupRow
                  key={group.key}
                  group={group}
                  expanded={selectedCorrelation === group.key}
                  onToggle={() => setSelectedCorrelation(selectedCorrelation === group.key ? null : group.key)}
                  onEntryClick={handleEntryClick}
                  onInvestigate={() => investigateGroup(group)}
                />
              ))}
            </div>
          </Card>
        )}

        {allFailed ? (
          <LoadError
            title={`The timeline could not be loaded: ${failedSources.join(', ')} could not be read`}
            onRetry={timeline.refetch}
          />
        ) : failedSources.length > 0 && !isLoading && (
          <LoadError
            title={`Could not read ${failedSources.join(', ')} — the timeline below is incomplete`}
            onRetry={timeline.refetch}
          />
        )}

        {unavailableSources.length > 0 && (
          <p role="note" data-testid="timeline-unavailable-sources" className="text-xs text-slate-400 bg-slate-900 border border-slate-800 rounded-sm px-3 py-2">
            Unavailable for this cluster: {unavailableSources.join(', ')} — alerts are read from the local cluster&apos;s
            Prometheus only, so they are left out here rather than shown from another cluster.
          </p>
        )}

        {timeline.configChangesNote && (
          <p role="note" data-testid="timeline-config-note" className="text-xs text-slate-400">{timeline.configChangesNote}</p>
        )}

        {timeline.eventsCapped && (
          <p role="status" className="text-xs text-amber-300/80">
            Events are capped at {CLUSTER_EVENTS_CAP} cluster-wide, so some in this range may be missing. Select a namespace to see all of its events.
          </p>
        )}

        {/* Timeline stream */}
        {allFailed ? null : isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-faint text-sm">Loading timeline...</div>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Info className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">{failedSources.length > 0 || unavailableSources.length > 0 ? 'Nothing found in the sources that could be read' : 'No timeline entries found'}</p>
              <p className="text-faint text-xs mt-1">Try adjusting the time range or enabling more categories</p>
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

      </div>
    </div>
  );
}

// ── Sub-components ──

const DENSITY_COLORS: Record<TimelineCategory, string> = {
  alert: '#f87171',
  event: '#60a5fa',
  rollout: '#34d399',
  config: '#fbbf24',
};

const _densityTime = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Stacked density of entries per category across the selected range. */
function TimelineDensity({ entries, timeRange, categories }: { entries: TimelineEntry[]; timeRange: TimeRange; categories: Set<TimelineCategory> }) {
  const data = React.useMemo(() => {
    const end = Date.now();
    return bucketEntries(entries, end - TIME_RANGE_MS[timeRange], end);
  }, [entries, timeRange]);
  const active = (Object.keys(CATEGORY_CONFIG) as TimelineCategory[]).filter((c) => categories.has(c));
  const peak = data.reduce((m, d) => Math.max(m, active.reduce((s, c) => s + d[c], 0)), 0);
  return (
    <Card className="px-3 pt-3 pb-1">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xs font-semibold text-slate-300">Activity over the last {timeRange}</h2>
        <ul aria-label="Timeline density" className="flex gap-3 text-[11px] text-slate-400">
          {active.map((c) => (
            <li key={c} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: DENSITY_COLORS[c] }} />
              {CATEGORY_CONFIG[c].label} {data.reduce((s, d) => s + d[c], 0)}
            </li>
          ))}
          <li className="text-faint">peak {peak}/bucket</li>
        </ul>
      </div>
      <div style={{ height: 96 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap={1}>
            <XAxis dataKey="time" tickFormatter={(t: number) => _densityTime.format(t)} stroke="#475569" tick={{ fontSize: 9, fill: '#64748b' }} minTickGap={40} />
            <YAxis allowDecimals={false} stroke="#475569" tick={{ fontSize: 9, fill: '#64748b' }} width={40} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
              labelFormatter={(t) => (typeof t === 'number' ? _densityTime.format(t) : String(t))}
              cursor={{ fill: '#33415540' }}
            />
            {active.map((c) => (
              <Bar key={c} dataKey={c} name={CATEGORY_CONFIG[c].label} stackId="d" fill={DENSITY_COLORS[c]} fillOpacity={0.85} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

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
      <div className={cn('absolute left-[-25px] top-5 w-3 h-3 rounded-full border-2 border-slate-950', severityDot)} />

      <div className="flex items-start gap-3">
        <div className={cn('shrink-0 mt-0.5', cfg.color)}>
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-faint">
              {formatTime(entry.timestamp)}
            </span>
            <span className={cn('px-1.5 py-0.5 text-xs rounded-sm', {
              'bg-red-900/50 text-red-300': entry.severity === 'critical',
              'bg-amber-900/50 text-amber-300': entry.severity === 'warning',
              'bg-blue-900/50 text-blue-300': entry.severity === 'info',
              'bg-slate-800 text-slate-400': entry.severity === 'normal',
            })}>
              {cfg.label}
            </span>
            {entry.namespace && (
              <span className="text-xs text-faint">{entry.namespace}</span>
            )}
          </div>

          {entry.resource && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-faint">{entry.resource.kind}</span>
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

