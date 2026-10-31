// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

let mockMetricQueries: any[] = [];
vi.mock('../../components/metrics/AutoMetrics', () => ({
  getMetricsForResource: () => mockMetricQueries,
  resolveQuery: (q: string) => q,
  formatYAxisValue: (v: number) => String(v),
}));

vi.mock('../../components/metrics/MetricsChart', () => ({
  MetricsChart: ({ series }: any) => <div data-testid="metrics-chart">Chart ({series.length} series)</div>,
}));

vi.mock('../../hooks/useResourceUrl', () => ({
  buildApiPath: vi.fn(),
}));

vi.mock('../../engine/colors', () => ({
  CHART_COLOR_SEQUENCE: ['#3b82f6', '#22c55e', '#f59e0b'],
}));

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import MetricsView from '../MetricsView';

function renderView(props: { gvrKey: string; namespace?: string; name: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MetricsView {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MetricsView', () => {
  afterEach(() => {
    cleanup();
    mockMetricQueries = [];
    vi.unstubAllGlobals();
  });

  it('renders heading with resource name', () => {
    renderView({ gvrKey: 'apps/v1/deployments', namespace: 'default', name: 'nginx' });
    expect(screen.getByText('Metrics')).toBeDefined();
    expect(screen.getByText('nginx')).toBeDefined();
  });

  it('shows namespace badge when provided', () => {
    renderView({ gvrKey: 'apps/v1/deployments', namespace: 'production', name: 'api' });
    expect(screen.getByText('production')).toBeDefined();
  });

  it('shows time range selector buttons', () => {
    renderView({ gvrKey: 'apps/v1/deployments', namespace: 'default', name: 'nginx' });
    expect(screen.getByText('1h')).toBeDefined();
    expect(screen.getByText('6h')).toBeDefined();
    expect(screen.getByText('24h')).toBeDefined();
    expect(screen.getByText('7d')).toBeDefined();
  });

  it('shows no-metrics message when no queries available', () => {
    mockMetricQueries = [];
    renderView({ gvrKey: 'v1/configmaps', namespace: 'default', name: 'my-config' });
    expect(screen.getByText('No metrics available for configmaps')).toBeDefined();
  });

  it('renders metric panels when queries are configured', () => {
    mockMetricQueries = [
      { id: 'cpu', title: 'CPU Usage', query: 'rate(cpu{pod="$pod"}[5m])', yAxisLabel: 'cores', yAxisFormat: 'number' },
      { id: 'mem', title: 'Memory Usage', query: 'mem{pod="$pod"}', yAxisLabel: 'bytes', yAxisFormat: 'bytes' },
    ];
    renderView({ gvrKey: 'apps/v1/deployments', namespace: 'default', name: 'nginx' });
    expect(screen.getByText('CPU Usage')).toBeDefined();
    expect(screen.getByText('Memory Usage')).toBeDefined();
  });

  it('shows a load error with retry, not "No data available", when Prometheus fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    mockMetricQueries = [{ id: 'cpu', title: 'CPU Usage', query: 'cpu', yAxisLabel: 'cores', yAxisFormat: 'number' }];
    renderView({ gvrKey: 'apps/v1/deployments', namespace: 'default', name: 'nginx' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Failed to fetch metrics'));
    expect(screen.getByRole('alert').textContent).toMatch(/503/);
    expect(screen.queryByText('No data available')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
  });

  it('still says "No data available" for a successful empty result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'success', data: { result: [] } }), { status: 200 })));
    mockMetricQueries = [{ id: 'cpu', title: 'CPU Usage', query: 'cpu', yAxisLabel: 'cores', yAxisFormat: 'number' }];
    renderView({ gvrKey: 'apps/v1/deployments', namespace: 'default', name: 'nginx' });
    await waitFor(() => expect(screen.getByText('No data available')).toBeDefined());
  });
});
