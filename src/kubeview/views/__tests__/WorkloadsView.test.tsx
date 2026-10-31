// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = { selectedNamespace: '*', addTab: vi.fn() };
    return selector(state);
  },
}));

const mockData: Record<string, any[]> = {};
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({
    data: mockData[apiPath] || [], isLoading: false,
  }),
}));

const goMock = vi.fn();
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => goMock }));
vi.mock('../../engine/query', () => ({ k8sList: vi.fn().mockResolvedValue([]), k8sGet: vi.fn().mockResolvedValue(null), sanitizePromQL: (v: string) => v }));
vi.mock('../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div>,
}));
vi.mock('../../components/metrics/prometheus', () => ({ queryInstant: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import WorkloadsView from '../WorkloadsView';

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><WorkloadsView /></MemoryRouter></QueryClientProvider>);
}

describe('WorkloadsView', () => {
  afterEach(() => { cleanup(); Object.keys(mockData).forEach(k => delete mockData[k]); });

  it('renders page header', () => {
    renderView();
    expect(screen.getAllByText('Workloads').length).toBeGreaterThanOrEqual(1);
  });

  it('shows stat cards for resource types', () => {
    renderView();
    expect(screen.getByText('Deployments')).toBeDefined();
    expect(screen.getByText('StatefulSets')).toBeDefined();
    expect(screen.getByText('DaemonSets')).toBeDefined();
    expect(screen.getByText('Pods')).toBeDefined();
    expect(screen.getByText('Jobs')).toBeDefined();
  });

  it('shows metric cards', () => {
    renderView();
    const cards = screen.getAllByTestId('metric-card');
    expect(cards.length).toBeGreaterThanOrEqual(4);
  });

  it('shows zero counts when no data', () => {
    renderView();
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(4);
  });

  it('shows unhealthy deployment warning', () => {
    mockData['/apis/apps/v1/deployments'] = [{
      metadata: { name: 'bad-deploy', namespace: 'test', uid: '1' },
      spec: { replicas: 1 },
      status: { availableReplicas: 0, readyReplicas: 0, conditions: [] },
    }];
    renderView();
    expect(screen.getByText(/not fully available/)).toBeDefined();
  });

  it('View Logs is its own button and selects pods by the Deployment selector', () => {
    goMock.mockReset();
    mockData['/apis/apps/v1/deployments'] = [{
      metadata: { name: 'web', namespace: 'shop', uid: 'd1' },
      spec: { replicas: 1, selector: { matchLabels: { 'app.kubernetes.io/name': 'storefront', tier: 'web' } } },
      status: { replicas: 1, readyReplicas: 1, availableReplicas: 1 },
    }];
    renderView();
    const logs = screen.getByRole('button', { name: 'View logs for web' });
    expect(logs.parentElement?.closest('button')).toBeNull();
    fireEvent.click(logs);
    expect(goMock).toHaveBeenCalledTimes(1);
    expect(goMock).toHaveBeenCalledWith(
      `/logs/shop/web?selector=${encodeURIComponent('app.kubernetes.io/name=storefront,tier=web')}&kind=Deployment`,
      'web (Logs)',
    );
  });

  describe('each problem count appears once', () => {
    function crashloopFixture() {
      mockData['/api/v1/pods'] = [1, 2, 3].map((i) => ({
        metadata: { name: `web-${i}`, namespace: 'shop', uid: `p${i}` },
        status: { phase: 'Running', containerStatuses: [{ name: 'c', restartCount: 1, state: { waiting: { reason: 'CrashLoopBackOff' } } }] },
      }));
      mockData['/apis/apps/v1/deployments'] = [{
        metadata: { name: 'web', namespace: 'shop', uid: 'd1' },
        spec: { replicas: 3, selector: { matchLabels: { app: 'web' } } },
        status: { availableReplicas: 0, readyReplicas: 0, conditions: [] },
      }];
    }

    it('shows the crashloop and unhealthy-deployment counts only in the banner', () => {
      crashloopFixture();
      renderView();
      expect(screen.getAllByText(/3 pods in CrashLoopBackOff/)).toHaveLength(1);
      expect(screen.getAllByText(/1 deployment not fully available/)).toHaveLength(1);
      // No stat-card badge, CrashLoopBackOff metric card, Pod Status row or
      // "Unhealthy Deployments (1)" panel repeating them.
      expect(screen.queryByText('CrashLoopBackOff')).toBeNull();
      expect(screen.queryByText('CrashLoop')).toBeNull();
      expect(screen.queryByText(/Unhealthy Deployments/)).toBeNull();
      expect(screen.queryByText('Unhealthy (1)')).toBeNull();
      expect(screen.queryAllByTestId('metric-card').map((c) => c.textContent)).not.toContain('CrashLoopBackOff');
    });

    it('the crashloop banner opens the pod list', () => {
      crashloopFixture();
      renderView();
      fireEvent.click(screen.getByRole('button', { name: /3 pods in CrashLoopBackOff/ }));
      expect(goMock).toHaveBeenCalledWith('/r/v1~pods', 'Pods');
    });

    it('the unhealthy-deployments banner filters the deployments list to them', () => {
      crashloopFixture();
      mockData['/apis/apps/v1/deployments'].push({
        metadata: { name: 'api', namespace: 'shop', uid: 'd2' },
        spec: { replicas: 1, selector: { matchLabels: { app: 'api' } } },
        status: { availableReplicas: 1, readyReplicas: 1, replicas: 1, conditions: [{ type: 'Available', status: 'True' }] },
      });
      renderView();
      expect(screen.getByText('api')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: /deployment not fully available/ }));
      expect(screen.queryByText('api')).toBeNull();
      expect(screen.getAllByText('web').length).toBeGreaterThan(0);
    });
  });
});
