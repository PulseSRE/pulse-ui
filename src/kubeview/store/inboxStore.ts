/**
 * Inbox Store — manages state for the unified SRE worklist.
 * Fetches items from REST API, supports filtering, grouping, and presets.
 */

import { create } from 'zustand';
import {
  fetchInbox,
  fetchInboxStats,
  type InboxItem,
  type InboxGroup,
  type InboxFilters,
} from '../engine/inboxApi';

type Preset = 'active_incidents' | 'needs_approval' | 'my_items' | 'unclaimed' | null;

const PRESET_FILTERS: Record<string, InboxFilters> = {
  active_incidents: { type: 'finding', status: 'investigating' },
  needs_approval: {},
  my_items: { claimed_by: '__current_user__' },
  unclaimed: {},
};

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
}

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  groups: [],
  stats: {},
  total: 0,
  filters: {},
  activePreset: null,
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
      const data = await fetchInbox(queryFilters);
      set({
        items: data.items,
        groups: data.groups,
        stats: data.stats,
        total: data.total,
        loading: false,
      });
    } catch (err) {
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
}));
