import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

export type DockPanel = 'logs' | 'terminal' | 'events' | 'agent' | null;
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

  // Dock (right-side panel)
  dockPanel: DockPanel;
  dockHeight: number;
  dockWidth: number;
  dockFullscreen: boolean;
  dockContext: { namespace: string; podName: string; containerName?: string } | null;
  openDock: (panel: DockPanel) => void;
  closeDock: () => void;
  setDockHeight: (height: number) => void;
  setDockWidth: (width: number) => void;
  toggleDockFullscreen: () => void;
  setDockContext: (ctx: { namespace: string; podName: string; containerName?: string } | null) => void;

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
}

let tabIdCounter = Date.now();
let toastIdCounter = 0;

const DEFAULT_TABS: Tab[] = [
  { id: 'welcome', title: 'Welcome', icon: 'Home', path: '/welcome', pinned: true, closable: true },
  { id: 'pulse', title: 'Pulse', icon: 'Activity', path: '/pulse', pinned: true, closable: true },
  { id: 'admin', title: 'Admin', icon: 'Settings', path: '/admin', pinned: true, closable: true },
];

// Default toast durations (ms)
const TOAST_DURATIONS = {
  success: 5000,
  error: 0, // persistent
  warning: 8000,
  undo: 5000,
};

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Tabs - default state
      tabs: DEFAULT_TABS,
      activeTabId: 'pulse',
      _pendingNavigate: null,

      addTab: (tab) => {
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

      // Dock (right-side panel)
      dockPanel: null,
      dockHeight: 250,
      dockWidth: 420,
      dockFullscreen: false,
      dockContext: null,

      openDock: (panel) => {
        set({ dockPanel: panel });
      },

      closeDock: () => {
        set({ dockPanel: null, dockFullscreen: false });
      },

      setDockContext: (ctx) => {
        set({ dockContext: ctx });
      },

      setDockHeight: (height) => {
        const clampedHeight = Math.max(100, Math.min(600, height));
        set({ dockHeight: clampedHeight });
      },

      setDockWidth: (width) => {
        const clampedWidth = Math.max(300, Math.min(900, width));
        set({ dockWidth: clampedWidth });
      },

      toggleDockFullscreen: () => {
        set((s) => ({ dockFullscreen: !s.dockFullscreen }));
      },

      // Toasts
      toasts: [],

      addToast: (toast) => {
        const id = `toast-${++toastIdCounter}`;
        const duration = toast.duration !== undefined ? toast.duration : TOAST_DURATIONS[toast.type];

        const newToast: ToastData = { ...toast, id };
        set((state) => ({ toasts: [...state.toasts, newToast] }));

        // Auto-dismiss after duration
        if (duration > 0) {
          setTimeout(() => {
            get().removeToast(id);
            // For undo toasts, execute default action if not manually dismissed
            if (toast.type === 'undo' && toast.action) {
              // The action was not clicked, so this is a timeout
              // We don't execute the undo action on timeout
            }
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
    }),
    {
      name: 'openshiftpulse-ui-storage',
      partialize: (state) => ({
        // Only persist these fields
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        selectedNamespace: state.selectedNamespace,
        dockHeight: state.dockHeight,
        dockWidth: state.dockWidth,
      }),
      merge: (persisted: any, current: any) => {
        if (!persisted) return current;

        // Paths that are redirects — discard tabs for these on rehydration
        const STALE_PATHS = new Set([
          '/', '/dashboard', '/software', '/operators', '/operatorhub',
          '/morning-report', '/troubleshoot', '/config-compare', '/timeline',
        ]);

        // Re-assign unique IDs to persisted tabs to avoid key collisions
        const seen = new Set<string>();
        const tabs = (persisted.tabs || current.tabs).map((tab: Tab) => {
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
        const activeTab = tabs.find((t: Tab) => t.path === (persisted.tabs || []).find((pt: Tab) => pt.id === persisted.activeTabId)?.path);

        return {
          ...current,
          ...persisted,
          tabs,
          activeTabId: activeTab?.id || 'pulse',
        };
      },
    }
  )
);
