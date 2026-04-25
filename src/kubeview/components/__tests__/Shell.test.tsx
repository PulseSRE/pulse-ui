// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Outlet: () => <div data-testid="outlet">outlet-content</div>,
  };
});

const _mockRemoveDegraded = vi.fn();
const _mockUIState: Record<string, any> = {
  commandPaletteOpen: false,
  browserOpen: false,
  dockPanel: null,
  bottomDockPanel: null,
  aiSidebarExpanded: true,
  aiSidebarMode: 'dashboard',
  impersonateUser: null,
  clearImpersonation: vi.fn(),
  degradedReasons: new Set(),
  removeDegradedReason: _mockRemoveDegraded,
  selectedNamespace: '*',
  addTab: vi.fn(),
  addToast: vi.fn(),
  tabs: [],
  activeTabId: null,
  closeTab: vi.fn(),
  setActiveTab: vi.fn(),
  reorderTabs: vi.fn(),
  namespaces: [],
  setNamespace: vi.fn(),
  toggleCommandPalette: vi.fn(),
  toggleBrowser: vi.fn(),
  openDock: vi.fn(),
  closeDock: vi.fn(),
  expandAISidebar: vi.fn(),
  collapseAISidebar: vi.fn(),
  toggleAISidebar: vi.fn(),
  setAISidebarMode: vi.fn(),
  bottomDockHeight: 250,
  setBottomDockHeight: vi.fn(),
  openBottomDock: vi.fn(),
  closeBottomDock: vi.fn(),
  dockWidth: 420,
  setDockWidth: vi.fn(),
  dockHeight: 250,
  setDockHeight: vi.fn(),
  toasts: [],
  removeToast: vi.fn(),
  isHyperShift: false,
  viewBuilderMode: false,
  exitViewBuilder: vi.fn(),
};

vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: any) => selector(_mockUIState),
    { getState: () => _mockUIState },
  ),
}));

vi.mock('../../store/monitorStore', () => ({
  useMonitorStore: Object.assign(
    (selector: any) => {
      const state = {
        notificationCenterOpen: false,
        toggleNotificationCenter: vi.fn(),
        findings: [],
        unreadCount: 0,
        connected: false,
        activeSkill: null,
      };
      return selector(state);
    },
    { getState: () => ({ toggleNotificationCenter: vi.fn(), disconnect: vi.fn() }) },
  ),
}));

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (selector: any) => {
      const state = {
        connected: false,
        hasUnreadInsight: false,
        setUnreadInsight: vi.fn(),
        streaming: false,
        messages: [],
      };
      return selector(state);
    },
    { getState: () => ({ connected: false, connect: vi.fn(), disconnect: vi.fn(), streaming: false }) },
  ),
}));

vi.mock('../../store/customViewStore', () => ({
  useCustomViewStore: Object.assign(
    (selector: any) => selector({ views: [] }),
    { getState: () => ({ loadViews: vi.fn(), setActiveBuilderId: vi.fn() }) },
  ),
}));

vi.mock('../../hooks', () => ({
  useKeyboardShortcuts: vi.fn(),
  useDiscovery: vi.fn(),
}));
vi.mock('../../hooks/useCapabilityDetection', () => ({
  useCapabilityDetection: vi.fn(),
}));
vi.mock('../../engine/enhancers/register', () => ({
  registerBuiltinEnhancers: vi.fn(),
}));
vi.mock('../../engine/agentNotifications', () => ({
  startAgentNotifications: vi.fn(),
  stopAgentNotifications: vi.fn(),
}));
vi.mock('../CommandBar', () => ({
  CommandBar: () => <div data-testid="command-bar">CommandBar</div>,
}));
vi.mock('../TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar">TabBar</div>,
}));
vi.mock('../BottomDock', () => ({
  BottomDock: () => <div data-testid="bottom-dock">BottomDock</div>,
}));
vi.mock('../sidebar/AISidebar', () => ({
  AISidebar: () => <div data-testid="ai-sidebar">AISidebar</div>,
}));
vi.mock('../StatusBar', () => ({
  StatusBar: () => <div data-testid="status-bar">StatusBar</div>,
}));
vi.mock('../CommandPalette', () => ({
  CommandPalette: () => <div data-testid="command-palette">CommandPalette</div>,
}));
vi.mock('../ResourceBrowser', () => ({
  ResourceBrowser: () => <div data-testid="resource-browser">ResourceBrowser</div>,
}));
vi.mock('../feedback/Toast', () => ({
  ToastContainer: () => null,
}));
vi.mock('../agent/NotificationCenter', () => ({
  NotificationCenter: () => null,
}));
vi.mock('../ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: any) => <>{children}</>,
  CssHealthCheck: () => null,
}));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import { Shell } from '../Shell';

function renderShell() {
  return render(
    <MemoryRouter>
      <Shell />
    </MemoryRouter>
  );
}

describe('Shell', () => {
  afterEach(() => {
    cleanup();
    _mockUIState.commandPaletteOpen = false;
    _mockUIState.browserOpen = false;
    _mockUIState.impersonateUser = null;
    _mockUIState.degradedReasons = new Set();
    _mockRemoveDegraded.mockClear();
  });

  it('renders CommandBar, TabBar, StatusBar, and Outlet', () => {
    renderShell();
    expect(screen.getByTestId('command-bar')).toBeDefined();
    expect(screen.getByTestId('tab-bar')).toBeDefined();
    expect(screen.getByTestId('status-bar')).toBeDefined();
    expect(screen.getByTestId('outlet')).toBeDefined();
  });

  it('renders AI sidebar always', () => {
    renderShell();
    expect(screen.getByTestId('ai-sidebar')).toBeDefined();
  });

  it('renders BottomDock always', () => {
    renderShell();
    expect(screen.getByTestId('bottom-dock')).toBeDefined();
  });

  it('renders impersonation banner when impersonateUser is set', () => {
    _mockUIState.impersonateUser = 'test-admin';
    renderShell();
    expect(screen.getByText(/Impersonating/)).toBeDefined();
    expect(screen.getByText('test-admin')).toBeDefined();
    expect(screen.getByText('Stop')).toBeDefined();
  });

  it('does not render CommandPalette when closed', () => {
    renderShell();
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });

  it('renders session expired modal when session_expired is in degradedReasons', () => {
    _mockUIState.degradedReasons = new Set(['session_expired']);
    renderShell();
    expect(screen.getByText('Session Expired')).toBeDefined();
    expect(screen.getByText('Log in now')).toBeDefined();
  });

  it('does not render session expired modal when no session_expired reason', () => {
    renderShell();
    expect(screen.queryByText('Session Expired')).toBeNull();
  });

  it('does not render session expired modal for other degraded reasons', () => {
    _mockUIState.degradedReasons = new Set(['agent_unreachable']);
    renderShell();
    expect(screen.queryByText('Session Expired')).toBeNull();
  });

  it('session expired modal shows countdown starting at 10s', () => {
    _mockUIState.degradedReasons = new Set(['session_expired']);
    renderShell();
    expect(screen.getByText('10s')).toBeDefined();
    _mockUIState.degradedReasons = new Set();
  });

  it('session expired modal countdown decrements', () => {
    vi.useFakeTimers();
    try {
      _mockUIState.degradedReasons = new Set(['session_expired']);
      renderShell();
      expect(screen.getByText('10s')).toBeDefined();

      act(() => { vi.advanceTimersByTime(1000); });
      expect(screen.getByText('9s')).toBeDefined();

      act(() => { vi.advanceTimersByTime(1000); });
      expect(screen.getByText('8s')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('session expired modal has progress bar', () => {
    _mockUIState.degradedReasons = new Set(['session_expired']);
    const { container } = renderShell();
    const progressBar = container.querySelector('.bg-blue-500.h-1\\.5');
    expect(progressBar).toBeDefined();
    _mockUIState.degradedReasons = new Set();
  });

  it('session expired modal has no dismiss button', () => {
    _mockUIState.degradedReasons = new Set(['session_expired']);
    renderShell();

    expect(screen.queryByText('Dismiss')).toBeNull();
    expect(screen.getByText('Log in now')).toBeDefined();
    _mockUIState.degradedReasons = new Set();
  });
});
