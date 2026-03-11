import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface ConfigMap {
  name: string;
  namespace: string;
  dataKeys: number;
  age: string;
}

interface RawConfigMap extends K8sMeta {
  data?: Record<string, string>;
}

const columns: ColumnDef<ConfigMap>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Data Keys', key: 'dataKeys' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (c) => <ResourceActions name={c.name} namespace={c.namespace} apiBase="/api/v1" resourceType="configmaps" kind="ConfigMap" detailPath={`/workloads/configmaps/${c.namespace}/${c.name}`} />, sortable: false },
];

export default function ConfigMaps() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawConfigMap, ConfigMap>(
    '/api/v1/configmaps',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      dataKeys: Object.keys(item.data ?? {}).length,
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="ConfigMaps"
      description="Manage configuration data for your applications"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(c) => `${c.namespace}-${c.name}`}
      createLabel="Create ConfigMap"
      nameField="name"
      onRowClick={(item) => navigate(`/workloads/configmaps/${item.namespace}/${item.name}`)}
    />
  );
}
