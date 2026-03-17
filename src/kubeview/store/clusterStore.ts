import { create } from 'zustand';
import {
  discoverResources,
  groupResources as groupDiscoveryResources,
  type ResourceType,
  type APIGroup,
  type ResourceRegistry,
} from '../engine/discovery';

// Re-export for consumers that import from the store
export type { ResourceType, APIGroup };

interface ClusterState {
  // Discovery
  resourceRegistry: ResourceRegistry | null;
  apiGroups: APIGroup[];
  discoveryLoading: boolean;
  discoveryError: string | null;

  // Cluster info
  clusterVersion: string | null;
  kubernetesVersion: string | null;
  platform: string | null;

  // Actions
  runDiscovery: () => Promise<void>;
  setClusterInfo: (info: {
    version?: string;
    kubernetesVersion?: string;
    platform?: string;
  }) => void;
}

export const useClusterStore = create<ClusterState>((set, get) => ({
  // Discovery
  resourceRegistry: null,
  apiGroups: [],
  discoveryLoading: false,
  discoveryError: null,

  // Cluster info
  clusterVersion: null,
  kubernetesVersion: null,
  platform: null,

  // Actions
  runDiscovery: async () => {
    set({ discoveryLoading: true, discoveryError: null });
    try {
      const registry = await discoverResources();
      const groups = groupDiscoveryResources(registry);
      set({
        resourceRegistry: registry,
        apiGroups: groups,
        discoveryLoading: false,
      });
    } catch (error) {
      set({
        discoveryError: error instanceof Error ? error.message : 'Discovery failed',
        discoveryLoading: false,
      });
    }
  },

  setClusterInfo: (info) => {
    set({
      clusterVersion: info.version ?? get().clusterVersion,
      kubernetesVersion: info.kubernetesVersion ?? get().kubernetesVersion,
      platform: info.platform ?? get().platform,
    });
  },
}));
