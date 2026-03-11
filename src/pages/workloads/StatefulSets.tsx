import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { Label } from '@patternfly/react-core';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface StatefulSet {
  name: string;
  namespace: string;
  replicas: number;
  ready: number;
  age: string;
}

interface RawStatefulSet extends K8sMeta {
  spec: { replicas: number };
  status: { readyReplicas?: number };
}

const columns: ColumnDef<StatefulSet>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Replicas', key: 'replicas', render: (s) => `${s.ready}/${s.replicas}` },
  { title: 'Ready', key: 'ready', render: (s) => (
    <Label color={s.ready === s.replicas ? 'green' : s.ready > 0 ? 'orange' : 'red'}>
      {s.ready === s.replicas ? 'Ready' : `${s.ready}/${s.replicas}`}
    </Label>
  )},
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (s) => <ActionsCell item={s} />, sortable: false },
];

function ActionsCell({ item }: { item: StatefulSet }) {
  return <ResourceActions name={item.name} namespace={item.namespace} apiBase="/apis/apps/v1" resourceType="statefulsets" kind="StatefulSet" detailPath={`/workloads/statefulsets/${item.namespace}/${item.name}`} />;
}

export default function StatefulSets() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawStatefulSet, StatefulSet>(
    '/apis/apps/v1/statefulsets',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      replicas: item.spec.replicas ?? 0,
      ready: item.status.readyReplicas ?? 0,
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="StatefulSets"
      description="Manage stateful applications with persistent identity"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(s) => `${s.namespace}-${s.name}`}
      createLabel="Create StatefulSet"
      nameField="name"
      onRowClick={(item) => navigate(`/workloads/statefulsets/${item.namespace}/${item.name}`)}
    />
  );
}
