import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useClusterStore } from '../clusterStore';

// Mock the discovery module
vi.mock('../../engine/discovery', () => {
  return {
    discoverResources: vi.fn(),
    groupResources: vi.fn(() => []),
  };
});

import { discoverResources, groupResources } from '../../engine/discovery';

const mockDiscover = discoverResources as ReturnType<typeof vi.fn>;
const mockGroup = groupResources as ReturnType<typeof vi.fn>;

function resetStore() {
  useClusterStore.setState({
    resourceRegistry: null,
    apiGroups: [],
    discoveryLoading: false,
    discoveryError: null,
    clusterVersion: null,
    kubernetesVersion: null,
    platform: null,
  });
}

beforeEach(() => {
  mockDiscover.mockReset();
  mockGroup.mockReset().mockReturnValue([]);
  resetStore();
});

describe('clusterStore', () => {
  describe('initial state', () => {
    it('starts with null registry', () => {
      expect(useClusterStore.getState().resourceRegistry).toBeNull();
    });

    it('starts with empty apiGroups', () => {
      expect(useClusterStore.getState().apiGroups).toEqual([]);
    });

    it('starts not loading', () => {
      expect(useClusterStore.getState().discoveryLoading).toBe(false);
    });
  });

  describe('runDiscovery', () => {
    it('sets loading state during discovery', async () => {
      const registry = new Map();
      mockDiscover.mockResolvedValueOnce(registry);

      const promise = useClusterStore.getState().runDiscovery();
      expect(useClusterStore.getState().discoveryLoading).toBe(true);

      await promise;
      expect(useClusterStore.getState().discoveryLoading).toBe(false);
    });

    it('populates registry from discovery engine', async () => {
      const registry = new Map();
      registry.set('core/v1/pods', {
        group: '', version: 'v1', kind: 'Pod', plural: 'pods',
        singularName: 'pod', namespaced: true, verbs: ['get', 'list'],
        shortNames: [], categories: [],
      });
      registry.set('core/v1/nodes', {
        group: '', version: 'v1', kind: 'Node', plural: 'nodes',
        singularName: 'node', namespaced: false, verbs: ['get', 'list'],
        shortNames: [], categories: [],
      });
      mockDiscover.mockResolvedValueOnce(registry);

      await useClusterStore.getState().runDiscovery();

      const result = useClusterStore.getState().resourceRegistry;
      expect(result).not.toBeNull();
      expect(result!.has('core/v1/pods')).toBe(true);
      expect(result!.has('core/v1/nodes')).toBe(true);
      expect(result!.get('core/v1/pods')?.kind).toBe('Pod');
    });

    it('populates registry from API groups', async () => {
      const registry = new Map();
      registry.set('apps/v1/deployments', {
        group: 'apps', version: 'v1', kind: 'Deployment', plural: 'deployments',
        singularName: 'deployment', namespaced: true, verbs: ['get', 'list', 'create'],
        shortNames: ['deploy'], categories: [],
      });
      mockDiscover.mockResolvedValueOnce(registry);

      await useClusterStore.getState().runDiscovery();

      const result = useClusterStore.getState().resourceRegistry;
      expect(result!.has('apps/v1/deployments')).toBe(true);
      expect(result!.get('apps/v1/deployments')?.kind).toBe('Deployment');
    });

    it('sets error on failure', async () => {
      mockDiscover.mockRejectedValueOnce(new Error('Network error'));

      await useClusterStore.getState().runDiscovery();

      expect(useClusterStore.getState().discoveryError).toBeTruthy();
      expect(useClusterStore.getState().discoveryLoading).toBe(false);
    });
  });

  describe('setClusterInfo', () => {
    it('sets cluster version', () => {
      useClusterStore.getState().setClusterInfo({ version: '4.17' });
      expect(useClusterStore.getState().clusterVersion).toBe('4.17');
    });

    it('sets kubernetes version', () => {
      useClusterStore.getState().setClusterInfo({ kubernetesVersion: '1.30' });
      expect(useClusterStore.getState().kubernetesVersion).toBe('1.30');
    });

    it('sets platform', () => {
      useClusterStore.getState().setClusterInfo({ platform: 'AWS' });
      expect(useClusterStore.getState().platform).toBe('AWS');
    });

    it('preserves existing values when partial update', () => {
      useClusterStore.getState().setClusterInfo({ version: '4.17', platform: 'AWS' });
      useClusterStore.getState().setClusterInfo({ kubernetesVersion: '1.30' });

      const state = useClusterStore.getState();
      expect(state.clusterVersion).toBe('4.17');
      expect(state.kubernetesVersion).toBe('1.30');
      expect(state.platform).toBe('AWS');
    });
  });
});
