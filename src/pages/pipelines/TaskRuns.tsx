import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import StatusIndicator from '@/components/StatusIndicator';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface TaskRun {
  name: string;
  namespace: string;
  task: string;
  status: string;
  duration: string;
  age: string;
}

interface RawCondition {
  type: string;
  reason?: string;
}

interface RawTaskRun extends K8sMeta {
  spec: {
    taskRef?: {
      name: string;
    };
  };
  status?: {
    conditions?: RawCondition[];
    startTime?: string;
    completionTime?: string;
  };
}

function computeDuration(startTime: string | undefined, completionTime: string | undefined): string {
  if (!startTime || !completionTime) return '-';
  const start = new Date(startTime).getTime();
  const end = new Date(completionTime).getTime();
  const diffMs = end - start;
  if (diffMs < 0) return '-';
  const totalSeconds = Math.floor(diffMs / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function extractStatus(conditions: RawCondition[] | undefined): string {
  if (!conditions || conditions.length === 0) return 'Unknown';
  const first = conditions[0];
  return first.reason ?? first.type;
}

const columns: ColumnDef<TaskRun>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Task', key: 'task' },
  {
    title: 'Status',
    key: 'status',
    render: (item) => <StatusIndicator status={item.status} />,
  },
  { title: 'Duration', key: 'duration' },
  { title: 'Age', key: 'age' },
];

export default function TaskRuns() {
  const { data, loading } = useK8sResource<RawTaskRun, TaskRun>(
    '/apis/tekton.dev/v1/taskruns',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      task: item.spec.taskRef?.name ?? '-',
      status: extractStatus(item.status?.conditions),
      duration: computeDuration(item.status?.startTime, item.status?.completionTime),
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="TaskRuns"
      description="Tekton TaskRun instances represent individual executions of a Task"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(t) => `${t.namespace}-${t.name}`}
      nameField="name"
    />
  );
}
