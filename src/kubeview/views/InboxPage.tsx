import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/primitives/Tabs';
import { EmptyState } from '../components/primitives/EmptyState';
import { useInboxStore } from '../store/inboxStore';
import { useUIStore } from '../store/uiStore';
import { InboxHeader } from './inbox/InboxHeader';
import { InboxFilterBar } from './inbox/InboxFilterBar';
import { InboxItem } from './inbox/InboxItem';
import { InboxGroup } from './inbox/InboxGroup';
import { EpisodePanel } from './inbox/EpisodePanel';
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

  useEffect(() => {
    if (didRestoreRef.current) return;
    didRestoreRef.current = true;
    const taskId = searchParams.get('task');
    if (taskId) {
      setSelectedItem(taskId);
    }
    const preset = searchParams.get('preset');
    if (preset) {
      useInboxStore.getState().setPreset(preset as 'needs_attention' | 'agent_cleared' | 'my_items' | 'archived' | 'all');
    }
    const tab = searchParams.get('tab');
    if (tab === 'activity' || tab === 'inbox') {
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

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="px-4 py-2 border-b border-slate-800">
          <TabsList>
            <TabsTrigger value="inbox">Inbox</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="inbox" className="flex-1 flex flex-col overflow-hidden">
          {/* What Pulse cannot currently see, before the queue of what it can. */}
          <CapabilityBanner className="mx-4 mt-3" />
          {/* Open episodes sit above the queue: a cause with its symptoms
              folded under it, so the list is not read cause-last. */}
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

            {error && (
              <div className="p-4">
                <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-sm text-red-400">
                  Failed to load inbox. <button onClick={refresh} className="underline ml-1">Retry</button>
                </div>
              </div>
            )}

            {!loading && !error && !hasItems && !hasFilters && (
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

            {!loading && !error && !hasItems && hasFilters && (
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
