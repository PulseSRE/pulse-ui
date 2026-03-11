import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { Label } from '@patternfly/react-core';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface CronJob {
  name: string;
  namespace: string;
  schedule: string;
  suspend: boolean;
  active: number;
  lastSchedule: string;
  age: string;
}

interface RawCronJob extends K8sMeta {
  spec: { schedule: string; suspend?: boolean };
  status: { active?: unknown[]; lastScheduleTime?: string };
}

const columns: ColumnDef<CronJob>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Schedule', key: 'schedule', render: (c) => <code>{c.schedule}</code> },
  { title: 'Suspend', key: 'suspend', render: (c) => (
    <Label color={c.suspend ? 'orange' : 'green'}>{c.suspend ? 'Yes' : 'No'}</Label>
  ), sortable: false },
  { title: 'Active', key: 'active' },
  { title: 'Last Schedule', key: 'lastSchedule' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (c) => <ResourceActions name={c.name} namespace={c.namespace} apiBase="/apis/batch/v1" resourceType="cronjobs" kind="CronJob" detailPath={`/workloads/cronjobs/${c.namespace}/${c.name}`} />, sortable: false },
];

export default function CronJobs() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawCronJob, CronJob>(
    '/apis/batch/v1/cronjobs',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      schedule: item.spec.schedule,
      suspend: item.spec.suspend ?? false,
      active: item.status.active?.length ?? 0,
      lastSchedule: ageFromTimestamp(item.status.lastScheduleTime),
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="CronJobs"
      description="Manage scheduled and recurring batch jobs"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(c) => `${c.namespace}-${c.name}`}
      createLabel="Create CronJob"
      nameField="name"
      onRowClick={(item) => navigate(`/workloads/cronjobs/${item.namespace}/${item.name}`)}
    />
  );
}
