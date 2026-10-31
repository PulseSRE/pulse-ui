// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listWatchCalls: Array<Record<string, unknown>> = [];
vi.mock('../useK8sListWatch', () => ({
  useK8sListWatch: (opts: Record<string, unknown>) => {
    listWatchCalls.push(opts);
    return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  },
}));
const queryRangeMock = vi.fn();
vi.mock('../../components/metrics/prometheus', () => ({
  promFetch: vi.fn(async () => ({ ok: true, json: async () => ({ data: { groups: [] } }) })),
  queryRange: (...a: any[]) => queryRangeMock(...a),
  metricsAvailableFor: () => true,
}));
vi.mock('../useClusterBase', () => ({ useActiveClusterId: () => 'local' }));
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(() => undefined, { getState: () => ({ addDegradedReason: vi.fn(), removeDegradedReason: vi.fn() }) }),
}));
vi.mock('../../engine/query', () => ({ k8sGet: vi.fn(async () => null) }));

import { useIncidentTimeline } from '../useIncidentTimeline';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

describe('useIncidentTimeline scoping', () => {
  beforeEach(() => { listWatchCalls.length = 0; queryRangeMock.mockReset(); });

  it('lists events for the selected namespace with no 500 cap, and includes alerts resolved within the range', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    queryRangeMock.mockResolvedValue([
      { metric: { alertname: 'KubePodCrashLooping', namespace: 'prod', severity: 'warning' }, values: [[nowSec - 3000, '1'], [nowSec - 2970, '1'], [nowSec - 2940, '1']] },
    ]);
    const { result } = renderHook(() => useIncidentTimeline({ timeRange: '1h', namespace: 'prod', categories: new Set(['event', 'alert']) }), { wrapper });
    const events = listWatchCalls.find((c) => String(c.apiPath).includes('events'))!;
    expect(events).toMatchObject({ apiPath: '/api/v1/events', namespace: 'prod', enabled: true });
    await waitFor(() => expect(result.current.entries.map((e) => e.title)).toEqual(['KubePodCrashLooping (resolved)']));
    const [query, start, end, step] = queryRangeMock.mock.calls[0];
    expect(query).toBe('ALERTS{alertstate="firing",namespace="prod"}');
    expect(end - start).toBe(3600);
    expect(step).toBe(30);
    expect(result.current.requestedSources).toBe(2);
  });

  it('reports alerts as failed when the range query fails', async () => {
    queryRangeMock.mockRejectedValue(new Error('503'));
    const { result } = renderHook(() => useIncidentTimeline({ timeRange: '6h', categories: new Set(['alert']) }), { wrapper });
    await waitFor(() => expect(result.current.failedSources).toEqual(['alerts (Prometheus)']));
    expect(queryRangeMock.mock.calls[0][0]).toBe('ALERTS{alertstate="firing"}');
  });
});
