import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, type K8sMeta } from '@/hooks/useK8sResource';
import '@/openshift-components.css';

interface NamespaceRow {
  namespace: string;
  podCount: number;
  totalCpuRequests: string;
  totalMemoryRequests: string;
  hasQuota: boolean;
  quotaCpuLimit: string;
  quotaMemoryLimit: string;
}

interface RawContainerResources {
  requests?: {
    cpu?: string;
    memory?: string;
  };
}

interface RawContainer {
  name: string;
  resources?: RawContainerResources;
}

interface RawPod extends K8sMeta {
  spec: {
    containers: RawContainer[];
  };
}

interface RawResourceQuota extends K8sMeta {
  spec?: {
    hard?: Record<string, string>;
  };
}

function parseCpuToMillicores(value: string): number {
  if (value.endsWith('m')) return parseFloat(value);
  return parseFloat(value) * 1000;
}

function parseMemoryToMi(value: string): number {
  if (value.endsWith('Gi')) return parseFloat(value) * 1024;
  if (value.endsWith('Mi')) return parseFloat(value);
  if (value.endsWith('Ki')) return parseFloat(value) / 1024;
  if (value.endsWith('G')) return parseFloat(value) * 953.674;
  if (value.endsWith('M')) return parseFloat(value) * 0.953674;
  if (value.endsWith('K')) return parseFloat(value) / 1048.576;
  // plain bytes
  return parseFloat(value) / (1024 * 1024);
}

function formatCpu(millicores: number): string {
  if (millicores === 0) return '0';
  if (millicores >= 1000) return `${(millicores / 1000).toFixed(1)} cores`;
  return `${Math.round(millicores)}m`;
}

function formatMemory(mi: number): string {
  if (mi === 0) return '0';
  if (mi >= 1024) return `${(mi / 1024).toFixed(1)} Gi`;
  return `${Math.round(mi)} Mi`;
}

const columns: ColumnDef<NamespaceRow>[] = [
  { title: 'Namespace', key: 'namespace' },
  { title: 'Pod Count', key: 'podCount' },
  { title: 'Total CPU Requests', key: 'totalCpuRequests' },
  { title: 'Total Memory Requests', key: 'totalMemoryRequests' },
  { title: 'Has Quota', key: 'hasQuota', render: (r) => (r.hasQuota ? 'Yes' : 'No') },
  { title: 'Quota CPU Limit', key: 'quotaCpuLimit' },
  { title: 'Quota Memory Limit', key: 'quotaMemoryLimit' },
];

export default function NamespaceConsumption() {
  const { data: pods, loading: podsLoading } = useK8sResource<RawPod, RawPod>(
    '/api/v1/pods',
    (item) => item,
  );

  const { data: quotas, loading: quotasLoading } = useK8sResource<RawResourceQuota, RawResourceQuota>(
    '/api/v1/resourcequotas',
    (item) => item,
  );

  const loading = podsLoading || quotasLoading;

  // Group pods by namespace and aggregate
  const nsMap = new Map<string, { podCount: number; cpuMillicores: number; memoryMi: number }>();

  for (const pod of pods) {
    const ns = pod.metadata.namespace ?? '';
    const entry = nsMap.get(ns) ?? { podCount: 0, cpuMillicores: 0, memoryMi: 0 };
    entry.podCount += 1;

    for (const container of pod.spec.containers) {
      const cpuReq = container.resources?.requests?.cpu;
      if (cpuReq) entry.cpuMillicores += parseCpuToMillicores(cpuReq);

      const memReq = container.resources?.requests?.memory;
      if (memReq) entry.memoryMi += parseMemoryToMi(memReq);
    }

    nsMap.set(ns, entry);
  }

  // Build quota map keyed by namespace
  const quotaMap = new Map<string, { cpuLimit: string; memoryLimit: string }>();
  for (const quota of quotas) {
    const ns = quota.metadata.namespace ?? '';
    const cpuLimit = quota.spec?.hard?.['limits.cpu'] ?? quota.spec?.hard?.['cpu'] ?? '-';
    const memoryLimit = quota.spec?.hard?.['limits.memory'] ?? quota.spec?.hard?.['memory'] ?? '-';
    // If multiple quotas exist per namespace, keep the first
    if (!quotaMap.has(ns)) {
      quotaMap.set(ns, { cpuLimit, memoryLimit });
    }
  }

  const data: NamespaceRow[] = Array.from(nsMap.entries()).map(([ns, entry]) => {
    const quota = quotaMap.get(ns);
    return {
      namespace: ns,
      podCount: entry.podCount,
      totalCpuRequests: formatCpu(entry.cpuMillicores),
      totalMemoryRequests: formatMemory(entry.memoryMi),
      hasQuota: quota !== undefined,
      quotaCpuLimit: quota?.cpuLimit ?? '-',
      quotaMemoryLimit: quota?.memoryLimit ?? '-',
    };
  });

  return (
    <ResourceListPage
      title="Namespace Consumption"
      description="Aggregate resource consumption grouped by namespace"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(r) => r.namespace}
      nameField="namespace"
    />
  );
}
