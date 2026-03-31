// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
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
});
