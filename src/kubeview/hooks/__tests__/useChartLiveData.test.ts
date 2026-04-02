// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the prometheus module
const queryRangeMock = vi.fn();
const getTimeRangeMock = vi.fn();
const parseDurationMock = vi.fn();

vi.mock('../../components/metrics/prometheus', () => ({
  queryRange: (...args: any[]) => queryRangeMock(...args),
  getTimeRange: (...args: any[]) => getTimeRangeMock(...args),
  parseDuration: (...args: any[]) => parseDurationMock(...args),
}));

import { useChartLiveData, DEFAULT_REFRESH_INTERVAL_MS } from '../useChartLiveData';
import type { ChartSpec } from '../../engine/agentComponents';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return {
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children),
    qc,
  };
}

const staticSeries: ChartSpec['series'] = [
  { label: 'cpu', data: [[1000, 0.5], [2000, 0.6]], color: '#60a5fa' },
];

const specWithQuery: ChartSpec = {
  kind: 'chart',
  title: 'CPU Usage',
  series: staticSeries,
  query: 'rate(container_cpu_usage_seconds_total[5m])',
  timeRange: '1h',
};

const specWithoutQuery: ChartSpec = {
  kind: 'chart',
  title: 'Static Chart',
  series: staticSeries,
};

describe('useChartLiveData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTimeRangeMock.mockReturnValue([1000, 2000]);
  });

  it('returns static series when spec has no query', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useChartLiveData(specWithoutQuery), { wrapper });

    expect(result.current.series).toEqual(staticSeries);
    expect(result.current.isLive).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(queryRangeMock).not.toHaveBeenCalled();
  });

  it('fetches live data when spec has a query', async () => {
    const promResult = [
      {
        metric: { __name__: 'cpu', pod: 'nginx-1' },
        values: [[1000, '0.7'], [2000, '0.8']] as [number, string][],
      },
    ];
    queryRangeMock.mockResolvedValue(promResult);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useChartLiveData(specWithQuery), { wrapper });

    await waitFor(() => {
      expect(result.current.isLive).toBe(true);
    });

    expect(queryRangeMock).toHaveBeenCalledWith(specWithQuery.query, 1000, 2000);
    expect(result.current.series).toHaveLength(1);
    expect(result.current.series[0].label).toBe('nginx-1');
    // Timestamps should be converted from seconds to milliseconds
    expect(result.current.series[0].data[0][0]).toBe(1_000_000);
    expect(result.current.series[0].data[0][1]).toBe(0.7);
  });

  it('falls back to static series when fetch fails', async () => {
    queryRangeMock.mockRejectedValue(new Error('Prometheus unavailable'));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useChartLiveData(specWithQuery), { wrapper });

    // The hook has retry: 1, so wait for both attempts to exhaust
    await waitFor(
      () => {
        expect(result.current.error).toBeTruthy();
      },
      { timeout: 5000 },
    );

    // Should fall back to static series
    expect(result.current.series).toEqual(staticSeries);
    expect(result.current.isLive).toBe(false);
  });

  it('toggles pause state', async () => {
    queryRangeMock.mockResolvedValue([]);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useChartLiveData(specWithQuery), { wrapper });

    expect(result.current.isPaused).toBe(false);

    act(() => {
      result.current.togglePause();
    });

    expect(result.current.isPaused).toBe(true);

    act(() => {
      result.current.togglePause();
    });

    expect(result.current.isPaused).toBe(false);
  });

  it('exports the default refresh interval', () => {
    expect(DEFAULT_REFRESH_INTERVAL_MS).toBe(60_000);
  });

  it('preserves colors from original spec series', async () => {
    const promResult = [
      {
        metric: { __name__: 'cpu', pod: 'nginx-1' },
        values: [[1000, '0.7']] as [number, string][],
      },
    ];
    queryRangeMock.mockResolvedValue(promResult);

    const specWithColor: ChartSpec = {
      ...specWithQuery,
      series: [{ label: 'cpu', data: [[1000, 0.5]], color: '#ff0000' }],
    };

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useChartLiveData(specWithColor), { wrapper });

    await waitFor(() => {
      expect(result.current.isLive).toBe(true);
    });

    expect(result.current.series[0].color).toBe('#ff0000');
  });
});
