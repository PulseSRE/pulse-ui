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
vi.mock('../../../engine/askPulse', () => ({ askPulse: vi.fn() }));
vi.mock('../../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div>{title}</div>,
  Sparkline: () => <div />,
}));

import { ReportTab } from '../ReportTab';
import { askPulse } from '../../../engine/askPulse';
import { useMonitorStore } from '../../../store/monitorStore';
import { useFleetStore } from '../../../store/fleetStore';

const node = { metadata: { name: 'n1', labels: {} }, status: { conditions: [{ type: 'Ready', status: 'True' }] } };
// A failing pod, so the smart prompts name it.
const crashing = {
  metadata: { name: 'api-7f9c', namespace: 'payments' },
  status: { phase: 'Running', containerStatuses: [{ name: 'api', ready: false, restartCount: 9, state: { waiting: { reason: 'CrashLoopBackOff' } } }] },
};

function renderTab() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { groups: [] } }), headers: new Headers() })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter>
      <ReportTab nodes={[node] as never} allPods={[crashing] as never} deployments={[]} pvcs={[]} operators={[]} postureIssues={1} go={vi.fn()} />
    </MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(askPulse).mockClear();
  useMonitorStore.setState({ connected: true, connectionError: null, lastScanTime: Date.now(), findings: [], scanReport: null } as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useMonitorStore.setState({ connected: false, lastScanTime: 0, findings: [] } as never);
  useFleetStore.setState({ activeClusterId: 'local' } as never);
});

describe('ReportTab "Ask Pulse" prompt chips', () => {
  it('on the local cluster, sends the chip with the pod it names attached', async () => {
    renderTab();
    const chip = await screen.findByRole('button', { name: /Why is pod api-7f9c CrashLoopBackOff in payments\?/ });
    fireEvent.click(chip);
    expect(askPulse).toHaveBeenCalledWith('Why is pod api-7f9c CrashLoopBackOff in payments?', { kind: 'Pod', name: 'api-7f9c', namespace: 'payments' });
  });

  it('on a remote cluster, the chips are disabled: the remote pod names never reach the local agent', async () => {
    useFleetStore.setState({ activeClusterId: 'prod-east' } as never);
    renderTab();
    const chip = await screen.findByRole('button', { name: /Why is pod api-7f9c/ }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe('Pulse AI answers about the local cluster only.');
    fireEvent.click(chip);
    expect(askPulse).not.toHaveBeenCalled();
  });
});
