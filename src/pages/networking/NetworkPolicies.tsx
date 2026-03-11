import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { Label } from '@patternfly/react-core';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface NetworkPolicy {
  name: string;
  namespace: string;
  podSelector: string;
  policyTypes: string[];
  age: string;
}

interface RawNetworkPolicy extends K8sMeta {
  spec: {
    podSelector?: { matchLabels?: Record<string, string> };
    policyTypes?: string[];
  };
}

const columns: ColumnDef<NetworkPolicy>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Pod Selector', key: 'podSelector', render: (n) => <code>{n.podSelector}</code> },
  { title: 'Policy Types', key: 'policyTypes', render: (n) => (
    <span className="os-netpol__types-cell">
      {n.policyTypes.map((t) => <Label key={t} color={t === 'Ingress' ? 'blue' : 'purple'}>{t}</Label>)}
    </span>
  ), sortable: false },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (n) => <ResourceActions name={n.name} namespace={n.namespace} apiBase="/apis/networking.k8s.io/v1" resourceType="networkpolicies" kind="NetworkPolicy" detailPath={`/networking/networkpolicies/${n.namespace}/${n.name}`} />, sortable: false },
];

function formatPodSelector(labels: Record<string, string> | undefined): string {
  if (!labels || Object.keys(labels).length === 0) return '(all pods)';
  return Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(', ');
}

export default function NetworkPolicies() {
  const navigate = useNavigate();
  const { data, loading } = useK8sResource<RawNetworkPolicy, NetworkPolicy>(
    '/apis/networking.k8s.io/v1/networkpolicies',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      podSelector: formatPodSelector(item.spec.podSelector?.matchLabels),
      policyTypes: item.spec.policyTypes ?? [],
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
  );

  return (
    <ResourceListPage
      title="Network Policies"
      description="Manage network access policies between pods"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(n) => `${n.namespace}-${n.name}`}
      createLabel="Create Network Policy"
      nameField="name"
      onRowClick={(item) => navigate(`/networking/networkpolicies/${item.namespace}/${item.name}`)}
    />
  );
}
