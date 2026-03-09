import { useMemo } from 'react';
import { Label } from '@patternfly/react-core';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import { useK8sResource, type K8sMeta } from '@/hooks/useK8sResource';

/* ---------- Raw K8s types ---------- */

interface RawSubject {
  kind: string;
  name: string;
  namespace?: string;
}

interface RawClusterRoleBinding extends K8sMeta {
  roleRef: {
    kind: string;
    name: string;
    apiGroup: string;
  };
  subjects?: RawSubject[];
}

/* ---------- Transformed types ---------- */

interface RBACAuditRow {
  subject: string;
  subjectKind: string;
  role: string;
  scope: string;
  bindingName: string;
}

/* ---------- Constants ---------- */

const ADMIN_ROLES = new Set(['cluster-admin', 'admin']);

/* ---------- Columns ---------- */

const columns: ColumnDef<RBACAuditRow>[] = [
  { title: 'Subject', key: 'subject' },
  {
    title: 'Kind',
    key: 'subjectKind',
    render: (row) => {
      const colorMap: Record<string, 'blue' | 'purple' | 'teal'> = {
        User: 'blue',
        Group: 'purple',
        ServiceAccount: 'teal',
      };
      return (
        <Label color={colorMap[row.subjectKind] ?? 'grey'}>
          {row.subjectKind}
        </Label>
      );
    },
  },
  {
    title: 'Role',
    key: 'role',
    render: (row) => (
      <code className="os-detail__label-code">{row.role}</code>
    ),
  },
  { title: 'Scope', key: 'scope' },
  { title: 'Binding Name', key: 'bindingName' },
];

/* ---------- Component ---------- */

export default function RBACAudit() {
  const { data: rawBindings, loading } = useK8sResource<
    RawClusterRoleBinding,
    RawClusterRoleBinding
  >(
    '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings',
    (item) => item,
  );

  const data = useMemo(() => {
    const rows: RBACAuditRow[] = [];

    for (const binding of rawBindings) {
      const roleName = binding.roleRef.name;
      if (!ADMIN_ROLES.has(roleName)) continue;

      const subjects = binding.subjects ?? [];
      for (const subj of subjects) {
        rows.push({
          subject: subj.name,
          subjectKind: subj.kind,
          role: roleName,
          scope: subj.namespace ? `Namespace: ${subj.namespace}` : 'Cluster',
          bindingName: binding.metadata.name,
        });
      }
    }

    return rows;
  }, [rawBindings]);

  return (
    <ResourceListPage
      title="RBAC Audit"
      description="Cluster role bindings granting cluster-admin or admin access"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(row) => `${row.bindingName}-${row.subjectKind}-${row.subject}`}
      nameField="subject"
      filterFn={(row, search) => {
        const q = search.toLowerCase();
        return (
          row.subject.toLowerCase().includes(q) ||
          row.subjectKind.toLowerCase().includes(q) ||
          row.role.toLowerCase().includes(q) ||
          row.bindingName.toLowerCase().includes(q)
        );
      }}
    />
  );
}
