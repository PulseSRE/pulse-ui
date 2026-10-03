/**
 * CRUD lifecycle tests for core v1 and apps/v1 resources.
 * Verifies correct API paths, request bodies, and response handling
 * for create and delete operations from both list view and detail view.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { k8sList, k8sCreate, k8sDelete } from '../query';
import { buildApiPath, buildApiPathFromResource } from '../../hooks/useResourceUrl';
import { kindToPlural } from '../renderers/index';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockOk(data: unknown = {}) {
  return mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  });
}

function mockError(code: number, message: string) {
  return mockFetch.mockResolvedValueOnce({
    ok: false,
    status: code,
    json: () => Promise.resolve({ kind: 'Status', message, reason: 'Forbidden', code }),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

// All core v1 + key grouped resources
const CORE_RESOURCES = [
  { kind: 'Pod', gvr: 'v1/pods', namespaced: true },
  { kind: 'Service', gvr: 'v1/services', namespaced: true },
  { kind: 'ConfigMap', gvr: 'v1/configmaps', namespaced: true },
  { kind: 'Secret', gvr: 'v1/secrets', namespaced: true },
  { kind: 'PersistentVolumeClaim', gvr: 'v1/persistentvolumeclaims', namespaced: true },
  { kind: 'ServiceAccount', gvr: 'v1/serviceaccounts', namespaced: true },
  { kind: 'Namespace', gvr: 'v1/namespaces', namespaced: false },
  { kind: 'Node', gvr: 'v1/nodes', namespaced: false },
  { kind: 'PersistentVolume', gvr: 'v1/persistentvolumes', namespaced: false },
];

const GROUPED_RESOURCES = [
  { kind: 'Deployment', gvr: 'apps/v1/deployments', namespaced: true },
  { kind: 'StatefulSet', gvr: 'apps/v1/statefulsets', namespaced: true },
  { kind: 'DaemonSet', gvr: 'apps/v1/daemonsets', namespaced: true },
  { kind: 'ReplicaSet', gvr: 'apps/v1/replicasets', namespaced: true },
  { kind: 'Job', gvr: 'batch/v1/jobs', namespaced: true },
  { kind: 'CronJob', gvr: 'batch/v1/cronjobs', namespaced: true },
  { kind: 'Ingress', gvr: 'networking.k8s.io/v1/ingresses', namespaced: true },
  { kind: 'NetworkPolicy', gvr: 'networking.k8s.io/v1/networkpolicies', namespaced: true },
  { kind: 'ClusterRole', gvr: 'rbac.authorization.k8s.io/v1/clusterroles', namespaced: false },
  { kind: 'ClusterRoleBinding', gvr: 'rbac.authorization.k8s.io/v1/clusterrolebindings', namespaced: false },
  { kind: 'Role', gvr: 'rbac.authorization.k8s.io/v1/roles', namespaced: true },
  { kind: 'RoleBinding', gvr: 'rbac.authorization.k8s.io/v1/rolebindings', namespaced: true },
];

const ALL_RESOURCES = [...CORE_RESOURCES, ...GROUPED_RESOURCES];

describe('kindToPlural', () => {
  it.each([
    ['Pod', 'pods'],
    ['Service', 'services'],
    ['ConfigMap', 'configmaps'],
    ['Secret', 'secrets'],
    ['Namespace', 'namespaces'],
    ['Node', 'nodes'],
    ['Deployment', 'deployments'],
    ['StatefulSet', 'statefulsets'],
    ['DaemonSet', 'daemonsets'],
    ['ReplicaSet', 'replicasets'],
    ['Job', 'jobs'],
    ['CronJob', 'cronjobs'],
    ['Ingress', 'ingresses'],
    ['NetworkPolicy', 'networkpolicies'],
    ['PersistentVolumeClaim', 'persistentvolumeclaims'],
    ['PersistentVolume', 'persistentvolumes'],
    ['ServiceAccount', 'serviceaccounts'],
    ['ClusterRole', 'clusterroles'],
    ['ClusterRoleBinding', 'clusterrolebindings'],
    ['Role', 'roles'],
    ['RoleBinding', 'rolebindings'],
    ['Endpoints', 'endpoints'],
    ['StorageClass', 'storageclasses'],
  ])('pluralizes %s → %s', (kind, expected) => {
    expect(kindToPlural(kind)).toBe(expected);
  });
});

describe('buildApiPath', () => {
  describe('namespaced resources — list view', () => {
    it.each(
      ALL_RESOURCES.filter(r => r.namespaced).map(r => [r.kind, r.gvr])
    )('%s list path', (_kind, gvr) => {
      const path = buildApiPath(gvr, 'default');
      expect(path).toContain('/namespaces/default/');
      expect(path).not.toContain('undefined');
    });
  });

  describe('namespaced resources — detail view (with name)', () => {
    it.each(
      ALL_RESOURCES.filter(r => r.namespaced).map(r => [r.kind, r.gvr])
    )('%s detail path', (_kind, gvr) => {
      const path = buildApiPath(gvr, 'default', 'my-resource');
      expect(path).toContain('/namespaces/default/');
      expect(path).toMatch(/\/my-resource$/);
    });
  });

  describe('cluster-scoped resources — detail view via "_"', () => {
    it.each(
      ALL_RESOURCES.filter(r => !r.namespaced).map(r => [r.kind, r.gvr])
    )('%s detail path with "_" namespace', (_kind, gvr) => {
      const path = buildApiPath(gvr, '_', 'my-resource');
      // Should not have /namespaces/SOMETHING/ as a namespace segment
      // (Namespace resource legitimately has /namespaces/ as its resource plural)
      expect(path).not.toMatch(/\/namespaces\/[^/]+\/[^/]+\//);
      expect(path).toMatch(/\/my-resource$/);
    });
  });

  describe('cluster-scoped resources — no namespace', () => {
    it.each(
      ALL_RESOURCES.filter(r => !r.namespaced).map(r => [r.kind, r.gvr])
    )('%s list path without namespace', (_kind, gvr) => {
      const path = buildApiPath(gvr);
      expect(path).not.toMatch(/\/namespaces\/[^/]+\/[^/]+\//);
      expect(path).not.toContain('undefined');
    });
  });
});

describe('create resource (k8sCreate)', () => {
  describe('namespaced resources', () => {
    it.each(
      ALL_RESOURCES.filter(r => r.namespaced).map(r => [r.kind, r.gvr])
    )('creates %s via POST', async (_kind, gvr) => {
      const body = { apiVersion: 'v1', kind: _kind, metadata: { name: 'test' } };
      mockOk(body);

      const listPath = buildApiPath(gvr, 'default');
      await k8sCreate(listPath, body);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(listPath),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    });
  });

  describe('cluster-scoped resources', () => {
    it.each(
      ALL_RESOURCES.filter(r => !r.namespaced).map(r => [r.kind, r.gvr])
    )('creates %s via POST (no namespace segment)', async (_kind, gvr) => {
      const body = { apiVersion: 'v1', kind: _kind, metadata: { name: 'test' } };
      mockOk(body);

      const listPath = buildApiPath(gvr);
      await k8sCreate(listPath, body);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      // Should not have /namespaces/SOMETHING/ as a namespace segment
      expect(calledUrl).not.toMatch(/\/namespaces\/[^/]+\/[^/]+\//);
    });
  });

  it('returns error on 409 Conflict', async () => {
    mockError(409, 'already exists');
    const path = buildApiPath('v1/pods', 'default');
    await expect(k8sCreate(path, {})).rejects.toThrow('already exists');
  });

  it('returns error on 403 Forbidden', async () => {
    mockError(403, 'forbidden');
    const path = buildApiPath('apps/v1/deployments', 'default');
    await expect(k8sCreate(path, {})).rejects.toThrow('forbidden');
  });
});

describe('delete resource (k8sDelete)', () => {
  describe('delete from detail view — namespaced', () => {

    it.each(
      ALL_RESOURCES.filter(r => r.namespaced).map(r => [r.kind, r.gvr])
    )('deletes %s via DELETE with propagationPolicy', async (_kind, gvr) => {
      mockOk({ status: 'Success' });

      const detailPath = buildApiPath(gvr, 'default', 'my-resource');
      await k8sDelete(detailPath);

      // Find the DELETE call (last call for scalable, only call for others)
      const deleteCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const [url, opts] = deleteCall;
      expect(url).toContain(detailPath);
      expect(opts.method).toBe('DELETE');
      const body = JSON.parse(opts.body);
      expect(body.propagationPolicy).toBe('Background');
      expect(body.kind).toBe('DeleteOptions');
    });
  });

  describe('delete from detail view — cluster-scoped via "_"', () => {
    it.each(
      ALL_RESOURCES.filter(r => !r.namespaced).map(r => [r.kind, r.gvr])
    )('deletes %s without namespace segment', async (_kind, gvr) => {
      mockOk({ status: 'Success' });

      const detailPath = buildApiPath(gvr, '_', 'my-resource');
      await k8sDelete(detailPath);

      const [url] = mockFetch.mock.calls[0];
      // Should not have /namespaces/SOMETHING/ as a namespace segment
      expect(url).not.toMatch(/\/namespaces\/[^/]+\/[^/]+\//);
      expect(url).toContain('my-resource');
    });
  });

  describe('delete from list view (inline action)', () => {

    it.each(
      ALL_RESOURCES.filter(r => r.namespaced).map(r => {
        const parts = r.gvr.split('/');
        const apiVersion = parts.length === 3 ? `${parts[0]}/${parts[1]}` : parts[0];
        return [r.kind, apiVersion, r.gvr];
      })
    )('builds correct path for %s via apiVersion', async (kind, apiVersion, gvr) => {
      const plural = kindToPlural(kind as string);
      mockOk({ status: 'Success' });

      const [g, version] = (apiVersion as string).includes('/') ? (apiVersion as string).split('/') : ['', apiVersion];
      let basePath = g ? `/apis/${apiVersion}` : `/api/${version}`;
      basePath += `/namespaces/default`;
      const resourcePath = `${basePath}/${plural}/my-resource`;

      await k8sDelete(resourcePath);

      // Find the DELETE call
      const deleteCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(deleteCall[0]).toContain(`/${plural}/my-resource`);
      expect(deleteCall[0]).toContain('/namespaces/default/');
    });
  });

  it('does not throw on 404 (already deleted)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(k8sDelete('/api/v1/namespaces/default/pods/gone')).resolves.toBeUndefined();
  });

  it('throws on 403 Forbidden with message', async () => {
    mockError(403, 'pods "test" is forbidden: cannot delete');
    await expect(k8sDelete('/api/v1/namespaces/default/pods/test')).rejects.toThrow('cannot delete');
  });

  it('throws on 422 Unprocessable with message', async () => {
    mockError(422, 'resource has finalizers');
    await expect(k8sDelete('/api/v1/namespaces/test/pods/stuck')).rejects.toThrow('finalizers');
  });

  it('handles non-JSON error response (proxy 502)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.reject(new Error('not JSON')),
    });
    await expect(k8sDelete('/api/v1/pods/test')).rejects.toThrow('Bad Gateway');
  });
});

describe('end-to-end path correctness', () => {
  // These tests verify the full chain: GVR → buildApiPath → API call
  // to catch regressions in pluralization, namespace handling, and path construction.

  it('Deployment create + delete lifecycle', async () => {
    // Create
    mockOk({ metadata: { name: 'nginx', namespace: 'default', uid: '123' } });
    const createPath = buildApiPath('apps/v1/deployments', 'default');
    expect(createPath).toBe('/apis/apps/v1/namespaces/default/deployments');
    await k8sCreate(createPath, { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'nginx' } });
    expect(mockFetch.mock.calls[0][0]).toContain('/apis/apps/v1/namespaces/default/deployments');

    // Delete from detail view without mutating replicas
    mockOk({ status: 'Success' }); // DELETE
    const deletePath = buildApiPath('apps/v1/deployments', 'default', 'nginx');
    expect(deletePath).toBe('/apis/apps/v1/namespaces/default/deployments/nginx');
    await k8sDelete(deletePath);
    // Delete call
    expect(mockFetch.mock.calls[1][0]).toContain('/apis/apps/v1/namespaces/default/deployments/nginx');
    expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
  });

  it('Node delete via "_" namespace (cluster-scoped)', async () => {
    mockOk({ status: 'Success' });
    const path = buildApiPath('v1/nodes', '_', 'worker-1');
    expect(path).toBe('/api/v1/nodes/worker-1');
    await k8sDelete(path);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain('namespaces');
    expect(url).toContain('/nodes/worker-1');
  });

  it('ClusterRole delete via "_" namespace', async () => {
    mockOk({ status: 'Success' });
    const path = buildApiPath('rbac.authorization.k8s.io/v1/clusterroles', '_', 'admin');
    expect(path).toBe('/apis/rbac.authorization.k8s.io/v1/clusterroles/admin');
    await k8sDelete(path);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain('namespaces');
  });

  it('Ingress pluralization is correct (not "ingresss")', async () => {
    expect(kindToPlural('Ingress')).toBe('ingresses');
    mockOk({ status: 'Success' });
    const path = buildApiPath('networking.k8s.io/v1/ingresses', 'default', 'my-ingress');
    expect(path).toContain('/ingresses/my-ingress');
    await k8sDelete(path);
  });

  it('NetworkPolicy pluralization is correct', async () => {
    expect(kindToPlural('NetworkPolicy')).toBe('networkpolicies');
  });

  it('StorageClass pluralization is correct', async () => {
    expect(kindToPlural('StorageClass')).toBe('storageclasses');
  });
});

describe('list → delete lifecycle (simulates TableView flow)', () => {
  // This tests the EXACT flow: k8sList returns items, we use
  // buildApiPathFromResource to build the delete path, then k8sDelete.
  // This catches the bug where list items lack apiVersion/kind.

  it('Deployment: list → pick resource → delete', async () => {
    // 1. k8sList returns items with apiVersion/kind stamped from list
    mockOk({
      apiVersion: 'apps/v1', kind: 'DeploymentList', metadata: {},
      items: [{ metadata: { name: 'nginx', namespace: 'default', uid: '123' } }],
    });
    const resources = await k8sList<any>('/apis/apps/v1/deployments');
    expect(resources[0].apiVersion).toBe('apps/v1');
    expect(resources[0].kind).toBe('Deployment');

    // 2. Build delete path from the listed resource
    const resource = resources[0];
    const deletePath = buildApiPathFromResource(resource);
    expect(deletePath).toBe('/apis/apps/v1/namespaces/default/deployments/nginx');

    // 3. Delete
    mockOk({ status: 'Success' }); // DELETE
    await k8sDelete(deletePath);
    expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
  });

  it('Pod: list → pick resource → delete', async () => {
    mockOk({
      apiVersion: 'v1', kind: 'PodList', metadata: {},
      items: [{ metadata: { name: 'web-abc', namespace: 'prod', uid: '456' } }],
    });
    const resources = await k8sList<any>('/api/v1/pods');
    expect(resources[0].apiVersion).toBe('v1');
    expect(resources[0].kind).toBe('Pod');

    const deletePath = buildApiPathFromResource(resources[0]);
    expect(deletePath).toBe('/api/v1/namespaces/prod/pods/web-abc');

    mockOk({ status: 'Success' }); // no scale for pods
    await k8sDelete(deletePath);
  });

  it('ConfigMap: list → pick resource → delete', async () => {
    mockOk({
      apiVersion: 'v1', kind: 'ConfigMapList', metadata: {},
      items: [{ metadata: { name: 'my-config', namespace: 'default', uid: '789' } }],
    });
    const resources = await k8sList<any>('/api/v1/configmaps');
    expect(resources[0].apiVersion).toBe('v1');
    expect(resources[0].kind).toBe('ConfigMap');

    const deletePath = buildApiPathFromResource(resources[0]);
    expect(deletePath).toBe('/api/v1/namespaces/default/configmaps/my-config');

    mockOk({ status: 'Success' });
    await k8sDelete(deletePath);
  });

  it('Node: list → pick cluster-scoped → delete', async () => {
    mockOk({
      apiVersion: 'v1', kind: 'NodeList', metadata: {},
      items: [{ metadata: { name: 'worker-1', uid: 'n1' } }],
    });
    const resources = await k8sList<any>('/api/v1/nodes');
    expect(resources[0].apiVersion).toBe('v1');
    expect(resources[0].kind).toBe('Node');

    const deletePath = buildApiPathFromResource(resources[0]);
    expect(deletePath).toBe('/api/v1/nodes/worker-1');
    expect(deletePath).not.toContain('namespaces');

    mockOk({ status: 'Success' });
    await k8sDelete(deletePath);
  });

  it('Ingress: list → delete (pluralization)', async () => {
    mockOk({
      apiVersion: 'networking.k8s.io/v1', kind: 'IngressList', metadata: {},
      items: [{ metadata: { name: 'my-ing', namespace: 'default', uid: 'i1' } }],
    });
    const resources = await k8sList<any>('/apis/networking.k8s.io/v1/ingresses');
    expect(resources[0].kind).toBe('Ingress');

    const deletePath = buildApiPathFromResource(resources[0]);
    expect(deletePath).toContain('/ingresses/my-ing');
    expect(deletePath).not.toContain('ingresss');

    mockOk({ status: 'Success' });
    await k8sDelete(deletePath);
  });
});
