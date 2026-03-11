import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { Label } from '@patternfly/react-core';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface IngressItem {
  name: string;
  namespace: string;
  hosts: string[];
  address: string;
  ports: string;
  age: string;
}

interface RawIngress extends K8sMeta {
  spec: { rules?: { host?: string }[] };
  status: { loadBalancer?: { ingress?: { ip?: string }[] } };
}

const columns: ColumnDef<IngressItem>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Hosts', key: 'hosts', render: (i) => (
    <span className="os-ingress__hosts-cell">
      {i.hosts.map((h) => <Label key={h} color="blue">{h}</Label>)}
    </span>
  ), sortable: false },
  { title: 'Address', key: 'address' },
  { title: 'Ports', key: 'ports' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (i) => <ResourceActions name={i.name} namespace={i.namespace} apiBase="/apis/networking.k8s.io/v1" resourceType="ingresses" kind="Ingress" detailPath={`/networking/ingress/${i.namespace}/${i.name}`} />, sortable: false },
];

export default function Ingress() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawIngress, IngressItem>(
    '/apis/networking.k8s.io/v1/ingresses',
    (item) => {
      const hosts = (item.spec.rules ?? [])
        .map((r) => r.host)
        .filter((h): h is string => Boolean(h));
      return {
        name: item.metadata.name,
        namespace: item.metadata.namespace ?? '',
        hosts,
        address: item.status.loadBalancer?.ingress?.[0]?.ip ?? '-',
        ports: '80, 443',
        age: ageFromTimestamp(item.metadata.creationTimestamp),
      };
    },
  );

  return (
    <ResourceListPage
      title="Ingress"
      description="Manage ingress resources for external access to services"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(i) => `${i.namespace}-${i.name}`}
      createLabel="Create Ingress"
      nameField="name"
      onRowClick={(item) => navigate(`/networking/ingress/${item.namespace}/${item.name}`)}
    />
  );
}
