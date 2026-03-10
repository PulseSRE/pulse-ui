import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import StatusIndicator from '@/components/StatusIndicator';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface KnativeService {
  name: string;
  namespace: string;
  url: string;
  ready: string;
  latestRevision: string;
  age: string;
}

interface RawCondition {
  type: string;
  status: string;
}

interface RawKnativeService extends K8sMeta {
  status?: {
    url?: string;
    conditions?: RawCondition[];
    latestReadyRevisionName?: string;
  };
}

function extractReady(conditions: RawCondition[] | undefined): string {
  if (!conditions) return 'Unknown';
  const readyCondition = conditions.find((c) => c.type === 'Ready');
  if (!readyCondition) return 'Unknown';
  return readyCondition.status === 'True' ? 'True' : 'False';
}

const columns: ColumnDef<KnativeService>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'URL', key: 'url' },
  {
    title: 'Ready',
    key: 'ready',
    render: (item) => <StatusIndicator status={item.ready} />,
  },
  { title: 'Latest Revision', key: 'latestRevision' },
  { title: 'Age', key: 'age' },
];

export default function KnativeServices() {
  const { data, loading } = useK8sResource<RawKnativeService, KnativeService>(
    '/apis/serving.knative.dev/v1/services',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      url: item.status?.url ?? '-',
      ready: extractReady(item.status?.conditions),
      latestRevision: item.status?.latestReadyRevisionName ?? '-',
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Knative Services"
      description="Knative Services manage the lifecycle of serverless workloads"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(s) => `${s.namespace}-${s.name}`}
      nameField="name"
    />
  );
}
