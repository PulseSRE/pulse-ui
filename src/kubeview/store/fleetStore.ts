/**
 * Fleet Store — manages multi-cluster state, ACM detection, and fleet health.
 * Progressive disclosure: inactive when only one cluster is connected.
 */

import { create } from 'zustand';
import { k8sList, k8sGet, getImpersonationHeaders } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import {
  type ClusterConnection,
  type ClusterConnectionConfig,
  registerCluster,
  unregisterCluster,
  getAllConnections,
  setActiveClusterId,
  getActiveClusterId,
  isMultiCluster,
  updateConnectionStatus,
  updateConnectionLocation,
  getClusterBase,
} from '../engine/clusterConnection';

interface ManagedCluster extends K8sResource {
  status?: {
    conditions?: Array<{ type: string; status: string; message?: string }>;
    capacity?: { cpu?: string; memory?: string };
    version?: { kubernetes?: string };
    clusterClaims?: Array<{ name: string; value: string }>;
  };
}

interface FleetState {
  // Fleet mode
  fleetMode: 'single' | 'multi';
  connectionMode: 'none' | 'acm' | 'multi-proxy';

  // ACM detection
  acmAvailable: boolean;
  acmDetecting: boolean;

  // Clusters
  clusters: ClusterConnection[];
  activeClusterId: string;

  // Health polling
  healthPolling: boolean;

  // Actions
  detectACM: () => Promise<void>;
  addCluster: (config: ClusterConnectionConfig) => Promise<void>;
  removeCluster: (id: string) => void;
  setActiveCluster: (id: string) => void;
  refreshClusters: () => void;
  refreshHealth: (clusterId: string) => Promise<void>;
  refreshAllHealth: () => Promise<void>;
  startHealthPolling: () => void;
  stopHealthPolling: () => void;
}

let healthInterval: ReturnType<typeof setInterval> | null = null;

export const useFleetStore = create<FleetState>((set, get) => ({
  fleetMode: 'single',
  connectionMode: 'none',
  acmAvailable: false,
  acmDetecting: false,
  clusters: getAllConnections(),
  activeClusterId: getActiveClusterId(),
  healthPolling: false,

  detectACM: async () => {
    set({ acmDetecting: true });
    try {
      // Check if ACM/MCE ManagedCluster CRD exists
      const res = await fetch(`${getClusterBase()}/apis/cluster.open-cluster-management.io/v1/managedclusters`, {
        headers: { ...getImpersonationHeaders(), Accept: 'application/json' },
      });

      if (!res.ok) {
        // Import addToast to show feedback
        const { useUIStore } = await import('./uiStore');
        const detail = res.status === 404
          ? 'ACM/MCE not installed on this cluster. Install Advanced Cluster Management to enable fleet management.'
          : res.status === 403
            ? 'Permission denied. You need cluster-admin or managedcluster read access.'
            : `Failed to detect ACM (${res.status} ${res.statusText})`;
        useUIStore.getState().addToast({ type: 'warning', title: 'ACM Detection', detail, duration: 8000 });
        set({ acmAvailable: false, acmDetecting: false });
        return;
      }

      const data = await res.json();
      const managedClusters = (data.items || []) as ManagedCluster[];

      // Register each managed cluster
      for (const mc of managedClusters) {
        const name = mc.metadata.name;
        if (name === 'local-cluster') continue; // skip the hub itself

        const readyCond = mc.status?.conditions?.find(c => c.type === 'ManagedClusterConditionAvailable');
        const env = mc.metadata.labels?.['environment'] || mc.metadata.labels?.['env'] || '';

        registerCluster({
          id: name,
          name,
          environment: env,
          connectionType: 'acm-proxy',
          target: name,
        });

        updateConnectionStatus(name, readyCond?.status === 'True' ? 'connected' : 'unreachable', {
          version: mc.status?.version?.kubernetes,
          nodeCount: Math.round(parseFloat(mc.status?.capacity?.cpu || '0')) || undefined,
        });
      }

      const allConns = getAllConnections();
      set({
        acmAvailable: true,
        acmDetecting: false,
        connectionMode: 'acm',
        fleetMode: allConns.length > 1 ? 'multi' : 'single',
        clusters: allConns,
      });

      // Start health polling if multi-cluster
      if (allConns.length > 1) {
        get().startHealthPolling();
      }
    } catch (e) {
      const { useUIStore } = await import('./uiStore');
      useUIStore.getState().addToast({
        type: 'error',
        title: 'ACM Detection Failed',
        detail: e instanceof Error ? e.message : 'Network error — is the cluster reachable?',
      });
      set({ acmAvailable: false, acmDetecting: false });
    }
  },

  addCluster: async (config) => {
    registerCluster(config);
    const allConns = getAllConnections();
    set({
      clusters: allConns,
      fleetMode: allConns.length > 1 ? 'multi' : 'single',
      connectionMode: get().connectionMode === 'none' ? 'multi-proxy' : get().connectionMode,
    });

    // Check health of new cluster
    await get().refreshHealth(config.id);
  },

  removeCluster: (id) => {
    unregisterCluster(id);
    const allConns = getAllConnections();
    set({
      clusters: allConns,
      activeClusterId: getActiveClusterId(),
      fleetMode: allConns.length > 1 ? 'multi' : 'single',
    });
  },

  setActiveCluster: (id) => {
    setActiveClusterId(id);
    set({ activeClusterId: id });
  },

  refreshClusters: () => {
    set({ clusters: getAllConnections(), activeClusterId: getActiveClusterId() });
  },

  refreshHealth: async (clusterId) => {
    try {
      const base = getClusterBase(clusterId);
      const res = await fetch(`${base}/api/v1/nodes?limit=1`, { headers: { Accept: 'application/json' } });

      if (res.ok) {
        const data = await res.json();
        const nodeCount = data.metadata?.remainingItemCount ? data.metadata.remainingItemCount + 1 : (data.items?.length || 0);
        updateConnectionStatus(clusterId, 'connected', { nodeCount });
      } else if (res.status === 401 || res.status === 403) {
        updateConnectionStatus(clusterId, 'auth-expired');
      } else {
        updateConnectionStatus(clusterId, 'unreachable');
      }
    } catch {
      updateConnectionStatus(clusterId, 'unreachable');
    }

    set({ clusters: getAllConnections() });
  },

  refreshAllHealth: async () => {
    const clusters = getAllConnections();
    await Promise.allSettled(clusters.map(c => get().refreshHealth(c.id)));
  },

  startHealthPolling: () => {
    if (healthInterval) return;
    healthInterval = setInterval(() => get().refreshAllHealth(), 60000);
    set({ healthPolling: true });
    get().refreshAllHealth(); // immediate first check
  },

  stopHealthPolling: () => {
    if (healthInterval) {
      clearInterval(healthInterval);
      healthInterval = null;
    }
    set({ healthPolling: false });
  },
}));
