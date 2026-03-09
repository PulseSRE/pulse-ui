import React, { useState } from 'react';
import { Button, TextInput, Label } from '@patternfly/react-core';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';
import { useUIStore } from '@/store/useUIStore';

const BASE = '/api/kubernetes';

interface PVCRow {
  name: string;
  namespace: string;
  currentSize: string;
  storageClass: string;
  allowExpansion: boolean;
  status: string;
}

interface RawPVC extends K8sMeta {
  spec: {
    storageClassName?: string;
    resources?: { requests?: { storage?: string } };
    accessModes?: string[];
  };
  status: {
    phase?: string;
    capacity?: { storage?: string };
  };
}

interface RawStorageClass extends K8sMeta {
  allowVolumeExpansion?: boolean;
  provisioner: string;
}

function ResizeControl({ pvc, refetch }: { pvc: PVCRow; refetch: () => void }) {
  const addToast = useUIStore((s) => s.addToast);
  const [expanded, setExpanded] = useState(false);
  const [newSize, setNewSize] = useState('');

  const handleResize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!newSize) return;
    try {
      const res = await fetch(
        `${BASE}/api/v1/namespaces/${pvc.namespace}/persistentvolumeclaims/${pvc.name}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
          body: JSON.stringify({
            spec: { resources: { requests: { storage: newSize } } },
          }),
        },
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      addToast({ type: 'success', title: 'PVC resized', description: `${pvc.name} resized to ${newSize}` });
      setExpanded(false);
      setNewSize('');
      refetch();
    } catch (err) {
      addToast({ type: 'error', title: 'Resize failed', description: err instanceof Error ? err.message : String(err) });
    }
  };

  if (!expanded) {
    return (
      <span onClick={(e) => e.stopPropagation()}>
        <Button
          variant="secondary"
          size="sm"
          isDisabled={!pvc.allowExpansion}
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
        >
          Resize
        </Button>
      </span>
    );
  }

  return (
    <span onClick={(e) => e.stopPropagation()} className="os-pvc-resize__inline">
      <TextInput
        aria-label="New size"
        value={newSize}
        onChange={(_event, val) => setNewSize(val)}
        placeholder="e.g. 20Gi"
        className="os-pvc-resize__input"
      />
      <Button variant="primary" size="sm" onClick={handleResize} isDisabled={!newSize}>
        Apply
      </Button>
      <Button variant="link" size="sm" onClick={(e) => { e.stopPropagation(); setExpanded(false); }}>
        Cancel
      </Button>
    </span>
  );
}

export default function PVCResize() {
  const { data: storageClasses } = useK8sResource<RawStorageClass, { name: string; allowExpansion: boolean }>(
    '/apis/storage.k8s.io/v1/storageclasses',
    (item) => ({
      name: item.metadata.name,
      allowExpansion: item.allowVolumeExpansion === true,
    }),
  );

  const expansionMap = new Map(storageClasses.map((sc) => [sc.name, sc.allowExpansion]));

  const { data, loading, refetch } = useK8sResource<RawPVC, PVCRow>(
    '/api/v1/persistentvolumeclaims',
    (item) => {
      const scName = item.spec.storageClassName ?? '';
      return {
        name: item.metadata.name,
        namespace: item.metadata.namespace ?? '',
        currentSize: item.status.capacity?.storage ?? item.spec.resources?.requests?.storage ?? '-',
        storageClass: scName,
        allowExpansion: expansionMap.get(scName) ?? false,
        status: item.status.phase ?? '-',
      };
    },
  );

  const columns: ColumnDef<PVCRow>[] = [
    { title: 'Name', key: 'name' },
    { title: 'Namespace', key: 'namespace' },
    { title: 'Current Size', key: 'currentSize' },
    { title: 'Storage Class', key: 'storageClass' },
    {
      title: 'Allow Expansion',
      key: 'allowExpansion',
      render: (pvc) => (
        <Label color={pvc.allowExpansion ? 'green' : 'grey'}>
          {pvc.allowExpansion ? 'Yes' : 'No'}
        </Label>
      ),
    },
    { title: 'Status', key: 'status' },
    {
      title: 'Actions',
      key: 'actions',
      sortable: false,
      render: (pvc) => <ResizeControl pvc={pvc} refetch={refetch} />,
    },
  ];

  return (
    <ResourceListPage
      title="PVC Resize"
      description="View and resize Persistent Volume Claims that support volume expansion"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(pvc) => `${pvc.namespace}-${pvc.name}`}
      statusField="status"
      nameField="name"
      filterFn={(pvc, s) =>
        pvc.name.toLowerCase().includes(s.toLowerCase()) ||
        pvc.namespace.toLowerCase().includes(s.toLowerCase())
      }
    />
  );
}
