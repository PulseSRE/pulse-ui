import React from 'react';
import { Button } from '@patternfly/react-core';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';
import { useUIStore } from '@/store/useUIStore';

const BASE = '/api/kubernetes';

interface NodeRow {
  name: string;
  status: string;
  role: string;
  schedulable: boolean;
  podCount: number;
  age: string;
}

interface RawNodeCondition {
  type: string;
  status: string;
}

interface RawNode extends K8sMeta {
  spec: {
    unschedulable?: boolean;
  };
  status: {
    conditions?: RawNodeCondition[];
    allocatable?: Record<string, string>;
  };
}

function getNodeStatus(conditions: RawNodeCondition[] | undefined): string {
  const ready = conditions?.find((c) => c.type === 'Ready');
  if (!ready) return 'Unknown';
  return ready.status === 'True' ? 'Ready' : 'NotReady';
}

function getNodeRole(labels: Record<string, string> | undefined): string {
  if (!labels) return 'worker';
  const roleKeys = Object.keys(labels).filter((k) => k.startsWith('node-role.kubernetes.io/'));
  if (roleKeys.length === 0) return 'worker';
  return roleKeys.map((k) => k.replace('node-role.kubernetes.io/', '')).join(', ');
}

function NodeActions({ node, refetch }: { node: NodeRow; refetch: () => void }) {
  const addToast = useUIStore((s) => s.addToast);

  const handleCordon = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`${BASE}/api/v1/nodes/${node.name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
        body: JSON.stringify({ spec: { unschedulable: true } }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      addToast({ type: 'success', title: 'Node cordoned', description: `${node.name} marked as unschedulable` });
      refetch();
    } catch (err) {
      addToast({ type: 'error', title: 'Cordon failed', description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleUncordon = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`${BASE}/api/v1/nodes/${node.name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
        body: JSON.stringify({ spec: { unschedulable: null } }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      addToast({ type: 'success', title: 'Node uncordoned', description: `${node.name} marked as schedulable` });
      refetch();
    } catch (err) {
      addToast({ type: 'error', title: 'Uncordon failed', description: err instanceof Error ? err.message : String(err) });
    }
  };

  const [draining, setDraining] = React.useState(false);

  const handleDrain = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraining(true);
    try {
      // Step 1: Cordon the node
      const cordonRes = await fetch(`${BASE}/api/v1/nodes/${encodeURIComponent(node.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
        body: JSON.stringify({ spec: { unschedulable: true } }),
      });
      if (!cordonRes.ok) throw new Error(`Cordon failed: ${cordonRes.status}`);

      // Step 2: Evict all pods on the node
      const podsRes = await fetch(`${BASE}/api/v1/pods?fieldSelector=spec.nodeName=${encodeURIComponent(node.name)}`);
      if (!podsRes.ok) throw new Error(`Failed to list pods: ${podsRes.status}`);
      const podsJson = await podsRes.json() as { items?: { metadata: { name: string; namespace: string; ownerReferences?: { kind: string }[] } }[] };
      const pods = (podsJson.items ?? []).filter((p) => {
        // Skip DaemonSet pods and mirror pods
        const owners = p.metadata.ownerReferences ?? [];
        return !owners.some((o) => o.kind === 'DaemonSet');
      });

      let evicted = 0;
      for (const pod of pods) {
        try {
          await fetch(`${BASE}/api/v1/namespaces/${encodeURIComponent(pod.metadata.namespace)}/pods/${encodeURIComponent(pod.metadata.name)}/eviction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiVersion: 'policy/v1', kind: 'Eviction',
              metadata: { name: pod.metadata.name, namespace: pod.metadata.namespace },
            }),
          });
          evicted++;
        } catch { /* skip pods that can't be evicted */ }
      }

      addToast({ type: 'success', title: `Node ${node.name} drained`, description: `Evicted ${evicted} of ${pods.length} pods` });
      refetch();
    } catch (err) {
      addToast({ type: 'error', title: 'Drain failed', description: err instanceof Error ? err.message : String(err) });
    }
    setDraining(false);
  };

  return (
    <span onClick={(e) => e.stopPropagation()}>
      {node.schedulable ? (
        <Button variant="secondary" size="sm" onClick={handleCordon}>Cordon</Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={handleUncordon}>Uncordon</Button>
      )}
      {' '}
      <Button variant="warning" size="sm" isLoading={draining} onClick={handleDrain}>Drain</Button>
    </span>
  );
}

export default function NodeMaintenance() {
  const [podCounts, setPodCounts] = React.useState<Record<string, number>>({});

  const { data, loading, refetch } = useK8sResource<RawNode, NodeRow>(
    '/api/v1/nodes',
    (item) => ({
      name: item.metadata.name,
      status: getNodeStatus(item.status.conditions),
      role: getNodeRole(item.metadata.labels),
      schedulable: !item.spec.unschedulable,
      podCount: 0,
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
    15000,
  );

  // Fetch pod counts per node
  React.useEffect(() => {
    async function loadPodCounts() {
      try {
        const res = await fetch(`${BASE}/api/v1/pods`);
        if (!res.ok) return;
        const json = await res.json() as { items?: { spec: { nodeName?: string } }[] };
        const counts: Record<string, number> = {};
        for (const pod of json.items ?? []) {
          const node = pod.spec.nodeName;
          if (node) counts[node] = (counts[node] ?? 0) + 1;
        }
        setPodCounts(counts);
      } catch { /* ignore */ }
    }
    loadPodCounts();
  }, [data.length]);

  const dataWithPods = data.map((n) => ({ ...n, podCount: podCounts[n.name] ?? 0 }));

  const columns: ColumnDef<NodeRow>[] = [
    { title: 'Name', key: 'name' },
    { title: 'Status', key: 'status' },
    { title: 'Role', key: 'role' },
    { title: 'Schedulable', key: 'schedulable', render: (n) => (n.schedulable ? 'Yes' : 'No') },
    { title: 'Pod Count', key: 'podCount' },
    { title: 'Age', key: 'age' },
    {
      title: 'Actions',
      key: 'actions',
      sortable: false,
      render: (n) => <NodeActions node={n} refetch={refetch} />,
    },
  ];

  return (
    <ResourceListPage
      title="Node Maintenance"
      description="Cordon, uncordon, and drain cluster nodes for maintenance operations"
      columns={columns}
      data={dataWithPods}
      loading={loading}
      getRowKey={(n) => n.name}
      statusField="status"
      nameField="name"
      filterFn={(n, s) => n.name.toLowerCase().includes(s.toLowerCase())}
    />
  );
}
