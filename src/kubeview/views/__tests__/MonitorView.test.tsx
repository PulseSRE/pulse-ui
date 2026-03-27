// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: any) => {
      const state = {
        selectedNamespace: '*',
        addTab: vi.fn(),
        addToast: vi.fn(),
        openDock: vi.fn(),
      };
      return selector(state);
    },
    { getState: () => ({ openDock: vi.fn(), addToast: vi.fn() }) },
  ),
}));

// Mutable monitor state — override in individual tests via monitorOverrides
const monitorOverrides: Record<string, any> = {};

vi.mock('../../store/monitorStore', () => ({
  useMonitorStore: (selector: any) => {
    const state = {
      findings: [],
      predictions: [],
      connected: false,
      monitorEnabled: false,
      setMonitorEnabled: vi.fn(),
      dismissFinding: vi.fn(),
      fixHistory: [],
      fixHistoryLoading: false,
      loadFixHistory: vi.fn(),
      autoFixCategories: [],
      setAutoFixCategories: vi.fn(),
      triggerScan: vi.fn(),
      lastScanTime: 0,
      nextScanTime: 0,
      activeWatches: [],
      ...monitorOverrides,
    };
    return selector(state);
  },
}));

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (selector: any) => {
      const state = { connected: false, sendMessage: vi.fn() };
      return selector(state);
    },
    { getState: () => ({ connected: false, sendMessage: vi.fn() }) },
  ),
}));

vi.mock('../../store/trustStore', () => ({
  useTrustStore: (selector: any) => {
    const state = {
      trustLevel: 0,
      setTrustLevel: vi.fn(),
      autoFixCategories: [],
      setAutoFixCategories: vi.fn(),
    };
    return selector(state);
  },
  TRUST_LABELS: { 0: 'Observe', 1: 'Confirm', 2: 'Batch', 3: 'Bounded', 4: 'Autonomous' },
}));

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import MonitorView from '../MonitorView';

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MonitorView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MonitorView', () => {
  beforeEach(() => {
    // Reset overrides before each test
    for (const key of Object.keys(monitorOverrides)) {
      delete monitorOverrides[key];
    }
  });

  afterEach(() => { cleanup(); });

  it('renders the page header', () => {
    renderView();
    expect(screen.getByText('Monitor')).toBeDefined();
    expect(screen.getByText(/SRE command center/)).toBeDefined();
  });

  it('renders all three tabs', () => {
    renderView();
    expect(screen.getByText('Live Status')).toBeDefined();
    expect(screen.getByText('Fix History')).toBeDefined();
    expect(screen.getByText('Configuration')).toBeDefined();
  });

  it('shows Live Status tab by default with severity cards', () => {
    renderView();
    expect(screen.getByText('Critical')).toBeDefined();
    expect(screen.getByText('Warning')).toBeDefined();
    expect(screen.getByText('Info')).toBeDefined();
  });

  it('shows empty state on Live Status tab', () => {
    renderView();
    expect(screen.getByText('All clear')).toBeDefined();
  });

  it('switches to Fix History tab', () => {
    renderView();
    fireEvent.click(screen.getByText('Fix History'));
    expect(screen.getByText('No actions taken yet')).toBeDefined();
    expect(screen.getByPlaceholderText('Search history...')).toBeDefined();
  });

  it('switches to Configuration tab', () => {
    renderView();
    fireEvent.click(screen.getByText('Configuration'));
    expect(screen.getByText('Trust Level')).toBeDefined();
    expect(screen.getByText('Scan Now')).toBeDefined();
  });

  it('shows monitor enable/disable toggle on config tab', () => {
    renderView();
    fireEvent.click(screen.getByText('Configuration'));
    const toggle = screen.getByRole('switch');
    expect(toggle).toBeDefined();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('shows all five trust levels', () => {
    renderView();
    fireEvent.click(screen.getByText('Configuration'));
    expect(screen.getByText(/Monitor Only/)).toBeDefined();
    expect(screen.getByText(/Level 1: Suggest/)).toBeDefined();
    expect(screen.getByText(/Ask First/)).toBeDefined();
    expect(screen.getByText(/Auto-fix Safe/)).toBeDefined();
    expect(screen.getByText(/Full Auto/)).toBeDefined();
  });

  it('shows disconnected status by default', () => {
    renderView();
    expect(screen.getByText('Disconnected')).toBeDefined();
  });

  it('shows connection status indicator', () => {
    renderView();
    // The connection status badge is always visible
    const badge = screen.getByText('Disconnected');
    expect(badge.className).toContain('text-slate-400');
  });

  it('renders tab list with correct ARIA attributes', () => {
    renderView();
    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeDefined();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(3);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('Scan Now button is disabled when disconnected', () => {
    monitorOverrides.connected = false;
    renderView();
    fireEvent.click(screen.getByText('Configuration'));
    const scanButton = screen.getByText('Scan Now').closest('button')!;
    expect(scanButton.disabled).toBe(true);
  });

  it('Scan Now button shows "Scanning..." text after click', () => {
    monitorOverrides.connected = true;
    renderView();
    fireEvent.click(screen.getByText('Configuration'));
    const scanButton = screen.getByText('Scan Now').closest('button')!;
    expect(scanButton.disabled).toBe(false);
    fireEvent.click(scanButton);
    expect(screen.getByText('Scanning...')).toBeDefined();
  });

  it('Investigate button exists on findings', () => {
    monitorOverrides.findings = [
      {
        id: 'f-test-1',
        severity: 'critical',
        category: 'memory',
        title: 'OOM Risk Detected',
        summary: 'Pod web-1 nearing memory limit',
        resources: [{ kind: 'Pod', name: 'web-1', namespace: 'default' }],
        autoFixable: true,
        timestamp: Date.now(),
      },
    ];
    renderView();
    // The finding should be visible on the Live Status tab (default)
    expect(screen.getByText('OOM Risk Detected')).toBeDefined();
    expect(screen.getByText('Investigate')).toBeDefined();
    // Verify the Investigate button is a clickable button element
    const investigateBtn = screen.getByText('Investigate').closest('button')!;
    expect(investigateBtn).toBeDefined();
    expect(investigateBtn.disabled).toBeFalsy();
  });
});
