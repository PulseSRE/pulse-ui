import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import StatusIndicator from '@/components/StatusIndicator';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface KnativeRevision {
  name: string;
  namespace: string;
  service: string;
  ready: string;
  age: string;
}

interface RawCondition {
  type: string;
  status: string;
}

interface RawKnativeRevision extends K8sMeta {
  status?: {
    conditions?: RawCondition[];
  };
}

function extractReady(conditions: RawCondition[] | undefined): string {
  if (!conditions) return 'Unknown';
  const readyCondition = conditions.find((c) => c.type === 'Ready');
  if (!readyCondition) return 'Unknown';
  return readyCondition.status === 'True' ? 'True' : 'False';
}

const columns: ColumnDef<KnativeRevision>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Service', key: 'service' },
  {
    title: 'Ready',
    key: 'ready',
    render: (item) => <StatusIndicator status={item.ready} />,
  },
  { title: 'Age', key: 'age' },
];

export default function KnativeRevisions() {
  const { data, loading } = useK8sResource<RawKnativeRevision, KnativeRevision>(
    '/apis/serving.knative.dev/v1/revisions',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      service: item.metadata.labels?.['serving.knative.dev/service'] ?? '-',
      ready: extractReady(item.status?.conditions),
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Knative Revisions"
      description="Knative Revisions represent immutable snapshots of a Knative Service"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(r) => `${r.namespace}-${r.name}`}
      nameField="name"
    />
  );
}
