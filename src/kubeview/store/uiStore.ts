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
}

export type DockPanel = 'logs' | 'terminal' | 'events' | null;
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

  // Dock
  dockPanel: DockPanel;
  dockHeight: number;
  openDock: (panel: DockPanel) => void;
  closeDock: () => void;
  setDockHeight: (height: number) => void;

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
}

let tabIdCounter = Date.now();
let toastIdCounter = 0;

const DEFAULT_TABS: Tab[] = [
  { id: 'welcome', title: 'Welcome', icon: 'Home', path: '/welcome', pinned: true, closable: false },
  { id: 'pulse', title: 'Pulse', icon: 'Activity', path: '/pulse', pinned: true, closable: false },
  { id: 'workloads', title: 'Workloads', icon: 'Package', path: '/workloads', pinned: true, closable: false },
  { id: 'troubleshoot', title: 'Troubleshoot', icon: 'Zap', path: '/troubleshoot', pinned: true, closable: false },
  { id: 'operators', title: 'Operators', icon: 'Puzzle', path: '/operatorhub', pinned: true, closable: false },
  { id: 'admin', title: 'Admin', icon: 'Settings', path: '/admin', pinned: true, closable: false },
  { id: 'create', title: 'Create', icon: 'FilePlus', path: '/create/v1~pods', pinned: true, closable: false },
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

      addTab: (tab) => {
        // Normalize path: strip trailing slash (except root)
        const normalizedPath = tab.path.length > 1 && tab.path.endsWith('/') ? tab.path.slice(0, -1) : tab.path;
        tab = { ...tab, path: normalizedPath };

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
        if (activeTabId === id) {
          // Find the next tab to activate
          const closedIndex = tabs.findIndex((t) => t.id === id);
          const nextTab = newTabs[closedIndex] || newTabs[closedIndex - 1];
          newActiveTabId = nextTab.id;
        }

        set({ tabs: newTabs, activeTabId: newActiveTabId });
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

      // Dock
      dockPanel: null,
      dockHeight: 250, // default height

      openDock: (panel) => {
        set({ dockPanel: panel });
      },

      closeDock: () => {
        set({ dockPanel: null });
      },

      setDockHeight: (height) => {
        const clampedHeight = Math.max(100, Math.min(600, height));
        set({ dockHeight: clampedHeight });
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
    }),
    {
      name: 'openshiftview-ui-storage',
      partialize: (state) => ({
        // Only persist these fields
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        selectedNamespace: state.selectedNamespace,
        dockHeight: state.dockHeight,
      }),
      merge: (persisted: any, current: any) => {
        if (!persisted) return current;

        // Re-assign unique IDs to persisted tabs to avoid key collisions
        const seen = new Set<string>();
        const tabs = (persisted.tabs || current.tabs).map((tab: Tab) => {
          // Deduplicate by path
          if (seen.has(tab.path)) return null;
          seen.add(tab.path);
          // Keep pulse tab ID stable, re-assign others
          if (tab.id === 'pulse') return tab;
          return { ...tab, id: `tab-${++tabIdCounter}` };
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
