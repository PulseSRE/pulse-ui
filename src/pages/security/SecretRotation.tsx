import { useMemo } from 'react';
import { Label } from '@patternfly/react-core';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

/* ---------- Raw K8s types ---------- */

interface RawSecret extends K8sMeta {
  type: string;
  data?: Record<string, string>;
}

/* ---------- Transformed types ---------- */

interface SecretRotationRow {
  name: string;
  namespace: string;
  type: string;
  age: string;
  ageDays: number;
  status: 'OK' | 'Stale' | 'Critical';
}

/* ---------- Helpers ---------- */

function daysSince(ts: string | undefined): number {
  if (!ts) return 0;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}

function ageStatus(days: number): 'OK' | 'Stale' | 'Critical' {
  if (days > 180) return 'Critical';
  if (days > 90) return 'Stale';
  return 'OK';
}

const statusColorMap: Record<string, 'green' | 'orange' | 'red'> = {
  OK: 'green',
  Stale: 'orange',
  Critical: 'red',
};

/* ---------- Columns ---------- */

const columns: ColumnDef<SecretRotationRow>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  {
    title: 'Type',
    key: 'type',
    render: (row) => <code className="os-detail__label-code">{row.type}</code>,
  },
  { title: 'Age', key: 'age' },
  {
    title: 'Status',
    key: 'status',
    render: (row) => (
      <Label color={statusColorMap[row.status]}>{row.status}</Label>
    ),
  },
];

/* ---------- Component ---------- */

export default function SecretRotation() {
  const { data: rawData, loading } = useK8sResource<RawSecret, SecretRotationRow>(
    '/api/v1/secrets',
    (item) => {
      const days = daysSince(item.metadata.creationTimestamp);
      return {
        name: item.metadata.name,
        namespace: item.metadata.namespace ?? '',
        type: item.type,
        age: ageFromTimestamp(item.metadata.creationTimestamp),
        ageDays: days,
        status: ageStatus(days),
      };
    },
  );

  const data = useMemo(
    () => [...rawData].sort((a, b) => b.ageDays - a.ageDays),
    [rawData],
  );

  return (
    <ResourceListPage
      title="Secret Rotation"
      description="Monitor secret age and identify stale credentials that need rotation"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(row) => `${row.namespace}-${row.name}`}
      nameField="name"
      filterFn={(row, search) => {
        const q = search.toLowerCase();
        return (
          row.name.toLowerCase().includes(q) ||
          row.namespace.toLowerCase().includes(q) ||
          row.type.toLowerCase().includes(q) ||
          row.status.toLowerCase().includes(q)
        );
      }}
    />
  );
}
