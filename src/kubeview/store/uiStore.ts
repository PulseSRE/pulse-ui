import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DegradedReason } from '../engine/degradedMode';

export interface Tab {
  id: string;
  title: string;
  icon?: string;
  path: string; // e.g., "/r/apps~v1~deployments/production" or "/pulse"
  pinned: boolean;
  closable: boolean;
}

export interface ToastData {
  id: string;
  type: 'success' | 'error' | 'warning' | 'undo';
  title: string;
  detail?: string;
  duration?: number; // ms, 0 = persistent
  action?: {
    label: string;
    onClick: () => void;
  };
  errorId?: string;
  category?: string;
  suggestions?: string[];
}

export type DockPanel = 'logs' | 'terminal' | 'events' | 'agent' | 'monitor' | null;
export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

interface UIState {
  // Tabs
  tabs: Tab[];
  activeTabId: string;
  addTab: (tab: Omit<Tab, 'id'>) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  pinTab: (id: string) => void;
  unpinTab: (id: string) => void;

  // Command palette
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  // Action panel (Cmd+.)
  actionPanelOpen: boolean;
  actionPanelResource: unknown | null;
  openActionPanel: (resource?: unknown) => void;
  closeActionPanel: () => void;

  // Resource browser (Cmd+B)
  browserOpen: boolean;
  toggleBrowser: () => void;
  closeBrowser: () => void;

  // AI Sidebar (right-side, always present)
  aiSidebarExpanded: boolean;
  aiSidebarMode: 'dashboard' | 'chat';
  aiSidebarWidth: number;
  expandAISidebar: () => void;
  collapseAISidebar: () => void;
  toggleAISidebar: () => void;
  setAISidebarMode: (mode: 'dashboard' | 'chat') => void;
  setAISidebarWidth: (width: number) => void;

  // Bottom Dock (logs/terminal/events)
  bottomDockPanel: 'logs' | 'terminal' | 'events' | null;
  bottomDockHeight: number;
  dockContext: { namespace: string; podName: string; containerName?: string } | null;
  terminalContext: { namespace: string; podName: string; containerName: string; isNode?: boolean } | null;
  openBottomDock: (panel: 'logs' | 'terminal' | 'events') => void;
  closeBottomDock: () => void;
  setBottomDockHeight: (height: number) => void;
  setDockContext: (ctx: { namespace: string; podName: string; containerName?: string } | null) => void;
  openTerminal: (ctx: { namespace: string; podName: string; containerName: string; isNode?: boolean }) => void;

  // Legacy adapter — DEPRECATED: use expandAISidebar/setAISidebarMode for agent,
  // openBottomDock/closeBottomDock for logs/terminal/events. Remove after remaining
  // engine/ and components/ callsites are migrated.
  /** @deprecated Use expandAISidebar() + setAISidebarMode('chat') or openBottomDock() */
  dockPanel: DockPanel;
  /** @deprecated No longer used — AI sidebar width is fixed */
  dockWidth: number;
  /** @deprecated No longer used */
  dockFullscreen: boolean;
  /** @deprecated Use expandAISidebar() + setAISidebarMode('chat') for agent, openBottomDock() for others */
  openDock: (panel: DockPanel) => void;
  /** @deprecated Use collapseAISidebar() or closeBottomDock() */
  closeDock: () => void;
  /** @deprecated No longer used */
  setDockWidth: (width: number) => void;
  /** @deprecated No longer used */
  toggleDockFullscreen: () => void;

  // View Builder (split-screen mode)
  viewBuilderMode: boolean;
  viewBuilderId: string | null;
  enterViewBuilder: (viewId: string) => void;
  exitViewBuilder: () => void;

  // Toasts
  toasts: ToastData[];
  addToast: (toast: Omit<ToastData, 'id'>) => string;
  removeToast: (id: string) => void;

  // Connection
  connectionStatus: ConnectionStatus;
  lastSyncTime: number;
  activeWatches: number;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setLastSyncTime: (time: number) => void;
  setActiveWatches: (count: number) => void;

  // Namespace
  selectedNamespace: string;
  setSelectedNamespace: (ns: string) => void;

  // Status bar operation
  activeOperation: string | null;
  setActiveOperation: (op: string | null) => void;

  // Sidebar
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Navigation after tab close
  _pendingNavigate: string | null;

  // Impersonation
  impersonateUser: string | null;
  impersonateGroups: string[];
  setImpersonation: (user: string | null, groups?: string[]) => void;
  clearImpersonation: () => void;

  // Degraded mode (runtime-only, not persisted)
  degradedReasons: Set<DegradedReason>;
  addDegradedReason: (reason: DegradedReason) => void;
  removeDegradedReason: (reason: DegradedReason) => void;
}

let tabIdCounter = Date.now();
let toastIdCounter = 0;

const DEFAULT_TABS: Tab[] = [
  { id: 'pulse', title: 'Pulse', icon: 'HeartPulse', path: '/pulse', pinned: true, closable: false },
  { id: 'inbox', title: 'Inbox', icon: 'Inbox', path: '/inbox', pinned: true, closable: true },
  { id: 'agent', title: 'Pulse Agent', icon: 'Bot', path: '/agent', pinned: true, closable: true },
];

// Default toast durations (ms)
const TOAST_DURATIONS = {
  success: 5000,
  error: 15000,
  warning: 8000,
  undo: 5000,
};

const MAX_VISIBLE_TOASTS = 3;

export const useUIStore = create<UIState>()(
  persist<
    UIState,
    [],
    [],
    Pick<UIState, 'tabs' | 'activeTabId' | 'selectedNamespace' | 'aiSidebarExpanded' | 'aiSidebarWidth' | 'bottomDockHeight'>
  >(
    (set, get) => ({
      // Tabs - default state
      tabs: DEFAULT_TABS,
      activeTabId: 'pulse',
      _pendingNavigate: null,

      addTab: (tab: Omit<Tab, 'id'>) => {
        // Normalize path: strip trailing slash (except root)
        const normalizedPath = tab.path.length > 1 && tab.path.endsWith('/') ? tab.path.slice(0, -1) : tab.path;
        // Ensure title is never empty
        const raw = tab.title?.trim() || normalizedPath.split('/').filter(Boolean).pop() || 'Untitled';
        const title = raw.charAt(0).toUpperCase() + raw.slice(1);
        tab = { ...tab, path: normalizedPath, title };

        // Reuse existing tab with same path
        const { tabs } = get();
        const existing = tabs.find((t) => t.path === normalizedPath);
        if (existing) {
          // Update title if different, and activate
          if (existing.title !== tab.title) {
            set((state) => ({
              tabs: state.tabs.map((t) => t.id === existing.id ? { ...t, title: tab.title } : t),
              activeTabId: existing.id,
            }));
          } else {
            set({ activeTabId: existing.id });
          }
          return existing.id;
        }

        const id = `tab-${++tabIdCounter}`;
        const newTab: Tab = { ...tab, id };
        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: id,
        }));
        return id;
      },

      closeTab: (id) => {
        const { tabs, activeTabId } = get();
        const tabToClose = tabs.find((t) => t.id === id);
        if (!tabToClose?.closable) return;

        const newTabs = tabs.filter((t) => t.id !== id);
        if (newTabs.length === 0) return; // Don't close last tab

        let newActiveTabId = activeTabId;
        let navigateTo: string | null = null;
        if (activeTabId === id) {
          // Find the next tab, or fall back to first pinned/any tab
          const closedIndex = tabs.findIndex((t) => t.id === id);
          const nextTab = newTabs[closedIndex] || newTabs[closedIndex - 1] || newTabs[0];
          newActiveTabId = nextTab?.id || 'pulse';
          navigateTo = nextTab?.path || '/pulse';
        }

        set({ tabs: newTabs, activeTabId: newActiveTabId, _pendingNavigate: navigateTo });
      },

      setActiveTab: (id) => {
        const { tabs } = get();
        if (tabs.find((t) => t.id === id)) {
          set({ activeTabId: id });
        }
      },

      updateTab: (id, updates) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        }));
      },

      reorderTabs: (fromIndex, toIndex) => {
        set((state) => {
          const newTabs = [...state.tabs];
          const [movedTab] = newTabs.splice(fromIndex, 1);
          newTabs.splice(toIndex, 0, movedTab);
          return { tabs: newTabs };
        });
      },

      pinTab: (id) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, pinned: true } : t)),
        }));
      },

      unpinTab: (id) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, pinned: false } : t)),
        }));
      },

      // Command palette
      commandPaletteOpen: false,
      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
      toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

      // Action panel
      actionPanelOpen: false,
      actionPanelResource: null,
      openActionPanel: (resource) => set({ actionPanelOpen: true, actionPanelResource: resource || null }),
      closeActionPanel: () => set({ actionPanelOpen: false, actionPanelResource: null }),

      // Resource browser
      browserOpen: false,
      toggleBrowser: () => set((state) => ({ browserOpen: !state.browserOpen })),
      closeBrowser: () => set({ browserOpen: false }),

      // AI Sidebar
      aiSidebarExpanded: true,
      aiSidebarMode: 'dashboard' as const,
      aiSidebarWidth: 360,

      expandAISidebar: () => set({ aiSidebarExpanded: true }),
      collapseAISidebar: () => set({ aiSidebarExpanded: false }),
      toggleAISidebar: () => set((s) => ({ aiSidebarExpanded: !s.aiSidebarExpanded })),
      setAISidebarMode: (mode) => set({ aiSidebarMode: mode }),
      setAISidebarWidth: (width) => set({ aiSidebarWidth: Math.max(300, Math.min(600, width)) }),

      // Bottom Dock
      bottomDockPanel: null,
      bottomDockHeight: 250,
      dockContext: null,
      terminalContext: null,

      openBottomDock: (panel) => set({ bottomDockPanel: panel }),
      closeBottomDock: () => set({ bottomDockPanel: null }),
      setBottomDockHeight: (height) => set({ bottomDockHeight: Math.max(150, Math.min(400, height)) }),

      setDockContext: (ctx) => set({ dockContext: ctx }),

      openTerminal: (ctx) => {
        set({ terminalContext: ctx, bottomDockPanel: 'terminal' });
      },

      // Legacy adapter — DEPRECATED: migrate remaining callsites in engine/ and components/ to
      // expandAISidebar() + setAISidebarMode('chat') for agent, openBottomDock() for logs/terminal/events.
      // Remove once engine/agentNotifications.ts, engine/actions.ts, components/ErrorBoundary.tsx,
      // components/onboarding/GateCard.tsx, components/feedback/Toast.tsx, components/CommandPalette.tsx,
      // components/agent/AIOnboarding.tsx, and components/StatusBar.tsx are migrated.
      dockPanel: null as DockPanel,
      dockWidth: 420,
      dockFullscreen: false,

      openDock: (panel) => {
        if (panel === 'agent') {
          set({ aiSidebarExpanded: true, aiSidebarMode: 'chat', dockPanel: 'agent' });
        } else if (panel === 'logs' || panel === 'terminal' || panel === 'events') {
          set({ bottomDockPanel: panel, dockPanel: panel });
        }
      },

      closeDock: () => {
        set({ bottomDockPanel: null, dockPanel: null });
      },

      setDockWidth: (width) => {
        const clampedWidth = Math.max(300, Math.min(900, width));
        set({ dockWidth: clampedWidth });
      },

      toggleDockFullscreen: () => {
        set((s) => ({ dockFullscreen: !s.dockFullscreen }));
      },

      // View Builder
      viewBuilderMode: false,
      viewBuilderId: null,

      enterViewBuilder: (viewId) => {
        set({ viewBuilderMode: true, viewBuilderId: viewId, aiSidebarExpanded: true, aiSidebarMode: 'chat' });
      },

      exitViewBuilder: () => {
        set({ viewBuilderMode: false, viewBuilderId: null });
      },

      // Toasts
      toasts: [],

      addToast: (toast) => {
        // Deduplicate: skip if a toast with the same title and type already exists
        const existing = get().toasts;
        if (existing.some((t) => t.title === toast.title && t.type === toast.type)) {
          return existing.find((t) => t.title === toast.title)!.id;
        }

        const id = `toast-${++toastIdCounter}`;
        const duration = toast.duration !== undefined ? toast.duration : TOAST_DURATIONS[toast.type];

        const newToast: ToastData = { ...toast, id };
        set((state) => {
          const updated = [...state.toasts, newToast];
          // Cap visible toasts — drop oldest when over limit
          if (updated.length > MAX_VISIBLE_TOASTS) {
            return { toasts: updated.slice(-MAX_VISIBLE_TOASTS) };
          }
          return { toasts: updated };
        });

        if (duration > 0) {
          setTimeout(() => {
            get().removeToast(id);
          }, duration);
        }

        return id;
      },

      removeToast: (id) => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      },

      // Connection
      connectionStatus: 'connected',
      lastSyncTime: Date.now(),
      activeWatches: 0,

      setConnectionStatus: (status) => set({ connectionStatus: status }),
      setLastSyncTime: (time) => set({ lastSyncTime: time }),
      setActiveWatches: (count) => set({ activeWatches: count }),

      // Namespace
      selectedNamespace: '*',
      setSelectedNamespace: (ns) => set({ selectedNamespace: ns }),

      // Status bar operation
      activeOperation: null,
      setActiveOperation: (op) => set({ activeOperation: op }),

      // Sidebar
      sidebarOpen: true,
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      // Impersonation
      impersonateUser: null,
      impersonateGroups: [],
      setImpersonation: (user, groups = []) => set({ impersonateUser: user, impersonateGroups: groups }),
      clearImpersonation: () => set({ impersonateUser: null, impersonateGroups: [] }),

      // Degraded mode
      degradedReasons: new Set<DegradedReason>(),
      addDegradedReason: (reason) =>
        set((state) => {
          if (state.degradedReasons.has(reason)) return state;
          const next = new Set(state.degradedReasons);
          next.add(reason);
          return { degradedReasons: next };
        }),
      removeDegradedReason: (reason) =>
        set((state) => {
          if (!state.degradedReasons.has(reason)) return state;
          const next = new Set(state.degradedReasons);
          next.delete(reason);
          return { degradedReasons: next };
        }),
    }),
    {
      name: 'openshiftpulse-ui-storage',
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        selectedNamespace: state.selectedNamespace,
        aiSidebarExpanded: state.aiSidebarExpanded,
        aiSidebarWidth: state.aiSidebarWidth,
        bottomDockHeight: state.bottomDockHeight,
      }),
      merge: (persisted, current) => {
        if (persisted == null) return current;
        const persistedState = persisted as Partial<Pick<UIState, 'tabs' | 'activeTabId'>>;

        // Paths that are redirects — discard tabs for these on rehydration
        const STALE_PATHS = new Set([
          '/', '/dashboard', '/software', '/operators', '/operatorhub',
          '/morning-report', '/troubleshoot', '/config-compare', '/timeline',
        ]);

        // Re-assign unique IDs to persisted tabs to avoid key collisions
        const seen = new Set<string>();
        const tabs = (persistedState.tabs || current.tabs).map((tab: Tab) => {
          // Deduplicate by path
          if (seen.has(tab.path)) return null;
          seen.add(tab.path);
          // Drop tabs for redirect paths or untitled tabs
          if (STALE_PATHS.has(tab.path)) return null;
          if (tab.title === 'Untitled' && !tab.pinned) return null;
          // Fix empty/untitled titles from older persisted state
          const title = tab.title?.trim() || tab.path.split('/').filter(Boolean).pop() || 'Untitled';
          // Keep pulse tab ID stable, re-assign others
          if (tab.id === 'pulse') return { ...tab, title };
          return { ...tab, title, id: `tab-${++tabIdCounter}` };
        }).filter(Boolean) as Tab[];

        // Find active tab in the cleaned list
        const activeTab = tabs.find((t: Tab) => t.path === (persistedState.tabs || []).find((pt: Tab) => pt.id === persistedState.activeTabId)?.path);

        return {
          ...current,
          ...persistedState,
          tabs,
          activeTabId: activeTab?.id || 'pulse',
        };
      },
    }
  )
);
