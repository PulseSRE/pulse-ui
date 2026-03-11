import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import StatusIndicator from '@/components/StatusIndicator';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface ServiceItem {
  name: string;
  namespace: string;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
  clusterIP: string;
  externalIP: string;
  ports: string;
  age: string;
}

interface RawServicePort {
  port: number;
  nodePort?: number;
  protocol?: string;
}

interface RawService extends K8sMeta {
  spec: {
    type?: string;
    clusterIP?: string;
    ports?: RawServicePort[];
  };
}

const columns: ColumnDef<ServiceItem>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Type', key: 'type', render: (s) => <StatusIndicator status={s.type} /> },
  { title: 'Cluster IP', key: 'clusterIP', render: (s) => <code>{s.clusterIP}</code> },
  { title: 'External IP', key: 'externalIP' },
  { title: 'Ports', key: 'ports', render: (s) => <code>{s.ports}</code> },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (s) => <ResourceActions name={s.name} namespace={s.namespace} apiBase="/api/v1" resourceType="services" kind="Service" detailPath={`/networking/services/${s.namespace}/${s.name}`} />, sortable: false },
];

function formatPorts(ports: RawServicePort[] | undefined): string {
  if (!ports || ports.length === 0) return '<none>';
  return ports.map((p) => {
    const proto = p.protocol ?? 'TCP';
    return p.nodePort ? `${p.port}:${p.nodePort}/${proto}` : `${p.port}/${proto}`;
  }).join(', ');
}

export default function Services() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawService, ServiceItem>(
    '/api/v1/services',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      type: (item.spec.type ?? 'ClusterIP') as ServiceItem['type'],
      clusterIP: item.spec.clusterIP ?? '<none>',
      externalIP: '<none>',
      ports: formatPorts(item.spec.ports),
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Services"
      description="Manage service endpoints and load balancing"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(s) => `${s.namespace}-${s.name}`}
      createLabel="Create Service"
      nameField="name"
      onRowClick={(item) => navigate(`/networking/services/${item.namespace}/${item.name}`)}
    />
  );
}
