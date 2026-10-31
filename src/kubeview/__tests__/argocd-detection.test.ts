import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useArgoCDStore } from '../store/argoCDStore';

// Mock the query module
vi.mock('../engine/query', () => ({
  k8sList: vi.fn(),
  getImpersonationHeaders: vi.fn(() => ({})),
}));

// Mock fetch for API group detection
const mockFetch = vi.fn();
global.fetch = mockFetch;

const { k8sList } = await import('../engine/query');
const mockK8sList = vi.mocked(k8sList);

function makeArgoApp(name: string, ns = 'openshift-gitops', syncStatus = 'Synced' as const, healthStatus = 'Healthy' as const) {
  return {
    apiVersion: 'argoproj.io/v1alpha1' as const,
    kind: 'Application' as const,
    metadata: { name, namespace: ns, uid: `app-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: {
      source: { repoURL: 'https://github.com/org/repo', path: `apps/${name}`, targetRevision: 'main' },
      destination: { server: 'https://kubernetes.default.svc', namespace: 'default' },
      project: 'default',
    },
    status: {
      sync: { status: syncStatus, revision: 'abc1234' },
      health: { status: healthStatus },
      resources: [
        { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'default', name: `${name}-deploy`, status: syncStatus },
        { group: '', version: 'v1', kind: 'Service', namespace: 'default', name: `${name}-svc`, status: syncStatus },
      ],
    },
  };
}

describe('ArgoCDStore', () => {
  beforeEach(() => {
    // Reset store state
    useArgoCDStore.setState({
      available: false,
      detecting: false,
      detectionError: null,
      namespace: null,
      applications: [],
      applicationsLoading: false,
      resourceCache: new Map(),
    });
    vi.clearAllMocks();
  });

  describe('detect', () => {
    it('sets available=true when argoproj.io API group exists and apps are found', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, clone: () => ({ json: () => Promise.resolve({ resources: [] }) }) }); // API group check
      mockK8sList.mockResolvedValueOnce([makeArgoApp('my-app')]); // openshift-gitops namespace
      mockK8sList.mockResolvedValue([]); // subsequent loadApplications

      await useArgoCDStore.getState().detect();

      expect(useArgoCDStore.getState().available).toBe(true);
      expect(useArgoCDStore.getState().namespace).toBe('openshift-gitops');
    });

    it('sets available=false when argoproj.io API group does not exist', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      await useArgoCDStore.getState().detect();

      expect(useArgoCDStore.getState().available).toBe(false);
      expect(useArgoCDStore.getState().namespace).toBeNull();
    });

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await useArgoCDStore.getState().detect();

      expect(useArgoCDStore.getState().available).toBe(false);
      expect(useArgoCDStore.getState().detectionError).toBe('Failed to detect ArgoCD');
    });

    it('falls back to argocd namespace when openshift-gitops fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, clone: () => ({ json: () => Promise.resolve({ resources: [] }) }) }); // API group exists
      mockK8sList
        .mockRejectedValueOnce(new Error('Not found')) // openshift-gitops fails
        .mockResolvedValueOnce([makeArgoApp('my-app', 'argocd')]) // argocd works
        .mockResolvedValue([]); // loadApplications

      await useArgoCDStore.getState().detect();

      expect(useArgoCDStore.getState().available).toBe(true);
      expect(useArgoCDStore.getState().namespace).toBe('argocd');
    });
  });

  describe('resourceCache', () => {
    it('builds lookup cache from application resources', async () => {
      const app = makeArgoApp('frontend');
      useArgoCDStore.setState({
        available: true,
        namespace: 'openshift-gitops',
      });

      // Simulate loadApplications
      mockK8sList.mockResolvedValueOnce([app]);
      await useArgoCDStore.getState().loadApplications();

      const cache = useArgoCDStore.getState().resourceCache;
      expect(cache.size).toBe(2);

      const deployInfo = cache.get('Deployment/default/frontend-deploy');
      expect(deployInfo).toBeDefined();
      expect(deployInfo?.appName).toBe('frontend');
      expect(deployInfo?.syncStatus).toBe('Synced');
      expect(deployInfo?.revision).toBe('abc1234');
      expect(deployInfo?.repoURL).toBe('https://github.com/org/repo');
    });

    it('lookupResource returns undefined for unmanaged resources', () => {
      useArgoCDStore.setState({ available: true, resourceCache: new Map() });

      const result = useArgoCDStore.getState().lookupResource('Deployment', 'default', 'not-managed');
      expect(result).toBeUndefined();
    });

    it('lookupResource finds managed resources', () => {
      const cache = new Map();
      cache.set('Deployment/default/my-deploy', {
        appName: 'my-app',
        appNamespace: 'openshift-gitops',
        syncStatus: 'OutOfSync',
        revision: 'def5678',
      });
      useArgoCDStore.setState({ available: true, resourceCache: cache });

      const result = useArgoCDStore.getState().lookupResource('Deployment', 'default', 'my-deploy');
      expect(result).toBeDefined();
      expect(result?.syncStatus).toBe('OutOfSync');
      expect(result?.appName).toBe('my-app');
    });

    it('handles resources without namespace', () => {
      const cache = new Map();
      cache.set('ClusterRole/_/admin', {
        appName: 'rbac-app',
        appNamespace: 'openshift-gitops',
        syncStatus: 'Synced',
      });
      useArgoCDStore.setState({ available: true, resourceCache: cache });

      const result = useArgoCDStore.getState().lookupResource('ClusterRole', undefined, 'admin');
      expect(result?.appName).toBe('rbac-app');
    });
  });

  describe('loadApplications', () => {
    it('loads apps from the detected namespace', async () => {
      useArgoCDStore.setState({ available: true, namespace: 'openshift-gitops' });
      const apps = [makeArgoApp('app1'), makeArgoApp('app2', 'openshift-gitops', 'OutOfSync', 'Degraded')];
      mockK8sList.mockResolvedValueOnce(apps);

      await useArgoCDStore.getState().loadApplications();

      expect(useArgoCDStore.getState().applications).toHaveLength(2);
      expect(useArgoCDStore.getState().resourceCache.size).toBe(4); // 2 resources per app
    });

    it('handles load failure gracefully', async () => {
      useArgoCDStore.setState({ available: true, namespace: 'openshift-gitops' });
      mockK8sList.mockRejectedValueOnce(new Error('Forbidden'));

      await useArgoCDStore.getState().loadApplications();

      expect(useArgoCDStore.getState().applications).toHaveLength(0);
      expect(useArgoCDStore.getState().applicationsLoading).toBe(false);
      // The failure is kept, so the page can say so instead of "No Applications".
      expect(useArgoCDStore.getState().applicationsError).toBe('Forbidden');
    });

    it('clears the error after a successful reload', async () => {
      useArgoCDStore.setState({ available: true, namespace: 'openshift-gitops', applicationsError: 'Forbidden' });
      mockK8sList.mockResolvedValueOnce([makeArgoApp('app1')]);
      await useArgoCDStore.getState().loadApplications();
      expect(useArgoCDStore.getState().applicationsError).toBeNull();
    });
  });

  describe('rollouts', () => {
    it('loads rollouts after detection finds the rollouts resource', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, clone: () => ({ json: () => Promise.resolve({ resources: [{ name: 'applications' }, { name: 'rollouts' }] }) }) });
      const rollout = { metadata: { name: 'canary', namespace: 'web', uid: 'r1' } };
      mockK8sList.mockImplementation(async (path: string) => (path.includes('rollouts') ? [rollout] : []) as never);

      await useArgoCDStore.getState().detect();
      await vi.waitFor(() => expect(useArgoCDStore.getState().rollouts).toHaveLength(1));
      expect(mockK8sList).toHaveBeenCalledWith('/apis/argoproj.io/v1alpha1/rollouts', undefined, expect.anything());
      expect(useArgoCDStore.getState().rolloutsAvailable).toBe(true);
    });

    it('keeps a rollouts read failure as an error', async () => {
      mockK8sList.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { statusCode: 403 }));
      await useArgoCDStore.getState().loadRollouts();
      expect(useArgoCDStore.getState().rolloutsError).toBe('Permission denied (403)');
    });
  });
});
