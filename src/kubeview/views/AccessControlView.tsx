import React from 'react';
import { Shield, Users, Key, Lock, AlertTriangle, CheckCircle, ArrowRight, Activity, Info, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { K8sResource } from '../engine/renderers';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { Panel } from '../components/primitives/Panel';

export default function AccessControlView() {
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  // Use useK8sListWatch for real-time updates
  const { data: clusterRoles = [] } = useK8sListWatch({ apiPath: '/apis/rbac.authorization.k8s.io/v1/clusterroles' });
  const { data: clusterRoleBindings = [] } = useK8sListWatch({ apiPath: '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings' });
  const { data: roles = [] } = useK8sListWatch({ apiPath: '/apis/rbac.authorization.k8s.io/v1/roles', namespace: nsFilter });
  const { data: roleBindings = [] } = useK8sListWatch({ apiPath: '/apis/rbac.authorization.k8s.io/v1/rolebindings', namespace: nsFilter });
  const { data: serviceAccounts = [] } = useK8sListWatch({ apiPath: '/api/v1/serviceaccounts', namespace: nsFilter });
  const { data: namespaces = [] } = useK8sListWatch({ apiPath: '/api/v1/namespaces' });
  const { data: users = [] } = useK8sListWatch({ apiPath: '/apis/user.openshift.io/v1/users' });

  // Find cluster-admin bindings
  const clusterAdminBindings = React.useMemo(() => {
    return clusterRoleBindings.filter((b: any) => {
      const roleRef = b.roleRef;
      return roleRef?.name === 'cluster-admin';
    });
  }, [clusterRoleBindings]);

  // Find subjects with broad permissions (exclude system/platform defaults)
  const broadPermissions = React.useMemo(() => {
    const subjects: Array<{ name: string; kind: string; binding: string; namespace?: string }> = [];
    for (const b of clusterAdminBindings as any[]) {
      // Skip system-provided bindings
      const bindingName = b.metadata?.name || '';
      if (bindingName.startsWith('system:') || bindingName.startsWith('openshift-')) continue;

      for (const s of b.subjects || []) {
        // Skip system users, groups, and platform SAs
        if (s.name?.startsWith('system:') || s.name?.startsWith('openshift-')) continue;
        if (s.kind === 'Group' && (s.name === 'system:masters' || s.name?.startsWith('system:'))) continue;
        if (s.kind === 'ServiceAccount' && (s.namespace?.startsWith('openshift-') || s.namespace?.startsWith('kube-'))) continue;
        subjects.push({ name: s.name, kind: s.kind, binding: b.metadata.name, namespace: s.namespace });
      }
    }
    return subjects;
  }, [clusterAdminBindings]);

  // Namespace breakdown
  const saByNamespace = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const sa of serviceAccounts as any[]) {
      const ns = sa.metadata?.namespace || '';
      map.set(ns, (map.get(ns) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [serviceAccounts]);

  const go = useNavigateTab();

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header — matches other domain pages */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Shield className="w-6 h-6 text-indigo-500" />
              Access Control
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              RBAC roles, bindings, service accounts, and security audit
              {nsFilter && <span className="text-blue-400 ml-1">in {nsFilter}</span>}
            </p>
          </div>
        </div>

        {/* Issues banner */}
        {broadPermissions.length > 5 && (
          <div className="flex items-center px-4 py-2.5 rounded-lg border bg-yellow-950/30 border-yellow-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-slate-200">{broadPermissions.length} subjects have cluster-admin — review below</span>
            </div>
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <button onClick={() => go('/r/rbac.authorization.k8s.io~v1~clusterroles', 'ClusterRoles')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Cluster Roles</div>
            <div className="text-xl font-bold text-slate-100">{clusterRoles.length}</div>
          </button>
          <button onClick={() => go('/r/rbac.authorization.k8s.io~v1~clusterrolebindings', 'ClusterRoleBindings')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Cluster Bindings</div>
            <div className="text-xl font-bold text-slate-100">{clusterRoleBindings.length}</div>
          </button>
          <button onClick={() => go('/r/rbac.authorization.k8s.io~v1~roles', 'Roles')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Roles</div>
            <div className="text-xl font-bold text-slate-100">{roles.length}</div>
          </button>
          <button onClick={() => go('/r/rbac.authorization.k8s.io~v1~rolebindings', 'RoleBindings')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Role Bindings</div>
            <div className="text-xl font-bold text-slate-100">{roleBindings.length}</div>
          </button>
          <button onClick={() => go('/r/v1~serviceaccounts', 'ServiceAccounts')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Service Accounts</div>
            <div className="text-xl font-bold text-slate-100">{serviceAccounts.length}</div>
          </button>
        </div>

        {/* RBAC Health Audit — right after stats, matching other pages */}
        <RBACHealthAudit
            clusterRoles={clusterRoles as any[]}
            clusterRoleBindings={clusterRoleBindings as any[]}
            roles={roles as any[]}
            roleBindings={roleBindings as any[]}
            serviceAccounts={serviceAccounts as any[]}
            namespaces={namespaces as any[]}
            users={users as any[]}
            go={go}
          />

        {/* Recent RBAC Changes */}
        <RecentRBACChanges
          clusterRoleBindings={clusterRoleBindings as any[]}
          roleBindings={roleBindings as any[]}
          go={go}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cluster Admin subjects */}
          <Panel title={`Cluster Admin Subjects (${broadPermissions.length})`} icon={<AlertTriangle className="w-4 h-4 text-yellow-500" />}>
            {broadPermissions.length === 0 ? (
              <div className="text-sm text-slate-500 py-4 text-center">No cluster-admin bindings found</div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-auto">
                {broadPermissions.slice(0, 15).map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50">
                    <div className="flex items-center gap-2">
                      {s.kind === 'ServiceAccount' ? <Key className="w-3.5 h-3.5 text-teal-400" /> :
                       s.kind === 'User' ? <Users className="w-3.5 h-3.5 text-blue-400" /> :
                       <Lock className="w-3.5 h-3.5 text-purple-400" />}
                      <span className="text-sm text-slate-200">{s.name}</span>
                      <span className="text-xs text-slate-500">{s.kind}</span>
                    </div>
                    <span className="text-xs text-slate-500">via {s.binding}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* SA by namespace */}
          <Panel title="Service Accounts by Namespace" icon={<Key className="w-4 h-4 text-teal-500" />}>
            <div className="space-y-2">
              {saByNamespace.map(([ns, count]) => (
                <div key={ns} className="flex items-center justify-between py-1 px-2">
                  <span className="text-sm text-slate-300">{ns}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${(count / serviceAccounts.length) * 100}%` }} />
                    </div>
                    <span className="text-xs text-slate-400 font-mono w-6 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Quick links */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: 'User Management', path: '/users' },
              { label: 'ClusterRoles', path: '/r/rbac.authorization.k8s.io~v1~clusterroles' },
              { label: 'ClusterRoleBindings', path: '/r/rbac.authorization.k8s.io~v1~clusterrolebindings' },
              { label: 'ServiceAccounts', path: '/r/v1~serviceaccounts' },
            ].map((item) => (
              <button key={item.label} onClick={() => go(item.path, item.label)}
                className="flex items-center justify-between px-3 py-2 rounded hover:bg-slate-800/50 text-left transition-colors">
                <span className="text-sm text-slate-300">{item.label}</span>
                <ArrowRight className="w-3 h-3 text-slate-600" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentRBACChanges({ clusterRoleBindings, roleBindings, go }: {
  clusterRoleBindings: any[]; roleBindings: any[]; go: (path: string, title: string) => void;
}) {
  const recentChanges = React.useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const changes: Array<{
      type: 'privilege-grant' | 'new-binding' | 'modified';
      name: string; namespace?: string; role: string;
      subjects: string[]; when: Date; severity: 'high' | 'medium' | 'low';
      clusterScoped: boolean;
    }> = [];

    const allBindings = [
      ...clusterRoleBindings.map((b: any) => ({ ...b, _clusterScoped: true })),
      ...roleBindings.map((b: any) => ({ ...b, _clusterScoped: false })),
    ];

    for (const b of allBindings) {
      const created = b.metadata?.creationTimestamp ? new Date(b.metadata.creationTimestamp) : null;
      if (!created || created.getTime() < sevenDaysAgo) continue;

      // Skip system-provided bindings
      const name = b.metadata?.name || '';
      if (name.startsWith('system:') || name.startsWith('openshift-')) continue;
      if (name.includes('installer') || name.includes('pruner')) continue;

      const role = b.roleRef?.name || '';
      const subjects = (b.subjects || [])
        .filter((s: any) => !s.name?.startsWith('system:'))
        .map((s: any) => `${s.kind}/${s.name}`);
      if (subjects.length === 0) continue;

      const isAdmin = role === 'cluster-admin' || role === 'admin';
      const severity = role === 'cluster-admin' ? 'high' : isAdmin ? 'medium' : 'low';

      changes.push({
        type: isAdmin ? 'privilege-grant' : 'new-binding',
        name,
        namespace: b.metadata?.namespace,
        role,
        subjects,
        when: created,
        severity,
        clusterScoped: b._clusterScoped,
      });
    }

    return changes.sort((a, b) => b.when.getTime() - a.when.getTime()).slice(0, 15);
  }, [clusterRoleBindings, roleBindings]);

  if (recentChanges.length === 0) return null;

  const highSeverity = recentChanges.filter(c => c.severity === 'high');

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-400" />
          Recent RBAC Changes (last 7 days)
        </h2>
        {highSeverity.length > 0 && (
          <span className="text-xs px-2 py-0.5 bg-red-900/50 text-red-300 rounded">{highSeverity.length} privilege escalation{highSeverity.length !== 1 ? 's' : ''}</span>
        )}
      </div>
      <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
        {recentChanges.map((change, i) => {
          const age = formatChangeAge(change.when);
          const gvr = change.clusterScoped ? 'rbac.authorization.k8s.io~v1~clusterrolebindings' : 'rbac.authorization.k8s.io~v1~rolebindings';
          const path = change.namespace
            ? `/r/${gvr}/${change.namespace}/${change.name}`
            : `/r/${gvr}/_/${change.name}`;

          return (
            <button key={i} onClick={() => go(path, change.name)}
              className="w-full px-4 py-3 text-left hover:bg-slate-800/30 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {change.severity === 'high' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  ) : change.severity === 'medium' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Shield className="w-3.5 h-3.5 text-slate-500" />
                  )}
                  <span className="text-sm text-slate-200">{change.name}</span>
                  {change.namespace && <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{change.namespace}</span>}
                </div>
                <span className="text-xs text-slate-500">{age}</span>
              </div>
              <div className="flex items-center gap-2 ml-5.5 text-xs">
                <span className={cn('px-1.5 py-0.5 rounded',
                  change.severity === 'high' ? 'bg-red-900/50 text-red-300' :
                  change.severity === 'medium' ? 'bg-amber-900/50 text-amber-300' :
                  'bg-slate-800 text-slate-400'
                )}>
                  → {change.role}
                </span>
                <span className="text-slate-500 truncate">
                  {change.subjects.slice(0, 2).join(', ')}{change.subjects.length > 2 ? ` +${change.subjects.length - 2}` : ''}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatChangeAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return `${Math.floor(ms / 60000)}m ago`;
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}


// ===== RBAC Health Audit =====

interface AuditCheck {
  id: string;
  title: string;
  description: string;
  why: string;
  passing: any[];
  failing: any[];
  yamlExample: string;
}

function RBACHealthAudit({
  clusterRoles,
  clusterRoleBindings,
  roles,
  roleBindings,
  serviceAccounts,
  namespaces,
  users,
  go,
}: {
  clusterRoles: any[];
  clusterRoleBindings: any[];
  roles: any[];
  roleBindings: any[];
  serviceAccounts: any[];
  namespaces: any[];
  users: any[];
  go: (path: string, title: string) => void;
}) {
  const [expandedCheck, setExpandedCheck] = React.useState<string | null>(null);

  // Helper: exclude system namespaces
  const isSystemNS = (ns: string) => ns.startsWith('openshift-') || ns.startsWith('kube-') || ns === 'openshift' || ns === 'default';

  // Helper: check if role is system-managed
  const isSystemRole = (roleName: string) =>
    roleName.startsWith('system:') || roleName.startsWith('openshift:') || roleName.includes(':kube-');

  const checks: AuditCheck[] = React.useMemo(() => {
    const allChecks: AuditCheck[] = [];

    // User namespaces only
    const userNamespaces = namespaces.filter((ns: any) => !isSystemNS(ns.metadata?.name || ''));
    const userRoleBindings = roleBindings.filter((rb: any) => !isSystemNS(rb.metadata?.namespace || ''));

    // Build set of existing user names
    const existingUsers = new Set(users.map((u: any) => u.metadata?.name).filter(Boolean));

    // 1. Default ServiceAccount privileges
    const defaultSAIssues = userNamespaces.map((ns: any) => {
      const nsName = ns.metadata.name;
      const defaultSA = serviceAccounts.find((sa: any) => sa.metadata.namespace === nsName && sa.metadata.name === 'default');
      if (!defaultSA) return null;

      // Check if default SA has cluster-admin or admin via RoleBindings
      const badBindings = userRoleBindings.filter((rb: any) => {
        if (rb.metadata.namespace !== nsName) return false;
        const roleRef = rb.roleRef?.name || '';
        if (roleRef !== 'cluster-admin' && roleRef !== 'admin') return false;
        return (rb.subjects || []).some((s: any) => s.kind === 'ServiceAccount' && s.name === 'default');
      });

      return badBindings.length > 0 ? { namespace: nsName, bindings: badBindings } : null;
    }).filter(Boolean);

    allChecks.push({
      id: 'default-sa',
      title: 'Default ServiceAccount Privileges',
      description: 'Default ServiceAccounts should not have cluster-admin or admin roles',
      why: 'Every pod that doesn\'t specify a serviceAccountName uses the "default" SA. Granting it elevated privileges means any pod in the namespace inherits those permissions, which violates least privilege.',
      passing: userNamespaces.filter((ns: any) => !defaultSAIssues.some((issue: any) => issue.namespace === ns.metadata.name)),
      failing: defaultSAIssues.map((issue: any) => ({ metadata: { name: issue.namespace, namespace: issue.namespace }, bindings: issue.bindings })),
      yamlExample: `# Instead of binding default SA, create a dedicated SA:
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app-sa
  namespace: my-namespace
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-app-admin
  namespace: my-namespace
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: admin
subjects:
- kind: ServiceAccount
  name: my-app-sa    # NOT default
  namespace: my-namespace`,
    });

    // 2. Overprivileged RoleBindings (cluster-admin in user namespaces)
    const overPrivileged = userRoleBindings.filter((rb: any) => {
      const roleRef = rb.roleRef?.name || '';
      return roleRef === 'cluster-admin';
    });

    allChecks.push({
      id: 'overprivileged-bindings',
      title: 'Overprivileged RoleBindings',
      description: 'RoleBindings should not grant cluster-admin in non-system namespaces',
      why: 'cluster-admin grants full cluster access, including reading secrets in all namespaces and modifying cluster resources. Namespace-scoped RoleBindings should use roles like "admin" or "edit" instead.',
      passing: userRoleBindings.filter((rb: any) => !overPrivileged.includes(rb)),
      failing: overPrivileged,
      yamlExample: `# Use namespace-scoped roles instead:
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-app-admin
  namespace: my-namespace
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: admin    # NOT cluster-admin
subjects:
- kind: User
  name: developer@example.com`,
    });

    // 3. Wildcard rules in ClusterRoles
    const userClusterRoles = clusterRoles.filter((cr: any) => !isSystemRole(cr.metadata?.name || ''));
    const wildcardRoles = userClusterRoles.filter((cr: any) => {
      const rules = cr.rules || [];
      return rules.some((rule: any) => {
        const resources = rule.resources || [];
        const verbs = rule.verbs || [];
        return resources.includes('*') || verbs.includes('*');
      });
    });

    allChecks.push({
      id: 'wildcard-rules',
      title: 'Wildcard Rules in ClusterRoles',
      description: 'ClusterRoles should avoid wildcard (*) in resources or verbs',
      why: 'Wildcard permissions grant access to all current and future resources/actions, making it impossible to audit what a role can do. Explicit permissions are more secure and maintainable.',
      passing: userClusterRoles.filter((cr: any) => !wildcardRoles.includes(cr)),
      failing: wildcardRoles,
      yamlExample: `# Instead of wildcards:
rules:
- apiGroups: ["apps"]
  resources: ["deployments", "statefulsets"]    # NOT ["*"]
  verbs: ["get", "list", "watch", "update"]      # NOT ["*"]`,
    });

    // 4. Stale RoleBindings (referencing non-existent users)
    // Note: On OpenShift, User objects are created on first login. A binding to a user
    // who hasn't logged in yet is not stale. Only flag bindings where the user was
    // explicitly deleted (existed before but doesn't now). Since we can't tell the
    // difference, we only flag if there are many more binding subjects than users.
    const allBoundUsers = new Set<string>();
    for (const rb of userRoleBindings) {
      for (const s of (rb as any).subjects || []) {
        if (s.kind === 'User' && s.name && !s.name.startsWith('system:')) allBoundUsers.add(s.name);
      }
    }
    const staleUsers = [...allBoundUsers].filter(u => !existingUsers.has(u));
    const staleBindings = staleUsers.length > 0 ? userRoleBindings.filter((rb: any) => {
      return (rb.subjects || []).some((s: any) => s.kind === 'User' && staleUsers.includes(s.name));
    }) : [];

    allChecks.push({
      id: 'stale-bindings',
      title: 'Stale RoleBindings',
      description: 'RoleBindings referencing users who have never logged in or were removed',
      why: 'On OpenShift, User objects are created on first login. Bindings to users without User objects may be pre-provisioned (valid) or stale. Review these to ensure they are intentional.',
      passing: userRoleBindings.filter((rb: any) => !staleBindings.includes(rb)),
      failing: staleBindings,
      yamlExample: `# Identify stale bindings:
# 1. List users: oc get users
# 2. Check RoleBinding subjects
# 3. Delete orphaned bindings:
oc delete rolebinding <name> -n <namespace>`,
    });

    // 5. Namespace isolation (namespaces with no RoleBindings)
    const namespacesWithBindings = new Set(userRoleBindings.map((rb: any) => rb.metadata?.namespace).filter(Boolean));
    const isolatedNamespaces = userNamespaces.filter((ns: any) => !namespacesWithBindings.has(ns.metadata.name));

    allChecks.push({
      id: 'namespace-isolation',
      title: 'Namespace Isolation',
      description: 'User namespaces should have at least one RoleBinding for access control',
      why: 'Namespaces with no RoleBindings have no explicit access control, relying only on cluster-wide permissions. This makes it unclear who can access what and prevents proper multi-tenancy.',
      passing: userNamespaces.filter((ns: any) => namespacesWithBindings.has(ns.metadata.name)),
      failing: isolatedNamespaces,
      yamlExample: `# Grant namespace access:
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: developers
  namespace: my-namespace
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: edit
subjects:
- kind: Group
  name: developers
  apiGroup: rbac.authorization.k8s.io`,
    });

    // 6. ServiceAccount token automount with elevated privileges
    const privilegedSAs = serviceAccounts.filter((sa: any) => {
      const ns = sa.metadata?.namespace || '';
      if (isSystemNS(ns)) return false;

      const automount = sa.automountServiceAccountToken !== false; // defaults to true
      if (!automount) return false;

      // Check if SA has cluster-admin or admin via RoleBindings
      const saName = sa.metadata?.name || '';
      const hasElevated = [...roleBindings, ...clusterRoleBindings].some((binding: any) => {
        const roleRef = binding.roleRef?.name || '';
        if (roleRef !== 'cluster-admin' && roleRef !== 'admin') return false;
        return (binding.subjects || []).some((s: any) =>
          s.kind === 'ServiceAccount' && s.name === saName && (!s.namespace || s.namespace === ns)
        );
      });

      return hasElevated;
    });

    const safeSAs = serviceAccounts.filter((sa: any) => !privilegedSAs.includes(sa) && !isSystemNS(sa.metadata?.namespace || ''));

    allChecks.push({
      id: 'sa-automount',
      title: 'ServiceAccount Token Automount',
      description: 'ServiceAccounts with elevated privileges should disable automountServiceAccountToken',
      why: 'When automountServiceAccountToken is true (default), the SA token is automatically mounted into every pod. If a pod is compromised, the attacker gains the SA\'s permissions. Disable automount unless the pod needs to call the Kubernetes API.',
      passing: safeSAs,
      failing: privilegedSAs,
      yamlExample: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: privileged-sa
  namespace: my-namespace
automountServiceAccountToken: false    # Disable unless needed
---
# For pods that need API access, opt in explicitly:
apiVersion: v1
kind: Pod
metadata:
  name: api-client
spec:
  serviceAccountName: privileged-sa
  automountServiceAccountToken: true    # Explicit opt-in`,
    });

    return allChecks;
  }, [clusterRoles, clusterRoleBindings, roles, roleBindings, serviceAccounts, namespaces, users]);

  const totalPassing = checks.reduce((s, c) => s + (c.failing.length === 0 ? 1 : 0), 0);
  const score = Math.round((totalPassing / checks.length) * 100);

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" /> RBAC Health Audit
        </h2>
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-bold', score === 100 ? 'text-green-400' : score >= 60 ? 'text-amber-400' : 'text-red-400')}>{score}%</span>
          <span className="text-xs text-slate-500">{totalPassing}/{checks.length} passing</span>
        </div>
      </div>
      <div className="divide-y divide-slate-800">
        {checks.map((check) => {
          const pass = check.failing.length === 0;
          const expanded = expandedCheck === check.id;
          return (
            <div key={check.id}>
              <button
                onClick={() => setExpandedCheck(expanded ? null : check.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {pass ? <CheckCircle className="w-4 h-4 text-green-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                  <div>
                    <span className="text-sm text-slate-200">{check.title}</span>
                    <span className="text-xs text-slate-500 ml-2">
                      {pass ? `${check.passing.length} pass` : `${check.failing.length} of ${check.failing.length + check.passing.length} need attention`}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-600">{expanded ? '▾' : '▸'}</span>
              </button>

              {expanded && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-xs text-slate-400">{check.description}</p>

                  {/* Why it matters */}
                  <div className="bg-blue-950/20 border border-blue-900/50 rounded p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Info className="w-3.5 h-3.5 text-blue-400" />
                      <div className="text-xs font-medium text-blue-300">Why it matters</div>
                    </div>
                    <p className="text-xs text-slate-400">{check.why}</p>
                  </div>

                  {/* Failing items */}
                  {check.failing.length > 0 && (
                    <div>
                      <div className="text-xs text-amber-400 font-medium mb-1.5">Issues ({check.failing.length})</div>
                      <div className="space-y-1 max-h-32 overflow-auto">
                        {check.failing.slice(0, 15).map((item: any, idx: number) => {
                          const name = item.metadata?.name || '';
                          const ns = item.metadata?.namespace || '';
                          const path = check.id === 'default-sa' || check.id === 'namespace-isolation'
                            ? `/r/v1~namespaces/_/${name}`
                            : check.id === 'wildcard-rules'
                            ? `/yaml/rbac.authorization.k8s.io~v1~clusterroles/_/${name}`
                            : `/yaml/rbac.authorization.k8s.io~v1~rolebindings/${ns}/${name}`;

                          return (
                            <button key={idx} onClick={() => go(path, name)}
                              className="flex items-center justify-between w-full py-1 px-2 rounded hover:bg-slate-800/50 text-left transition-colors">
                              <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                <span className="text-xs text-slate-300">{name}</span>
                                {ns && <span className="text-xs text-slate-600">{ns}</span>}
                              </div>
                              <span className="text-xs text-blue-400">View →</span>
                            </button>
                          );
                        })}
                        {check.failing.length > 15 && <div className="text-xs text-slate-600 px-2">+{check.failing.length - 15} more</div>}
                      </div>
                    </div>
                  )}

                  {/* Passing items */}
                  {check.passing.length > 0 && (
                    <div>
                      <div className="text-xs text-green-400 font-medium mb-1">Passing ({check.passing.length})</div>
                      <div className="flex flex-wrap gap-1">
                        {check.passing.slice(0, 8).map((item: any, idx: number) => (
                          <span key={idx} className="text-xs px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded">{item.metadata?.name || ''}</span>
                        ))}
                        {check.passing.length > 8 && <span className="text-xs text-slate-600">+{check.passing.length - 8} more</span>}
                      </div>
                    </div>
                  )}

                  {/* YAML example */}
                  <div>
                    <div className="text-xs text-slate-500 font-medium mb-1">How to fix:</div>
                    <pre className="text-[11px] text-emerald-400 font-mono bg-slate-950 p-3 rounded overflow-x-auto whitespace-pre-wrap">{check.yamlExample}</pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
