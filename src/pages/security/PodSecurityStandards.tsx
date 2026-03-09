import { useMemo } from 'react';
import { Label } from '@patternfly/react-core';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, type K8sMeta } from '@/hooks/useK8sResource';

/* ---------- Raw K8s types ---------- */

interface RawContainer {
  name: string;
  securityContext?: {
    runAsNonRoot?: boolean;
    runAsUser?: number;
    privileged?: boolean;
    allowPrivilegeEscalation?: boolean;
  };
}

interface RawPod extends K8sMeta {
  spec: {
    containers: RawContainer[];
    securityContext?: {
      runAsNonRoot?: boolean;
      runAsUser?: number;
    };
    hostNetwork?: boolean;
    hostPID?: boolean;
    hostIPC?: boolean;
  };
}

interface RawNamespace extends K8sMeta {}

/* ---------- Transformed types ---------- */

interface PodInfo {
  namespace: string;
  hasViolation: boolean;
}

interface NamespaceInfo {
  name: string;
  enforceLevel: string;
  auditLevel: string;
  warnLevel: string;
}

interface PodSecurityRow {
  name: string;
  enforceLevel: string;
  auditLevel: string;
  warnLevel: string;
  podCount: number;
  violations: number;
}

/* ---------- Constants ---------- */

const PSA_ENFORCE = 'pod-security.kubernetes.io/enforce';
const PSA_AUDIT = 'pod-security.kubernetes.io/audit';
const PSA_WARN = 'pod-security.kubernetes.io/warn';

/* ---------- Helpers ---------- */

function getLevelLabel(level: string): 'green' | 'blue' | 'orange' | 'grey' {
  switch (level) {
    case 'restricted':
      return 'green';
    case 'baseline':
      return 'blue';
    case 'privileged':
      return 'orange';
    default:
      return 'grey';
  }
}

function hasPodViolation(pod: RawPod): boolean {
  const podCtx = pod.spec.securityContext;
  if (podCtx?.runAsUser === 0 || podCtx?.runAsNonRoot === false) return true;
  if (pod.spec.hostNetwork || pod.spec.hostPID || pod.spec.hostIPC) return true;
  return pod.spec.containers.some(
    (c) =>
      c.securityContext?.privileged === true ||
      c.securityContext?.allowPrivilegeEscalation === true ||
      c.securityContext?.runAsUser === 0,
  );
}

/* ---------- Columns ---------- */

const columns: ColumnDef<PodSecurityRow>[] = [
  { title: 'Namespace', key: 'name' },
  {
    title: 'Enforce Level',
    key: 'enforceLevel',
    render: (row) => (
      <Label color={getLevelLabel(row.enforceLevel)}>
        {row.enforceLevel || 'none'}
      </Label>
    ),
  },
  {
    title: 'Audit Level',
    key: 'auditLevel',
    render: (row) => (
      <Label color={getLevelLabel(row.auditLevel)}>
        {row.auditLevel || 'none'}
      </Label>
    ),
  },
  {
    title: 'Warn Level',
    key: 'warnLevel',
    render: (row) => (
      <Label color={getLevelLabel(row.warnLevel)}>
        {row.warnLevel || 'none'}
      </Label>
    ),
  },
  { title: 'Pod Count', key: 'podCount' },
  {
    title: 'Violations',
    key: 'violations',
    render: (row) =>
      row.violations > 0 ? (
        <Label color="red">{row.violations}</Label>
      ) : (
        <Label color="green">0</Label>
      ),
  },
];

/* ---------- Component ---------- */

export default function PodSecurityStandards() {
  const podsResource = useK8sResource<RawPod, PodInfo>(
    '/api/v1/pods',
    (item) => ({
      namespace: item.metadata.namespace ?? '',
      hasViolation: hasPodViolation(item),
    }),
  );

  const namespacesResource = useK8sResource<RawNamespace, NamespaceInfo>(
    '/api/v1/namespaces',
    (item) => ({
      name: item.metadata.name,
      enforceLevel: item.metadata.labels?.[PSA_ENFORCE] ?? '',
      auditLevel: item.metadata.labels?.[PSA_AUDIT] ?? '',
      warnLevel: item.metadata.labels?.[PSA_WARN] ?? '',
    }),
  );

  const data = useMemo(() => {
    const podsByNs = new Map<string, { count: number; violations: number }>();

    for (const pod of podsResource.data) {
      const entry = podsByNs.get(pod.namespace) ?? { count: 0, violations: 0 };
      entry.count += 1;
      if (pod.hasViolation) entry.violations += 1;
      podsByNs.set(pod.namespace, entry);
    }

    return namespacesResource.data.map((ns): PodSecurityRow => {
      const stats = podsByNs.get(ns.name) ?? { count: 0, violations: 0 };
      return {
        name: ns.name,
        enforceLevel: ns.enforceLevel,
        auditLevel: ns.auditLevel,
        warnLevel: ns.warnLevel,
        podCount: stats.count,
        violations: stats.violations,
      };
    });
  }, [podsResource.data, namespacesResource.data]);

  const loading = podsResource.loading || namespacesResource.loading;

  return (
    <ResourceListPage
      title="Pod Security Standards"
      description="Namespace-level pod security admission analysis and violation tracking"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(row) => row.name}
      nameField="name"
      filterFn={(row, search) => {
        const q = search.toLowerCase();
        return (
          row.name.toLowerCase().includes(q) ||
          row.enforceLevel.toLowerCase().includes(q) ||
          row.auditLevel.toLowerCase().includes(q) ||
          row.warnLevel.toLowerCase().includes(q)
        );
      }}
    />
  );
}
