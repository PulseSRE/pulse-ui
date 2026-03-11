import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface InstalledOperator {
  name: string;
  namespace: string;
  version: string;
  status: string;
  provider: string;
  age: string;
}

interface RawCSV extends K8sMeta {
  spec: {
    version?: string;
    provider?: { name: string };
  };
  status?: {
    phase?: string;
  };
}

const columns: ColumnDef<InstalledOperator>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Version', key: 'version' },
  { title: 'Status', key: 'status' },
  { title: 'Provider', key: 'provider' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (op) => <ResourceActions name={op.name} namespace={op.namespace} apiBase="/apis/operators.coreos.com/v1alpha1" resourceType="clusterserviceversions" kind="Operator" detailPath={`/operators/installed/${op.namespace}/${op.name}`} />, sortable: false },
];

export default function InstalledOperators() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawCSV, InstalledOperator>(
    '/apis/operators.coreos.com/v1alpha1/clusterserviceversions',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      version: item.spec.version ?? '-',
      status: item.status?.phase ?? 'Unknown',
      provider: item.spec.provider?.name ?? '-',
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Installed Operators"
      description="View and manage installed cluster operators"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(op) => `${op.namespace}-${op.name}`}
      statusField="status"
      nameField="name"
      onRowClick={(item) => navigate(`/operators/installed/${item.namespace}/${item.name}`)}
    />
  );
}
