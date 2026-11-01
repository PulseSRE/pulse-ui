// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const addToast = vi.fn();
vi.mock('../../store/uiStore', () => {
  const state = {
    selectedNamespace: '*', connectionStatus: 'connected', addTab: vi.fn(), setConnectionStatus: vi.fn(),
    addToast: (...a: unknown[]) => addToast(...a), addDegradedReason: vi.fn(), removeDegradedReason: vi.fn(),
  };
  const useUIStore = (selector: (s: typeof state) => unknown) => selector(state);
  useUIStore.getState = () => state;
  return { useUIStore };
});
vi.mock('../../store/customViewStore', () => ({ useCustomViewStore: (selector: any) => selector({ views: [] }) }));
vi.mock('../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false, isError: false }) }));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../engine/query', () => ({
  k8sGet: vi.fn().mockResolvedValue(null), k8sList: vi.fn().mockResolvedValue([]), getImpersonationHeaders: () => ({}),
}));
vi.mock('../../components/metrics/prometheus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queryInstant: vi.fn().mockResolvedValue([]),
  queryRange: vi.fn().mockResolvedValue([]),
  getTimeRange: vi.fn().mockReturnValue([0, 1]),
}));
vi.mock('../../components/metrics/Sparkline', () => ({ MetricCard: () => <div />, Sparkline: () => <div /> }));
vi.mock('../../engine/analyticsApi', async () => {
  const actual = await vi.importActual<any>('../../engine/analyticsApi');
  return { ...actual, fetchCapabilities: vi.fn().mockResolvedValue({}) };
});

import PulseView from '../PulseView';
import { useMonitorStore } from '../../store/monitorStore';
import { useFleetStore } from '../../store/fleetStore';

function mockRules(res: { ok: boolean; status: number; firing?: number }) {
  const alerts = Array.from({ length: res.firing ?? 0 }, (_, i) => ({
    state: 'firing', labels: { alertname: `A${i}`, severity: 'warning' }, annotations: {}, activeAt: new Date().toISOString(),
  }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: String(url).includes('/rules') ? res.ok : true,
    status: String(url).includes('/rules') ? res.status : 200,
    headers: new Headers(),
    json: async () => ({ data: { groups: [{ name: 'g', rules: [{ type: 'alerting', name: 'r', alerts }] }] } }),
  })));
}

/** Render, wait until the alert read has settled, then finish a scan. */
async function scan({ remote = false } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><PulseView /></MemoryRouter></QueryClientProvider>);
  if (!remote) {
    await waitFor(() => {
      const q = qc.getQueryCache().find({ queryKey: ['incidentFeed', 'alerts'], exact: false });
      expect(q && q.state.status !== 'pending').toBe(true);
    });
  }
  fireEvent.click(screen.getByText('Scan Now'));
  act(() => { useMonitorStore.setState({ lastScanTime: Date.now() + 1 }); });
  await waitFor(() => expect(addToast).toHaveBeenCalled());
  return addToast.mock.calls[0][0] as { type: string; detail: string };
}

beforeEach(() => {
  addToast.mockReset();
  useMonitorStore.setState({ connected: true, findings: [], lastScanTime: 1, triggerScan: vi.fn() } as never);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useFleetStore.setState({ activeClusterId: 'local' }); });

describe('PulseView scan-complete toast', () => {
  it('says the cluster looks healthy only with no findings and no firing alerts', async () => {
    mockRules({ ok: true, status: 200 });
    const t = await scan();
    expect(t.type).toBe('success');
    expect(t.detail).toMatch(/looks healthy/);
  });

  it('counts firing alerts, not only findings', async () => {
    mockRules({ ok: true, status: 200, firing: 2 });
    const t = await scan();
    expect(t.type).toBe('warning');
    expect(t.detail).toMatch(/2 firing alerts/);
    expect(t.detail).not.toMatch(/healthy/);
  });

  it.each([403, 500])('does not call the cluster healthy when alerts fail with %i', async (status) => {
    mockRules({ ok: false, status });
    const t = await scan();
    expect(t.type).toBe('warning');
    expect(t.detail).toMatch(/alerts could not be read/);
    expect(t.detail).not.toMatch(/looks healthy/);
  });

  it('on a remote cluster says alerts are local-only, not that they could not be read', async () => {
    useFleetStore.setState({ activeClusterId: 'east', clusters: [{ id: 'east', name: 'east', status: 'connected' }] as never });
    mockRules({ ok: true, status: 200 });
    const t = await scan({ remote: true });
    expect(t.type).toBe('warning');
    expect(t.detail).toMatch(/local cluster only/);
    expect(t.detail).not.toMatch(/could not be read/);
    expect(t.detail).not.toMatch(/looks healthy/);
    expect(screen.getByText(/alerts are available for the local cluster only/)).toBeTruthy();
  });
});
