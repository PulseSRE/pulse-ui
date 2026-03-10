/**
 * Kubernetes API client
 *
 * Connects to a real cluster via kubectl proxy (http://localhost:8001)
 * proxied through rspack dev server at /api/kubernetes
 *
 * Usage: run `kubectl proxy --port=8001` before starting the dev server
 */

const BASE = '/api/kubernetes';

interface K8sListResponse<T> {
  kind: string;
  items: T[];
  metadata: { resourceVersion?: string };
}

interface K8sResource {
  metadata: {
    name: string;
    namespace?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    uid?: string;
  };
}

async function k8sFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`K8s API error: ${res.status} ${res.statusText} for ${path}`);
  }
  return res.json() as Promise<T>;
}

function ageFromTimestamp(ts: string | undefined): string {
  if (!ts) return '-';
  const diff = Date.now() - new Date(ts).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

// === Pod ===
interface K8sPod extends K8sResource {
  status: { phase: string; containerStatuses?: { restartCount: number }[] };
  spec: { nodeName?: string; containers: { name: string; image: string }[] };
}

export async function fetchPods(namespace?: string) {
  const path = namespace && namespace !== 'all'
    ? `/api/v1/namespaces/${namespace}/pods`
    : '/api/v1/pods';
  const data = await k8sFetch<K8sListResponse<K8sPod>>(path);
  return data.items.map((p) => ({
    name: p.metadata.name,
    namespace: p.metadata.namespace ?? '',
    status: (p.status.phase ?? 'Unknown') as 'Running' | 'Pending' | 'Failed',
    restarts: p.status.containerStatuses?.reduce((sum, c) => sum + c.restartCount, 0) ?? 0,
  }));
}

// === Node ===
interface K8sNode extends K8sResource {
  status: {
    conditions: { type: string; status: string }[];
    allocatable: { cpu: string; memory: string; pods: string };
    capacity: { cpu: string; memory: string; pods: string };
    nodeInfo: { kubeletVersion: string; osImage: string; containerRuntimeVersion: string };
  };
  metadata: K8sResource['metadata'] & { labels: Record<string, string> };
}

interface K8sNodeMetrics {
  metadata: { name: string };
  usage: { cpu: string; memory: string };
}

function parseCpuToMillicores(cpu: string): number {
  if (cpu.endsWith('n')) return parseInt(cpu) / 1_000_000;
  if (cpu.endsWith('u')) return parseInt(cpu) / 1_000;
  if (cpu.endsWith('m')) return parseInt(cpu);
  return parseInt(cpu) * 1000;
}

function parseMemoryToMi(mem: string): number {
  if (mem.endsWith('Ki')) return parseInt(mem) / 1024;
  if (mem.endsWith('Mi')) return parseInt(mem);
  if (mem.endsWith('Gi')) return parseInt(mem) * 1024;
  if (mem.endsWith('Ti')) return parseInt(mem) * 1024 * 1024;
  return parseInt(mem) / (1024 * 1024);
}

function parseAllocatableCpu(cpu: string): number {
  if (cpu.endsWith('m')) return parseInt(cpu);
  return parseInt(cpu) * 1000;
}

function parseAllocatableMemory(mem: string): number {
  if (mem.endsWith('Ki')) return parseInt(mem) / 1024;
  if (mem.endsWith('Mi')) return parseInt(mem);
  if (mem.endsWith('Gi')) return parseInt(mem) * 1024;
  return parseInt(mem) / (1024 * 1024);
}

export async function fetchNodes() {
  const data = await k8sFetch<K8sListResponse<K8sNode>>('/api/v1/nodes');

  // Try to fetch node metrics for CPU/memory usage
  let metricsMap = new Map<string, { cpu: number; memory: number }>();
  try {
    const metrics = await k8sFetch<K8sListResponse<K8sNodeMetrics>>('/apis/metrics.k8s.io/v1beta1/nodes');
    for (const m of metrics.items) {
      metricsMap.set(m.metadata.name, {
        cpu: parseCpuToMillicores(m.usage.cpu),
        memory: parseMemoryToMi(m.usage.memory),
      });
    }
  } catch {
    // metrics-server may not be available
  }

  return data.items.map((n) => {
    const ready = n.status.conditions.find((c) => c.type === 'Ready');
    const roles = Object.keys(n.metadata.labels ?? {})
      .filter((l) => l.startsWith('node-role.kubernetes.io/'))
      .map((l) => l.replace('node-role.kubernetes.io/', ''))
      .join(',') || 'worker';

    const usage = metricsMap.get(n.metadata.name);
    const allocCpu = parseAllocatableCpu(n.status.allocatable.cpu);
    const allocMem = parseAllocatableMemory(n.status.allocatable.memory);
    const cpuPercent = usage && allocCpu > 0 ? Math.round((usage.cpu / allocCpu) * 100) : 0;
    const memPercent = usage && allocMem > 0 ? Math.round((usage.memory / allocMem) * 100) : 0;

    return {
      name: n.metadata.name,
      status: (ready?.status === 'True' ? 'Ready' : 'NotReady') as 'Ready' | 'NotReady',
      cpu: cpuPercent,
      memory: memPercent,
      role: roles,
      version: n.status.nodeInfo.kubeletVersion,
    };
  });
}

// === Deployment ===
interface K8sDeployment extends K8sResource {
  spec: { replicas: number };
  status: { readyReplicas?: number; availableReplicas?: number; conditions?: { type: string; status: string }[] };
}

export async function fetchDeployments(namespace?: string) {
  const path = namespace && namespace !== 'all'
    ? `/apis/apps/v1/namespaces/${namespace}/deployments`
    : '/apis/apps/v1/deployments';
  const data = await k8sFetch<K8sListResponse<K8sDeployment>>(path);
  return data.items.map((d) => ({
    name: d.metadata.name,
    namespace: d.metadata.namespace ?? '',
    replicas: d.spec.replicas ?? 0,
    ready: d.status.readyReplicas ?? 0,
    status: (d.status.availableReplicas ?? 0) >= (d.spec.replicas ?? 0)
      ? 'Available' : 'Progressing' as 'Available' | 'Progressing' | 'Failed',
  }));
}

// === Service ===
interface K8sService extends K8sResource {
  spec: { type: string; clusterIP: string; ports?: { port: number; protocol: string }[] };
}

export async function fetchServices(namespace?: string) {
  const path = namespace && namespace !== 'all'
    ? `/api/v1/namespaces/${namespace}/services`
    : '/api/v1/services';
  const data = await k8sFetch<K8sListResponse<K8sService>>(path);
  return data.items.map((s) => ({
    name: s.metadata.name,
    namespace: s.metadata.namespace ?? '',
    type: s.spec.type as 'ClusterIP' | 'NodePort' | 'LoadBalancer',
    clusterIP: s.spec.clusterIP ?? '',
  }));
}

// === Namespace ===
interface K8sNamespace extends K8sResource {
  status: { phase: string };
}

export async function fetchNamespaces() {
  const data = await k8sFetch<K8sListResponse<K8sNamespace>>('/api/v1/namespaces');
  return data.items.map((n) => ({
    name: n.metadata.name,
    status: (n.status.phase ?? 'Active') as 'Active' | 'Terminating',
    podCount: 0,
    age: ageFromTimestamp(n.metadata.creationTimestamp),
  }));
}

// === Event ===
interface K8sEvent extends K8sResource {
  type: string;
  reason: string;
  message: string;
  lastTimestamp?: string;
  eventTime?: string;
  involvedObject?: { namespace?: string };
}

export async function fetchEvents(namespace?: string) {
  const path = namespace && namespace !== 'all'
    ? `/api/v1/namespaces/${namespace}/events?limit=50`
    : '/api/v1/events?limit=50';
  const data = await k8sFetch<K8sListResponse<K8sEvent>>(path);
  return data.items
    .sort((a, b) => {
      const ta = a.lastTimestamp ?? a.eventTime ?? a.metadata.creationTimestamp ?? '';
      const tb = b.lastTimestamp ?? b.eventTime ?? b.metadata.creationTimestamp ?? '';
      return new Date(tb).getTime() - new Date(ta).getTime();
    })
    .slice(0, 20)
    .map((e) => ({
      type: (e.type ?? 'Normal') as 'Warning' | 'Error' | 'Normal',
      reason: e.reason ?? '',
      message: e.message ?? '',
      timestamp: e.lastTimestamp ?? e.eventTime ?? e.metadata.creationTimestamp ?? new Date().toISOString(),
      namespace: e.involvedObject?.namespace ?? e.metadata.namespace ?? '',
    }));
}

// === PersistentVolume ===
interface K8sPV extends K8sResource {
  spec: { capacity: { storage: string }; storageClassName: string };
  status: { phase: string };
}

export async function fetchPersistentVolumes() {
  const data = await k8sFetch<K8sListResponse<K8sPV>>('/api/v1/persistentvolumes');
  return data.items.map((pv) => ({
    name: pv.metadata.name,
    capacity: pv.spec.capacity?.storage ?? '',
    status: (pv.status.phase ?? 'Available') as 'Bound' | 'Available' | 'Released',
    storageClass: pv.spec.storageClassName ?? '',
  }));
}

// === Check if cluster is reachable ===
export async function checkClusterConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/v1/namespaces/default`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export { ageFromTimestamp };
export type { K8sResource };
