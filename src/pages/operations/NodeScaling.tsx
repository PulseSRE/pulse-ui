import React from 'react';
import { Button } from '@patternfly/react-core';
import { MinusIcon, PlusIcon } from '@patternfly/react-icons';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';
import { useUIStore } from '@/store/useUIStore';

const BASE = '/api/kubernetes';

interface MachineSetRow {
  name: string;
  namespace: string;
  desired: number;
  current: number;
  ready: number;
  available: number;
  age: string;
}

interface RawMachineSet extends K8sMeta {
  spec: {
    replicas?: number;
    selector?: {
      matchLabels?: Record<string, string>;
    };
    template?: {
      spec?: {
        providerSpec?: {
          value?: Record<string, unknown>;
        };
      };
    };
  };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    fullyLabeledReplicas?: number;
  };
}

function ScaleControl({ ms, refetch }: { ms: MachineSetRow; refetch: () => void }) {
  const addToast = useUIStore((s) => s.addToast);

  const handleScale = async (delta: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = Math.max(0, ms.desired + delta);
    try {
      const res = await fetch(
        `${BASE}/apis/machine.openshift.io/v1beta1/namespaces/${ms.namespace}/machinesets/${ms.name}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
          body: JSON.stringify({ spec: { replicas: next } }),
        },
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      addToast({ type: 'success', title: `Scaled ${ms.name}`, description: `Replicas set to ${next}` });
      refetch();
    } catch (err) {
      addToast({ type: 'error', title: 'Scale failed', description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <span className="os-deployments__scale-inline" onClick={(e) => e.stopPropagation()}>
      <Button
        variant="plain"
        size="sm"
        isDisabled={ms.desired <= 0}
        onClick={(e) => handleScale(-1, e)}
        aria-label="Scale down"
        className="os-deployments__scale-btn"
      >
        <MinusIcon />
      </Button>
      <span className="os-deployments__scale-value">{ms.current}/{ms.desired}</span>
      <Button
        variant="plain"
        size="sm"
        onClick={(e) => handleScale(1, e)}
        aria-label="Scale up"
        className="os-deployments__scale-btn"
      >
        <PlusIcon />
      </Button>
    </span>
  );
}

export default function NodeScaling() {
  const { data, loading, refetch } = useK8sResource<RawMachineSet, MachineSetRow>(
    '/apis/machine.openshift.io/v1beta1/machinesets',
    (item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace ?? '',
      desired: item.spec.replicas ?? 0,
      current: item.status?.replicas ?? 0,
      ready: item.status?.readyReplicas ?? 0,
      available: item.status?.availableReplicas ?? 0,
      age: ageFromTimestamp(item.metadata.creationTimestamp),
    }),
    15000,
  );

  const columns: ColumnDef<MachineSetRow>[] = [
    { title: 'Name', key: 'name' },
    { title: 'Namespace', key: 'namespace' },
    {
      title: 'Desired',
      key: 'desired',
      sortable: false,
      render: (ms) => <ScaleControl ms={ms} refetch={refetch} />,
    },
    { title: 'Current', key: 'current' },
    { title: 'Ready', key: 'ready' },
    { title: 'Available', key: 'available' },
    { title: 'Age', key: 'age' },
  ];

  return (
    <ResourceListPage
      title="Node Scaling"
      description="Scale worker nodes by adjusting MachineSet replicas"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(ms) => `${ms.namespace}-${ms.name}`}
      nameField="name"
      filterFn={(ms, s) =>
        ms.name.toLowerCase().includes(s.toLowerCase()) ||
        ms.namespace.toLowerCase().includes(s.toLowerCase())
      }
    />
  );
}
