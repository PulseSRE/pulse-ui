// @vitest-environment jsdom
/**
 * Timeline config lane from the agent's GET /changes (Wave 12): workload and
 * ConfigMap changes with who made them, for the selected namespace on the
 * local cluster; a failed read is a failed source, an older agent and a
 * remote cluster are said, not shown as "no changes".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock('../../components/metrics/prometheus', () => ({
  promFetch: vi.fn(async () => ({ ok: true, json: async () => ({ data: { groups: [] } }) })),
  queryRange: vi.fn(async () => []),
  metricsAvailableFor: () => true,
}));
let cluster = 'local';
vi.mock('../useClusterBase', () => ({ useActiveClusterId: () => cluster }));
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(() => undefined, { getState: () => ({ addDegradedReason: vi.fn(), removeDegradedReason: vi.fn() }) }),
}));
vi.mock('../../engine/query', () => ({ k8sGet: vi.fn(async () => null) }));

import { useIncidentTimeline } from '../useIncidentTimeline';

// Vitest runs without globals here, so Testing Library's automatic cleanup does
// not run: unmount every hook and drop its queries after each test, or a
// render scheduled by a late query result runs after jsdom is torn down
// ("window is not defined" as an unhandled error).
const clients: QueryClient[] = [];
function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchMock = vi.fn();
const at = new Date(Date.now() - 10 * 60_000).toISOString();

beforeEach(() => { cluster = 'local'; fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(async () => {
  cleanup();
  for (const c of clients.splice(0)) { await c.cancelQueries(); c.clear(); }
  vi.unstubAllGlobals();
});

describe('config lane from /changes', () => {
  it('adds the namespace\'s changes with their actor, and skips ClusterVersion (already in the lane)', async () => {
    fetchMock.mockResolvedValue(res({ available: true, changes: [
      { at, kind: 'ConfigMap', namespace: 'payments', name: 'api-cfg', summary: 'edited', actor: 'alice', source: 'configmap' },
      { at, kind: 'ClusterVersion', namespace: '', name: 'version', summary: 'upgrade', actor: null, source: 'clusterversion' },
    ] }));
    const { result } = renderHook(() => useIncidentTimeline({ timeRange: '1h', namespace: 'payments', categories: new Set(['config']) }), { wrapper });
    await waitFor(() => expect(result.current.entries.map((e) => e.title)).toEqual(['ConfigMap api-cfg: edited']));
    expect(result.current.entries[0].detail).toContain('by alice');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/agent/changes?');
    expect(url).toContain('namespace=payments');
    expect(result.current.configChangesNote).toBeNull();
  });

  it('a truncated list is said, and unreadable sources are a failed part', async () => {
    fetchMock.mockResolvedValue(res({ available: true, truncated: true, unreadable: ['argo: forbidden'], changes: [] }));
    const { result } = renderHook(() => useIncidentTimeline({ timeRange: '1h', namespace: 'payments', categories: new Set(['config']) }), { wrapper });
    await waitFor(() => expect(result.current.configChangesNote).toMatch(/truncated/));
    expect(result.current.failedSources).toContain('part of the change history (argo: forbidden)');
  });

  it('a refused read is a failed source, not an empty lane', async () => {
    fetchMock.mockResolvedValue(res({ detail: 'configmaps is forbidden' }, 403));
    const { result } = renderHook(() => useIncidentTimeline({ timeRange: '1h', namespace: 'payments', categories: new Set(['config']) }), { wrapper });
    await waitFor(() => expect(result.current.failedSources).toContain('workload and ConfigMap changes (Pulse agent)'));
  });

  it('an older agent, no namespace, or a remote cluster is a note, and nothing is fetched for the latter two', async () => {
    fetchMock.mockResolvedValue(res({ detail: 'Not Found' }, 404));
    const older = renderHook(() => useIncidentTimeline({ timeRange: '1h', namespace: 'payments', categories: new Set(['config']) }), { wrapper });
    await waitFor(() => expect(older.result.current.configChangesNote).toMatch(/newer agent/));
    expect(older.result.current.failedSources).toEqual([]);
    fetchMock.mockClear();
    const noNs = renderHook(() => useIncidentTimeline({ timeRange: '1h', categories: new Set(['config']) }), { wrapper });
    expect(noNs.result.current.configChangesNote).toMatch(/Select a namespace/);
    cluster = 'prod-east';
    const remote = renderHook(() => useIncidentTimeline({ timeRange: '1h', namespace: 'payments', categories: new Set(['config']) }), { wrapper });
    expect(remote.result.current.configChangesNote).toMatch(/local cluster only/);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/agent/changes'))).toBe(false);
  });
});
