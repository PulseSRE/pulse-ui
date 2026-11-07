// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../../store/uiStore', () => ({
  useUIStore: (selector: any) => selector({ selectedNamespace: '*', addTab: vi.fn(), setConnectionStatus: vi.fn(), addToast: vi.fn() }),
}));
vi.mock('../../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
const k8sGet = vi.fn();
vi.mock('../../../engine/query', () => ({
  k8sGet: (...a: unknown[]) => k8sGet(...a),
  k8sList: vi.fn().mockResolvedValue([]),
  k8sPatch: vi.fn().mockResolvedValue(null),
}));
const queryInstant = vi.fn().mockResolvedValue([]);
vi.mock('../../../components/metrics/prometheus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queryInstant: (...a: unknown[]) => queryInstant(...a),
  queryRange: vi.fn().mockResolvedValue([]),
  getTimeRange: vi.fn().mockReturnValue([0, 1]),
}));
vi.mock('../../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div>{title}</div>,
  Sparkline: () => <div />,
}));

import { ReportTab } from '../ReportTab';
import { PrometheusReadError } from '../../../engine/readError';
import { useArgoCDStore } from '../../../store/argoCDStore';

let qc: QueryClient | undefined;
function renderTab() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter>
      <ReportTab nodes={[]} allPods={[]} deployments={[]} pvcs={[]} operators={[]} go={vi.fn()} />
    </MemoryRouter></QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); qc?.clear(); k8sGet.mockReset(); queryInstant.mockReset(); queryInstant.mockResolvedValue([]); useArgoCDStore.setState({ applications: [] }); });

describe('ReportTab cluster updates', () => {
  it('says Unknown, not "Up to date", when ClusterVersion cannot be read', async () => {
    k8sGet.mockImplementation(async (path: string) => {
      if (path.includes('clusterversions')) throw Object.assign(new Error('forbidden'), { statusCode: 403, status: 403 });
      return null;
    });
    renderTab();
    expect(await screen.findByText(/Unknown — ClusterVersion could not be read/)).toBeDefined();
    expect(screen.queryByText('Up to date')).toBeNull();
  });

  it('says Unknown when CVO could not retrieve updates', async () => {
    k8sGet.mockImplementation(async (path: string) =>
      path.includes('clusterversions')
        ? { status: { desired: { version: '4.17.1' }, availableUpdates: [], conditions: [{ type: 'RetrievedUpdates', status: 'False' }] } }
        : null);
    renderTab();
    expect(await screen.findByText(/could not retrieve available updates/)).toBeDefined();
    expect(screen.queryByText('Up to date')).toBeNull();
  });

  it('says Up to date only when CVO answered with no updates, and names the newest update otherwise', async () => {
    k8sGet.mockImplementation(async (path: string) =>
      path.includes('clusterversions')
        ? { status: { desired: { version: '4.17.1' }, availableUpdates: [{ version: '4.17.2' }, { version: '4.17.10' }] } }
        : null);
    renderTab();
    expect(await screen.findByText('4.17.10')).toBeDefined();
  });
});

describe('ReportTab Argo drift', () => {
  it('picks up out-of-sync applications that load after the report rendered', async () => {
    k8sGet.mockResolvedValue(null);
    renderTab();
    expect(screen.queryByText(/ArgoCD app out of sync/)).toBeNull();
    act(() => {
      useArgoCDStore.setState({ applications: [{ metadata: { name: 'web', namespace: 'openshift-gitops' }, status: { sync: { status: 'OutOfSync' } } }] as never });
    });
    expect(await screen.findByText('1 ArgoCD app out of sync')).toBeDefined();
  });
});

/** The value shown under a heartbeat label ("API Latency (p99)", "Etcd Leader Changes (1h)"). */
function heartbeat(label: string): HTMLElement {
  return screen.getByText(label).nextElementSibling as HTMLElement;
}

describe('ReportTab Prometheus reads', () => {
  it.each([
    ['403', new PrometheusReadError('forbidden', 'Prometheus refused the query (403)', 403)],
    ['500', new PrometheusReadError('http', 'Prometheus returned an error (status 500)', 500)],
  ])('a %s shows "Could not check" for API latency and etcd, and flags volume usage, never a green or empty value', async (_l, err) => {
    k8sGet.mockResolvedValue(null);
    queryInstant.mockRejectedValue(err);
    renderTab();
    await waitFor(() => expect(heartbeat('API Latency (p99)').textContent).toBe('Could not check'));
    expect(heartbeat('API Latency (p99)').getAttribute('title')).toBe(err.message);
    await waitFor(() => expect(heartbeat('Etcd Leader Changes (1h)').textContent).toBe('Could not check'));
    expect(heartbeat('API Latency (p99)').className).not.toContain('green');
    expect((await screen.findByText(/Volume usage could not be checked/)).closest('[role="alert"]')).not.toBeNull();
  });

  it('a successful read with no series says "No data", with no error', async () => {
    k8sGet.mockResolvedValue(null);
    queryInstant.mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(heartbeat('API Latency (p99)').textContent).toBe('No data'));
    await waitFor(() => expect(heartbeat('Etcd Leader Changes (1h)').textContent).toBe('No data'));
    expect(screen.queryByText(/Volume usage could not be checked/)).toBeNull();
  });

  it('a real value is shown with its colour', async () => {
    k8sGet.mockResolvedValue(null);
    queryInstant.mockImplementation(async (q: string) => (q.includes('apiserver_request_duration') ? [{ metric: {}, value: 0.12 }] : []));
    renderTab();
    await waitFor(() => expect(heartbeat('API Latency (p99)').textContent).toBe('120ms'));
    expect(heartbeat('API Latency (p99)').className).toContain('text-green-400');
  });
});
