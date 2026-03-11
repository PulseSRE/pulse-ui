import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface PodDisruptionBudget {
  name: string;
  namespace: string;
  minAvailable: string;
  maxUnavailable: string;
  currentHealthy: number;
  desiredHealthy: number;
  expectedPods: number;
  age: string;
}

interface RawPDB extends K8sMeta {
  spec: {
    minAvailable?: number | string;
    maxUnavailable?: number | string;
  };
  status: {
    currentHealthy?: number;
    desiredHealthy?: number;
    expectedPods?: number;
  };
}

const columns: ColumnDef<PodDisruptionBudget>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Min Available', key: 'minAvailable' },
  { title: 'Max Unavailable', key: 'maxUnavailable' },
  { title: 'Current Healthy', key: 'currentHealthy' },
  { title: 'Desired Healthy', key: 'desiredHealthy' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (pdb) => <ResourceActions name={pdb.name} namespace={pdb.namespace} apiBase="/apis/policy/v1" resourceType="poddisruptionbudgets" kind="PodDisruptionBudget" detailPath={`/workloads/poddisruptionbudgets/${pdb.namespace}/${pdb.name}`} />, sortable: false },
];

export default function PodDisruptionBudgets() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawPDB, PodDisruptionBudget>(
    '/apis/policy/v1/poddisruptionbudgets',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      minAvailable: item.spec.minAvailable !== undefined ? String(item.spec.minAvailable) : '-',
      maxUnavailable: item.spec.maxUnavailable !== undefined ? String(item.spec.maxUnavailable) : '-',
      currentHealthy: item.status.currentHealthy ?? 0,
      desiredHealthy: item.status.desiredHealthy ?? 0,
      expectedPods: item.status.expectedPods ?? 0,
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Pod Disruption Budgets"
      description="Manage disruption budgets to limit voluntary disruptions to pods"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(pdb) => `${pdb.namespace}-${pdb.name}`}
      nameField="name"
      onRowClick={(item) => navigate(`/workloads/poddisruptionbudgets/${item.namespace}/${item.name}`)}
    />
  );
}
