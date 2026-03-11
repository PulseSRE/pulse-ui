import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ResourceListPage, { type ColumnDef } from '@/components/ResourceListPage';
import ResourceActions from '@/components/ResourceActions';
import { useK8sResource, ageFromTimestamp, type K8sMeta } from '@/hooks/useK8sResource';
import { Label } from '@patternfly/react-core';

interface Role {
  name: string;
  namespace: string;
  kind: string;
  rules: number;
  age: string;
}

interface RawRole extends K8sMeta {
  kind: string;
  rules?: unknown[];
}

const columns: ColumnDef<Role>[] = [
  { title: 'Name', key: 'name' },
  { title: 'Namespace', key: 'namespace', render: (r) => r.namespace === '-' ? <span className="os-text-muted">All (cluster)</span> : r.namespace },
  { title: 'Kind', key: 'kind', render: (r) => <Label color={r.kind === 'ClusterRole' ? 'blue' : 'green'}>{r.kind}</Label> },
  { title: 'Rules', key: 'rules' },
  { title: 'Age', key: 'age' },
  { title: '', key: 'actions', render: (r) => <ResourceActions name={r.name} namespace={r.namespace === '-' ? undefined : r.namespace} apiBase="/apis/rbac.authorization.k8s.io/v1" resourceType={r.kind === 'ClusterRole' ? 'clusterroles' : 'roles'} kind={r.kind} detailPath={`/administration/roles/${r.namespace}/${r.name}`} />, sortable: false },
];

function transformRole(item: RawRole): Role {
  return {
    name: item.metadata.name,
    namespace: item.metadata.namespace ?? '-',
    kind: item.kind ?? (item.metadata.namespace ? 'Role' : 'ClusterRole'),
    rules: item.rules?.length ?? 0,
    age: ageFromTimestamp(item.metadata.creationTimestamp),
  };
}

export default function Roles() {
  const navigate = useNavigate();
  const clusterRoles = useK8sResource<RawRole, Role>(
    '/apis/rbac.authorization.k8s.io/v1/clusterroles',
    transformRole,
  );
  const namespacedRoles = useK8sResource<RawRole, Role>(
    '/apis/rbac.authorization.k8s.io/v1/roles',
    transformRole,
  );

  const data = useMemo(
    () => [...clusterRoles.data, ...namespacedRoles.data],
    [clusterRoles.data, namespacedRoles.data],
  );
  const loading = clusterRoles.loading || namespacedRoles.loading;

  return (
    <ResourceListPage
      title="Roles"
      description="Manage ClusterRoles and namespace-scoped Roles for access control"
      columns={columns}
      data={data}
      loading={loading}
      getRowKey={(r) => `${r.kind}-${r.namespace}-${r.name}`}
      createLabel="Create Role"
      nameField="name"
      onRowClick={(item) => navigate(`/administration/roles/${item.namespace}/${item.name}`)}
      filterFn={(r, s) => {
        const q = s.toLowerCase();
        return r.name.toLowerCase().includes(q) || r.namespace.toLowerCase().includes(q);
      }}
    />
  );
}
