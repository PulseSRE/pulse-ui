import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import StatusIndicator from '@/components/StatusIndicator';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface PipelineRun {
  name: string;
  namespace: string;
  pipeline: string;
  status: string;
  duration: string;
  age: string;
}

interface RawCondition {
  type: string;
  reason?: string;
}

interface RawPipelineRun extends K8sMeta {
  spec: {
    pipelineRef?: {
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

const columns: ColumnDef<PipelineRun>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Pipeline', key: 'pipeline' },
  {
    title: 'Status',
    key: 'status',
    render: (item) => <StatusIndicator status={item.status} />,
  },
  { title: 'Duration', key: 'duration' },
  { title: 'Age', key: 'age' },
];

export default function PipelineRuns() {
  const { data, loading } = useK8sResource<RawPipelineRun, PipelineRun>(
    '/apis/tekton.dev/v1/pipelineruns',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      pipeline: item.spec.pipelineRef?.name ?? '-',
      status: extractStatus(item.status?.conditions),
      duration: computeDuration(item.status?.startTime, item.status?.completionTime),
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="PipelineRuns"
      description="Tekton PipelineRun instances represent individual executions of a Pipeline"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(p) => `${p.namespace}-${p.name}`}
      nameField="name"
    />
  );
}
