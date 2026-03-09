import { Label } from '@patternfly/react-core';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';

interface CertRow {
  name: string;
  namespace: string;
  type: string;
  certPreview: string;
  age: string;
  ageDays: number;
  status: string;
}

interface RawSecret extends K8sMeta {
  type: string;
  data?: Record<string, string>;
}

function getCertStatus(ageDays: number): string {
  if (ageDays > 365) return 'Check Expiry';
  if (ageDays > 300) return 'Expiring Soon';
  return 'Fresh';
}

function getCertStatusColor(status: string): 'green' | 'orange' | 'red' | 'grey' {
  switch (status) {
    case 'Fresh':
      return 'green';
    case 'Expiring Soon':
      return 'orange';
    case 'Check Expiry':
      return 'orange';
    default:
      return 'grey';
  }
}

function computeAgeDays(ts: string | undefined): number {
  if (!ts) return 0;
  const diff = Date.now() - new Date(ts).getTime();
  return Math.floor(diff / 86400000);
}

const columns: ColumnDef<CertRow>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace' },
  { title: 'Type', key: 'type' },
  { title: 'Age', key: 'age' },
  {
    title: 'Status',
    key: 'status',
    render: (cert) => (
      <Label color={getCertStatusColor(cert.status)}>{cert.status}</Label>
    ),
  },
];

export default function CertificateManagement() {
  const { data: allSecrets, loading } = useK8sResource<RawSecret, CertRow | null>(
    '/api/v1/secrets',
    (item) => {
      if (item.type !== 'kubernetes.io/tls') return null;
      const certData = item.data?.['tls.crt'] ?? '';
      const decoded = certData ? atob(certData).substring(0, 50) : '-';
      const ageDays = computeAgeDays(item.metadata.creationTimestamp);
      return {
        name: item.metadata.name,
        namespace: item.metadata.namespace ?? '',
        type: item.type,
        certPreview: decoded,
        age: ageFromTimestamp(item.metadata.creationTimestamp),
        ageDays,
        status: getCertStatus(ageDays),
      };
    },
  );

  const data = allSecrets.filter((item): item is CertRow => item !== null);

  return (
    <ResourceListPage
      title="Certificate Management"
      description="View TLS certificates and monitor their freshness based on creation age"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(cert) => `${cert.namespace}-${cert.name}`}
      nameField="name"
      filterFn={(cert, s) =>
        cert.name.toLowerCase().includes(s.toLowerCase()) ||
        cert.namespace.toLowerCase().includes(s.toLowerCase())
      }
    />
  );
}
