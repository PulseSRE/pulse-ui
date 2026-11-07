import type { TerminalTarget } from '../engine/terminalTargets';
import { getActiveClusterId } from '../engine/clusterConnection';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DegradedReason } from '../engine/degradedMode';
import { isKnownRoute } from '../engine/routeTable';
import { stripNamespaceScope, stripNamespaceScopeFromWindow } from '../engine/namespaceScope';

export interface Tab {
  id: string;
  title: string;
  icon?: string;
  path: string; // e.g., "/r/apps~v1~deployments/production" or "/pulse"
  pinned: boolean;
  closable: boolean;
  /** When the tab was last active; the least recent unpinned tab is closed first. */
  lastActive?: number;
}

/**
 * Query params that name a different object rather than a view of the same
 * page, so they stay in the tab key: a list or create form per namespace, and
 * a workload's logs per kind (a Deployment and a StatefulSet can share a name).
 */
const IDENTITY_PARAMS: ReadonlyArray<[RegExp, readonly string[]]> = [
  [/^\/r\/[^/]+$/, ['ns', 'namespace']],
  [/^\/create(\/|$)/, ['ns', 'namespace']],
  [/^\/logs\//, ['kind']],
];

/**
 * One shell tab per page: tabs are keyed on the path without its query or
 * hash, so `/workloads` and `/workloads?tab=builds` share a tab, except for
 * the identity params above. The tab's `path` keeps the last full URL seen,
 * so returning to it restores the page's tab and filters.
 */
export function tabKey(path: string): string {
  const end = path.search(/[?#]/);
  let pathname = end === -1 ? path : path.slice(0, end);
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  const names = IDENTITY_PARAMS.find(([re]) => re.test(pathname))?.[1];
  if (!names || end === -1) return pathname;
  const query = path.slice(end).split('#')[0].replace(/^\?/, '');
  const params = new URLSearchParams(query);
  const kept = names.filter((n) => params.get(n)).map((n) => `${n}=${encodeURIComponent(params.get(n)!)}`);
  return kept.length ? `${pathname}?${kept.join('&')}` : pathname;
}

/** Unpinned tabs kept open; opening one more closes the least recently used. */
export const MAX_UNPINNED_TABS = 12;

let activationSeq = 0;
/** A strictly increasing activation stamp that survives reloads (based on the clock). */
function nextActivation(): number {
  activationSeq = Math.max(Date.now(), activationSeq + 1);
  return activationSeq;
}

/** Close the least recently used unpinned tabs above the cap. The active tab is never closed. */
export function capTabs(tabs: Tab[], activeTabId: string, max = MAX_UNPINNED_TABS): Tab[] {
  const evictable = tabs.filter((t) => !t.pinned && t.closable);
  if (evictable.length <= max) return tabs;
  const victims = new Set(
    evictable
      .filter((t) => t.id !== activeTabId)
      // Never-stamped tabs (restored from older storage) go first, in bar order.
      .map((t, i) => ({ t, i }))
      .sort((a, b) => (a.t.lastActive ?? 0) - (b.t.lastActive ?? 0) || a.i - b.i)
      .slice(0, evictable.length - max)
      .map(({ t }) => t.id),
  );
  return tabs.filter((t) => !victims.has(t.id));
}

export interface ToastData {
  id: string;
  type: 'success' | 'error' | 'warning' | 'undo';
  title: string;
  detail?: string;
  duration?: number; // ms, 0 = persistent
  tier?: 'action' | 'system' | 'background';
  action?: {
    label: string;
    onClick: () => void;
  };
  errorId?: string;
  category?: string;
  suggestions?: string[];
}

type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

/** What the bottom-dock terminal is attached to. */
export interface TerminalContext {
  namespace: string;
  podName: string;
  containerName: string;
  isNode?: boolean;
  clusterId?: string;
  /** Containers the terminal may switch between (regular and ephemeral). */
  containers?: TerminalTarget[];
}

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
  terminalContext: TerminalContext | null;
  openBottomDock: (panel: 'logs' | 'terminal' | 'events') => void;
  closeBottomDock: () => void;
  setBottomDockHeight: (height: number) => void;
  setDockContext: (ctx: { namespace: string; podName: string; containerName?: string } | null) => void;
  openTerminal: (ctx: TerminalContext) => void;


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

  // Namespace scope. The URL's `?ns=` is the source (see useNamespaceScope);
  // this mirrors it for readers outside the page and across navigation.
  selectedNamespace: string;
  /** The cluster `selectedNamespace` (and any `?ns=` in tab paths) belongs to. */
  scopeClusterId: string;
  setSelectedNamespace: (ns: string) => void;
  /** A cluster switch: all namespaces, and no tab keeps the old cluster's `?ns=`. */
  resetNamespaceScope: (clusterId: string) => void;
  /** Mounted pages that scope by namespace / that show all namespaces whatever the picker says. */
  namespaceScopeUsers: number;
  namespaceScopeOptOuts: number;
  /** Count one page as scoped (`applies`) or not; returns the release. */
  registerNamespaceScope: (applies: boolean) => () => void;

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
const SYSTEM_TOAST_COOLDOWN = 300_000; // 5min cooldown for system-tier toasts
const _systemToastHistory = new Map<string, { count: number; lastShown: number }>();

/**
 * Tabs without the namespace scope, which names a namespace on one cluster.
 * A title that named the scope ("Pods (payments)") loses it; tabs that become
 * the same page collapse into one (the active or pinned one is kept).
 */
export function dropTabScopes(tabs: Tab[], activeTabId: string): Tab[] {
  const stripped = tabs.map((tab) => {
    const path = stripNamespaceScope(tab.path);
    if (path === tab.path) return tab;
    const ns = new URLSearchParams(tab.path.split(/[?#]/)[1] ?? '').get('ns') ?? new URLSearchParams(tab.path.split(/[?#]/)[1] ?? '').get('namespace');
    const suffix = ns ? ` (${ns})` : '';
    const title = suffix && tab.title.endsWith(suffix) ? tab.title.slice(0, -suffix.length) : tab.title;
    return { ...tab, path, title };
  });
  const keep = new Map<string, Tab>();
  for (const tab of stripped) {
    const key = tabKey(tab.path);
    const held = keep.get(key);
    if (!held || (!held.pinned && (tab.pinned || tab.id === activeTabId))) keep.set(key, tab);
  }
  const kept = new Set([...keep.values()].map((t) => t.id));
  return stripped.filter((t) => kept.has(t.id));
}

export const useUIStore = create<UIState>()(
  persist<
    UIState,
    [],
    [],
    Pick<UIState, 'tabs' | 'activeTabId' | 'selectedNamespace' | 'scopeClusterId' | 'aiSidebarExpanded' | 'aiSidebarWidth' | 'bottomDockHeight'>
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
        const raw = tab.title?.trim() || tabKey(normalizedPath).split('/').filter(Boolean).pop() || 'Untitled';
        const title = raw.charAt(0).toUpperCase() + raw.slice(1);
        tab = { ...tab, path: normalizedPath, title };
        const stamp = nextActivation();

        // Reuse the page's tab: same path, whatever the query
        const { tabs } = get();
        const key = tabKey(normalizedPath);
        const existing = tabs.find((t) => tabKey(t.path) === key);
        if (existing) {
          // The caller named this view, so its title wins; the tab remembers
          // the new URL (a pinned tab keeps the URL it was pinned with).
          const updates: Partial<Tab> = existing.pinned
            ? { lastActive: stamp }
            : { title: tab.title, path: normalizedPath, lastActive: stamp };
          set((state) => ({
            tabs: state.tabs.map((t) => t.id === existing.id ? { ...t, ...updates } : t),
            activeTabId: existing.id,
          }));
          return existing.id;
        }

        const id = `tab-${++tabIdCounter}`;
        const newTab: Tab = { ...tab, id, lastActive: stamp };
        set((state) => ({
          tabs: capTabs([...state.tabs, newTab], id),
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
          const stamp = nextActivation();
          set({ activeTabId: id, tabs: tabs.map((t) => (t.id === id ? { ...t, lastActive: stamp } : t)) });
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
        if (ctx.clusterId && ctx.clusterId !== getActiveClusterId()) return;
        set({ terminalContext: ctx, bottomDockPanel: 'terminal' });
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
        const tier = toast.tier || 'action';

        // Background tier — suppress entirely
        if (tier === 'background') return '';

        // Deduplicate: skip if a toast with the same title and type already exists
        const existing = get().toasts;
        if (existing.some((t) => t.title === toast.title && t.type === toast.type)) {
          return existing.find((t) => t.title === toast.title && t.type === toast.type)!.id;
        }

        // System tier — cooldown-based throttling
        if (tier === 'system') {
          const key = `${toast.type}:${toast.title}`;
          const entry = _systemToastHistory.get(key);
          const now = Date.now();
          if (entry && now - entry.lastShown < SYSTEM_TOAST_COOLDOWN) {
            entry.count++;
            return '';
          }
          _systemToastHistory.set(key, { count: 0, lastShown: now });
          // Evict old entries
          if (_systemToastHistory.size > 100) {
            for (const [k, v] of _systemToastHistory) {
              if (now - v.lastShown > SYSTEM_TOAST_COOLDOWN) _systemToastHistory.delete(k);
            }
          }
        }

        const id = `toast-${++toastIdCounter}`;
        const duration = toast.duration !== undefined ? toast.duration : TOAST_DURATIONS[toast.type];

        const newToast: ToastData = { ...toast, id };
        set((state) => {
          const updated = [...state.toasts, newToast];
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
      scopeClusterId: getActiveClusterId(),
      setSelectedNamespace: (ns) => set({ selectedNamespace: ns, scopeClusterId: getActiveClusterId() }),
      resetNamespaceScope: (clusterId) => set((state) => ({
        selectedNamespace: '*',
        scopeClusterId: clusterId,
        tabs: dropTabScopes(state.tabs, state.activeTabId),
      })),
      namespaceScopeUsers: 0,
      namespaceScopeOptOuts: 0,
      registerNamespaceScope: (applies) => {
        const field = applies ? 'namespaceScopeUsers' : 'namespaceScopeOptOuts';
        set((state) => ({ [field]: state[field] + 1 }));
        return () => set((state) => ({ [field]: Math.max(0, state[field] - 1) }));
      },

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
        scopeClusterId: state.scopeClusterId,
        aiSidebarExpanded: state.aiSidebarExpanded,
        aiSidebarWidth: state.aiSidebarWidth,
        bottomDockHeight: state.bottomDockHeight,
      }),
      merge: (persisted, current) => {
        if (persisted == null) return current;
        const persistedState = persisted as Partial<Pick<UIState, 'tabs' | 'activeTabId'>>;

        // Re-assign unique IDs to persisted tabs to avoid key collisions.
        // When two stored tabs are the same page, the pinned one is kept.
        const seen = new Set<string>();
        const stored = persistedState.tabs || current.tabs;
        const pinnedKeys = new Set(stored.filter((t) => t.pinned).map((t) => tabKey(t.path)));
        const tabs = stored.map((tab: Tab) => {
          if (!tab.pinned && pinnedKeys.has(tabKey(tab.path))) return null;
          // One tab per page (older storage could hold /x and /x?tab=y)
          const key = tabKey(tab.path);
          if (seen.has(key)) return null;
          seen.add(key);
          if (tab.path === '/') return null;
          // A tab for a route that no longer exists (e.g. /welcome, /incidents)
          // would restore onto the Not Found page under its old title.
          if (!isKnownRoute(tab.path)) return null;
          if (tab.title === 'Untitled' && !tab.pinned) return null;
          // Fix empty/untitled titles from older persisted state
          const title = tab.title?.trim() || tab.path.split('/').filter(Boolean).pop() || 'Untitled';
          // Keep pulse tab ID stable, re-assign others
          if (tab.id === 'pulse') return { ...tab, title };
          return { ...tab, title, id: `tab-${++tabIdCounter}` };
        }).filter(Boolean) as Tab[];
        if (!tabs.some((t) => t.id === 'pulse')) {
          const pulseTab = current.tabs.find((t) => t.id === 'pulse');
          if (pulseTab) tabs.unshift(pulseTab);
        }

        // Find active tab in the cleaned list
        const storedActive = (persistedState.tabs || []).find((pt: Tab) => pt.id === persistedState.activeTabId);
        const activeTab = storedActive && tabs.find((t: Tab) => tabKey(t.path) === tabKey(storedActive.path));

        const activeTabId = activeTab?.id || 'pulse';
        // The restored active tab counts as just used, so the cap never closes it later.
        const stamp = nextActivation();
        const stamped = tabs.map((t) => (t.id === activeTabId ? { ...t, lastActive: stamp } : t));
        // A reload starts on the local cluster. A scope saved on another
        // cluster (or by a version that did not record one) names that
        // cluster's namespaces: drop it, from the tabs and the URL too.
        const saved = persisted as Partial<Pick<UIState, 'selectedNamespace' | 'scopeClusterId'>>;
        const scopeMatches = saved.scopeClusterId === getActiveClusterId();
        if (!scopeMatches) stripNamespaceScopeFromWindow();
        return {
          ...current,
          ...persistedState,
          selectedNamespace: scopeMatches ? saved.selectedNamespace ?? '*' : '*',
          scopeClusterId: getActiveClusterId(),
          tabs: capTabs(scopeMatches ? stamped : dropTabScopes(stamped, activeTabId), activeTabId),
          activeTabId,
        };
      },
    }
  )
);
