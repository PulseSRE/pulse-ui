/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RESOURCE_CATEGORIES,
  isUserNamespace,
  sanitizeResource,
  exportClusterToGit,
  type ExportEvent,
  type ExportOptions,
} from '../gitopsExport';
import type { K8sResource } from '../renderers/index';

// Mock query module
vi.mock('../query', () => ({
  k8sList: vi.fn().mockResolvedValue([]),
}));

// Mock gitProvider module
vi.mock('../gitProvider', () => ({
  createGitProvider: vi.fn(),
}));

import { k8sList } from '../query';
import { createGitProvider } from '../gitProvider';

const mockK8sList = vi.mocked(k8sList);
const mockCreateGitProvider = vi.mocked(createGitProvider);

describe('RESOURCE_CATEGORIES', () => {
  it('has 4 categories', () => {
    expect(RESOURCE_CATEGORIES).toHaveLength(4);
  });

  it('includes workloads, networking, config, and storage', () => {
    const ids = RESOURCE_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual(['workloads', 'networking', 'config', 'storage']);
  });

  it('each category has at least one resource', () => {
    for (const cat of RESOURCE_CATEGORIES) {
      expect(cat.resources.length).toBeGreaterThan(0);
      expect(cat.label).toBeTruthy();
      expect(cat.description).toBeTruthy();
    }
  });

  it('each resource has kind, apiPath, and namespaced flag', () => {
    for (const cat of RESOURCE_CATEGORIES) {
      for (const res of cat.resources) {
        expect(res.kind).toBeTruthy();
        expect(res.apiPath).toMatch(/^\//);
        expect(typeof res.namespaced).toBe('boolean');
      }
    }
  });

  it('workloads category has deployments, statefulsets, daemonsets, cronjobs', () => {
    const workloads = RESOURCE_CATEGORIES.find((c) => c.id === 'workloads')!;
    const kinds = workloads.resources.map((r) => r.kind);
    expect(kinds).toContain('Deployment');
    expect(kinds).toContain('StatefulSet');
    expect(kinds).toContain('DaemonSet');
    expect(kinds).toContain('CronJob');
  });

  it('storage category includes a non-namespaced resource (StorageClass)', () => {
    const storage = RESOURCE_CATEGORIES.find((c) => c.id === 'storage')!;
    const sc = storage.resources.find((r) => r.kind === 'StorageClass');
    expect(sc).toBeDefined();
    expect(sc!.namespaced).toBe(false);
  });
});

describe('isUserNamespace', () => {
  it('returns true for user namespaces', () => {
    expect(isUserNamespace('my-app')).toBe(true);
    expect(isUserNamespace('production')).toBe(true);
    expect(isUserNamespace('team-frontend')).toBe(true);
  });

  it('returns false for openshift- prefixed namespaces', () => {
    expect(isUserNamespace('openshift-operators')).toBe(false);
    expect(isUserNamespace('openshift-monitoring')).toBe(false);
    expect(isUserNamespace('openshift-console')).toBe(false);
  });

  it('returns false for kube- prefixed namespaces', () => {
    expect(isUserNamespace('kube-system')).toBe(false);
    expect(isUserNamespace('kube-public')).toBe(false);
    expect(isUserNamespace('kube-node-lease')).toBe(false);
  });

  it('returns false for default namespace', () => {
    expect(isUserNamespace('default')).toBe(false);
  });

  it('returns false for openshift namespace', () => {
    expect(isUserNamespace('openshift')).toBe(false);
  });

  it('returns true for namespaces starting with "kube" but not "kube-"', () => {
    expect(isUserNamespace('kubeedge')).toBe(true);
  });
});

describe('sanitizeResource', () => {
  const baseResource: K8sResource = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: 'my-app',
      namespace: 'production',
      uid: 'abc-123',
      resourceVersion: '12345',
      creationTimestamp: '2026-01-01T00:00:00Z',
      labels: { app: 'my-app' },
      annotations: {
        'app.kubernetes.io/name': 'my-app',
        'kubectl.kubernetes.io/last-applied-configuration': '{}',
        'deployment.kubernetes.io/revision': '3',
      },
      ownerReferences: [
        { apiVersion: 'v1', kind: 'ReplicaSet', name: 'my-app-abc', uid: 'ref-123' },
      ],
    },
    spec: { replicas: 2 },
    status: { readyReplicas: 2 },
  };

  it('strips uid, resourceVersion, creationTimestamp', () => {
    const clean = sanitizeResource(baseResource);
    expect(clean.metadata.uid).toBeUndefined();
    expect(clean.metadata.resourceVersion).toBeUndefined();
    expect(clean.metadata.creationTimestamp).toBeUndefined();
  });

  it('strips status', () => {
    const clean = sanitizeResource(baseResource);
    expect(clean.status).toBeUndefined();
  });

  it('strips ownerReferences', () => {
    const clean = sanitizeResource(baseResource);
    expect(clean.metadata.ownerReferences).toBeUndefined();
  });

  it('strips kubectl/deployment runtime annotations but keeps user annotations', () => {
    const clean = sanitizeResource(baseResource);
    expect(clean.metadata.annotations).toBeDefined();
    expect(clean.metadata.annotations!['app.kubernetes.io/name']).toBe('my-app');
    expect(clean.metadata.annotations!['kubectl.kubernetes.io/last-applied-configuration']).toBeUndefined();
    expect(clean.metadata.annotations!['deployment.kubernetes.io/revision']).toBeUndefined();
  });

  it('removes annotations key entirely when all annotations are stripped', () => {
    const resource: K8sResource = {
      ...baseResource,
      metadata: {
        ...baseResource.metadata,
        annotations: {
          'kubectl.kubernetes.io/last-applied-configuration': '{}',
        },
      },
    };
    const clean = sanitizeResource(resource);
    expect(clean.metadata.annotations).toBeUndefined();
  });

  it('preserves name, namespace, labels, and spec', () => {
    const clean = sanitizeResource(baseResource);
    expect(clean.metadata.name).toBe('my-app');
    expect(clean.metadata.namespace).toBe('production');
    expect(clean.metadata.labels).toEqual({ app: 'my-app' });
    expect(clean.spec).toEqual({ replicas: 2 });
  });

  it('does not mutate the original resource', () => {
    const original = structuredClone(baseResource);
    sanitizeResource(baseResource);
    expect(baseResource).toEqual(original);
  });
});

describe('exportClusterToGit', () => {
  const mockProvider = {
    createBranch: vi.fn().mockResolvedValue(undefined),
    getFileContent: vi.fn().mockResolvedValue(null),
    createOrUpdateFile: vi.fn().mockResolvedValue(undefined),
    createPullRequest: vi.fn().mockResolvedValue({ url: 'https://github.com/org/repo/pull/1', number: 1 }),
  };

  const baseOptions: ExportOptions = {
    config: {
      provider: 'github',
      repoUrl: 'https://github.com/org/repo',
      baseBranch: 'main',
      token: 'test-token',
    },
    clusterName: 'test-cluster',
    categoryIds: ['workloads'],
    namespaces: ['production'],
    exportMode: 'pr',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGitProvider.mockReturnValue(mockProvider as any);
    mockK8sList.mockResolvedValue([]);
  });

  async function collectEvents(options: ExportOptions): Promise<ExportEvent[]> {
    const events: ExportEvent[] = [];
    for await (const event of exportClusterToGit(options)) {
      events.push(event);
    }
    return events;
  }

  it('yields start event with correct category count', async () => {
    const events = await collectEvents(baseOptions);
    expect(events[0]).toEqual({ type: 'start', totalCategories: 1 });
  });

  it('yields category-start, category-fetched, category-committed for each category', async () => {
    const events = await collectEvents(baseOptions);
    const types = events.map((e) => e.type);
    expect(types).toContain('category-start');
    expect(types).toContain('category-fetched');
    expect(types).toContain('category-committed');
  });

  it('yields complete event at the end', async () => {
    const events = await collectEvents(baseOptions);
    const last = events[events.length - 1];
    expect(last.type).toBe('complete');
  });

  it('creates a branch in PR mode', async () => {
    await collectEvents(baseOptions);
    expect(mockProvider.createBranch).toHaveBeenCalledWith('main', expect.stringContaining('cluster-export/test-cluster/'));
  });

  it('does not create a branch in direct mode', async () => {
    await collectEvents({ ...baseOptions, exportMode: 'direct' });
    expect(mockProvider.createBranch).not.toHaveBeenCalled();
  });

  it('commits resources and creates a PR in PR mode', async () => {
    const deployment: K8sResource = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'web', namespace: 'production', uid: 'x', resourceVersion: '1', creationTimestamp: '2026-01-01T00:00:00Z' },
      spec: { replicas: 1 },
      status: { readyReplicas: 1 },
    };
    mockK8sList.mockResolvedValueOnce([deployment]);

    const events = await collectEvents(baseOptions);
    expect(mockProvider.createOrUpdateFile).toHaveBeenCalled();
    expect(mockProvider.createPullRequest).toHaveBeenCalled();

    const completeEvent = events.find((e) => e.type === 'complete');
    expect(completeEvent).toEqual({ type: 'complete', totalResources: 1 });
  });

  it('skips resources from system namespaces', async () => {
    const systemDeploy: K8sResource = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'operator', namespace: 'openshift-operators' },
    };
    const userDeploy: K8sResource = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'web', namespace: 'production' },
    };
    mockK8sList.mockResolvedValueOnce([systemDeploy, userDeploy]);

    await collectEvents(baseOptions);
    // Only the user deploy should be committed
    expect(mockProvider.createOrUpdateFile).toHaveBeenCalledTimes(1);
    expect(mockProvider.createOrUpdateFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('production'),
      expect.any(String),
      expect.any(String),
      undefined,
    );
  });

  it('yields error event if git provider creation fails', async () => {
    mockCreateGitProvider.mockImplementation(() => {
      throw new Error('Invalid repository URL');
    });

    const events = await collectEvents(baseOptions);
    expect(events).toContainEqual({ type: 'error', error: 'Invalid repository URL' });
  });

  it('yields error event if branch creation fails', async () => {
    mockProvider.createBranch.mockRejectedValueOnce(new Error('Branch exists'));

    const events = await collectEvents(baseOptions);
    expect(events).toContainEqual({
      type: 'error',
      error: 'Failed to create branch: Branch exists',
    });
  });
});
