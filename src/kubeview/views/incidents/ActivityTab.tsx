import React, { useState, useMemo, useEffect } from 'react';
import {
  Search, Info, Bell, Activity, RefreshCw, Settings, Bot,
  Sparkles, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../components/primitives/Card';
import { EmptyState } from '../../components/primitives/EmptyState';
import { useIncidentTimeline, type TimeRange } from '../../hooks/useIncidentTimeline';
import { useUIStore } from '../../store/uiStore';
import { useMonitorStore } from '../../store/monitorStore';
import { useAgentStore } from '../../store/agentStore';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { resourceDetailUrl } from '../../engine/gvr';
import { formatRelativeTime } from '../../engine/formatters';
import { getDateKey } from '../../engine/dateUtils';
import { fetchLearningFeed } from '../../engine/analyticsApi';
import { actionCategoryLabel } from '../../engine/fixHistory';
import { agentFetch } from '../../engine/safeQuery';
import { requestRollback, type ActionRecord } from '../../engine/fixHistory';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import type { TimelineEntry, TimelineCategory, CorrelationGroup } from '../../engine/types/timeline';
import { CorrelationGroupRow } from './shared/CorrelationGroupRow';
import { HistoryEntryCard } from './shared/HistoryEntryCard';
import { InvestigationCard } from './shared/InvestigationCard';
import { PostmortemCard, type Postmortem } from './shared/PostmortemCard';
import { IncidentLifecycleDrawer } from './IncidentLifecycleDrawer';

const TIME_RANGES: TimeRange[] = ['15m', '1h', '6h', '24h', '3d', '7d'];

type ViewMode = 'by-resource' | 'by-date';
type ActivityCategory = 'events' | 'alerts' | 'agent' | 'rollouts' | 'config';

const ACTIVITY_CATEGORIES: { id: ActivityCategory; label: string; icon: React.ElementType }[] = [
  { id: 'events', label: 'Events', icon: Activity },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'rollouts', label: 'Rollouts', icon: RefreshCw },
  { id: 'config', label: 'Config', icon: Settings },
];

async function fetchPostmortems(): Promise<{ postmortems: Postmortem[]; total: number }> {
  const res = await agentFetch('/api/agent/postmortems');
  if (!res.ok) return { postmortems: [], total: 0 };
  return res.json();
}

export function ActivityTab() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  const [viewMode, setViewMode] = useState<ViewMode>('by-date');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<ActivityCategory>>(
    () => new Set(['events', 'alerts', 'agent', 'rollouts', 'config']),
  );
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [lifecycleFindingId, setLifecycleFindingId] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ActionRecord | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  const toggleCategory = (cat: ActivityCategory) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Map activity categories to timeline categories
  const timelineCategories = useMemo(() => {
    const cats = new Set<TimelineCategory>();
    if (activeCategories.has('events')) cats.add('event');
    if (activeCategories.has('alerts')) cats.add('alert');
    if (activeCategories.has('rollouts')) cats.add('rollout');
    if (activeCategories.has('config')) cats.add('config');
    return cats;
  }, [activeCategories]);

  const timeline = useIncidentTimeline({ timeRange, namespace: nsFilter, categories: timelineCategories });
  const investigations = useMonitorStore((s) => s.investigations);
  const _recentActions = useMonitorStore((s) => s.recentActions);
  const fixHistory = useMonitorStore((s) => s.fixHistory);
  const loadFixHistory = useMonitorStore((s) => s.loadFixHistory);
  const findings = useMonitorStore((s) => s.findings);

  useEffect(() => { loadFixHistory(); }, [loadFixHistory]);

  const { data: postmortemData } = useQuery({
    queryKey: ['postmortems'],
    queryFn: fetchPostmortems,
    refetchInterval: 60_000,
  });

  const { data: learningData } = useQuery({
    queryKey: ['learning-feed', 7],
    queryFn: () => fetchLearningFeed(7),
    refetchInterval: 60_000,
    enabled: activeCategories.has('agent'),
  });

  const showAgent = activeCategories.has('agent');
  const postmortems = postmortemData?.postmortems ?? [];
  const learningEvents = learningData?.events ?? [];

  // Filter investigations by namespace
  const filteredInvestigations = useMemo(
    () => [...investigations]
      .filter((report) => {
        if (!nsFilter) return true;
        const finding = findings.find((f) => f.id === report.findingId);
        return Boolean(finding?.resources?.some((r) => r.namespace === nsFilter));
      })
      .sort((a, b) => b.timestamp - a.timestamp),
    [findings, investigations, nsFilter],
  );

  // Merge timeline entries with fix history for "by date" mode
  const mergedEntries = useMemo(() => {
    let all = [...(timeline.entries || [])];

    if (showAgent) {
      for (const action of fixHistory) {
        // A chat_action row is a write the operator approved in chat — labeling
        // it a plain "Fix" would make a human decision read as an autonomous one.
        const prefix = action.category === 'chat_action' ? 'User-approved fix' : 'Fix';
        // A recurred fix completed and even verified once, but the agent
        // withdrew that verdict — showing it as a plain completed fix would
        // keep asserting a success the agent no longer claims.
        const recurred = action.verificationStatus === 'verified_then_recurred';
        all.push({
          id: action.id,
          timestamp: new Date(action.timestamp).toISOString(),
          category: 'event' as TimelineCategory,
          severity: (action.status === 'failed' || recurred ? 'warning' : 'normal') as 'warning' | 'normal',
          title: `${prefix}: ${action.tool || actionCategoryLabel(action.category)} — ${recurred ? `${action.status} (verified, then recurred)` : action.status}`,
          detail: action.reasoning || action.afterState || '',
          namespace: action.resources?.[0]?.namespace,
          resource: action.resources?.[0]
            ? { kind: action.resources[0].kind, name: action.resources[0].name, namespace: action.resources[0].namespace, apiVersion: 'v1' }
            : undefined,
          source: { type: 'k8s-event' as const },
        });
      }
    }

    all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      all = all.filter(
        (e) => e.title.toLowerCase().includes(q) || (e.detail || '').toLowerCase().includes(q) || (e.namespace || '').toLowerCase().includes(q),
      );
    }

    return all;
  }, [timeline.entries, fixHistory, searchQuery, showAgent]);

  // Completed fixes the agent can undo — keyed by action id, which is also the
  // timeline entry id the merge above assigns them.
  const rollbackableById = useMemo(() => {
    const map = new Map<string, ActionRecord>();
    for (const action of fixHistory) {
      if (action.status === 'completed' && action.rollbackAvailable) map.set(action.id, action);
    }
    return map;
  }, [fixHistory]);

  const handleConfirmRollback = async () => {
    if (!rollbackTarget) return;
    setRollbackBusy(true);
    setRollbackError(null);
    try {
      await requestRollback(rollbackTarget.id);
      const res = rollbackTarget.resources?.[0];
      useUIStore.getState().addToast({
        type: 'success',
        title: 'Rollback executed',
        detail: res ? `${res.kind} ${res.name} restored to its pre-fix state` : undefined,
        duration: 5000,
      });
      setRollbackTarget(null);
      loadFixHistory();
    } catch (e) {
      // The agent refuses on purpose for action types without a snapshot —
      // show what it said instead of a generic failure.
      setRollbackError(e instanceof Error ? e.message : 'Rollback failed');
    } finally {
      setRollbackBusy(false);
    }
  };

  // Group by date for "by date" mode
  const groupedEntries = useMemo(() => {
    const groups: Record<string, TimelineEntry[]> = {};
    for (const entry of mergedEntries) {
      const dateKey = getDateKey(new Date(entry.timestamp));
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(entry);
    }
    return groups;
  }, [mergedEntries]);

  // Correlation groups for "by resource" mode
  const filteredGroups = useMemo(() => {
    const groups = timeline.correlationGroups || [];
    if (!searchQuery) return groups;
    const q = searchQuery.toLowerCase();
    return groups.filter(
      (g) => g.key.toLowerCase().includes(q) || g.entries.some((e) => e.title.toLowerCase().includes(q)),
    );
  }, [timeline.correlationGroups, searchQuery]);

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

  const handleInvestigate = (group: CorrelationGroup) => {
    const label = (group.key || '').split('/').slice(0, 2).join(' ');
    const ns = (group.key || '').split('/')[2];
    const eventSummary = group.entries.slice(0, 8).map((e) => e.title).join(', ');
    const query = `Investigate ${label}${ns && ns !== '_' ? ` in namespace ${ns}` : ''}. Recent events: ${eventSummary}. What is the root cause and how should I fix it?`;
    useAgentStore.getState().sendMessage(query);
    useUIStore.getState().expandAISidebar();
    useUIStore.getState().setAISidebarMode('chat');
  };

  const handlePostmortemInvestigate = (query: string) => {
    useAgentStore.getState().sendMessage(query);
    useUIStore.getState().expandAISidebar();
    useUIStore.getState().setAISidebarMode('chat');
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* View mode toggle */}
        <div className="flex gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800" role="radiogroup" aria-label="View mode">
          <button
            role="radio"
            aria-checked={viewMode === 'by-date'}
            onClick={() => setViewMode('by-date')}
            className={cn('px-3 py-1.5 text-xs rounded-sm transition-colors', viewMode === 'by-date' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200')}
          >
            By Date
          </button>
          <button
            role="radio"
            aria-checked={viewMode === 'by-resource'}
            onClick={() => setViewMode('by-resource')}
            className={cn('px-3 py-1.5 text-xs rounded-sm transition-colors', viewMode === 'by-resource' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200')}
          >
            By Resource
          </button>
        </div>

        {/* Time range */}
        <Card className="flex gap-1 p-1">
          {TIME_RANGES.map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={cn('px-3 py-1.5 text-xs rounded-sm transition-colors', timeRange === range ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200')}
            >
              {range}
            </button>
          ))}
        </Card>

        {/* Category filters */}
        <Card className="flex gap-1 p-1">
          {ACTIVITY_CATEGORIES.map(({ id, label, icon: Icon }) => {
            const active = activeCategories.has(id);
            return (
              <button
                key={id}
                onClick={() => toggleCategory(id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm transition-colors',
                  active ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-400',
                )}
              >
                <Icon className={cn('w-3.5 h-3.5', active ? 'text-violet-400' : 'text-slate-600')} />
                {label}
              </button>
            );
          })}
        </Card>

        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search activity..."
            aria-label="Search activity"
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-violet-500"
          />
        </div>
      </div>

      {/* Agent section: investigations + postmortems + learning */}
      {showAgent && (filteredInvestigations.length > 0 || postmortems.length > 0 || learningEvents.length > 0) && (
        <div className="space-y-4">
          {/* Investigations */}
          {filteredInvestigations.length > 0 && (
            <Card>
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Bot className="w-4 h-4 text-violet-400" />
                  AI Investigations ({filteredInvestigations.length})
                </h2>
              </div>
              <div className="divide-y divide-slate-800">
                {filteredInvestigations.slice(0, 10).map((report) => (
                  <InvestigationCard key={report.id} report={report} onClickFinding={setLifecycleFindingId} />
                ))}
              </div>
            </Card>
          )}

          {/* Postmortems */}
          {postmortems.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-teal-400" />
                Postmortems ({postmortems.length})
              </h2>
              <div className="space-y-2">
                {postmortems.slice(0, 5).map((pm) => (
                  <PostmortemCard key={pm.id} postmortem={pm} onInvestigate={handlePostmortemInvestigate} />
                ))}
              </div>
            </div>
          )}

          {/* Learning events */}
          {learningEvents.length > 0 && (
            <Card>
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Agent Learning ({learningEvents.length})
                </h2>
              </div>
              <div className="divide-y divide-slate-800">
                {learningEvents.slice(0, 10).map((event, i) => (
                  <div key={i} className="px-4 py-3 flex items-start gap-3">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded-sm">{event.type}</span>
                        {event.timestamp && (
                          <span className="text-xs text-slate-500">{formatRelativeTime(event.timestamp)}</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-300">{event.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Main content: by resource or by date */}
      {viewMode === 'by-resource' ? (
        <>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>{filteredGroups.length} correlated incidents</span>
            <span>-</span>
            <span>{timeline.entries?.length || 0} total entries</span>
          </div>

          {timeline.isLoading ? (
            <div className="flex items-center justify-center h-48">
              <span className="text-slate-500 text-sm">Loading correlation data...</span>
            </div>
          ) : filteredGroups.length === 0 ? (
            <EmptyState
              icon={<Info className="w-8 h-8" />}
              title="No correlated incidents"
              description="No correlation patterns detected in this time window."
            />
          ) : (
            <Card>
              <div className="divide-y divide-slate-800">
                {filteredGroups.map((group) => (
                  <CorrelationGroupRow
                    key={group.key}
                    group={group}
                    expanded={expandedGroup === group.key}
                    onToggle={() => setExpandedGroup(expandedGroup === group.key ? null : group.key)}
                    onEntryClick={handleEntryClick}
                    onInvestigate={() => handleInvestigate(group)}
                  />
                ))}
              </div>
            </Card>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>{mergedEntries.length} entries</span>
          </div>

          {timeline.isLoading ? (
            <div className="flex items-center justify-center h-48">
              <span className="text-slate-500 text-sm">Loading history...</span>
            </div>
          ) : mergedEntries.length === 0 ? (
            <EmptyState
              icon={<Info className="w-8 h-8" />}
              title="No activity"
              description="Adjust the time range or enable more categories to see activity."
            />
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedEntries).map(([dateKey, dateEntries]) => (
                <div key={dateKey}>
                  <div className="sticky top-0 z-10 bg-slate-950 py-2 mb-3">
                    <h2 className="text-sm font-semibold text-slate-100 uppercase tracking-wide">{dateKey}</h2>
                  </div>
                  <div className="relative pl-6 border-l-2 border-slate-800 space-y-3">
                    {dateEntries.map((entry) => {
                      const rollbackable = rollbackableById.get(entry.id);
                      return (
                        <HistoryEntryCard
                          key={entry.id}
                          entry={entry}
                          onClick={() => handleEntryClick(entry)}
                          onRollback={rollbackable ? () => { setRollbackError(null); setRollbackTarget(rollbackable); } : undefined}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {lifecycleFindingId && (
        <IncidentLifecycleDrawer findingId={lifecycleFindingId} onClose={() => setLifecycleFindingId(null)} />
      )}

      <ConfirmDialog
        open={rollbackTarget !== null}
        onClose={() => setRollbackTarget(null)}
        onConfirm={handleConfirmRollback}
        title="Roll back this fix?"
        description={rollbackTarget ? (() => {
          const res = rollbackTarget.resources?.[0];
          const what = res ? `${res.kind} ${res.name}${res.namespace ? ` in ${res.namespace}` : ''}` : 'the affected resource';
          return `The agent will restore ${what} to its state before "${rollbackTarget.tool || rollbackTarget.category}" ran. This writes to the cluster immediately.`;
        })() : ''}
        confirmLabel="Roll back"
        variant="warning"
        loading={rollbackBusy}
      >
        {rollbackError && (
          <p className="mt-3 text-sm text-red-400" role="alert">{rollbackError}</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
