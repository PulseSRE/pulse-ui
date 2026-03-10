import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface Pipeline {
  name: string;
  namespace: string;
  tasks: number;
  age: string;
}

interface RawPipeline extends K8sMeta {
  spec: {
    tasks?: unknown[];
  };
}

const columns: ColumnDef<Pipeline>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Tasks', key: 'tasks' },
  { title: 'Age', key: 'age' },
];

export default function Pipelines() {
  const { data, loading } = useK8sResource<RawPipeline, Pipeline>(
    '/apis/tekton.dev/v1/pipelines',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      tasks: item.spec.tasks?.length ?? 0,
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Pipelines"
      description="Tekton Pipelines define a series of tasks to build, test, and deploy applications"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(p) => `${p.namespace}-${p.name}`}
      nameField="name"
    />
  );
}
