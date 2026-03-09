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

  const handleDrain = (e: React.MouseEvent) => {
    e.stopPropagation();
    addToast({ type: 'info', title: 'Draining node...', description: `Drain initiated for ${node.name}` });
  };

  return (
    <span onClick={(e) => e.stopPropagation()}>
      {node.schedulable ? (
        <Button variant="secondary" size="sm" onClick={handleCordon}>Cordon</Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={handleUncordon}>Uncordon</Button>
      )}
      {' '}
      <Button variant="warning" size="sm" onClick={handleDrain}>Drain</Button>
    </span>
  );
}

export default function NodeMaintenance() {
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
      data={data}
      loading={loading}
      getRowKey={(n) => n.name}
      statusField="status"
      nameField="name"
      filterFn={(n, s) => n.name.toLowerCase().includes(s.toLowerCase())}
    />
  );
}
