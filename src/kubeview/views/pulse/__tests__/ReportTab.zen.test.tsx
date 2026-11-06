// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../../store/uiStore', () => {
  const state = {
    selectedNamespace: '*', addTab: vi.fn(), setConnectionStatus: vi.fn(), addToast: vi.fn(),
    addDegradedReason: vi.fn(), removeDegradedReason: vi.fn(),
  };
  const useUIStore = (selector: (s: typeof state) => unknown) => selector(state);
  useUIStore.getState = () => state;
  return { useUIStore };
});
vi.mock('../../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../../engine/query', () => ({
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sList: vi.fn().mockResolvedValue([]),
  k8sPatch: vi.fn().mockResolvedValue(null),
  getImpersonationHeaders: () => ({}),
}));
vi.mock('../../../components/metrics/prometheus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queryInstant: vi.fn().mockResolvedValue([]),
  queryRange: vi.fn().mockResolvedValue([]),
  getTimeRange: vi.fn().mockReturnValue([0, 1]),
}));
vi.mock('../../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div>{title}</div>,
  Sparkline: () => <div />,
}));

import { ReportTab } from '../ReportTab';
import { useMonitorStore } from '../../../store/monitorStore';
import { useFleetStore } from '../../../store/fleetStore';

const node = { metadata: { name: 'n1', labels: {} }, status: { conditions: [{ type: 'Ready', status: 'True' }] } };
const pod = { metadata: { name: 'p1', namespace: 'app' }, status: { phase: 'Running', containerStatuses: [] } };

function rules(alerts: Array<{ severity: string }>) {
  return {
    data: {
      groups: [{
        name: 'g',
        rules: [{
          type: 'alerting', name: 'r',
          alerts: alerts.map((a, i) => ({
            state: 'firing', labels: { alertname: `A${i}`, severity: a.severity }, annotations: {}, activeAt: new Date().toISOString(),
          })),
        }],
      }],
    },
  };
}

function mockRules(res: { ok: boolean; status: number; body?: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: res.ok, status: res.status, json: async () => res.body ?? {}, headers: new Headers(),
  })));
}

async function renderTab(postureIssues?: number, settle = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const r = render(
    <QueryClientProvider client={qc}><MemoryRouter>
      <ReportTab nodes={[node] as never} allPods={[pod] as never} deployments={[]} pvcs={[]} operators={[]}
        postureIssues={postureIssues} go={vi.fn()} />
    </MemoryRouter></QueryClientProvider>,
  );
  // Assert only once the alert read has settled, so a pass cannot come from
  // the moment before the failure lands. (A remote cluster never reads alerts.)
  if (settle) await waitFor(() => {
    const q = qc.getQueryCache().find({ queryKey: ['incidentFeed', 'alerts'], exact: false });
    expect(q?.state.status === 'success' || q?.state.status === 'error').toBe(true);
  });
  return r;
}

beforeEach(() => {
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
  // The monitor has scanned and reports nothing open.
  useMonitorStore.setState({ connected: true, connectionError: null, lastScanTime: Date.now(), findings: [], scanReport: null } as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useMonitorStore.setState({ connected: false, lastScanTime: 0, findings: [] } as never);
  useFleetStore.setState({ activeClusterId: 'local' } as never);
});

describe('ReportTab Zen screen', () => {
  it('shows "All Systems Nominal" when alerts were read, nothing fires and the posture bar is clear', async () => {
    mockRules({ ok: true, status: 200, body: rules([]) });
    await renderTab(0);
    expect(await screen.findByText('All Systems Nominal')).toBeDefined();
  });

  it('does not show Zen when the monitor is unreachable: the browser\'s own list cannot say healthy', async () => {
    useMonitorStore.setState({ connected: false, connectionError: 'socket closed', lastScanTime: 0 } as never);
    mockRules({ ok: true, status: 200, body: rules([]) });
    await renderTab(0);
    expect(await screen.findByText('Cluster Risk Score')).toBeDefined();
    expect(screen.queryByText('All Systems Nominal')).toBeNull();
    expect(screen.getByTestId('attention-fallback')).toBeDefined();
  });

  it('does not show Zen before the monitor\'s first scan', async () => {
    useMonitorStore.setState({ connected: true, lastScanTime: 0 } as never);
    mockRules({ ok: true, status: 200, body: rules([]) });
    await renderTab(0);
    expect(await screen.findByText('Cluster Risk Score')).toBeDefined();
    expect(screen.queryByText('All Systems Nominal')).toBeNull();
  });

  it('does not show Zen on a remote cluster, which the monitor does not watch', async () => {
    useFleetStore.setState({ activeClusterId: 'prod-east' } as never);
    mockRules({ ok: true, status: 200, body: rules([]) });
    await renderTab(0, false);
    expect((await screen.findByTestId('attention-fallback')).textContent).toMatch(/local cluster only/);
    expect(screen.queryByText('All Systems Nominal')).toBeNull();
  });

  it('does not show Zen under a posture bar that counts open issues', async () => {
    mockRules({ ok: true, status: 200, body: rules([]) });
    await renderTab(2);
    expect(await screen.findByText('Cluster Risk Score')).toBeDefined();
    expect(screen.queryByText('All Systems Nominal')).toBeNull();
  });

  it('does not show Zen while a warning alert fires', async () => {
    mockRules({ ok: true, status: 200, body: rules([{ severity: 'warning' }]) });
    await renderTab(0);
    await waitFor(() => expect(screen.getByText('Cluster Risk Score')).toBeDefined());
    expect(screen.queryByText('All Systems Nominal')).toBeNull();
  });

  it.each([403, 500])('shows the risk score as Unknown, not Healthy, when alerts fail with %i', async (status) => {
    mockRules({ ok: false, status });
    await renderTab(0);
    expect(await screen.findByTestId('risk-score-unknown')).toBeDefined();
    expect(screen.getByText('Alerts could not be read')).toBeDefined();
    expect(screen.queryByText('Healthy')).toBeNull();
    expect(screen.queryByText('All Systems Nominal')).toBeNull();
  });

  it('shows a numeric score with a label when alerts were read', async () => {
    mockRules({ ok: true, status: 200, body: rules([{ severity: 'warning' }]) });
    await renderTab(1);
    expect(await screen.findByText('Healthy')).toBeDefined();
    expect(screen.queryByTestId('risk-score-unknown')).toBeNull();
  });
});
