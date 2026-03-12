import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Label, Button } from '@patternfly/react-core';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';
import { useUIStore } from '@/store/useUIStore';

const BASE = '/api/kubernetes';

interface RawNodeSpec {
  unschedulable?: boolean;
}

interface RawNode extends K8sMeta {
  spec?: RawNodeSpec;
  status?: {
    conditions?: { type: string; status: string }[];
    nodeInfo?: { kubeletVersion?: string };
    addresses?: { type: string; address: string }[];
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
  };
}

interface NodeRow {
  name: string;
  status: string;
  roles: string;
  version: string;
  cpu: string;
  memory: string;
  podCount: number;
  age: string;
  schedulable: boolean;
}

function NodeActions({ node, onDone }: { node: NodeRow; onDone: () => void }) {
  const addToast = useUIStore((s) => s.addToast);
  const [cordonLoading, setCordonLoading] = useState(false);
  const [drainLoading, setDrainLoading] = useState(false);
  const isCordoned = !node.schedulable;

  const handleCordon = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCordonLoading(true);
    try {
      const res = await fetch(`${BASE}/api/v1/nodes/${encodeURIComponent(node.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
        body: JSON.stringify({ spec: { unschedulable: !isCordoned ? true : null } }),
      });
      if (!res.ok) throw new Error(await res.text());
      addToast({ type: 'success', title: `${node.name} ${isCordoned ? 'uncordoned' : 'cordoned'}` });
      onDone();
    } catch (err) {
      addToast({ type: 'error', title: 'Failed', description: err instanceof Error ? err.message : String(err) });
    }
    setCordonLoading(false);
  };

  const handleDrain = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDrainLoading(true);
    try {
      // Cordon first
      await fetch(`${BASE}/api/v1/nodes/${encodeURIComponent(node.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
        body: JSON.stringify({ spec: { unschedulable: true } }),
      });
      // Evict non-DaemonSet pods
      const podsRes = await fetch(`${BASE}/api/v1/pods?fieldSelector=spec.nodeName=${encodeURIComponent(node.name)}`);
      if (!podsRes.ok) throw new Error(`Failed to list pods`);
      const podsJson = await podsRes.json() as { items?: { metadata: { name: string; namespace: string; ownerReferences?: { kind: string }[] } }[] };
      const pods = (podsJson.items ?? []).filter((p) => {
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
        } catch { /* skip */ }
      }
      addToast({ type: 'success', title: `${node.name} drained`, description: `Evicted ${evicted}/${pods.length} pods` });
      onDone();
    } catch (err) {
      addToast({ type: 'error', title: 'Drain failed', description: err instanceof Error ? err.message : String(err) });
    }
    setDrainLoading(false);
  };

  return (
    <span className="os-nodes__actions" onClick={(e) => e.stopPropagation()}>
      <Button variant="link" size="sm" isInline isLoading={cordonLoading} onClick={handleCordon}>
        {isCordoned ? 'Uncordon' : 'Cordon'}
      </Button>
      {' '}
      <Button variant="link" size="sm" isInline isLoading={drainLoading} onClick={handleDrain}>
        Drain
      </Button>
    </span>
  );
}

export default function Nodes() {
  const navigate = useNavigate();
  const [podCounts, setPodCounts] = useState<Record<string, number>>({});

  const { data, loading, refetch } = useK8sResource<RawNode, NodeRow>(
    '/api/v1/nodes',
    (item) => {
      const conditions = item.status?.conditions ?? [];
      const readyCond = conditions.find((c) => c.type === 'Ready');
      const status = readyCond?.status === 'True' ? 'Ready' : 'NotReady';
      const labels = item.metadata.labels ?? {};
      const roles = Object.keys(labels)
        .filter((l) => l.startsWith('node-role.kubernetes.io/'))
        .map((l) => l.replace('node-role.kubernetes.io/', ''))
        .join(', ') || 'worker';
      const capacity = item.status?.capacity ?? {};
      const allocatable = item.status?.allocatable ?? {};
      return {
        name: item.metadata.name,
        status,
        roles,
        version: item.status?.nodeInfo?.kubeletVersion ?? '-',
        cpu: `${allocatable['cpu'] ?? '-'} / ${capacity['cpu'] ?? '-'}`,
        memory: `${allocatable['memory'] ?? '-'} / ${capacity['memory'] ?? '-'}`,
        podCount: 0,
        age: ageFromTimestamp(item.metadata.creationTimestamp),
        schedulable: !item.spec?.unschedulable,
      };
    },
    15000,
  );

  useEffect(() => {
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
    { title: 'Status', key: 'status', render: (n) => (
      <Label color={n.status === 'Ready' ? 'green' : 'red'}>{n.status}{!n.schedulable ? ', Cordoned' : ''}</Label>
    ), sortable: false },
    {
      title: 'Roles', key: 'roles', render: (n) => (
        <>{n.roles.split(', ').map((r) => <Label key={r} color="blue" className="pf-v5-u-mr-xs">{r}</Label>)}</>
      ), sortable: false,
    },
    { title: 'Version', key: 'version' },
    { title: 'CPU', key: 'cpu' },
    { title: 'Memory', key: 'memory' },
    { title: 'Pods', key: 'podCount' },
    { title: 'Age', key: 'age' },
    { title: 'Actions', key: 'actions', render: (n) => <NodeActions node={n} onDone={refetch} />, sortable: false },
  ];

  return (
    <ResourceListPage
      title="Nodes"
      description="View and manage cluster nodes — cordon, uncordon, and drain for maintenance"
      columns={columns}
      data={dataWithPods}
      loading={loading}
      getRowKey={(n) => n.name}
      onRowClick={(n) => navigate(`/compute/nodes/${n.name}`)}
      statusField="status"
      nameField="name"
    />
  );
}
