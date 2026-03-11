import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface Job {
  name: string;
  namespace: string;
  completions: string;
  duration: string;
  status: string;
  age: string;
}

interface RawJob extends K8sMeta {
  spec: { completions?: number };
  status: {
    succeeded?: number;
    active?: number;
    conditions?: { type: string }[];
  };
}

const columns: ColumnDef<Job>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Completions', key: 'completions' },
  { title: 'Duration', key: 'duration' },
  { title: 'Status', key: 'status' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (j) => <ResourceActions name={j.name} namespace={j.namespace} apiBase="/apis/batch/v1" resourceType="jobs" kind="Job" detailPath={`/workloads/jobs/${j.namespace}/${j.name}`} />, sortable: false },
];

function deriveJobStatus(item: RawJob): string {
  const condition = item.status.conditions?.[0]?.type;
  if (condition === 'Complete') return 'Complete';
  if (condition === 'Failed') return 'Failed';
  if ((item.status.active ?? 0) > 0) return 'Running';
  return condition ?? 'Pending';
}

export default function Jobs() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawJob, Job>(
    '/apis/batch/v1/jobs',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      completions: `${item.status.succeeded ?? 0}/${item.spec.completions ?? 0}`,
      duration: '-',
      status: deriveJobStatus(item),
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Jobs"
      description="View and manage batch job workloads"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(j) => `${j.namespace}-${j.name}`}
      createLabel="Create Job"
      statusField="status"
      nameField="name"
      onRowClick={(item) => navigate(`/workloads/jobs/${item.namespace}/${item.name}`)}
    />
  );
}
