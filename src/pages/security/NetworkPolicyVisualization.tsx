import { useMemo } from 'react';
import { Label } from '@patternfly/react-core';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, type K8sMeta } from '@/hooks/useK8sResource';

/* ---------- Raw K8s types ---------- */

interface RawNetworkPolicy extends K8sMeta {
  spec: {
    podSelector?: { matchLabels?: Record<string, string> };
    policyTypes?: string[];
  };
}

interface RawNamespace extends K8sMeta {}

/* ---------- Transformed types ---------- */

interface NamespaceNetPolRow {
  name: string;
  hasIngress: boolean;
  hasEgress: boolean;
  policyCount: number;
  status: 'Protected' | 'Exposed';
}

/* ---------- Component ---------- */

const columns: ColumnDef<NamespaceNetPolRow>[] = [
  { title: 'Namespace', key: 'name' },
  {
    title: 'Has Ingress Policy',
    key: 'hasIngress',
    render: (row) =>
      row.hasIngress ? (
        <Label color="green">Yes</Label>
      ) : (
        <Label color="grey">No</Label>
      ),
  },
  {
    title: 'Has Egress Policy',
    key: 'hasEgress',
    render: (row) =>
      row.hasEgress ? (
        <Label color="green">Yes</Label>
      ) : (
        <Label color="grey">No</Label>
      ),
  },
  { title: 'Policy Count', key: 'policyCount' },
  {
    title: 'Status',
    key: 'status',
    render: (row) =>
      row.status === 'Protected' ? (
        <Label color="green">Protected</Label>
      ) : (
        <Label color="red">Exposed</Label>
      ),
  },
];

export default function NetworkPolicyVisualization() {
  const netPols = useK8sResource<RawNetworkPolicy, { namespace: string; policyTypes: string[] }>(
    '/apis/networking.k8s.io/v1/networkpolicies',
    (item) => ({
      namespace: item.metadata.namespace ?? '',
      policyTypes: item.spec.policyTypes ?? [],
    }),
  );

  const namespaces = useK8sResource<RawNamespace, { name: string }>(
    '/api/v1/namespaces',
    (item) => ({ name: item.metadata.name }),
  );

  const data = useMemo(() => {
    const nsMap = new Map<
      string,
      { ingress: boolean; egress: boolean; count: number }
    >();

    for (const np of netPols.data) {
      const entry = nsMap.get(np.namespace) ?? {
        ingress: false,
        egress: false,
        count: 0,
      };
      entry.count += 1;
      if (np.policyTypes.includes('Ingress')) entry.ingress = true;
      if (np.policyTypes.includes('Egress')) entry.egress = true;
      // If no policyTypes specified, Ingress is the default
      if (np.policyTypes.length === 0) entry.ingress = true;
      nsMap.set(np.namespace, entry);
    }

    return namespaces.data.map((ns): NamespaceNetPolRow => {
      const entry = nsMap.get(ns.name);
      return {
        name: ns.name,
        hasIngress: entry?.ingress ?? false,
        hasEgress: entry?.egress ?? false,
        policyCount: entry?.count ?? 0,
        status: entry && entry.count > 0 ? 'Protected' : 'Exposed',
      };
    });
  }, [netPols.data, namespaces.data]);

  const loading = netPols.loading || namespaces.loading;

  return (
    <ResourceListPage
      title="Network Policy Visualization"
      description="Overview of network policy coverage across namespaces"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(row) => row.name}
      nameField="name"
      filterFn={(row, search) => {
        const q = search.toLowerCase();
        return (
          row.name.toLowerCase().includes(q) ||
          row.status.toLowerCase().includes(q)
        );
      }}
    />
  );
}
