// @vitest-environment jsdom
/**
 * Guards for one-click writes found acting on a stale or wrong picture:
 * views that wrote to the local cluster while a remote one was shown, a scale
 * computed from cached replicas, a "restart" that permanently deleted an
 * unmanaged pod, and a table delete that targeted the active cluster for rows
 * that did not come from it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scalePatch, describePodRestart } from '../writeGuards';
import { k8sFetch } from '../query';
import { registerCluster, resetConnections } from '../clusterConnection';
import { useUIStore } from '../../store/uiStore';
import { deleteTargetCluster } from '../../components/table/ResourceTable';
import type { K8sResource } from '../renderers';

const pod = (over: Partial<K8sResource['metadata']> = {}): K8sResource => ({
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: { name: 'web-1', namespace: 'shop', uid: 'u1', resourceVersion: '42', ...over },
});

describe('scalePatch', () => {
  it('applies only to the version the new count was computed from', () => {
    expect(scalePatch(pod(), 3)).toEqual({ metadata: { resourceVersion: '42' }, spec: { replicas: 3 } });
  });

  it('never asks for fewer than zero replicas', () => {
    expect(scalePatch(pod(), -1)).toEqual({ metadata: { resourceVersion: '42' }, spec: { replicas: 0 } });
  });
});

describe('describePodRestart', () => {
  it('names the controller that will replace a managed pod', () => {
    const plan = describePodRestart(pod({ ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'web-7d9', uid: 'r', controller: true }] }));
    expect(plan.replaced).toBe(true);
    expect(plan.description).toContain('ReplicaSet "web-7d9" will create a replacement');
    expect(plan.confirmLabel).toBe('Restart');
  });

  it('says plainly that an unmanaged pod will be gone for good', () => {
    const plan = describePodRestart(pod());
    expect(plan.replaced).toBe(false);
    expect(plan.variant).toBe('danger');
    expect(plan.description).toContain('nothing will recreate it');
    expect(plan.confirmLabel).toBe('Delete pod');
  });

  it('does not count a non-controller owner as a replacement', () => {
    const plan = describePodRestart(pod({ ownerReferences: [{ apiVersion: 'v1', kind: 'ConfigMap', name: 'x', uid: 'c' }] }));
    expect(plan.replaced).toBe(false);
  });
});

describe('k8sFetch', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
  beforeEach(() => {
    resetConnections();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
  });
  afterEach(() => {
    resetConnections();
    vi.unstubAllGlobals();
    useUIStore.setState({ impersonateUser: '', impersonateGroups: [] });
  });

  it('sends to the named cluster, not the local one', async () => {
    registerCluster({ id: 'prod', name: 'Prod', connectionType: 'acm-proxy', target: 'prod' });
    await k8sFetch('prod', '/api/v1/namespaces/shop/services', { method: 'POST' });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('/api/kubernetes/apis/cluster.open-cluster-management.io/v1/managedclusters/prod/proxy/api/v1/namespaces/shop/services');
  });

  it('carries impersonation, and keeps the caller\'s own headers', async () => {
    useUIStore.setState({ impersonateUser: 'alice', impersonateGroups: ['devs'] });
    await k8sFetch('local', '/apis/batch/v1/namespaces/x/jobs', { method: 'POST', headers: { 'Content-Type': 'application/yaml' } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ 'Impersonate-User': 'alice', 'Impersonate-Group': 'devs', 'Content-Type': 'application/yaml' });
  });

  it('refuses an unknown cluster instead of falling back to local', () => {
    expect(() => k8sFetch('gone', '/api/v1/pods')).toThrow('Unknown cluster: gone');
  });
});

describe('deleteTargetCluster (agent tables)', () => {
  it('a live row deletes in the active cluster, only if it is still the same object', () => {
    expect(deleteTargetCluster({ _resource: pod() }, 'prod')).toEqual({
      clusterId: 'prod',
      preconditions: { uid: 'u1', resourceVersion: '42' },
    });
  });

  it('a row the agent sent describes the local cluster', () => {
    expect(deleteTargetCluster({ name: 'web-1' }, 'local')).toEqual({ clusterId: 'local' });
  });

  it('refuses a row with no cluster while another cluster is active', () => {
    expect(deleteTargetCluster({ name: 'web-1' }, 'prod')).toHaveProperty('refusal');
  });
});
