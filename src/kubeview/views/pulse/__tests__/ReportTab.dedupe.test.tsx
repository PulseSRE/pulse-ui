// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
import { useArgoCDStore } from '../../../store/argoCDStore';

const go = vi.fn();
const NODE = { metadata: { name: 'n1', uid: 'n1' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } };
const POD = { metadata: { name: 'web', namespace: 'shop', uid: 'p1' }, status: { phase: 'Running' } };
const DEGRADED = { metadata: { name: 'ingress' }, status: { conditions: [{ type: 'Degraded', status: 'True' }, { type: 'Available', status: 'False' }] } };

function renderTab(props: Partial<React.ComponentProps<typeof ReportTab>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter>
      <ReportTab nodes={[NODE] as never} allPods={[POD] as never} deployments={[]} pvcs={[]} operators={[]} go={go} {...props} />
    </MemoryRouter></QueryClientProvider>,
  );
}

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

afterEach(() => { cleanup(); k8sGet.mockReset(); go.mockReset(); useArgoCDStore.setState({ applications: [] }); });

describe('ReportTab shows each fact once', () => {
  it('lists degraded operators in Needs Attention only; Zone 1 links there', async () => {
    k8sGet.mockResolvedValue(null);
    renderTab({ operators: [DEGRADED] as never, postureIssues: 0 });
    expect(await screen.findByText('Operator ingress degraded')).toBeDefined();
    expect(screen.queryByText(/1 degraded operator/)).toBeNull();
    expect(screen.getByText(/Degraded operators are listed under Needs Attention/).closest('a')?.getAttribute('href')).toBe('#pulse-attention');
  });

  it('"Rollouts & config changes" lists real changes from the watched events, not pod noise', async () => {
    k8sGet.mockResolvedValue(null);
    const events = [
      { metadata: { name: 'e1', creationTimestamp: minsAgo(5) }, reason: 'ScalingReplicaSet', involvedObject: { kind: 'Deployment', name: 'web', namespace: 'shop', apiVersion: 'apps/v1' }, lastTimestamp: minsAgo(5) },
      { metadata: { name: 'e2', creationTimestamp: minsAgo(4) }, reason: 'Pulled', involvedObject: { kind: 'Pod', name: 'web-abc', namespace: 'shop' }, lastTimestamp: minsAgo(4) },
      { metadata: { name: 'e3', creationTimestamp: minsAgo(120) }, reason: 'ScalingReplicaSet', involvedObject: { kind: 'Deployment', name: 'old', namespace: 'shop', apiVersion: 'apps/v1' }, lastTimestamp: minsAgo(120) },
    ];
    renderTab({ events: events as never, postureIssues: 0, operators: [DEGRADED] as never });
    expect(await screen.findByText('Rollouts & config changes (1h)')).toBeDefined();
    expect(screen.getByText('ScalingReplicaSet')).toBeDefined();
    expect(screen.queryByText('Pulled')).toBeNull();
    expect(screen.queryByText('old')).toBeNull();
    expect(screen.queryByText(/Recent Changes/)).toBeNull();
    // Not fetched again: the only list call would have been for events.
    const q = await import('../../../engine/query');
    expect(vi.mocked(q.k8sList).mock.calls.some(([p]) => String(p).includes('/events'))).toBe(false);
  });

  it('says "All clear" only when the posture bar has nothing open, and it is not a /readiness link', async () => {
    k8sGet.mockResolvedValue(null);
    sessionStorage.setItem('pulse-zen-dismissed', 'true'); // show the report, not the Zen screen
    renderTab({ postureIssues: 0 });
    const clear = await screen.findByText('All clear');
    expect(clear.closest('button')).toBeNull();
    cleanup();
    renderTab({ postureIssues: 3 });
    await screen.findByText('Rollouts & config changes (1h)');
    expect(screen.queryByText('All clear')).toBeNull();
  });
});
