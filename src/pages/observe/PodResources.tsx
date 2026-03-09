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
    title: 'Has Limits',
    key: 'hasLimits',
    render: (p) => (
      <Label color={p.hasLimits ? 'green' : 'red'}>
        {p.hasLimits ? 'Yes' : 'No'}
      </Label>
    ),
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
