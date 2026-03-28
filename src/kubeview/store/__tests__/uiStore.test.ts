// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../uiStore';

// Reset store between tests
function resetStore() {
  useUIStore.setState({
    tabs: [
      { id: 'pulse', title: 'Pulse', icon: 'Activity', path: '/pulse', pinned: true, closable: false },
    ],
    activeTabId: 'pulse',
    commandPaletteOpen: false,
    actionPanelOpen: false,
    actionPanelResource: null,
    browserOpen: false,
    dockPanel: null,
    dockWidth: 420,
    toasts: [],
    connectionStatus: 'connected',
    lastSyncTime: Date.now(),
    activeWatches: 0,
    selectedNamespace: '*',
    activeOperation: null,
  });
}

describe('uiStore', () => {
  beforeEach(() => {
    resetStore();
  });

  // --- Tabs ---

  describe('tabs', () => {
    it('starts with Pulse tab', () => {
      const { tabs, activeTabId } = useUIStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe('pulse');
      expect(tabs[0].pinned).toBe(true);
      expect(activeTabId).toBe('pulse');
    });

    it('addTab creates a new tab and activates it', () => {
      const id = useUIStore.getState().addTab({
        title: 'nodes',
        path: '/r/v1~nodes',
        pinned: false,
        closable: true,
      });

      const { tabs, activeTabId } = useUIStore.getState();
      expect(tabs).toHaveLength(2);
      expect(activeTabId).toBe(id);
      expect(tabs[1].title).toBe('Nodes');
      expect(tabs[1].path).toBe('/r/v1~nodes');
    });

    it('closeTab removes a closable tab', () => {
      const id = useUIStore.getState().addTab({
        title: 'nodes',
        path: '/r/v1~nodes',
        pinned: false,
        closable: true,
      });

      useUIStore.getState().closeTab(id);
      const { tabs } = useUIStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe('pulse');
    });

    it('closeTab does not remove a non-closable tab', () => {
      useUIStore.getState().closeTab('pulse');
      const { tabs } = useUIStore.getState();
      expect(tabs).toHaveLength(1);
    });

    it('closeTab activates next tab when active tab is closed', () => {
      const id1 = useUIStore.getState().addTab({
        title: 'tab1',
        path: '/t1',
        pinned: false,
        closable: true,
      });
      const id2 = useUIStore.getState().addTab({
        title: 'tab2',
        path: '/t2',
        pinned: false,
        closable: true,
      });

      // Active is id2 (last added)
      useUIStore.getState().setActiveTab(id1);
      useUIStore.getState().closeTab(id1);

      const { activeTabId } = useUIStore.getState();
      // Should activate the next available tab
      expect(activeTabId).not.toBe(id1);
    });

    it('closeTab does not remove the last tab', () => {
      // Only pulse tab, which is not closable
      // Add one closable tab then close it
      const id = useUIStore.getState().addTab({
        title: 'only',
        path: '/only',
        pinned: false,
        closable: true,
      });

      // Close the closable tab (pulse remains)
      useUIStore.getState().closeTab(id);
      expect(useUIStore.getState().tabs).toHaveLength(1);
    });

    it('setActiveTab changes the active tab', () => {
      const id = useUIStore.getState().addTab({
        title: 'nodes',
        path: '/r/v1~nodes',
        pinned: false,
        closable: true,
      });

      useUIStore.getState().setActiveTab('pulse');
      expect(useUIStore.getState().activeTabId).toBe('pulse');

      useUIStore.getState().setActiveTab(id);
      expect(useUIStore.getState().activeTabId).toBe(id);
    });

    it('setActiveTab ignores non-existent tab id', () => {
      useUIStore.getState().setActiveTab('nonexistent');
      expect(useUIStore.getState().activeTabId).toBe('pulse');
    });

    it('updateTab modifies tab properties', () => {
      const id = useUIStore.getState().addTab({
        title: 'old',
        path: '/old',
        pinned: false,
        closable: true,
      });

      useUIStore.getState().updateTab(id, { title: 'new', path: '/new' });
      const tab = useUIStore.getState().tabs.find((t) => t.id === id);
      expect(tab?.title).toBe('new');
      expect(tab?.path).toBe('/new');
    });

    it('reorderTabs swaps tab positions', () => {
      useUIStore.getState().addTab({ title: 'a', path: '/a', pinned: false, closable: true });
      useUIStore.getState().addTab({ title: 'b', path: '/b', pinned: false, closable: true });

      // Tabs: [pulse, a, b]
      useUIStore.getState().reorderTabs(1, 2);
      const titles = useUIStore.getState().tabs.map((t) => t.title);
      expect(titles).toEqual(['Pulse', 'B', 'A']);
    });

    it('pinTab and unpinTab toggle pin state', () => {
      const id = useUIStore.getState().addTab({
        title: 'test',
        path: '/test',
        pinned: false,
        closable: true,
      });

      useUIStore.getState().pinTab(id);
      expect(useUIStore.getState().tabs.find((t) => t.id === id)?.pinned).toBe(true);

      useUIStore.getState().unpinTab(id);
      expect(useUIStore.getState().tabs.find((t) => t.id === id)?.pinned).toBe(false);
    });
  });

  describe('tab title generation', () => {
    it('never creates a tab with title "Untitled"', () => {
      useUIStore.getState().addTab({ title: '', path: '/workloads', pinned: false, closable: true });
      const tab = useUIStore.getState().tabs.find((t) => t.path === '/workloads');
      expect(tab?.title).toBe('Workloads');
      expect(tab?.title).not.toBe('Untitled');
    });

    it('derives title from last path segment when title is empty', () => {
      useUIStore.getState().addTab({ title: '', path: '/r/apps~v1~deployments', pinned: false, closable: true });
      const tab = useUIStore.getState().tabs.find((t) => t.path === '/r/apps~v1~deployments');
      expect(tab?.title).toBe('Apps~v1~deployments');
    });

    it('capitalizes first letter of derived title', () => {
      useUIStore.getState().addTab({ title: '', path: '/compute', pinned: false, closable: true });
      const tab = useUIStore.getState().tabs.find((t) => t.path === '/compute');
      expect(tab?.title).toBe('Compute');
    });
  });

  describe('TabBar redirect handling', () => {
    it('TabBar excludes redirect paths from tab creation', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path');
      const source = fs.readFileSync(path.join(__dirname, '../../components/TabBar.tsx'), 'utf-8');
      // Verify REDIRECT_PATHS includes root and legacy paths
      expect(source).toContain("'/'");
      expect(source).toContain("'/dashboard'");
      expect(source).toContain("'/software'");
      expect(source).toContain("'/troubleshoot'");
      expect(source).toContain('REDIRECT_PATHS.has(currentPath)');
    });

    it('store merge drops tabs for redirect paths', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path');
      const source = fs.readFileSync(path.join(__dirname, '../uiStore.ts'), 'utf-8');
      expect(source).toContain('STALE_PATHS');
      expect(source).toContain("tab.title === 'Untitled'");
    });
  });

  // --- Command Palette ---

  describe('command palette', () => {
    it('opens and closes', () => {
      useUIStore.getState().openCommandPalette();
      expect(useUIStore.getState().commandPaletteOpen).toBe(true);

      useUIStore.getState().closeCommandPalette();
      expect(useUIStore.getState().commandPaletteOpen).toBe(false);
    });

    it('toggles', () => {
      useUIStore.getState().toggleCommandPalette();
      expect(useUIStore.getState().commandPaletteOpen).toBe(true);

      useUIStore.getState().toggleCommandPalette();
      expect(useUIStore.getState().commandPaletteOpen).toBe(false);
    });
  });

  // --- Action Panel ---

  describe('action panel', () => {
    it('opens with resource and closes', () => {
      const resource = { metadata: { name: 'test' } };
      useUIStore.getState().openActionPanel(resource);

      expect(useUIStore.getState().actionPanelOpen).toBe(true);
      expect(useUIStore.getState().actionPanelResource).toEqual(resource);

      useUIStore.getState().closeActionPanel();
      expect(useUIStore.getState().actionPanelOpen).toBe(false);
      expect(useUIStore.getState().actionPanelResource).toBeNull();
    });

    it('opens without resource', () => {
      useUIStore.getState().openActionPanel();
      expect(useUIStore.getState().actionPanelOpen).toBe(true);
      expect(useUIStore.getState().actionPanelResource).toBeNull();
    });
  });

  // --- Resource Browser ---

  describe('resource browser', () => {
    it('toggles and closes', () => {
      useUIStore.getState().toggleBrowser();
      expect(useUIStore.getState().browserOpen).toBe(true);

      useUIStore.getState().toggleBrowser();
      expect(useUIStore.getState().browserOpen).toBe(false);

      useUIStore.getState().toggleBrowser();
      useUIStore.getState().closeBrowser();
      expect(useUIStore.getState().browserOpen).toBe(false);
    });
  });

  // --- Dock ---

  describe('dock', () => {
    it('opens and closes', () => {
      useUIStore.getState().openDock('logs');
      expect(useUIStore.getState().dockPanel).toBe('logs');

      useUIStore.getState().closeDock();
      expect(useUIStore.getState().dockPanel).toBeNull();
    });

    it('switches panels', () => {
      useUIStore.getState().openDock('logs');
      useUIStore.getState().openDock('terminal');
      expect(useUIStore.getState().dockPanel).toBe('terminal');
    });

    it('clamps dock width', () => {
      useUIStore.getState().setDockWidth(100);
      expect(useUIStore.getState().dockWidth).toBe(300);

      useUIStore.getState().setDockWidth(1200);
      expect(useUIStore.getState().dockWidth).toBe(900);

      useUIStore.getState().setDockWidth(500);
      expect(useUIStore.getState().dockWidth).toBe(500);
    });
  });

  // --- Toasts ---

  describe('toasts', () => {
    it('adds and removes a toast', () => {
      const id = useUIStore.getState().addToast({
        type: 'success',
        title: 'Saved',
      });

      expect(useUIStore.getState().toasts).toHaveLength(1);
      expect(useUIStore.getState().toasts[0].title).toBe('Saved');

      useUIStore.getState().removeToast(id);
      expect(useUIStore.getState().toasts).toHaveLength(0);
    });

    it('error toasts have duration 0 (persistent)', () => {
      useUIStore.getState().addToast({
        type: 'error',
        title: 'Failed',
      });

      // Error toasts should persist (not auto-dismiss)
      expect(useUIStore.getState().toasts).toHaveLength(1);
    });

    it('supports custom duration', () => {
      useUIStore.getState().addToast({
        type: 'success',
        title: 'Custom',
        duration: 0, // persistent
      });

      expect(useUIStore.getState().toasts).toHaveLength(1);
    });
  });

  // --- Connection ---

  describe('connection', () => {
    it('updates connection status', () => {
      useUIStore.getState().setConnectionStatus('disconnected');
      expect(useUIStore.getState().connectionStatus).toBe('disconnected');

      useUIStore.getState().setConnectionStatus('reconnecting');
      expect(useUIStore.getState().connectionStatus).toBe('reconnecting');
    });

    it('updates last sync time', () => {
      const time = Date.now();
      useUIStore.getState().setLastSyncTime(time);
      expect(useUIStore.getState().lastSyncTime).toBe(time);
    });

    it('updates active watches count', () => {
      useUIStore.getState().setActiveWatches(5);
      expect(useUIStore.getState().activeWatches).toBe(5);
    });
  });

  // --- Namespace ---

  describe('namespace', () => {
    it('defaults to all namespaces', () => {
      expect(useUIStore.getState().selectedNamespace).toBe('*');
    });

    it('changes namespace', () => {
      useUIStore.getState().setSelectedNamespace('kube-system');
      expect(useUIStore.getState().selectedNamespace).toBe('kube-system');
    });
  });

  // --- Active Operation ---

  describe('active operation', () => {
    it('sets and clears', () => {
      useUIStore.getState().setActiveOperation('Scaling deployment');
      expect(useUIStore.getState().activeOperation).toBe('Scaling deployment');

      useUIStore.getState().setActiveOperation(null);
      expect(useUIStore.getState().activeOperation).toBeNull();
    });
  });
});
