import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import StatusIndicator from '@/components/StatusIndicator';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface DaemonSet {
  name: string;
  namespace: string;
  desired: number;
  current: number;
  ready: number;
  upToDate: number;
  available: number;
  age: string;
}

interface RawDaemonSet extends K8sMeta {
  status: {
    desiredNumberScheduled?: number;
    currentNumberScheduled?: number;
    numberReady?: number;
    updatedNumberScheduled?: number;
    numberAvailable?: number;
  };
}

const columns: ColumnDef<DaemonSet>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Status', key: 'status', render: (ds) => (
    <StatusIndicator status={ds.ready === ds.desired && ds.available === ds.desired ? 'Running' : ds.ready > 0 ? 'Pending' : 'Failed'} />
  ), sortable: false },
  { title: 'Desired', key: 'desired' },
  { title: 'Current', key: 'current' },
  { title: 'Ready', key: 'ready' },
  { title: 'Up-to-date', key: 'upToDate' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (ds) => <ResourceActions name={ds.name} namespace={ds.namespace} apiBase="/apis/apps/v1" resourceType="daemonsets" kind="DaemonSet" detailPath={`/workloads/daemonsets/${ds.namespace}/${ds.name}`} />, sortable: false },
];

export default function DaemonSets() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawDaemonSet, DaemonSet>(
    '/apis/apps/v1/daemonsets',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      desired: item.status.desiredNumberScheduled ?? 0,
      current: item.status.currentNumberScheduled ?? 0,
      ready: item.status.numberReady ?? 0,
      upToDate: item.status.updatedNumberScheduled ?? 0,
      available: item.status.numberAvailable ?? 0,
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="DaemonSets"
      description="Manage daemon set workloads running on every node"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(ds) => `${ds.namespace}-${ds.name}`}
      createLabel="Create DaemonSet"
      nameField="name"
      onRowClick={(item) => navigate(`/workloads/daemonsets/${item.namespace}/${item.name}`)}
    />
  );
}
