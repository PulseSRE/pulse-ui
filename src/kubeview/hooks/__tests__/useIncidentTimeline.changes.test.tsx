// @vitest-environment jsdom
/**
 * Timeline config lane from the agent's GET /changes (Wave 12): workload and
 * ConfigMap changes with who made them, for the selected namespace on the
 * local cluster; a failed read is a failed source, an older agent and a
 * remote cluster are said, not shown as "no changes".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
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

// One client per test, not per render: a client made inside the wrapper is
// replaced on every re-render, and each replacement starts its queries again.
let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchMock = vi.fn();
const at = new Date(Date.now() - 10 * 60_000).toISOString();

beforeEach(() => {
  cluster = 'local';
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
// Vitest runs without globals, so Testing Library does not unmount by itself.
// Hooks left mounted kept rendering after the last test, outside act(); a
// commit just before the jsdom environment was torn down queued React's
// passive-effect flush, which then read `window` after it was gone
// ("ReferenceError: window is not defined" on CI). Unmount inside act, stop
// the client's queries and let in-flight reads settle before the next test.
afterEach(async () => {
  cleanup();
  await act(async () => {
    await client.cancelQueries();
    client.clear();
    await new Promise((r) => setTimeout(r, 0));
  });
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
