import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { Label } from '@patternfly/react-core';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface RawSecret extends K8sMeta {
  type: string;
  data?: Record<string, string>;
}

interface HelmRelease {
  name: string;
  namespace: string;
  chart: string;
  version: string;
  status: string;
  age: string;
  isHelm: boolean;
}

const statusColors: Record<string, 'green' | 'blue' | 'orange' | 'red' | 'grey'> = {
  deployed: 'green',
  superseded: 'blue',
  failed: 'red',
  'pending-install': 'orange',
  'pending-upgrade': 'orange',
  uninstalling: 'orange',
};

const columns: ColumnDef<HelmRelease>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Chart', key: 'chart' },
  { title: 'Version', key: 'version' },
  { title: 'Status', key: 'status', render: (r) => <Label color={statusColors[r.status] ?? 'grey'}>{r.status}</Label> },
  { title: 'Updated', key: 'age' },
];

export default function HelmReleases() {
  const { data, loading } = useK8sResource<RawSecret, HelmRelease>(
    '/api/v1/secrets',
    (item) => ({
      name: item.metadata.labels?.['name'] ?? item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      chart: item.metadata.labels?.['name'] ?? '-',
      version: item.metadata.labels?.['version'] ?? '-',
      status: item.metadata.labels?.['status'] ?? 'unknown',
      age: ageFromTimestamp(item.metadata.creationTimestamp),
      isHelm: item.type === 'helm.sh/release.v1',
    }),
  );

  const releases = data.filter((r) => r.isHelm);

  return (
    <ResourceListPage
      title="Helm Releases"
      description="Helm releases installed in the cluster (stored as Secrets)"
      columns={columns}
      data={releases}
      loading={loading}
      getRowKey={(r) => `${r.namespace}-${r.name}-${r.version}`}
      nameField="name"
    />
  );
}
