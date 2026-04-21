import { useEffect, useState, useCallback } from 'react';
import { Inbox } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/primitives/Tabs';
import { EmptyState } from '../components/primitives/EmptyState';
import { useInboxStore } from '../store/inboxStore';
import { InboxHeader } from './inbox/InboxHeader';
import { InboxFilterBar } from './inbox/InboxFilterBar';
import { InboxItem } from './inbox/InboxItem';
import { InboxGroup } from './inbox/InboxGroup';
import { NewTaskDialog } from './inbox/NewTaskDialog';
import { TaskDetailDrawer } from './inbox/TaskDetailDrawer';
import { ActivityTab } from './incidents/ActivityTab';
import type { InboxItem as InboxItemType } from '../engine/inboxApi';
import { fetchInboxItem } from '../engine/inboxApi';

export function InboxPage() {
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [drawerItem, setDrawerItem] = useState<InboxItemType | null>(null);

  const items = useInboxStore((s) => s.items);
  const groups = useInboxStore((s) => s.groups);
  const loading = useInboxStore((s) => s.loading);
  const error = useInboxStore((s) => s.error);
  const selectedItemId = useInboxStore((s) => s.selectedItemId);
  const setSelectedItem = useInboxStore((s) => s.setSelectedItem);
  const refresh = useInboxStore((s) => s.refresh);
  const filters = useInboxStore((s) => s.filters);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedItemId) {
      setDrawerItem(null);
      return;
    }
    fetchInboxItem(selectedItemId)
      .then(setDrawerItem)
      .catch(() => setDrawerItem(null));
  }, [selectedItemId]);

  const handleCloseDrawer = useCallback(() => {
    setSelectedItem(null);
    setDrawerItem(null);
  }, [setSelectedItem]);

  const handleClearFilters = useCallback(() => {
    useInboxStore.getState().setFilters({});
  }, []);

  const hasItems = items.length > 0 || groups.length > 0;
  const hasFilters = Object.values(filters).some((v) => v != null && v !== '');

  return (
    <div className="flex flex-col h-full">
      <InboxHeader onNewTask={() => setNewTaskOpen(true)} />

      <Tabs defaultValue="inbox">
        <div className="px-4 py-2 border-b border-slate-800">
          <TabsList>
            <TabsTrigger value="inbox">Inbox</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="inbox" className="flex-1 flex flex-col overflow-hidden">
          <InboxFilterBar />

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
                title="All clear"
                description="Nothing needs proactive attention right now."
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
        <div className="fixed inset-y-0 right-0 w-[400px] z-40 border-l border-slate-800 bg-slate-950 shadow-2xl overflow-y-auto">
          <TaskDetailDrawer item={drawerItem} onClose={handleCloseDrawer} />
        </div>
      )}

      <NewTaskDialog open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
    </div>
  );
}
