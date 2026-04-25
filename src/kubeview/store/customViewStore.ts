/**
 * Custom View Store — persists user-created dashboards through the
 * Pulse Agent backend API (PostgreSQL, user-scoped).
 *
 * User says "create a dashboard showing node health and crashlooping pods"
 * → agent returns component specs → user saves as a named view → view
 * appears in sidebar and persists across sessions.
 *
 * Views are scoped per user (via OpenShift OAuth token). Sharing clones
 * the view to the target user's account.
 */

import { create } from 'zustand';
import type { ViewSpec, ComponentSpec } from '../engine/agentComponents';
import { truncateForPersistence } from '../engine/agentComponents';

const AGENT_BASE = '/api/agent';
let _lastLoadAttempt = 0;

interface CustomViewState {
  views: ViewSpec[];
  loading: boolean;
  error: string | null;
  currentUser: string | null;
  /** The view currently being built in canvas mode */
  activeBuilderId: string | null;

  /** Fetch all views from backend for the current user */
  loadViews: () => Promise<void>;
  /** Save a new view to backend */
  saveView: (view: ViewSpec) => Promise<void>;
  /** Delete a view from backend */
  deleteView: (id: string) => Promise<void>;
  /** Update view fields (title, description, layout, positions) */
  updateView: (id: string, updates: Partial<ViewSpec>, save?: boolean) => Promise<void>;
  /** Add a widget to an existing view */
  addWidget: (viewId: string, widget: ComponentSpec) => Promise<void>;
  /** Remove a widget by index */
  removeWidget: (viewId: string, widgetIndex: number) => Promise<void>;
  /** Update a specific widget's properties (e.g. chartType) */
  updateWidget: (viewId: string, widgetIndex: number, updates: Partial<ComponentSpec>) => Promise<void>;
  /** Get a view by ID from local state */
  getView: (id: string) => ViewSpec | undefined;
  /** Create a new view and add a widget — returns the view ID */
  createAndAddWidget: (widget: ComponentSpec) => Promise<string | null>;
  /** Set the active builder view */
  setActiveBuilderId: (id: string | null) => void;
  /** Force-reload views from backend, bypassing debounce */
  forceLoadViews: () => Promise<void>;
  /** Clone a view to the current user (from share link) */
  claimSharedView: (shareToken: string) => Promise<string | null>;
  /** Generate a share link for a view */
  shareView: (id: string) => Promise<string | null>;
  /** Execute an action_button tool from a view */
  executeAction: (viewId: string, action: string, actionInput: Record<string, unknown>) => Promise<{ result: string; status: string; error_message?: string }>;
}

async function apiFetch(path: string, options?: RequestInit) {
  const rawRes = await fetch(`${AGENT_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (rawRes.status === 401) {
    const { useUIStore } = await import('./uiStore');
    useUIStore.getState().addDegradedReason('session_expired');
  }
  if (!rawRes.ok) {
    const error = await rawRes.json().catch(() => ({ error: rawRes.statusText }));
    throw new Error(error.error || rawRes.statusText);
  }
  return rawRes.json();
}

export const useCustomViewStore = create<CustomViewState>()(
  (set, get) => ({
    views: [],
    loading: false,
    error: null,
    currentUser: null,
    activeBuilderId: null,

    loadViews: async () => {
      // Debounce: skip if already loading or loaded within last 5 seconds
      const now = Date.now();
      if (get().loading) return;
      if (_lastLoadAttempt && now - _lastLoadAttempt < 5000) return;
      _lastLoadAttempt = now;

      set({ loading: true, error: null });
      try {
        const data = await apiFetch('/views');
        const seenIds = new Set<string>();
        const views: ViewSpec[] = (data.views || [])
          .map((v: any) => ({
            id: v.id,
            title: v.title,
            description: v.description || '',
            icon: v.icon || '',
            layout: v.layout || [],
            positions: v.positions || {},
            generatedAt: new Date(v.created_at).getTime(),
            owner: v.owner,
          }))
          .filter((v: ViewSpec) => {
            if (seenIds.has(v.id)) return false;
            seenIds.add(v.id);
            return true;
          });
        set({ views, currentUser: data.owner, loading: false });
      } catch (err) {
        _lastLoadAttempt = 0; // Allow immediate retry on error
        set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load views' });
      }
    },

    forceLoadViews: async () => {
      _lastLoadAttempt = 0;
      await get().loadViews();
    },

    saveView: async (view) => {
      const truncated = {
        ...view,
        layout: view.layout.map(truncateForPersistence),
      };
      try {
        const result = await apiFetch('/views', {
          method: 'POST',
          body: JSON.stringify({
            id: truncated.id,
            title: truncated.title,
            description: truncated.description,
            icon: truncated.icon,
            layout: truncated.layout,
            positions: truncated.positions || {},
          }),
        });
        // Add to local state
        set((s) => ({
          views: [...s.views, { ...truncated, owner: result.owner }],
          currentUser: result.owner,
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to save view';
        console.error('Failed to save view:', msg);
        set({ error: msg });
      }
    },

    deleteView: async (id) => {
      try {
        await apiFetch(`/views/${id}`, { method: 'DELETE' });
        set((s) => ({ views: s.views.filter((v) => v.id !== id) }));
      } catch (e) {
        console.error('Failed to delete view:', e);
      }
    },

    updateView: async (id, updates, save = false) => {
      const payload: Record<string, any> = {};
      if (updates.title !== undefined) payload.title = updates.title;
      if (updates.description !== undefined) payload.description = updates.description;
      if (updates.icon !== undefined) payload.icon = updates.icon;
      if (updates.layout !== undefined) {
        payload.layout = updates.layout.map(truncateForPersistence);
      }
      if (updates.positions !== undefined) payload.positions = updates.positions;
      if (save) payload.save = true;

      try {
        await apiFetch(`/views/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        set((s) => ({
          views: s.views.map((v) =>
            v.id === id ? { ...v, ...updates } : v,
          ),
        }));
      } catch (e) {
        console.error('Failed to update view:', e);
      }
    },

    addWidget: async (viewId, widget) => {
      const view = get().getView(viewId);
      if (!view) return;
      const newLayout = [...view.layout, truncateForPersistence(widget)];
      await get().updateView(viewId, { layout: newLayout }, true);
    },

    removeWidget: async (viewId, widgetIndex) => {
      const view = get().getView(viewId);
      if (!view) return;
      const newLayout = view.layout.filter((_, i) => i !== widgetIndex);
      await get().updateView(viewId, { layout: newLayout }, true);
    },

    updateWidget: async (viewId, widgetIndex, updates) => {
      const view = get().getView(viewId);
      if (!view) return;
      const newLayout = view.layout.map((spec, i) =>
        i === widgetIndex ? { ...spec, ...updates } as ComponentSpec : spec,
      );
      await get().updateView(viewId, { layout: newLayout }, true);
    },

    getView: (id) => get().views.find((v) => v.id === id),

    createAndAddWidget: async (widget) => {
      const { activeBuilderId } = get();
      if (activeBuilderId) {
        await get().addWidget(activeBuilderId, widget);
        return activeBuilderId;
      }
      // Derive a meaningful name from the widget's title/kind
      const widgetTitle = (widget as any).title || '';
      const kindLabel = widget.kind === 'chart' ? 'Chart' : widget.kind === 'data_table' ? 'Table' : widget.kind.replace('_', ' ');
      const title = widgetTitle || `${kindLabel} View`;
      const newView: ViewSpec = {
        id: `cv-${Date.now().toString(36)}`,
        title,
        description: '',
        layout: [truncateForPersistence(widget)],
        generatedAt: Date.now(),
      };
      await get().saveView(newView);
      set({ activeBuilderId: newView.id });
      return newView.id;
    },

    setActiveBuilderId: (id) => set({ activeBuilderId: id }),

    claimSharedView: async (shareToken) => {
      try {
        const result = await apiFetch(`/views/claim/${shareToken}`, {
          method: 'POST',
        });
        // Reload views to include the clone
        await get().loadViews();
        return result.id;
      } catch (e) {
        console.error('Failed to claim shared view:', e);
        return null;
      }
    },

    shareView: async (id) => {
      try {
        const result = await apiFetch(`/views/${id}/share`, {
          method: 'POST',
        });
        return result.share_token;
      } catch (e) {
        console.error('Failed to share view:', e);
        return null;
      }
    },

    executeAction: async (viewId, action, actionInput) => {
      const data = await apiFetch(`/views/${viewId}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action, action_input: actionInput }),
      });
      return data;
    },
  }),
);
