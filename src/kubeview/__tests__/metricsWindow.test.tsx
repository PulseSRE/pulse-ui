// @vitest-environment jsdom
/**
 * /metrics and the project charts used `end = Date.now()` per render in the
 * query key: hovering a chart (which sets state) refetched every chart and
 * flashed skeletons. The window is now state that advances on an interval.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { screen, cleanup, waitFor, fireEvent, renderHook, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

vi.mock('../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../components/metrics/Sparkline', () => ({ MetricCard: ({ title }: { title: string }) => <div>{title}</div>, Sparkline: () => <div /> }));
vi.mock('../components/metrics/AutoMetrics', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../components/metrics/AutoMetrics');
  return {
    ...actual,
    getMetricsForResource: () => [
      { id: 'cpu', title: 'CPU', query: 'cpu_q', yAxisLabel: 'cores', yAxisFormat: 'number' },
      { id: 'mem', title: 'Memory', query: 'mem_q', yAxisLabel: 'bytes', yAxisFormat: 'number' },
    ],
  };
});
// A chart whose hover calls back into the page, as the real one does.
vi.mock('../components/metrics/MetricsChart', () => ({
  MetricsChart: ({ onHover }: { onHover?: (t: number | null) => void }) => (
    <button type="button" data-testid="chart" onMouseMove={() => onHover?.(Math.random())}>chart</button>
  ),
}));

import { mockFetchRoutes, renderWithClient } from './helpers/honestStates';
import { useMetricsWindow } from '../hooks/useMetricsWindow';
import MetricsView from '../views/MetricsView';
import ProjectDashboard from '../views/ProjectDashboard';

const promBody = { body: { status: 'success', data: { resultType: 'matrix', result: [{ metric: {}, values: [[1, '1'], [2, '2']] }] } } };

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

const rangeCalls = (fetchMock: ReturnType<typeof mockFetchRoutes>) =>
  fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/v1/query_range')).length;

describe('useMetricsWindow', () => {
  it('holds still across re-renders, advances on its interval, and resets when the range changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    const { result, rerender } = renderHook(({ range }) => useMetricsWindow(range), { initialProps: { range: 3600 } });
    const first = result.current;
    expect(first.end - first.start).toBe(3600);

    vi.setSystemTime(new Date('2026-11-01T00:00:30Z'));
    rerender({ range: 3600 });
    expect(result.current).toEqual(first);

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current.end).toBeGreaterThan(first.end);

    rerender({ range: 21600 });
    expect(result.current.end - result.current.start).toBe(21600);
  });
});

describe('MetricsView', () => {
  it('does not refetch or show skeletons when a chart is hovered', async () => {
    const fetchMock = mockFetchRoutes({ '/api/prometheus': promBody });
    renderWithClient(<MetricsView gvrKey="v1/pods" namespace="shop" name="api-1" />);
    await waitFor(() => expect(screen.getAllByTestId('chart')).toHaveLength(2));
    const before = rangeCalls(fetchMock);
    expect(before).toBe(2);

    // Time passes between hovers: the old code would have made a new key.
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => realNow + 5_000);
    for (let i = 0; i < 5; i++) fireEvent.mouseMove(screen.getAllByTestId('chart')[0]);

    expect(screen.getAllByTestId('chart')).toHaveLength(2);
    expect(document.querySelector('.kv-skeleton')).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(rangeCalls(fetchMock)).toBe(before);
  });

  it('still shows the error when Prometheus fails', async () => {
    mockFetchRoutes({ '/api/prometheus': { status: 500, body: { status: 'error', error: 'boom' } } });
    renderWithClient(<MetricsView gvrKey="v1/pods" namespace="shop" name="api-1" />);
    await waitFor(() => expect(screen.getAllByText('Failed to fetch metrics')).toHaveLength(2));
    expect(screen.queryByText('No data available')).toBeNull();
  });
});

describe('ProjectDashboard resource charts', () => {
  it('do not refetch when the page re-renders', async () => {
    const fetchMock = mockFetchRoutes({ '/api/prometheus': promBody, '/api/v1/pods': { body: { items: [] } } }, 404);
    // A fresh element each time, so React really re-renders the page.
    const ui = () => <Routes><Route path="/project/:namespace" element={<ProjectDashboard />} /></Routes>;
    const { rerender, client } = renderWithClient(ui(), { route: '/project/shop' });
    await screen.findByText('Resource Metrics');
    await waitFor(() => expect(rangeCalls(fetchMock)).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    const before = rangeCalls(fetchMock);

    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => realNow + 5_000);
    // Hover each chart: each sets its own state; then force a parent re-render.
    for (const c of screen.queryAllByTestId('chart')) fireEvent.mouseMove(c);
    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/project/shop']}>{ui()}</MemoryRouter>
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(rangeCalls(fetchMock)).toBe(before);
  });
});
