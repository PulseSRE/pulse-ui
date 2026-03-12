import { Label } from '@patternfly/react-core';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, type K8sMeta } from '@/hooks/useK8sResource';
import '@/openshift-components.css';

interface PodResource {
  name: string;
  namespace: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  hasLimits: boolean;
  flag: string;
}

interface RawContainerResources {
  requests?: {
    cpu?: string;
    memory?: string;
  };
  limits?: {
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

function parseCpuMillicores(v: string): number {
  if (v.endsWith('m')) return parseFloat(v);
  return parseFloat(v) * 1000;
}

function parseMemMi(v: string): number {
  if (v.endsWith('Gi')) return parseFloat(v) * 1024;
  if (v.endsWith('Mi')) return parseFloat(v);
  if (v.endsWith('Ki')) return parseFloat(v) / 1024;
  return parseFloat(v) / (1024 * 1024);
}

function getFlag(containers: RawContainer[]): string {
  const hasLimits = containers.every((c) => c.resources?.limits?.cpu && c.resources?.limits?.memory);
  if (!hasLimits) return 'Missing Limits';
  let totalCpu = 0, totalMem = 0;
  for (const c of containers) {
    if (c.resources?.requests?.cpu) totalCpu += parseCpuMillicores(c.resources.requests.cpu);
    if (c.resources?.requests?.memory) totalMem += parseMemMi(c.resources.requests.memory);
  }
  if (totalCpu > 2000 || totalMem > 4096) return 'High Request';
  return 'OK';
}

function aggregateField(containers: RawContainer[], section: 'requests' | 'limits', field: 'cpu' | 'memory'): string {
  const values = containers
    .map((c) => c.resources?.[section]?.[field])
    .filter((v): v is string => v !== undefined);
  if (values.length === 0) return '-';
  return values.join(' + ');
}

function hasAllLimits(containers: RawContainer[]): boolean {
  return containers.every(
    (c) => c.resources?.limits?.cpu !== undefined && c.resources?.limits?.memory !== undefined,
  );
}

const columns: ColumnDef<PodResource>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'CPU Request', key: 'cpuRequest' },
  { title: 'CPU Limit', key: 'cpuLimit' },
  { title: 'Memory Request', key: 'memoryRequest' },
  { title: 'Memory Limit', key: 'memoryLimit' },
  {
    title: 'Status',
    key: 'flag',
    render: (p) => (
      <Label color={p.flag === 'OK' ? 'green' : p.flag === 'High Request' ? 'orange' : 'red'}>
        {p.flag}
      </Label>
    ),
    sortable: false,
  },
];

export default function PodResources() {
  const { data, loading } = useK8sResource<RawPod, PodResource>(
    '/api/v1/pods',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      cpuRequest: aggregateField(item.spec.containers, 'requests', 'cpu'),
      cpuLimit: aggregateField(item.spec.containers, 'limits', 'cpu'),
      memoryRequest: aggregateField(item.spec.containers, 'requests', 'memory'),
      memoryLimit: aggregateField(item.spec.containers, 'limits', 'memory'),
      hasLimits: hasAllLimits(item.spec.containers),
      flag: getFlag(item.spec.containers),
    }),
  );

  return (
    <ResourceListPage
      title="Pod Resources"
      description="View pod resource requests and limits across all namespaces"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(p) => `${p.namespace}-${p.name}`}
      nameField="name"
      filterFn={(p, s) => {
        const term = s.toLowerCase();
        return p.name.toLowerCase().includes(term) || p.namespace.toLowerCase().includes(term);
      }}
    />
  );
}
