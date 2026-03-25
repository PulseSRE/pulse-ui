/**
 * Integration test: Delete flow
 *
 * Tests the full list → delete → verify gone lifecycle using MSW
 * to mock the K8s API at the network level.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { buildApiPathFromResource } from '../hooks/useResourceUrl';

// Mock gvr.ts to use absolute URL so MSW can intercept
vi.mock('../engine/gvr', () => ({
  K8S_BASE: 'http://localhost:9000/api/kubernetes',
  gvrToUrl: (gvrKey: string) => gvrKey.replace(/\//g, '~'),
  urlToGvr: (gvrUrl: string) => gvrUrl.replace(/~/g, '/'),
  resourceDetailUrl: () => '/r/test',
}));

// Mock clusterConnection to return the same absolute URL for multi-cluster support
vi.mock('../engine/clusterConnection', () => ({
  getClusterBase: () => 'http://localhost:9000/api/kubernetes',
}));

// Import AFTER mock
const { k8sList, k8sDelete, k8sCreate } = await import('../engine/query');

// --- In-memory K8s store ---
let deployments: any[];
let pods: any[];
let configmaps: any[];
let nodes: any[];

function resetStore() {
  deployments = [
    { metadata: { name: 'nginx', namespace: 'default', uid: 'd1' }, spec: { replicas: 2 } },
    { metadata: { name: 'api', namespace: 'default', uid: 'd2' }, spec: { replicas: 1 } },
  ];
  pods = [
    { metadata: { name: 'nginx-abc-123', namespace: 'default', uid: 'p1' }, status: { phase: 'Running' } },
    { metadata: { name: 'api-def-456', namespace: 'default', uid: 'p2' }, status: { phase: 'Running' } },
  ];
  configmaps = [
    { metadata: { name: 'app-config', namespace: 'default', uid: 'cm1' }, data: { key: 'val' } },
  ];
  nodes = [
    { metadata: { name: 'worker-1', uid: 'n1' } },
  ];
}

// --- MSW handlers ---
const server = setupServer(
  // Deployments
  http.get('http://localhost:9000/api/kubernetes/apis/apps/v1/deployments', () =>
    HttpResponse.json({ apiVersion: 'apps/v1', kind: 'DeploymentList', metadata: {}, items: deployments })),
  http.get('http://localhost:9000/api/kubernetes/apis/apps/v1/namespaces/*/deployments', () =>
    HttpResponse.json({ apiVersion: 'apps/v1', kind: 'DeploymentList', metadata: {}, items: deployments })),
  http.patch('http://localhost:9000/api/kubernetes/apis/apps/v1/namespaces/*/deployments/*', () =>
    HttpResponse.json({ status: 'ok' })),
  http.delete('http://localhost:9000/api/kubernetes/apis/apps/v1/namespaces/*/deployments/:name', ({ params }) => {
    const idx = deployments.findIndex(d => d.metadata.name === params.name);
    if (idx === -1) return HttpResponse.json({ kind: 'Status', message: 'not found', code: 404 }, { status: 404 });
    deployments.splice(idx, 1);
    return HttpResponse.json({ kind: 'Status', status: 'Success' });
  }),

  // Pods
  http.get('http://localhost:9000/api/kubernetes/api/v1/pods', () =>
    HttpResponse.json({ apiVersion: 'v1', kind: 'PodList', metadata: {}, items: pods })),
  http.delete('http://localhost:9000/api/kubernetes/api/v1/namespaces/*/pods/:name', ({ params }) => {
    const idx = pods.findIndex(p => p.metadata.name === params.name);
    if (idx === -1) return HttpResponse.json({ kind: 'Status', code: 404 }, { status: 404 });
    pods.splice(idx, 1);
    return HttpResponse.json({ kind: 'Status', status: 'Success' });
  }),

  // ConfigMaps
  http.get('http://localhost:9000/api/kubernetes/api/v1/configmaps', () =>
    HttpResponse.json({ apiVersion: 'v1', kind: 'ConfigMapList', metadata: {}, items: configmaps })),
  http.delete('http://localhost:9000/api/kubernetes/api/v1/namespaces/*/configmaps/:name', ({ params }) => {
    const idx = configmaps.findIndex(c => c.metadata.name === params.name);
    if (idx === -1) return HttpResponse.json({ kind: 'Status', code: 404 }, { status: 404 });
    configmaps.splice(idx, 1);
    return HttpResponse.json({ kind: 'Status', status: 'Success' });
  }),

  // Nodes (cluster-scoped)
  http.get('http://localhost:9000/api/kubernetes/api/v1/nodes', () =>
    HttpResponse.json({ apiVersion: 'v1', kind: 'NodeList', metadata: {}, items: nodes })),
  http.delete('http://localhost:9000/api/kubernetes/api/v1/nodes/:name', ({ params }) => {
    const idx = nodes.findIndex(n => n.metadata.name === params.name);
    if (idx === -1) return HttpResponse.json({ kind: 'Status', code: 404 }, { status: 404 });
    nodes.splice(idx, 1);
    return HttpResponse.json({ kind: 'Status', status: 'Success' });
  }),

  // Forbidden endpoint for error testing
  http.patch('http://localhost:9000/api/kubernetes/apis/apps/v1/namespaces/*/deployments/protected', () =>
    HttpResponse.json({ status: 'ok' })),
  http.delete('http://localhost:9000/api/kubernetes/apis/apps/v1/namespaces/*/deployments/protected', () =>
    HttpResponse.json({ kind: 'Status', message: 'forbidden: cannot delete', code: 403 }, { status: 403 })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
beforeEach(() => resetStore());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// --- Tests ---

describe('Integration: k8sList stamps apiVersion/kind', () => {
  it('deployments get apiVersion:"apps/v1" and kind:"Deployment"', async () => {
    const items = await k8sList<any>('/apis/apps/v1/deployments');
    expect(items).toHaveLength(2);
    expect(items[0].apiVersion).toBe('apps/v1');
    expect(items[0].kind).toBe('Deployment');
  });

  it('pods get apiVersion:"v1" and kind:"Pod"', async () => {
    const items = await k8sList<any>('/api/v1/pods');
    expect(items[0].apiVersion).toBe('v1');
    expect(items[0].kind).toBe('Pod');
  });

  it('configmaps get apiVersion:"v1" and kind:"ConfigMap"', async () => {
    const items = await k8sList<any>('/api/v1/configmaps');
    expect(items[0].kind).toBe('ConfigMap');
  });

  it('nodes get apiVersion:"v1" and kind:"Node"', async () => {
    const items = await k8sList<any>('/api/v1/nodes');
    expect(items[0].kind).toBe('Node');
  });
});

describe('Integration: buildApiPathFromResource on listed items', () => {
  it('deployment → correct namespaced path', async () => {
    const items = await k8sList<any>('/apis/apps/v1/deployments');
    expect(buildApiPathFromResource(items[0])).toBe('/apis/apps/v1/namespaces/default/deployments/nginx');
  });

  it('pod → correct namespaced path', async () => {
    const items = await k8sList<any>('/api/v1/pods');
    expect(buildApiPathFromResource(items[0])).toBe('/api/v1/namespaces/default/pods/nginx-abc-123');
  });

  it('node → correct cluster-scoped path (no namespace)', async () => {
    const items = await k8sList<any>('/api/v1/nodes');
    const path = buildApiPathFromResource(items[0]);
    expect(path).toBe('/api/v1/nodes/worker-1');
    expect(path).not.toContain('namespaces');
  });
});

describe('Integration: list → delete → verify gone', () => {
  it('deployment: list has 2 → delete nginx → list has 1', async () => {
    let items = await k8sList<any>('/apis/apps/v1/deployments');
    expect(items).toHaveLength(2);

    const target = items.find((i: any) => i.metadata.name === 'nginx');
    await k8sDelete(buildApiPathFromResource(target));

    items = await k8sList<any>('/apis/apps/v1/deployments');
    expect(items).toHaveLength(1);
    expect(items[0].metadata.name).toBe('api');
  });

  it('pod: delete removes from list', async () => {
    let items = await k8sList<any>('/api/v1/pods');
    expect(items).toHaveLength(2);

    await k8sDelete(buildApiPathFromResource(items[0]));

    items = await k8sList<any>('/api/v1/pods');
    expect(items).toHaveLength(1);
  });

  it('configmap: delete removes from list', async () => {
    let items = await k8sList<any>('/api/v1/configmaps');
    expect(items).toHaveLength(1);

    await k8sDelete(buildApiPathFromResource(items[0]));

    items = await k8sList<any>('/api/v1/configmaps');
    expect(items).toHaveLength(0);
  });

  it('node: cluster-scoped delete works', async () => {
    let items = await k8sList<any>('/api/v1/nodes');
    expect(items).toHaveLength(1);

    await k8sDelete(buildApiPathFromResource(items[0]));

    items = await k8sList<any>('/api/v1/nodes');
    expect(items).toHaveLength(0);
  });
});

describe('Integration: bulk delete', () => {
  it('deletes all deployments', async () => {
    const items = await k8sList<any>('/apis/apps/v1/deployments');
    for (const item of items) {
      await k8sDelete(buildApiPathFromResource(item));
    }
    const remaining = await k8sList<any>('/apis/apps/v1/deployments');
    expect(remaining).toHaveLength(0);
  });
});

describe('Integration: error handling', () => {
  it('404 on already-deleted resource does not throw', async () => {
    await expect(k8sDelete('/apis/apps/v1/namespaces/default/deployments/nonexistent')).resolves.toBeUndefined();
  });

  it('403 forbidden throws with message', async () => {
    server.use(
      http.patch('http://localhost:9000/api/kubernetes/apis/apps/v1/namespaces/*/deployments/forbidden-deploy', () =>
        HttpResponse.json({ status: 'ok' })),
      http.delete('http://localhost:9000/api/kubernetes/apis/apps/v1/namespaces/*/deployments/forbidden-deploy', () =>
        HttpResponse.json({ kind: 'Status', message: 'forbidden: cannot delete', code: 403 }, { status: 403 })),
    );
    await expect(k8sDelete('/apis/apps/v1/namespaces/default/deployments/forbidden-deploy')).rejects.toThrow('forbidden');
  });
});
