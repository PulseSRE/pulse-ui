import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, UserCheck } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/primitives/Tabs';
import { EmptyState } from '../components/primitives/EmptyState';
import { LoadError } from '../components/primitives/LoadError';
import { useInboxStore } from '../store/inboxStore';
import { useUIStore } from '../store/uiStore';
import { InboxHeader } from './inbox/InboxHeader';
import { InboxFilterBar } from './inbox/InboxFilterBar';
import { InboxPresets } from './inbox/InboxPresets';
import { InboxItem } from './inbox/InboxItem';
import { InboxGroup } from './inbox/InboxGroup';
import { EpisodePanel } from './inbox/EpisodePanel';
import { ApprovalsQueue, useApprovalCount } from './inbox/ApprovalsQueue';
import { useApprovalsStore } from '../store/approvalsStore';
import { CapabilityBanner } from '../components/primitives/CapabilityBanner';
import { NewTaskDialog } from './inbox/NewTaskDialog';
import { TaskDetailDrawer } from './inbox/TaskDetailDrawer';
import { ActivityTab } from './incidents/ActivityTab';
import type { InboxItem as InboxItemType } from '../engine/inboxApi';
import { fetchInboxItem } from '../engine/inboxApi';

export function InboxPage() {
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [drawerItem, setDrawerItem] = useState<InboxItemType | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const didRestoreRef = useRef(false);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'inbox');

  const items = useInboxStore((s) => s.items);
  const groups = useInboxStore((s) => s.groups);
  const loading = useInboxStore((s) => s.loading);
  const error = useInboxStore((s) => s.error);
  const selectedItemId = useInboxStore((s) => s.selectedItemId);
  const setSelectedItem = useInboxStore((s) => s.setSelectedItem);
  const refresh = useInboxStore((s) => s.refresh);
  const filters = useInboxStore((s) => s.filters);
  const activePreset = useInboxStore((s) => s.activePreset);
  const collapsedIntoEpisodes = useInboxStore((s) => s.collapsedIntoEpisodes);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // What is waiting on a person: feeds the Approvals tab count, the banner,
  // the "Approval waiting" chip on rows and the Approve button in the drawer.
  const refreshApprovals = useApprovalsStore((s) => s.refresh);
  const approvalCount = useApprovalCount();
  useEffect(() => {
    refreshApprovals();
    const timer = setInterval(refreshApprovals, 60_000);
    return () => clearInterval(timer);
  }, [refreshApprovals]);

  useEffect(() => {
    if (didRestoreRef.current) return;
    didRestoreRef.current = true;
    const taskId = searchParams.get('task');
    if (taskId) {
      setSelectedItem(taskId);
    }
    // Only presets the inbox knows. Links used `needs_approval`, which matched
    // no filter and silently showed an unfiltered list.
    const preset = searchParams.get('preset');
    const known = ['needs_attention', 'agent_cleared', 'my_items', 'archived', 'all'] as const;
    const normalized = preset === 'needs_approval' ? 'needs_attention' : preset;
    if (normalized && (known as readonly string[]).includes(normalized)) {
      useInboxStore.getState().setPreset(normalized as (typeof known)[number]);
    }
    const tab = searchParams.get('tab');
    if (tab === 'activity' || tab === 'inbox' || tab === 'approvals') {
      setActiveTab(tab);
    }
  }, [searchParams, setSelectedItem]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedItemId) next.set('task', selectedItemId);
    else next.delete('task');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [selectedItemId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!selectedItemId) {
      setDrawerItem(null);
      return;
    }
    let cancelled = false;
    fetchInboxItem(selectedItemId)
      .then((item) => { if (!cancelled) setDrawerItem(item); })
      .catch(() => {
        if (!cancelled) {
          setDrawerItem(null);
          setSelectedItem(null);
          useUIStore.getState().addToast({ type: 'error', title: 'Item not found — it may have been archived or deleted' });
        }
      });
    return () => { cancelled = true; };
  }, [selectedItemId]);

  const handleCloseDrawer = useCallback(() => {
    setSelectedItem(null);
    setDrawerItem(null);
  }, [setSelectedItem]);

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value);
    const next = new URLSearchParams(searchParams);
    if (value === 'inbox') next.delete('tab');
    else next.set('tab', value);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleClearFilters = useCallback(() => {
    useInboxStore.getState().setFilters({});
  }, []);

  const hasItems = items.length > 0 || groups.length > 0;
  const hasFilters = Object.values(filters).some((v) => v != null && v !== '');

  return (
    <div className="flex flex-col h-full">
      <InboxHeader onNewTask={() => setNewTaskOpen(true)} />
      {approvalCount > 0 && activeTab !== 'approvals' && (
        // One line, not a second copy of the queue: the answers happen in the Approvals tab.
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-amber-700/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <UserCheck className="h-4 w-4 text-amber-400" />
          <span className="flex-1">
            {approvalCount} {approvalCount === 1 ? 'approval is' : 'approvals are'} waiting on you
          </span>
          <button
            type="button"
            onClick={() => handleTabChange('approvals')}
            className="font-medium text-amber-300 hover:underline"
          >
            Review
          </button>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="px-4 py-2 border-b border-slate-800">
          <TabsList>
            <TabsTrigger value="inbox">Inbox</TabsTrigger>
            <TabsTrigger value="approvals">
              Approvals{approvalCount > 0 ? ` (${approvalCount})` : ''}
            </TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="inbox" className="flex-1 flex flex-col overflow-hidden">
          {/* What Pulse cannot currently see, before the queue of what it can. */}
          <CapabilityBanner className="mx-4 mt-3" />
          {/* Open episodes sit above the queue: a cause with its symptoms
              folded under it, so the list is not read cause-last. */}
          <InboxPresets className="px-4 pt-3" />
          <EpisodePanel />
          {collapsedIntoEpisodes > 0 && (
            <p className="px-4 pt-2 text-xs text-slate-500">
              {collapsedIntoEpisodes} {collapsedIntoEpisodes === 1 ? 'item is' : 'items are'} explained by an
              open episode above and left out of the list below.
            </p>
          )}
          <InboxFilterBar />

          {activePreset === 'archived' && (
            <div className="mx-4 mt-2 rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-sm text-slate-400">
              <span className="font-medium text-slate-300">Archived items</span> are automatically deleted after 30 days. You can review past incidents, postmortems, and resolved issues here. Items nobody claimed or acted on for 48 hours are archived automatically — hover the grey dot to see why.
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loading && !hasItems && (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-slate-800/50 rounded-lg animate-pulse" />
                ))}
              </div>
            )}

            {error != null && (
              <div className="p-4">
                <LoadError title="Inbox could not be loaded" error={error} onRetry={() => { void refresh(); }} />
              </div>
            )}

            {!loading && error == null && !hasItems && !hasFilters && (
              <EmptyState
                icon={<Inbox className="w-8 h-8" />}
                title={
                  activePreset === 'needs_attention' ? 'All clear' :
                  activePreset === 'agent_cleared' ? 'No cleared items' :
                  activePreset === 'archived' ? 'No archived items' :
                  activePreset === 'my_items' ? 'No claimed items' :
                  'Inbox is empty'
                }
                description={
                  activePreset === 'needs_attention' ? 'The agent has reviewed everything and found no issues requiring your attention.' :
                  activePreset === 'agent_cleared' ? 'No items cleared by the agent yet. Items the agent determines are safe will appear here.' :
                  activePreset === 'archived' ? 'Resolved and dismissed items appear here for 30 days before auto-deletion.' :
                  activePreset === 'my_items' ? 'Claim items from Needs Attention to track them here.' :
                  'The agent monitors your cluster and adds items that need attention.'
                }
              />
            )}

            {!loading && error == null && !hasItems && hasFilters && (
              <EmptyState
                icon={<Inbox className="w-8 h-8" />}
                title="No items match your filters"
                description="Try adjusting your filters or clearing them."
                action={{ label: 'Clear filters', onClick: handleClearFilters }}
              />
            )}

            {hasItems && (
              <div className="space-y-1 p-4">
                {groups.map((group) => (
                  <InboxGroup
                    key={group.correlation_key}
                    group={group}
                    focusedItemId={selectedItemId}
                  />
                ))}
                {items.map((item) => (
                  <InboxItem
                    key={item.id}
                    item={item}
                    focused={item.id === selectedItemId}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="approvals" className="flex-1 overflow-y-auto">
          <ApprovalsQueue />
        </TabsContent>

        <TabsContent value="activity" className="flex-1 overflow-y-auto">
          <ActivityTab />
        </TabsContent>
      </Tabs>

      {drawerItem && (
        <TaskDetailDrawer item={drawerItem} onClose={handleCloseDrawer} />
      )}

      <NewTaskDialog open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
    </div>
  );
}
