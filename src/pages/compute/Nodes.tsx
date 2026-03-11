import { useNavigate } from 'react-router-dom';
import { Label } from '@patternfly/react-core';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface RawNode extends K8sMeta {
  status?: {
    conditions?: { type: string; status: string }[];
    nodeInfo?: { kubeletVersion?: string; osImage?: string; containerRuntimeVersion?: string };
    addresses?: { type: string; address: string }[];
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
  };
}

interface NodeRow {
  name: string;
  status: string;
  roles: string;
  version: string;
  internalIP: string;
  os: string;
  cpu: string;
  memory: string;
  age: string;
}

const columns: ColumnDef<NodeRow>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Status', key: 'status' },
  {
    title: 'Roles', key: 'roles', render: (n) => (
      <>{n.roles.split(', ').map((r) => <Label key={r} color="blue" className="pf-v5-u-mr-xs">{r}</Label>)}</>
    ), sortable: false,
  },
  { title: 'Version', key: 'version' },
  { title: 'Internal IP', key: 'internalIP' },
  { title: 'CPU', key: 'cpu' },
  { title: 'Memory', key: 'memory' },
  { title: 'Age', key: 'age' },
];

export default function Nodes() {
  const navigate = useNavigate();

  const { data, loading } = useK8sResource<RawNode, NodeRow>(
    '/api/v1/nodes',
    (item) => {
      const conditions = item.status?.conditions ?? [];
      const readyCond = conditions.find((c) => c.type === 'Ready');
      const status = readyCond?.status === 'True' ? 'Ready' : 'NotReady';
      const labels = item.metadata.labels ?? {};
      const roles = Object.keys(labels)
        .filter((l) => l.startsWith('node-role.kubernetes.io/'))
        .map((l) => l.replace('node-role.kubernetes.io/', ''))
        .join(', ') || 'worker';
      const addresses = item.status?.addresses ?? [];
      const internalIP = addresses.find((a) => a.type === 'InternalIP')?.address ?? '-';
      const capacity = item.status?.capacity ?? {};
      const allocatable = item.status?.allocatable ?? {};
      return {
        name: item.metadata.name,
        status,
        roles,
        version: item.status?.nodeInfo?.kubeletVersion ?? '-',
        internalIP,
        os: item.status?.nodeInfo?.osImage ?? '-',
        cpu: `${allocatable['cpu'] ?? '-'} / ${capacity['cpu'] ?? '-'}`,
        memory: `${allocatable['memory'] ?? '-'} / ${capacity['memory'] ?? '-'}`,
        age: ageFromTimestamp(item.metadata.creationTimestamp),
      };
    },
    30000,
  );

  return (
    <ResourceListPage
      title="Nodes"
      description="View and manage cluster compute nodes"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(n) => n.name}
      onRowClick={(n) => navigate(`/compute/nodes/${n.name}`)}
      statusField="status"
      nameField="name"
    />
  );
}
