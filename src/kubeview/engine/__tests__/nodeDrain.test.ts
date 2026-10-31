// @vitest-environment jsdom
/**
 * Drain used to cordon the node and toast "Drain started" while every pod
 * stayed put. It now cordons, evicts each movable pod through the Eviction
 * API, leaves DaemonSet and mirror pods alone, and reports pods a
 * PodDisruptionBudget blocked, by budget name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { drainNode, describeDrain } from '../nodeActions';

type Route = (url: string, init: RequestInit) => Response | Promise<Response> | undefined;
const calls: Array<{ method: string; url: string; body?: unknown }> = [];
let routes: Route[] = [];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    for (const r of routes) {
      const res = await r(url, { ...init, method });
      if (res) return res;
    }
    return json({ message: 'not found' }, 404);
  }));
}

const RS = [{ kind: 'ReplicaSet', name: 'rs', controller: true }];
const pod = (name: string, extra: Record<string, unknown> = {}, spec: Record<string, unknown> = {}) => ({
  metadata: { name, namespace: 'shop', uid: `uid-${name}`, labels: { app: name }, ownerReferences: RS, ...extra },
  spec: { nodeName: 'n1', ...spec },
  status: { phase: 'Running' },
});

const NODE_PODS = [
  pod('web-1'),
  pod('db-0'),
  pod('fluentd-x', { ownerReferences: [{ kind: 'DaemonSet', name: 'fluentd', controller: true }] }),
  pod('etcd-n1', { annotations: { 'kubernetes.io/config.mirror': 'abc' }, ownerReferences: [] }),
];
const FAST = { pollMs: 1, timeoutMs: 200 };

beforeEach(() => {
  calls.length = 0;
  routes = [
    (url, init) => (init.method === 'PATCH' && url.endsWith('/api/v1/nodes/n1') ? json({}) : undefined),
    (url, init) => (init.method === 'GET' && url.includes('/api/v1/pods?fieldSelector=') ? json({ kind: 'PodList', apiVersion: 'v1', items: NODE_PODS }) : undefined),
    (url, init) => (init.method === 'POST' && url.endsWith('/pods/web-1/eviction') ? json({ kind: 'Status', status: 'Success' }, 201) : undefined),
    (url, init) => (init.method === 'POST' && url.endsWith('/pods/db-0/eviction')
      ? json({ kind: 'Status', reason: 'TooManyRequests', message: 'Cannot evict pod as it would violate the pod\'s disruption budget.' }, 429)
      : undefined),
    (url, init) => (init.method === 'GET' && url.endsWith('/api/v1/namespaces/shop/pods/db-0') ? json(pod('db-0')) : undefined),
    (url, init) => (init.method === 'GET' && url.endsWith('/apis/policy/v1/namespaces/shop/poddisruptionbudgets')
      ? json({ kind: 'PodDisruptionBudgetList', apiVersion: 'policy/v1', items: [
          { metadata: { name: 'db-pdb' }, spec: { selector: { matchLabels: { app: 'db-0' } } } },
          { metadata: { name: 'other-pdb' }, spec: { selector: { matchLabels: { app: 'other' } } } },
        ] })
      : undefined),
  ];
  installFetch();
});

afterEach(() => vi.unstubAllGlobals());

describe('drainNode', () => {
  it('cordons, then evicts only movable pods through the Eviction API', async () => {
    const result = await drainNode('n1', 'local', FAST);

    expect(calls[0]).toEqual({ method: 'PATCH', url: '/api/kubernetes/api/v1/nodes/n1', body: { spec: { unschedulable: true } } });
    expect(calls[1].url).toBe('/api/kubernetes/api/v1/pods?fieldSelector=spec.nodeName%3Dn1');

    const evictions = calls.filter((c) => c.method === 'POST');
    expect(evictions.map((c) => c.url)).toEqual([
      '/api/kubernetes/api/v1/namespaces/shop/pods/web-1/eviction',
      '/api/kubernetes/api/v1/namespaces/shop/pods/db-0/eviction',
    ]);
    expect(evictions[0].body).toEqual({ apiVersion: 'policy/v1', kind: 'Eviction', metadata: { name: 'web-1', namespace: 'shop' } });

    expect(result.evicted).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.blocked).toBe(1);
    const blocked = result.pods.find((p) => p.name === 'db-0')!;
    expect(blocked.status).toBe('blocked');
    expect(blocked.pdbs).toEqual(['db-pdb']);
    expect(blocked.reason).toBe('Blocked by PodDisruptionBudget db-pdb');
  });

  it('reports an incomplete drain honestly', async () => {
    const result = await drainNode('n1', 'local', FAST);
    const toast = describeDrain(result);
    expect(toast.type).toBe('warning');
    expect(toast.title).toBe('Node "n1" cordoned; drain incomplete');
    expect(toast.detail).toContain('1 evicted');
    expect(toast.detail).toContain('1 blocked by a PodDisruptionBudget');
    expect(toast.title).not.toMatch(/started/i);
  });

  it('retrying only the blocked pods evicts just those', async () => {
    await drainNode('n1', 'local', { ...FAST, only: [{ namespace: 'shop', name: 'db-0' }] });
    const evictions = calls.filter((c) => c.method === 'POST').map((c) => c.url);
    expect(evictions).toEqual(['/api/kubernetes/api/v1/namespaces/shop/pods/db-0/eviction']);
    // The pod list is not re-read for a retry.
    expect(calls.some((c) => c.url.includes('fieldSelector'))).toBe(false);
  });

  it('does not evict anything when cordoning is forbidden', async () => {
    routes.unshift((url, init) => (init.method === 'PATCH' ? json({ kind: 'Status', reason: 'Forbidden', message: 'nodes "n1" is forbidden' }, 403) : undefined));
    await expect(drainNode('n1', 'local')).rejects.toThrow(/forbidden/);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('marks a pod whose eviction fails for another reason as failed', async () => {
    routes.unshift((url, init) => (init.method === 'POST' && url.endsWith('/pods/web-1/eviction') ? json({ message: 'boom' }, 500) : undefined));
    const result = await drainNode('n1', 'local', FAST);
    expect(result.pods.find((p) => p.name === 'web-1')?.status).toBe('failed');
    expect(describeDrain(result).type).toBe('warning');
  });

  it('says there was nothing to evict when only DaemonSet/mirror pods run', async () => {
    routes.unshift((url, init) => (init.method === 'GET' && url.includes('fieldSelector') ? json({ kind: 'PodList', apiVersion: 'v1', items: NODE_PODS.slice(2) }) : undefined));
    const result = await drainNode('n1', 'local', FAST);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(describeDrain(result).title).toBe('Node "n1" cordoned; nothing to evict');
  });

  it('leaves unmanaged and emptyDir pods unless opted in, naming why', async () => {
    const lone = pod('debug-shell', { ownerReferences: [] });
    const cache = pod('cache-0', {}, { volumes: [{ name: 'tmp', emptyDir: {} }] });
    routes.unshift((url, init) => (init.method === 'GET' && url.includes('fieldSelector') ? json({ kind: 'PodList', apiVersion: 'v1', items: [lone, cache] }) : undefined));
    const result = await drainNode('n1', 'local', FAST);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(result.pods.find((p) => p.name === 'debug-shell')).toMatchObject({ status: 'skipped', unmanaged: true, reason: expect.stringMatching(/Not managed by a controller/) });
    expect(result.pods.find((p) => p.name === 'cache-0')).toMatchObject({ status: 'skipped', emptyDir: true, reason: expect.stringMatching(/emptyDir/) });
  });

  it('evicts unmanaged and emptyDir pods with --force / --delete-emptydir-data', async () => {
    const lone = pod('debug-shell', { ownerReferences: [] });
    const cache = pod('cache-0', {}, { volumes: [{ name: 'tmp', emptyDir: {} }] });
    routes.unshift((url, init) => (init.method === 'GET' && url.includes('fieldSelector') ? json({ kind: 'PodList', apiVersion: 'v1', items: [lone, cache] }) : undefined));
    routes.unshift((url, init) => (init.method === 'POST' && url.endsWith('/eviction') ? json({ kind: 'Status', status: 'Success' }, 201) : undefined));
    const result = await drainNode('n1', 'local', { ...FAST, force: true, deleteEmptyDirData: true });
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
      '/api/kubernetes/api/v1/namespaces/shop/pods/debug-shell/eviction',
      '/api/kubernetes/api/v1/namespaces/shop/pods/cache-0/eviction',
    ]);
    expect(result.evicted).toBe(2);
  });

  it('does not report "drained" while evicted pods still exist', async () => {
    routes.unshift((url, init) => (init.method === 'GET' && url.endsWith('/api/v1/namespaces/shop/pods/web-1') ? json(pod('web-1', { deletionTimestamp: 'now' })) : undefined));
    routes.unshift((url, init) => (init.method === 'GET' && url.includes('fieldSelector') ? json({ kind: 'PodList', apiVersion: 'v1', items: [pod('web-1')] }) : undefined));
    const result = await drainNode('n1', 'local', { pollMs: 5, timeoutMs: 40 });
    expect(result.terminating).toBe(1);
    expect(result.evicted).toBe(0);
    const toast = describeDrain(result);
    expect(toast.title).toBe('Node "n1" cordoned; evictions accepted, 1 pod still terminating');
    expect(toast.title).not.toMatch(/drained/);
  });

  it('counts a pod as gone once its name belongs to a new pod', async () => {
    routes.unshift((url, init) => (init.method === 'GET' && url.endsWith('/api/v1/namespaces/shop/pods/web-1') ? json(pod('web-1', { uid: 'uid-new' })) : undefined));
    routes.unshift((url, init) => (init.method === 'GET' && url.includes('fieldSelector') ? json({ kind: 'PodList', apiVersion: 'v1', items: [pod('web-1')] }) : undefined));
    const result = await drainNode('n1', 'local', FAST);
    expect(result.evicted).toBe(1);
    expect(describeDrain(result).title).toBe('Node "n1" drained');
  });

  it('stops waiting when cancelled', async () => {
    routes.unshift((url, init) => (init.method === 'GET' && url.endsWith('/api/v1/namespaces/shop/pods/web-1') ? json(pod('web-1')) : undefined));
    routes.unshift((url, init) => (init.method === 'GET' && url.includes('fieldSelector') ? json({ kind: 'PodList', apiVersion: 'v1', items: [pod('web-1')] }) : undefined));
    const signal = { cancelled: false };
    setTimeout(() => { signal.cancelled = true; }, 20);
    const started = Date.now();
    const result = await drainNode('n1', 'local', { pollMs: 5, timeoutMs: 60_000, signal });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.terminating).toBe(1);
  });
});
