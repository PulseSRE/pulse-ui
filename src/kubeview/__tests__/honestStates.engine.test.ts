// @vitest-environment jsdom
/**
 * Wave 2, engine level: a failed or forbidden read is "unknown", never a
 * pass, a match, a zero or a default.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../store/uiStore', () => {
  const state = { impersonateUser: '', impersonateGroups: [], addDegradedReason: vi.fn(), removeDegradedReason: vi.fn(), addToast: vi.fn() };
  return { useUIStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state, setState: vi.fn() }) };
});

const connections: Array<{ id: string; name: string; status: string }> = [];
vi.mock('../engine/clusterConnection', () => ({
  getAllConnections: () => connections,
  getClusterBase: (id?: string) => (id ? `/k/${id}` : '/api/kubernetes'),
  getActiveClusterId: () => 'local',
}));

import { mockFetchRoutes } from './helpers/honestStates';
import { readK8s, listK8s, errorReason } from '../engine/readResult';
import { captureSnapshot, compareSnapshots, type ClusterSnapshot } from '../engine/snapshot';
import { fleetCompareResource } from '../engine/fleetDrift';
import { compareVersions } from '../engine/version';
import { bitbucketAuthHeader } from '../engine/gitProvider';

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('readK8s / listK8s', () => {
  it('keeps 404 (absent) apart from 403 (unknown)', async () => {
    mockFetchRoutes({ '/secrets/gone': { status: 404, body: { kind: 'Status', code: 404 } } }, 403);
    expect(await readK8s('/api/v1/namespaces/kube-system/secrets/gone')).toEqual({ state: 'absent' });
    expect(await readK8s('/api/v1/namespaces/kube-system/secrets/kubeadmin')).toEqual({ state: 'error', reason: 'Permission denied (403)' });
    expect(await listK8s('/api/v1/secrets')).toEqual({ state: 'error', reason: 'Permission denied (403)' });
  });

  it('returns the data on success', async () => {
    mockFetchRoutes({ '/apis/x': { body: { items: [{ metadata: { name: 'a' } }] } } });
    const r = await listK8s('/apis/x');
    expect(r.state).toBe('ok');
  });

  it('describes network failures', () => {
    expect(errorReason(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
    expect(errorReason({ statusCode: 500 })).toBe('Request failed (500)');
  });
});

describe('captureSnapshot / compareSnapshots', () => {
  it('marks unreadable sources and never counts their fields as matching', async () => {
    // Everything 403 except the cluster version.
    mockFetchRoutes({ 'clusterversions/version': { body: { status: { desired: { version: '4.17.1' } } } } }, 403);
    const a = await captureSnapshot('a');
    const b = await captureSnapshot('b');
    expect(a.unavailable).toContain('apiServer');
    expect(a.unavailable).toContain('scheduler');
    // The old fallbacks would have been 'Intermediate' and 'HighNodeUtilization' on both sides: a "match".
    const rows = compareSnapshots(a, b);
    const tls = rows.find((r) => r.field === 'TLS Profile')!;
    expect(tls.unavailable).toBe(true);
    expect(tls.changed).toBe(false);
    expect(tls.left).toBe('unavailable');
    const version = rows.find((r) => r.field === 'Cluster Version')!;
    expect(version.unavailable).toBeUndefined();
    expect(rows.filter((r) => !r.changed && !r.unavailable).map((r) => r.field)).toEqual(['Cluster Version']);
  });

  it('defaults an unset scheduler profile to LowNodeUtilization only when the read succeeded', async () => {
    mockFetchRoutes({ 'schedulers/cluster': { body: { spec: {} } } }, 404);
    const s = await captureSnapshot('s');
    expect(s.config?.schedulerProfile).toBe('LowNodeUtilization');
    expect(s.unavailable).toBeUndefined();
  });

  it('leaves old snapshots (no unavailable list) comparing as before', () => {
    const base = { id: 'x', label: 'x', timestamp: '', clusterVersion: '4.1', platform: '', controlPlaneTopology: '', nodes: { count: 1, versions: [] }, clusterOperators: [], crds: [], storageClasses: [], namespaceCount: 1 } as ClusterSnapshot;
    expect(compareSnapshots(base, base).every((r) => !r.unavailable)).toBe(true);
  });
});

describe('fleetCompareResource', () => {
  it('reports absent clusters as drift and failed clusters as not compared', async () => {
    connections.splice(0, connections.length,
      { id: 'a', name: 'a', status: 'connected' },
      { id: 'b', name: 'b', status: 'connected' },
      { id: 'c', name: 'c', status: 'connected' },
    );
    mockFetchRoutes({
      '/k/a/': { body: { metadata: { name: 'web' }, spec: { replicas: 2 } } },
      '/k/b/': { status: 404, body: { code: 404 } },
      '/k/c/': { status: 403, body: { code: 403 } },
    });
    const r = await fleetCompareResource('/apis/apps/v1/deployments', 'web', 'default');
    expect(r.clusters).toEqual(['a']);
    expect(r.totalClusters).toBe(3);
    expect(r.absentClusters).toEqual(['b']);
    expect(r.failedClusters).toEqual([{ id: 'c', reason: 'Permission denied (403)' }]);
  });
});

describe('compareVersions', () => {
  it('orders numerically', () => {
    expect(['4.15.4', '4.15.10', '4.15.5'].sort((a, b) => compareVersions(b, a))).toEqual(['4.15.10', '4.15.5', '4.15.4']);
  });
});

describe('bitbucketAuthHeader', () => {
  it('sends an App Password (username:password) as Basic and a token as Bearer', () => {
    expect(bitbucketAuthHeader('alice:app-pass')).toBe(`Basic ${btoa('alice:app-pass')}`);
    expect(bitbucketAuthHeader('ATCTT3xFfGN0')).toBe('Bearer ATCTT3xFfGN0');
  });
});
