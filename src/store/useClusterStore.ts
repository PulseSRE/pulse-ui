import { create } from 'zustand';
import * as k8s from '@/lib/k8s';

export interface Node {
  name: string;
  status: 'Ready' | 'NotReady';
  cpu: number;
  memory: number;
  role: string;
  version: string;
}

export interface Pod {
  name: string;
  namespace: string;
  status: 'Running' | 'Pending' | 'Failed';
  restarts: number;
}

export interface Deployment {
  name: string;
  namespace: string;
  replicas: number;
  ready: number;
  status: 'Available' | 'Progressing' | 'Failed';
}

export interface Service {
  name: string;
  namespace: string;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer';
  clusterIP: string;
}

export interface PersistentVolume {
  name: string;
  capacity: string;
  status: 'Bound' | 'Available' | 'Released';
  storageClass: string;
}

export interface Namespace {
  name: string;
  status: 'Active' | 'Terminating';
  podCount: number;
  age: string;
}

export interface Event {
  type: 'Warning' | 'Error' | 'Normal';
  reason: string;
  message: string;
  timestamp: string;
  namespace: string;
}

export interface ClusterInfo {
  version: string;
  kubernetesVersion: string;
  platform: string;
  region: string;
  consoleURL: string;
  apiURL: string;
  updateChannel: string;
}

export interface ResourceMetrics {
  timestamp: string;
  cpu: number;
  memory: number;
  pods: number;
}

export interface StorageInfo {
  totalCapacity: string;
  used: string;
  available: string;
  storageClasses: number;
}

interface ClusterStore {
  nodes: Node[];
  pods: Pod[];
  deployments: Deployment[];
  services: Service[];
  persistentVolumes: PersistentVolume[];
  namespaces: Namespace[];
  events: Event[];
  clusterInfo: ClusterInfo | null;
  metrics: ResourceMetrics[];
  storageInfo: StorageInfo | null;
  selectedNamespace: string;
  isLoading: boolean;
  error: string | null;
  pollingInterval: ReturnType<typeof setInterval> | null;
  setSelectedNamespace: (namespace: string) => void;
  fetchClusterData: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  // Admin actions
  deleteNamespace: (name: string) => Promise<void>;
}


export const useClusterStore = create<ClusterStore>((set, get) => ({
  nodes: [],
  pods: [],
  deployments: [],
  services: [],
  persistentVolumes: [],
  namespaces: [],
  events: [],
  clusterInfo: null,
  metrics: [],
  isLoading: false,
  error: null,
  storageInfo: null,
  selectedNamespace: 'all',
  pollingInterval: null,

  setSelectedNamespace: (namespace) => set({ selectedNamespace: namespace }),

  fetchClusterData: async () => {
    set({ isLoading: true, error: null });

    // Try real cluster first
    const connected = await k8s.checkClusterConnection();
    if (connected) {
      try {
        const [nodes, pods, deployments, services, namespaces, events, pvs, clusterInfo] = await Promise.all([
          k8s.fetchNodes(),
          k8s.fetchPods(),
          k8s.fetchDeployments(),
          k8s.fetchServices(),
          k8s.fetchNamespaces(),
          k8s.fetchEvents(),
          k8s.fetchPersistentVolumes(),
          k8s.fetchClusterInfo(),
        ]);
        const avgCpu = nodes.length > 0 ? Math.round(nodes.reduce((s, n) => s + n.cpu, 0) / nodes.length) : 0;
        const avgMem = nodes.length > 0 ? Math.round(nodes.reduce((s, n) => s + n.memory, 0) / nodes.length) : 0;
        set({
          nodes, pods, deployments, services, namespaces, events,
          persistentVolumes: pvs,
          clusterInfo,
          metrics: [{ timestamp: new Date().toISOString(), cpu: avgCpu, memory: avgMem, pods: pods.length }],
          storageInfo: { totalCapacity: '-', used: '-', available: '-', storageClasses: 0 },
          isLoading: false,
        });
        return;
      } catch (err) {
        set({ error: `Cluster API error: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    // No cluster connection available
    set({
      isLoading: false,
      error: 'Cannot connect to cluster. Run: oc proxy --port=8001',
      nodes: [],
      pods: [],
      deployments: [],
      services: [],
      persistentVolumes: [],
      namespaces: [],
      events: [],
      clusterInfo: null,
      metrics: [],
      storageInfo: null,
    });
  },

  startPolling: () => {
    const existing = get().pollingInterval;
    if (existing) return;

    const interval = setInterval(async () => {
      // Re-fetch live data from cluster
      try {
        const [pods, events, nodes] = await Promise.all([
          k8s.fetchPods(),
          k8s.fetchEvents(),
          k8s.fetchNodes(),
        ]);
        const now = new Date();
        const avgCpu = nodes.length > 0 ? Math.round(nodes.reduce((s, n) => s + n.cpu, 0) / nodes.length) : 0;
        const avgMem = nodes.length > 0 ? Math.round(nodes.reduce((s, n) => s + n.memory, 0) / nodes.length) : 0;
        set((state) => {
          const newMetric: ResourceMetrics = {
            timestamp: now.toISOString(),
            cpu: avgCpu,
            memory: avgMem,
            pods: pods.length,
          };
          return {
            pods,
            events,
            nodes,
            metrics: [...state.metrics.slice(-11), newMetric],
          };
        });
      } catch {
        // Silently ignore polling errors
      }
    }, 10000);

    set({ pollingInterval: interval });
  },

  stopPolling: () => {
    const interval = get().pollingInterval;
    if (interval) {
      clearInterval(interval);
      set({ pollingInterval: null });
    }
  },

  deleteNamespace: async (name) => {
    try {
      await fetch(`/api/kubernetes/api/v1/namespaces/${name}`, { method: 'DELETE' });
    } catch { /* ignore */ }
    set((state) => ({
      namespaces: state.namespaces.filter((ns) => ns.name !== name),
    }));
  },

}));
