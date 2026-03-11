import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';
import { Label } from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';

interface Route {
  name: string;
  namespace: string;
  host: string;
  path: string;
  service: string;
  termination: string;
  age: string;
}

interface RawRoute extends K8sMeta {
  spec: {
    host: string;
    path?: string;
    to: { name: string };
    tls?: { termination: string };
  };
}

const terminationColors: Record<string, 'green' | 'blue' | 'purple' | 'grey'> = {
  edge: 'green',
  passthrough: 'blue',
  reencrypt: 'purple',
  none: 'grey',
};

const columns: ColumnDef<Route>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Host', key: 'host', render: (r) => (
    <span className="os-routes__host-cell">
      <code>{r.host}</code>
      <ExternalLinkAltIcon className="os-routes__link-icon" />
    </span>
  )},
  { title: 'Path', key: 'path' },
  { title: 'Service', key: 'service' },
  { title: 'TLS', key: 'termination', render: (r) => <Label color={terminationColors[r.termination] ?? 'grey'}>{r.termination}</Label> },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (r) => <ResourceActions name={r.name} namespace={r.namespace} apiBase="/apis/route.openshift.io/v1" resourceType="routes" kind="Route" detailPath={`/networking/routes/${r.namespace}/${r.name}`} />, sortable: false },
];

export default function RoutesPage() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawRoute, Route>(
    '/apis/route.openshift.io/v1/routes',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      host: item.spec.host,
      path: item.spec.path ?? '/',
      service: item.spec.to.name,
      termination: item.spec.tls?.termination ?? 'none',
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Routes"
      description="Manage external access to services via HTTP/HTTPS routes"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(r) => `${r.namespace}-${r.name}`}
      createLabel="Create Route"
      nameField="name"
      onRowClick={(item) => navigate(`/networking/routes/${item.namespace}/${item.name}`)}
    />
  );
}
