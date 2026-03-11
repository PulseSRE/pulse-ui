import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { Label } from '@patternfly/react-core';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface Secret {
  name: string;
  namespace: string;
  type: string;
  dataKeys: number;
  age: string;
}

interface RawSecret extends K8sMeta {
  type: string;
  data?: Record<string, string>;
}

const typeColors: Record<string, 'purple' | 'teal' | 'orange' | 'blue' | 'grey'> = {
  'kubernetes.io/tls': 'purple',
  'kubernetes.io/dockerconfigjson': 'teal',
  'kubernetes.io/ssh-auth': 'orange',
  'kubernetes.io/service-account-token': 'blue',
  Opaque: 'grey',
};

const columns: ColumnDef<Secret>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Type', key: 'type', render: (s) => <Label color={typeColors[s.type] ?? 'grey'}>{s.type}</Label> },
  { title: 'Data Keys', key: 'dataKeys' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (s) => <ResourceActions name={s.name} namespace={s.namespace} apiBase="/api/v1" resourceType="secrets" kind="Secret" detailPath={`/workloads/secrets/${s.namespace}/${s.name}`} />, sortable: false },
];

export default function Secrets() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawSecret, Secret>(
    '/api/v1/secrets',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      type: item.type,
      dataKeys: Object.keys(item.data ?? {}).length,
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Secrets"
      description="Manage secrets and sensitive configuration data"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(s) => `${s.namespace}-${s.name}`}
      createLabel="Create Secret"
      nameField="name"
      onRowClick={(item) => navigate(`/workloads/secrets/${item.namespace}/${item.name}`)}
    />
  );
}
