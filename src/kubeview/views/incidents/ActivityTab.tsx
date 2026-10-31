import React, { useState, useMemo, useEffect } from 'react';
/**
 * Inbox › Activity — what the agent did: fixes (with rollback),
 * investigations, postmortems and what it learned.
 *
 * The cluster event timeline (events, alerts, rollouts, config changes,
 * correlated by resource) is /timeline; this tab used to be a second copy of
 * it built on the same hook. It now links there instead.
 */
import {
  Search, Info, Bot, Sparkles, Clock, ArrowRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../components/primitives/Card';
import { EmptyState } from '../../components/primitives/EmptyState';
import { useUIStore } from '../../store/uiStore';
import { useMonitorStore } from '../../store/monitorStore';
import { useAgentStore } from '../../store/agentStore';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { resourceDetailUrl } from '../../engine/gvr';
import { apiVersionOf, resolveKind } from '../../engine/kindRegistry';
import { formatRelativeTime } from '../../engine/formatters';
import { getDateKey } from '../../engine/dateUtils';
import { fetchLearningFeed } from '../../engine/analyticsApi';
import { actionCategoryLabel } from '../../engine/fixHistory';
import { agentFetch } from '../../engine/safeQuery';
import { requestRollback, type ActionRecord } from '../../engine/fixHistory';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import type { TimelineEntry, TimelineCategory } from '../../engine/types/timeline';
import { HistoryEntryCard } from './shared/HistoryEntryCard';
import { InvestigationCard } from './shared/InvestigationCard';
import { PostmortemCard, type Postmortem } from './shared/PostmortemCard';
import { IncidentLifecycleDrawer } from './IncidentLifecycleDrawer';

async function fetchPostmortems(): Promise<{ postmortems: Postmortem[]; total: number }> {
  const res = await agentFetch('/api/agent/postmortems');
  if (!res.ok) return { postmortems: [], total: 0 };
  return res.json();
}

export function ActivityTab() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  const [searchQuery, setSearchQuery] = useState('');
  const [lifecycleFindingId, setLifecycleFindingId] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ActionRecord | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  const investigations = useMonitorStore((s) => s.investigations);
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
  });

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

  // The agent's actions, newest first.
  const mergedEntries = useMemo(() => {
    let all: TimelineEntry[] = [];

    {
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
            // The agent sends kind/name/namespace only; the group comes from
            // discovery (a hardcoded 'v1' sent Deployments to v1~deployments).
            ? { kind: action.resources[0].kind, name: action.resources[0].name, namespace: action.resources[0].namespace, apiVersion: apiVersionOf(resolveKind(action.resources[0].kind)) }
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
  }, [fixHistory, searchQuery]);

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

  const handlePostmortemInvestigate = (query: string) => {
    useAgentStore.getState().sendMessage(query);
    useUIStore.getState().expandAISidebar();
    useUIStore.getState().setAISidebarMode('chat');
  };

  return (
    <div className="space-y-6">
      {/* The event timeline is one page: /timeline. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agent actions..."
            aria-label="Search agent actions"
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <button
          onClick={() => go('/timeline', 'Timeline')}
          className="ml-auto inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
        >
          Cluster events, alerts, rollouts and config changes are on Timeline <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Agent section: investigations + postmortems + learning */}
      {(filteredInvestigations.length > 0 || postmortems.length > 0 || learningEvents.length > 0) && (
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

      {/* Agent actions by date */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span>{mergedEntries.length} agent action{mergedEntries.length !== 1 ? 's' : ''}</span>
      </div>

      {mergedEntries.length === 0 ? (
        <EmptyState
          icon={<Info className="w-8 h-8" />}
          title="No agent actions"
          description={searchQuery ? 'No agent actions match your search.' : 'Fixes the agent applies, or you approve in chat, appear here.'}
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
