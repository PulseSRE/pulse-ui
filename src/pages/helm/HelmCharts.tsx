import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { Label } from '@patternfly/react-core';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface RawHelmChartRepo extends K8sMeta {
  spec?: {
    connectionConfig?: {
      url?: string;
    };
  };
  status?: {
    conditions?: {
      type: string;
      status: string;
    }[];
  };
}

interface HelmChart {
  name: string;
  url: string;
  status: string;
  age: string;
}

const statusColors: Record<string, 'green' | 'red' | 'grey'> = {
  Ready: 'green',
  True: 'green',
  False: 'red',
};

const columns: ColumnDef<HelmChart>[] = [
  { title: 'Name', key: 'name' },
  { title: 'URL', key: 'url' },
  { title: 'Status', key: 'status', render: (r) => <Label color={statusColors[r.status] ?? 'grey'}>{r.status}</Label> },
  { title: 'Age', key: 'age' },
];

export default function HelmCharts() {
  const { data, loading, error } = useK8sResource<RawHelmChartRepo, HelmChart>(
    '/apis/helm.openshift.io/v1beta1/helmchartrepositories',
    (item) => {
      const readyCondition = item.status?.conditions?.find((c) => c.type === 'Ready');
      return {
        name: item.metadata.name,
        url: item.spec?.connectionConfig?.url ?? '-',
        status: readyCondition?.status ?? 'Unknown',
        age: ageFromTimestamp(item.metadata.creationTimestamp),
      };
    },
  );

  const is404 = error?.startsWith('404');
  const showEmpty = is404 || (!loading && data.length === 0);

  if (showEmpty && !loading) {
    return (
      <ResourceListPage
        title="Helm Chart Repositories"
        description="No Helm Chart Repositories configured"
        columns={columns}
        data={[]}
        loading={false}
        getRowKey={(r) => r.name}
        nameField="name"
      />
    );
  }

  return (
    <ResourceListPage
      title="Helm Chart Repositories"
      description="Helm Chart Repositories configured in the cluster"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(r) => r.name}
      nameField="name"
    />
  );
}
