/**
 * Inbox Store — manages state for the unified SRE worklist.
 * Fetches items from REST API, supports filtering, grouping, and presets.
 * All API mutations go through store actions (not called directly from components).
 */

import { create } from 'zustand';
import {
  fetchInbox,
  fetchInboxStats,
  acknowledgeInboxItem,
  claimInboxItem,
  unclaimInboxItem,
  snoozeInboxItem,
  dismissInboxItem,
  resolveInboxItem,
  pinInboxItem,
  createInboxTask,
  restoreInboxItem,
  type InboxItem,
  type InboxGroup,
  type InboxFilters,
} from '../engine/inboxApi';
import { handleAuthError } from '../engine/auth';
import { useUIStore } from './uiStore';

type Preset = 'needs_attention' | 'agent_cleared' | 'my_items' | 'all' | null;

const PRESET_FILTERS: Record<string, InboxFilters> = {
  needs_attention: { status: '__needs_attention__' },
  agent_cleared: { status: 'agent_cleared' },
  my_items: { claimed_by: '__current_user__' },
  all: {},
};

function _toast(type: 'success' | 'error', title: string) {
  useUIStore.getState().addToast({ type, title });
}

interface InboxState {
  items: InboxItem[];
  groups: InboxGroup[];
  stats: Record<string, number>;
  total: number;
  filters: InboxFilters;
  activePreset: Preset;
  groupBy: string | null;
  selectedItemId: string | null;
  loading: boolean;
  error: string | null;

  setFilters: (filters: InboxFilters) => void;
  setPreset: (preset: Preset) => void;
  setGroupBy: (groupBy: string | null) => void;
  setSelectedItem: (id: string | null) => void;
  refresh: () => Promise<void>;
  refreshStats: () => Promise<void>;

  acknowledge: (id: string) => Promise<boolean>;
  claim: (id: string) => Promise<boolean>;
  unclaim: (id: string) => Promise<boolean>;
  snooze: (id: string, hours: number) => Promise<boolean>;
  dismiss: (id: string) => Promise<boolean>;
  resolve: (id: string) => Promise<boolean>;
  pin: (id: string) => Promise<boolean>;
  restore: (id: string) => Promise<boolean>;
  advanceStatus: (id: string, status: string) => Promise<boolean>;
  createTask: (data: { title: string; summary?: string; namespace?: string }) => Promise<boolean>;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  groups: [],
  stats: {},
  total: 0,
  filters: {},
  activePreset: 'needs_attention',
  groupBy: null,
  selectedItemId: null,
  loading: false,
  error: null,

  setFilters: (filters) => {
    set({ filters, activePreset: null });
    get().refresh();
  },

  setPreset: (preset) => {
    if (!preset) {
      set({ activePreset: null, filters: {} });
    } else {
      set({ activePreset: preset, filters: PRESET_FILTERS[preset] || {} });
    }
    get().refresh();
  },

  setGroupBy: (groupBy) => {
    set({ groupBy });
    get().refresh();
  },

  setSelectedItem: (id) => set({ selectedItemId: id }),

  refresh: async () => {
    const { filters, groupBy } = get();
    set({ loading: true, error: null });
    try {
      const queryFilters = { ...filters };
      if (groupBy) queryFilters.group_by = groupBy;
      const [data, globalStats] = await Promise.all([
        fetchInbox(queryFilters),
        fetchInboxStats(),
      ]);
      set({
        items: data.items,
        groups: data.groups,
        stats: globalStats,
        total: data.total,
        loading: false,
      });
    } catch (err) {
      handleAuthError(String(err));
      set({ error: String(err), loading: false });
    }
  },

  refreshStats: async () => {
    try {
      const stats = await fetchInboxStats();
      set({ stats });
    } catch {
      // silent — badge update is best-effort
    }
  },

  acknowledge: async (id) => {
    try {
      await acknowledgeInboxItem(id);
      get().refresh();
      return true;
    } catch {
      _toast('error', 'Failed to acknowledge');
      return false;
    }
  },

  claim: async (id) => {
    try {
      await claimInboxItem(id);
      get().refresh();
      return true;
    } catch {
      _toast('error', 'Failed to claim');
      return false;
    }
  },

  unclaim: async (id) => {
    try {
      await unclaimInboxItem(id);
      get().refresh();
      return true;
    } catch {
      _toast('error', 'Failed to unclaim');
      return false;
    }
  },

  snooze: async (id, hours) => {
    try {
      await snoozeInboxItem(id, hours);
      get().refresh();
      return true;
    } catch {
      _toast('error', 'Failed to snooze');
      return false;
    }
  },

  dismiss: async (id) => {
    try {
      await dismissInboxItem(id);
      get().refresh();
      return true;
    } catch {
      _toast('error', 'Failed to dismiss');
      return false;
    }
  },

  resolve: async (id) => {
    try {
      await resolveInboxItem(id);
      get().refresh();
      _toast('success', 'Item resolved');
      return true;
    } catch {
      _toast('error', 'Failed to resolve');
      return false;
    }
  },

  pin: async (id) => {
    try {
      await pinInboxItem(id);
      get().refresh();
      return true;
    } catch {
      _toast('error', 'Failed to pin');
      return false;
    }
  },

  restore: async (id) => {
    try {
      await restoreInboxItem(id);
      get().refresh();
      _toast('success', 'Item restored to inbox');
      return true;
    } catch {
      _toast('error', 'Failed to restore');
      return false;
    }
  },

  advanceStatus: async (id, status) => {
    try {
      const res = await fetch(`/api/agent/inbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      get().refresh();
      return true;
    } catch {
      _toast('error', 'Failed to update status');
      return false;
    }
  },

  createTask: async (data) => {
    try {
      await createInboxTask(data);
      get().refresh();
      _toast('success', 'Task created');
      return true;
    } catch {
      _toast('error', 'Failed to create task');
      return false;
    }
  },
}));
