/**
 * Cluster Connection Manager — resolves cluster IDs to API base URLs.
 * Replaces the hardcoded K8S_BASE constant for multi-cluster support.
 *
 * Connection types:
 * - 'local': The cluster Pulse is deployed on (default, backward compatible)
 * - 'acm-proxy': Routed through ACM/MCE managed cluster proxy
 * - 'direct-proxy': Direct connection via separate oc proxy instance
 */

export interface ClusterConnection {
  id: string;
  name: string;
  environment?: string; // dev, staging, prod, DR, edge
  connectionType: 'local' | 'acm-proxy' | 'direct-proxy';
  apiBase: string; // resolved base URL for K8s API calls
  status: 'connected' | 'unreachable' | 'auth-expired' | 'unknown';
  lastHealthCheck: number;
  location?: {
    region: string;       // e.g. "us-east-1", "eu-west-1"
    latitude: number;
    longitude: number;
    displayName?: string; // e.g. "N. Virginia", "Ireland"
  };
  metadata?: {
    version?: string;
    platform?: string;
    controlPlaneTopology?: string;
    nodeCount?: number;
  };
}

export interface ClusterConnectionConfig {
  id: string;
  name: string;
  environment?: string;
  connectionType: 'acm-proxy' | 'direct-proxy';
  /** For acm-proxy: the managed cluster name. For direct-proxy: the proxy URL (e.g., http://localhost:8002) */
  target: string;
}

/** The local cluster's base URL — always available */
const LOCAL_BASE = '/api/kubernetes';

/** ACM proxy path pattern */
const ACM_PROXY_PATTERN = '/api/kubernetes/apis/cluster.open-cluster-management.io/v1/managedclusters';

/** Registry of all cluster connections */
let connections = new Map<string, ClusterConnection>();
let activeClusterId: string = 'local';

/** Initialize with the local cluster */
connections.set('local', {
  id: 'local',
  name: 'Local Cluster',
  connectionType: 'local',
  apiBase: LOCAL_BASE,
  status: 'connected',
  lastHealthCheck: Date.now(),
});

/**
 * Get the K8s API base URL for a cluster.
 * If no clusterId provided, returns the active cluster's base.
 * This replaces all usage of the old K8S_BASE constant.
 */
export function getClusterBase(clusterId?: string): string {
  const id = clusterId || activeClusterId;
  const conn = connections.get(id);
  if (!conn) return LOCAL_BASE; // fallback to local
  return conn.apiBase;
}

/** Get the active cluster ID */
export function getActiveClusterId(): string {
  return activeClusterId;
}

/** Set the active cluster */
export function setActiveClusterId(id: string): void {
  if (connections.has(id)) {
    activeClusterId = id;
  }
}

/** Get all registered cluster connections */
export function getAllConnections(): ClusterConnection[] {
  return Array.from(connections.values());
}

/** Get a specific connection */
export function getConnection(id: string): ClusterConnection | undefined {
  return connections.get(id);
}

/** Register a new cluster connection */
export function registerCluster(config: ClusterConnectionConfig): ClusterConnection {
  let apiBase: string;

  if (config.connectionType === 'acm-proxy') {
    apiBase = `${ACM_PROXY_PATTERN}/${encodeURIComponent(config.target)}/proxy`;
  } else {
    // direct-proxy: target is the proxy URL, rewrite to go through our nginx
    apiBase = `/api/kubernetes/cluster/${encodeURIComponent(config.id)}`;
  }

  const conn: ClusterConnection = {
    id: config.id,
    name: config.name,
    environment: config.environment,
    connectionType: config.connectionType,
    apiBase,
    status: 'unknown',
    lastHealthCheck: 0,
  };

  connections.set(config.id, conn);
  return conn;
}

/** Remove a cluster connection */
export function unregisterCluster(id: string): void {
  if (id === 'local') return; // can't remove local
  connections.delete(id);
  if (activeClusterId === id) {
    activeClusterId = 'local';
  }
}

/** Update connection status */
export function updateConnectionStatus(id: string, status: ClusterConnection['status'], metadata?: ClusterConnection['metadata']): void {
  const conn = connections.get(id);
  if (conn) {
    conn.status = status;
    conn.lastHealthCheck = Date.now();
    if (metadata) conn.metadata = { ...conn.metadata, ...metadata };
  }
}

/** Update connection location (region/coordinates) */
export function updateConnectionLocation(id: string, location: ClusterConnection['location']): void {
  const conn = connections.get(id);
  if (conn) {
    conn.location = location;
  }
}

/** Check if multi-cluster mode is active (more than just local) */
export function isMultiCluster(): boolean {
  return connections.size > 1;
}

/** Reset to single-cluster (for testing) */
export function resetConnections(): void {
  connections = new Map();
  connections.set('local', {
    id: 'local',
    name: 'Local Cluster',
    connectionType: 'local',
    apiBase: LOCAL_BASE,
    status: 'connected',
    lastHealthCheck: Date.now(),
  });
  activeClusterId = 'local';
}
