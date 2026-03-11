import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface ServiceAccount {
  name: string;
  namespace: string;
  secrets: number;
  age: string;
}

interface RawServiceAccount extends K8sMeta {
  secrets?: unknown[];
}

const columns: ColumnDef<ServiceAccount>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Secrets', key: 'secrets' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (sa) => <ResourceActions name={sa.name} namespace={sa.namespace} apiBase="/api/v1" resourceType="serviceaccounts" kind="ServiceAccount" detailPath={`/administration/serviceaccounts/${sa.namespace}/${sa.name}`} />, sortable: false },
];

export default function ServiceAccounts() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawServiceAccount, ServiceAccount>(
    '/api/v1/serviceaccounts',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      secrets: item.secrets?.length ?? 0,
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Service Accounts"
      description="Manage service accounts for workload identity and API access"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(sa) => `${sa.namespace}-${sa.name}`}
      createLabel="Create Service Account"
      nameField="name"
      onRowClick={(item) => navigate(`/administration/serviceaccounts/${item.namespace}/${item.name}`)}
      filterFn={(sa, s) => {
        const q = s.toLowerCase();
        return sa.name.toLowerCase().includes(q) || sa.namespace.toLowerCase().includes(q);
      }}
    />
  );
}
