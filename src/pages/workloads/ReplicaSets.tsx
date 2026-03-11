import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface ReplicaSet {
  name: string;
  namespace: string;
  desired: number;
  current: number;
  ready: number;
  age: string;
}

interface RawReplicaSet extends K8sMeta {
  spec: { replicas?: number };
  status: { readyReplicas?: number; availableReplicas?: number };
}

const columns: ColumnDef<ReplicaSet>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Desired', key: 'desired' },
  { title: 'Current', key: 'current' },
  { title: 'Ready', key: 'ready' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (r) => <ResourceActions name={r.name} namespace={r.namespace} apiBase="/apis/apps/v1" resourceType="replicasets" kind="ReplicaSet" detailPath={`/workloads/replicasets/${r.namespace}/${r.name}`} />, sortable: false },
];

export default function ReplicaSets() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawReplicaSet, ReplicaSet>(
    '/apis/apps/v1/replicasets',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      desired: item.spec.replicas ?? 0,
      current: item.status.availableReplicas ?? 0,
      ready: item.status.readyReplicas ?? 0,
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="ReplicaSets"
      description="Manage replica sets that maintain a stable set of pod replicas"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(rs) => `${rs.namespace}-${rs.name}`}
      nameField="name"
      onRowClick={(item) => navigate(`/workloads/replicasets/${item.namespace}/${item.name}`)}
    />
  );
}
