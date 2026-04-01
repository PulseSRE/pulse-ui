import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users, User, Shield, Key, ArrowRight, CheckCircle, AlertTriangle,
  UserCheck, Search, Activity, Clock, Lock, Fingerprint,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList, k8sGet, k8sDelete } from '../engine/query';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import type { K8sResource } from '../engine/renderers';
import type {
  ClusterRole, ClusterRoleBinding, Role, RoleBinding,
  ServiceAccount, Namespace, Subject,
} from '../engine/types';
import { formatAge } from '../engine/dateUtils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { Card } from '../components/primitives/Card';
import { Panel } from '../components/primitives/Panel';
import { EmptyState } from '../components/primitives/EmptyState';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { showErrorToast } from '../engine/errorToast';
import type { AuditCheck, AuditItem } from '../components/audit/types';
import { HealthAuditPanel } from '../components/audit/HealthAuditPanel';

// ---------------------------------------------------------------------------
// K8s resource with extra OpenShift-specific fields
// ---------------------------------------------------------------------------
type K8sResourceExt = K8sResource & {
  identities?: string[];
  users?: string[];
  userName?: string;
  clientName?: string;
  redirectURI?: string;
  scopes?: string[];
  expiresIn?: number;
  secrets?: { name: string }[];
};

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------
type TabId = 'users' | 'groups-sa' | 'rbac' | 'impersonation';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'users', label: 'Users', icon: <User className="w-3.5 h-3.5" /> },
  { id: 'groups-sa', label: 'Groups & Service Accounts', icon: <Key className="w-3.5 h-3.5" /> },
  { id: 'rbac', label: 'RBAC', icon: <Shield className="w-3.5 h-3.5" /> },
  { id: 'impersonation', label: 'Impersonation', icon: <UserCheck className="w-3.5 h-3.5" /> },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function IdentityView() {
  const go = useNavigateTab();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const impersonateUser = useUIStore((s) => s.impersonateUser);
  const setImpersonation = useUIStore((s) => s.setImpersonation);
  const clearImpersonation = useUIStore((s) => s.clearImpersonation);
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  const urlTab = new URLSearchParams(window.location.search).get('tab') as TabId | null;
  const [activeTab, setActiveTabState] = useState<TabId>(
    urlTab && ['users', 'groups-sa', 'rbac', 'impersonation'].includes(urlTab) ? urlTab : 'users',
  );
  const setActiveTab = (tab: TabId) => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === 'users') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  };
  const [search, setSearch] = useState('');

  // ---- Data (useK8sListWatch for real-time updates) ----
  const { data: users = [], isLoading: usersLoading } = useK8sListWatch({ apiPath: '/apis/user.openshift.io/v1/users' });
  const { data: groups = [] } = useK8sListWatch({ apiPath: '/apis/user.openshift.io/v1/groups' });
  const { data: serviceAccounts = [] } = useK8sListWatch({ apiPath: '/api/v1/serviceaccounts', namespace: nsFilter });
  const { data: clusterRoles = [] } = useK8sListWatch({ apiPath: '/apis/rbac.authorization.k8s.io/v1/clusterroles' });
  const { data: clusterRoleBindings = [] } = useK8sListWatch({ apiPath: '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings' });
  const { data: roles = [] } = useK8sListWatch({ apiPath: '/apis/rbac.authorization.k8s.io/v1/roles', namespace: nsFilter });
  const { data: roleBindings = [] } = useK8sListWatch({ apiPath: '/apis/rbac.authorization.k8s.io/v1/rolebindings', namespace: nsFilter });
  const { data: namespaces = [] } = useK8sListWatch({ apiPath: '/api/v1/namespaces' });

  // kubeadmin secret check
  const { data: kubeadminSecret } = useQuery({
    queryKey: ['users', 'kubeadmin-secret'],
    queryFn: async () => {
      const res = await fetch('/api/kubernetes/api/v1/namespaces/kube-system/secrets/kubeadmin');
      return res.ok;
    },
    staleTime: 60000,
  });

  // OAuth config
  const { data: oauthConfig } = useQuery({
    queryKey: ['users', 'oauth'],
    queryFn: () => k8sGet<any>('/apis/config.openshift.io/v1/oauths/cluster').catch(() => null),
    staleTime: 120000,
  });

  // OAuth access tokens (recent sessions)
  const { data: accessTokens = [] } = useQuery<K8sResource[]>({
    queryKey: ['users', 'oauthaccesstokens'],
    queryFn: () => k8sList('/apis/oauth.openshift.io/v1/oauthaccesstokens').catch(() => []),
    staleTime: 60000,
  });

  // ---- Derived data ----
  const userRoles = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const crb of clusterRoleBindings as ClusterRoleBinding[]) {
      const roleName = crb.roleRef?.name || '';
      for (const subject of crb.subjects || []) {
        if (subject.kind === 'User' || subject.kind === 'ServiceAccount') {
          const key = subject.kind === 'ServiceAccount'
            ? `system:serviceaccount:${subject.namespace}:${subject.name}`
            : subject.name;
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(roleName);
        }
        if (subject.kind === 'Group') {
          if (!map.has(`group:${subject.name}`)) map.set(`group:${subject.name}`, []);
          map.get(`group:${subject.name}`)!.push(roleName);
        }
      }
    }
    return map;
  }, [clusterRoleBindings]);

  // Filter helpers
  const q = search.toLowerCase();
  const filteredUsers = users.filter((u: K8sResource) => !q || u.metadata.name.toLowerCase().includes(q));
  const filteredGroups = groups.filter((g: K8sResource) => !q || g.metadata.name.toLowerCase().includes(q));
  const filteredSAs = serviceAccounts.filter((sa: K8sResourceExt) => {
    if (!q) return true;
    return sa.metadata.name.toLowerCase().includes(q) || sa.metadata.namespace?.toLowerCase().includes(q);
  });
  const appSAs = filteredSAs.filter((sa: K8sResourceExt) => {
    const ns = sa.metadata.namespace || '';
    return !ns.startsWith('openshift-') && !ns.startsWith('kube-') && ns !== 'openshift' && sa.metadata.name !== 'default';
  });

  // Cluster-admin subjects
  const clusterAdminBindings = React.useMemo(() => {
    return (clusterRoleBindings as ClusterRoleBinding[]).filter((b) => b.roleRef?.name === 'cluster-admin');
  }, [clusterRoleBindings]);

  const broadPermissions = React.useMemo(() => {
    const subjects: Array<{ name: string; kind: string; binding: string; namespace?: string }> = [];
    for (const b of clusterAdminBindings) {
      for (const s of b.subjects || []) {
        subjects.push({ name: s.name, kind: s.kind, binding: b.metadata.name, namespace: s.namespace });
      }
    }
    return subjects;
  }, [clusterAdminBindings]);

  // SA by namespace
  const saByNamespace = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const sa of serviceAccounts as ServiceAccount[]) {
      const ns = sa.metadata?.namespace || '';
      map.set(ns, (map.get(ns) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [serviceAccounts]);

  const handleImpersonate = (username: string) => {
    setImpersonation(username);
    addToast({ type: 'warning', title: `Impersonating ${username}`, detail: 'All API requests now use this identity' });
  };

  // ---- Loading skeleton ----
  const isLoading = usersLoading && users.length === 0;

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Fingerprint className="w-6 h-6 text-violet-500" />
              Identity &amp; Access
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Users, groups, service accounts, RBAC, and impersonation
              {nsFilter && <span className="text-violet-400 ml-1">in {nsFilter}</span>}
            </p>
          </div>
        </div>

        {/* Impersonation banner */}
        {impersonateUser && (
          <div className="flex items-center justify-between px-4 py-3 bg-amber-900/30 border border-amber-800 rounded-lg">
            <div className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-amber-400" />
              <span className="text-sm text-amber-200">Currently impersonating <span className="font-mono font-bold">{impersonateUser}</span></span>
            </div>
            <button onClick={() => { clearImpersonation(); addToast({ type: 'success', title: 'Impersonation cleared' }); }}
              className="px-3 py-1.5 text-xs bg-amber-800 hover:bg-amber-700 text-amber-200 rounded transition-colors">
              Stop Impersonating
            </button>
          </div>
        )}

        {/* Summary header with counts */}
        <MetricGrid className="md:grid-cols-5">
          <button onClick={() => setActiveTab('users')} className={cn('bg-slate-900 rounded-lg border p-3 text-left transition-colors', activeTab === 'users' ? 'border-violet-600' : 'border-slate-800 hover:border-slate-600')}>
            <div className="text-xs text-slate-400 mb-1">Users</div>
            <div className="text-xl font-bold text-slate-100">{users.length}</div>
          </button>
          <button onClick={() => setActiveTab('groups-sa')} className={cn('bg-slate-900 rounded-lg border p-3 text-left transition-colors', activeTab === 'groups-sa' ? 'border-violet-600' : 'border-slate-800 hover:border-slate-600')}>
            <div className="text-xs text-slate-400 mb-1">Groups</div>
            <div className="text-xl font-bold text-slate-100">{groups.length}</div>
          </button>
          <button onClick={() => setActiveTab('groups-sa')} className={cn('bg-slate-900 rounded-lg border p-3 text-left transition-colors', activeTab === 'groups-sa' ? 'border-violet-600' : 'border-slate-800 hover:border-slate-600')}>
            <div className="text-xs text-slate-400 mb-1">Service Accounts</div>
            <div className="text-xl font-bold text-slate-100">{serviceAccounts.length}</div>
          </button>
          <button onClick={() => setActiveTab('rbac')} className={cn('bg-slate-900 rounded-lg border p-3 text-left transition-colors', activeTab === 'rbac' ? 'border-violet-600' : 'border-slate-800 hover:border-slate-600')}>
            <div className="text-xs text-slate-400 mb-1">Cluster Roles</div>
            <div className="text-xl font-bold text-slate-100">{clusterRoles.length}</div>
          </button>
          <button onClick={() => setActiveTab('rbac')} className={cn('bg-slate-900 rounded-lg border p-3 text-left transition-colors', activeTab === 'rbac' ? 'border-violet-600' : 'border-slate-800 hover:border-slate-600')}>
            <div className="text-xs text-slate-400 mb-1">Role Bindings</div>
            <div className="text-xl font-bold text-slate-100">{clusterRoleBindings.length + roleBindings.length}</div>
          </button>
        </MetricGrid>

        {/* Issues banner */}
        {broadPermissions.length > 5 && (
          <div className="flex items-center px-4 py-2.5 rounded-lg border bg-yellow-950/30 border-yellow-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-slate-200">{broadPermissions.length} subjects have cluster-admin — review below</span>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-slate-900 rounded-lg border border-slate-800 p-3 animate-pulse">
                <div className="h-3 bg-slate-800 rounded w-2/3 mb-2" />
                <div className="h-5 bg-slate-800 rounded w-1/3" />
              </div>
            ))}
          </div>
        )}

        {/* Tabs + Search */}
        <div className="flex items-center gap-3">
          <div
            className="flex gap-1 bg-slate-900 rounded-lg p-1"
            role="tablist"
            aria-label="Identity tabs"
            onKeyDown={(e) => {
              const ids = TABS.map((t) => t.id);
              const idx = ids.indexOf(activeTab);
              if (e.key === 'ArrowRight') { e.preventDefault(); setActiveTab(ids[(idx + 1) % ids.length]); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveTab(ids[(idx - 1 + ids.length) % ids.length]); }
            }}
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`identity-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
                  activeTab === tab.id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200',
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
        </div>

        {/* ==================== USERS TAB ==================== */}
        {activeTab === 'users' && (
          <>
            <Card>
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">Users ({filteredUsers.length})</h2>
              </div>
              <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
                {filteredUsers.length === 0 ? (
                  <EmptyState icon={<User className="w-8 h-8" />} title="No users found" description="No OpenShift users match your search." />
                ) : filteredUsers.map((user: K8sResourceExt) => {
                  const uRoles = userRoles.get(user.metadata.name) || [];
                  const isAdmin = uRoles.some((r) => r === 'cluster-admin');
                  const identities = user.identities || [];
                  return (
                    <div key={user.metadata.uid} className="px-4 py-3 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
                          <User className="w-4 h-4 text-slate-400" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-200">{user.metadata.name}</span>
                            {isAdmin && <span className="text-xs px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded">cluster-admin</span>}
                            {user.metadata.name === 'kube:admin' && <span className="text-xs px-1.5 py-0.5 bg-amber-900/50 text-amber-300 rounded">built-in</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {identities.length > 0 && <span className="text-xs text-slate-500">{identities[0]}</span>}
                            {uRoles.length > 0 && uRoles.length <= 3 && uRoles.map((r) => (
                              <span key={r} className="text-xs px-1 py-0.5 bg-slate-800 text-slate-500 rounded">{r}</span>
                            ))}
                            {uRoles.length > 3 && <span className="text-xs text-slate-600">+{uRoles.length} roles</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleImpersonate(user.metadata.name)}
                        disabled={impersonateUser === user.metadata.name}
                        className={cn('px-2.5 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors',
                          impersonateUser === user.metadata.name
                            ? 'bg-amber-900/50 text-amber-300'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200')}
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        {impersonateUser === user.metadata.name ? 'Impersonating' : 'Impersonate'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Recent Sessions */}
            {accessTokens.length > 0 && (
              <RecentSessions accessTokens={accessTokens} go={go} />
            )}

            {/* Identity & Access Audit */}
            <IdentityAudit
              users={users as K8sResource[]}
              groups={groups as K8sResource[]}
              clusterRoleBindings={clusterRoleBindings as ClusterRoleBinding[]}
              oauthConfig={oauthConfig}
              accessTokens={accessTokens as K8sResource[]}
              kubeadminExists={kubeadminSecret === true}
              go={go}
              addToast={addToast}
              queryClient={queryClient}
            />
          </>
        )}

        {/* ==================== GROUPS & SERVICE ACCOUNTS TAB ==================== */}
        {activeTab === 'groups-sa' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Groups */}
              <Card>
                <div className="px-4 py-3 border-b border-slate-800">
                  <h2 className="text-sm font-semibold text-slate-100">Groups ({filteredGroups.length})</h2>
                </div>
                <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
                  {filteredGroups.length === 0 ? (
                    <EmptyState icon={<Users className="w-8 h-8" />} title="No groups found" description="No OpenShift groups match your search." />
                  ) : filteredGroups.map((group: K8sResourceExt) => {
                    const members = group.users || [];
                    const gRoles = userRoles.get(`group:${group.metadata.name}`) || [];
                    return (
                      <div key={group.metadata.uid} className="px-4 py-3 hover:bg-slate-800/30 transition-colors">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-violet-400" />
                            <span className="text-sm font-medium text-slate-200">{group.metadata.name}</span>
                            <span className="text-xs text-slate-500">{members.length} member{members.length !== 1 ? 's' : ''}</span>
                          </div>
                          {gRoles.length > 0 && (
                            <div className="flex gap-1">
                              {gRoles.slice(0, 3).map((r) => (
                                <span key={r} className="text-xs px-1.5 py-0.5 bg-violet-900/50 text-violet-300 rounded">{r}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {members.length > 0 && (
                          <div className="flex flex-wrap gap-1 ml-6">
                            {members.slice(0, 10).map((m: string) => (
                              <span key={m} className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{m}</span>
                            ))}
                            {members.length > 10 && <span className="text-xs text-slate-600">+{members.length - 10} more</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Service Accounts */}
              <Card>
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-100">Service Accounts (application namespaces)</h2>
                  <button onClick={() => go('/r/v1~serviceaccounts', 'ServiceAccounts')} className="text-xs text-violet-400 hover:text-violet-300">View all →</button>
                </div>
                <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
                  {appSAs.length === 0 ? (
                    <EmptyState icon={<Key className="w-8 h-8" />} title="No application service accounts" description="No non-system service accounts match your search." />
                  ) : appSAs.slice(0, 50).map((sa: K8sResourceExt) => {
                    const saName = `system:serviceaccount:${sa.metadata.namespace}:${sa.metadata.name}`;
                    const saRoles = userRoles.get(saName) || [];
                    return (
                      <div key={sa.metadata.uid} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <Key className="w-4 h-4 text-slate-500" />
                          <div>
                            <span className="text-sm text-slate-200">{sa.metadata.name}</span>
                            <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded ml-2">{sa.metadata.namespace}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {saRoles.length > 0 && (
                            <span className="text-xs text-slate-500">{saRoles.length} role{saRoles.length !== 1 ? 's' : ''}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>

            {/* SA by Namespace breakdown */}
            <Panel title="Service Accounts by Namespace" icon={<Key className="w-4 h-4 text-violet-500" />}>
              <div className="space-y-2">
                {saByNamespace.map(([ns, count]) => (
                  <div key={ns} className="flex items-center justify-between py-1 px-2">
                    <span className="text-sm text-slate-300">{ns}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full" style={{ width: `${(count / serviceAccounts.length) * 100}%` }} />
                      </div>
                      <span className="text-xs text-slate-400 font-mono w-6 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}

        {/* ==================== RBAC TAB ==================== */}
        {activeTab === 'rbac' && (
          <>
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

            {/* RBAC Health Audit */}
            <RBACHealthAudit
              clusterRoles={clusterRoles as ClusterRole[]}
              clusterRoleBindings={clusterRoleBindings as ClusterRoleBinding[]}
              roles={roles as Role[]}
              roleBindings={roleBindings as RoleBinding[]}
              serviceAccounts={serviceAccounts as ServiceAccount[]}
              namespaces={namespaces as Namespace[]}
              users={users}
              go={go}
            />

            {/* Recent RBAC Changes */}
            <RecentRBACChanges
              clusterRoleBindings={clusterRoleBindings as ClusterRoleBinding[]}
              roleBindings={roleBindings as RoleBinding[]}
              go={go}
            />

            {/* Cluster Admin subjects */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Panel title={`Cluster Admin Subjects (${broadPermissions.length})`} icon={<AlertTriangle className="w-4 h-4 text-yellow-500" />}>
                {broadPermissions.length === 0 ? (
                  <EmptyState icon={<Shield className="w-8 h-8" />} title="No cluster-admin bindings" description="No subjects have cluster-admin privileges." className="py-6" />
                ) : (
                  <div className="space-y-1 max-h-64 overflow-auto">
                    {broadPermissions.slice(0, 15).map((s) => (
                      <div key={`${s.kind}:${s.namespace || ''}:${s.name}:${s.binding}`} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50">
                        <div className="flex items-center gap-2">
                          {s.kind === 'ServiceAccount' ? <Key className="w-3.5 h-3.5 text-teal-400" /> :
                           s.kind === 'User' ? <Users className="w-3.5 h-3.5 text-violet-400" /> :
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

              <Panel title="Service Accounts by Namespace" icon={<Key className="w-4 h-4 text-violet-500" />}>
                <div className="space-y-2">
                  {saByNamespace.map(([ns, count]) => (
                    <div key={ns} className="flex items-center justify-between py-1 px-2">
                      <span className="text-sm text-slate-300">{ns}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${(count / serviceAccounts.length) * 100}%` }} />
                        </div>
                        <span className="text-xs text-slate-400 font-mono w-6 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        )}

        {/* ==================== IMPERSONATION TAB ==================== */}
        {activeTab === 'impersonation' && (
          <>
            {/* Current impersonation status */}
            <Card>
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-violet-400" /> Impersonation
                </h2>
              </div>
              <div className="p-4">
                {impersonateUser ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-900/30 flex items-center justify-center">
                        <UserCheck className="w-5 h-5 text-amber-400" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-200">Currently impersonating</div>
                        <div className="text-sm font-mono text-amber-300">{impersonateUser}</div>
                      </div>
                    </div>
                    <button onClick={() => { clearImpersonation(); addToast({ type: 'success', title: 'Impersonation cleared' }); }}
                      className="px-3 py-1.5 text-xs bg-amber-800 hover:bg-amber-700 text-amber-200 rounded transition-colors">
                      Stop Impersonating
                    </button>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">Not currently impersonating any user. Select a user or service account below to impersonate.</div>
                )}
              </div>
            </Card>

            {/* Users to impersonate */}
            <Card>
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">Users</h2>
              </div>
              <div className="divide-y divide-slate-800 max-h-[400px] overflow-auto">
                {filteredUsers.length === 0 ? (
                  <EmptyState icon={<User className="w-8 h-8" />} title="No users found" className="py-6" />
                ) : filteredUsers.map((user: K8sResourceExt) => (
                  <div key={user.metadata.uid} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <User className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-200">{user.metadata.name}</span>
                    </div>
                    <button
                      onClick={() => handleImpersonate(user.metadata.name)}
                      disabled={impersonateUser === user.metadata.name}
                      className={cn('px-2.5 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors',
                        impersonateUser === user.metadata.name
                          ? 'bg-amber-900/50 text-amber-300'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200')}
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      {impersonateUser === user.metadata.name ? 'Active' : 'Impersonate'}
                    </button>
                  </div>
                ))}
              </div>
            </Card>

            {/* Service Accounts to impersonate */}
            <Card>
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">Service Accounts</h2>
              </div>
              <div className="divide-y divide-slate-800 max-h-[400px] overflow-auto">
                {appSAs.length === 0 ? (
                  <EmptyState icon={<Key className="w-8 h-8" />} title="No application service accounts" className="py-6" />
                ) : appSAs.slice(0, 50).map((sa: K8sResourceExt) => {
                  const saFullName = `system:serviceaccount:${sa.metadata.namespace}:${sa.metadata.name}`;
                  return (
                    <div key={sa.metadata.uid} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <Key className="w-4 h-4 text-slate-500" />
                        <div>
                          <span className="text-sm text-slate-200">{sa.metadata.name}</span>
                          <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded ml-2">{sa.metadata.namespace}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleImpersonate(saFullName)}
                        disabled={impersonateUser === saFullName}
                        className={cn('px-2 py-1 text-xs rounded flex items-center gap-1.5 transition-colors',
                          impersonateUser === saFullName
                            ? 'bg-amber-900/50 text-amber-300'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200')}
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        {impersonateUser === saFullName ? 'Active' : 'Impersonate'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}

        {/* Quick links */}
        <Card className="p-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Related Resources</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: 'ClusterRoles', path: '/r/rbac.authorization.k8s.io~v1~clusterroles' },
              { label: 'ClusterRoleBindings', path: '/r/rbac.authorization.k8s.io~v1~clusterrolebindings' },
              { label: 'Roles', path: '/r/rbac.authorization.k8s.io~v1~roles' },
              { label: 'RoleBindings', path: '/r/rbac.authorization.k8s.io~v1~rolebindings' },
            ].map((item) => (
              <button key={item.label} onClick={() => go(item.path, item.label)}
                className="flex items-center justify-between px-3 py-2 rounded hover:bg-slate-800/50 text-left transition-colors">
                <span className="text-sm text-slate-300">{item.label}</span>
                <ArrowRight className="w-3 h-3 text-slate-600" />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Sessions sub-component
// ---------------------------------------------------------------------------
function RecentSessions({ accessTokens, go }: { accessTokens: K8sResource[]; go: (path: string, title: string) => void }) {
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Clock className="w-4 h-4 text-violet-400" /> Recent Sessions ({accessTokens.length})
        </h2>
        <button onClick={() => go('/r/oauth.openshift.io~v1~oauthaccesstokens', 'OAuthAccessTokens')} className="text-xs text-violet-400 hover:text-violet-300">View all →</button>
      </div>
      <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
        {[...(accessTokens as K8sResource[])].sort((a: K8sResourceExt, b: K8sResourceExt) =>
          new Date(b.metadata.creationTimestamp || 0).getTime() - new Date(a.metadata.creationTimestamp || 0).getTime()
        ).slice(0, 15).map((token: K8sResourceExt) => {
          const userName = token.userName || 'unknown';
          const clientName = token.clientName || '';
          const redirectURI = token.redirectURI || '';
          const created = token.metadata.creationTimestamp ? new Date(token.metadata.creationTimestamp) : null;
          const age = created ? formatAge(created) : '—';
          const scopes = token.scopes || [];
          const expiresIn = token.expiresIn || 0;
          const expiresAt = created && expiresIn ? new Date(created.getTime() + expiresIn * 1000) : null;
          const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : false;
          const timeLeft = expiresAt && !isExpired ? formatAge(new Date(Date.now() - (expiresAt.getTime() - Date.now()))).replace(' ago', '') : null;
          const isSA = userName.startsWith('system:serviceaccount:');

          return (
            <div key={token.metadata.uid} className="px-4 py-3 hover:bg-slate-800/30 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {isSA ? <Key className="w-3.5 h-3.5 text-slate-500" /> : <User className="w-3.5 h-3.5 text-slate-500" />}
                  <span className="text-sm font-medium text-slate-200">{userName}</span>
                  {isExpired && <span className="text-xs px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded">expired</span>}
                  {!isExpired && expiresAt && <span className="text-xs px-1.5 py-0.5 bg-green-900/50 text-green-300 rounded">active</span>}
                </div>
                <span className="text-xs text-slate-500">{age}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 ml-5.5">
                {clientName && <span>Client: <span className="text-slate-400">{clientName}</span></span>}
                {expiresAt && (
                  <span>
                    {isExpired
                      ? <span className="text-red-400">Expired {formatAge(expiresAt)}</span>
                      : <span>Expires in <span className="text-slate-400">{timeLeft}</span></span>}
                  </span>
                )}
              </div>
              {(scopes.length > 0 || redirectURI) && (
                <div className="flex items-center gap-2 mt-1 ml-5.5 flex-wrap">
                  {scopes.map((s: string) => (
                    <span key={s} className="text-xs px-1 py-0.5 bg-slate-800 text-slate-500 rounded">{s}</span>
                  ))}
                  {redirectURI && (
                    <span className="text-xs text-slate-600 truncate max-w-[200px]" title={redirectURI}>
                      → {redirectURI.replace(/^https?:\/\//, '').split('/')[0]}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Identity & Access Audit (from UserManagementView)
// ---------------------------------------------------------------------------
function IdentityAudit({ users, groups, clusterRoleBindings, oauthConfig, accessTokens, kubeadminExists, go, addToast, queryClient }: {
  users: K8sResource[]; groups: K8sResource[]; clusterRoleBindings: ClusterRoleBinding[]; oauthConfig: any;
  accessTokens: K8sResource[]; kubeadminExists: boolean; go: (path: string, title: string) => void;
  addToast: (t: any) => void; queryClient: any;
}) {
  const [expandedCheck, setExpandedCheck] = React.useState<string | null>(null);
  const [confirmAction, setConfirmAction] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['users', 'current'],
    queryFn: async () => {
      const res = await fetch('/api/kubernetes/apis/user.openshift.io/v1/users/~');
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 300000,
  });
  const currentUserIsKubeAdmin = currentUser?.metadata?.name === 'kube:admin';

  const handleAction = async (actionId: string) => {
    setActionLoading(true);
    try {
      if (actionId === 'remove-kubeadmin') {
        await k8sDelete('/api/v1/namespaces/kube-system/secrets/kubeadmin');
        addToast({ type: 'success', title: 'kubeadmin removed', detail: 'The kubeadmin secret has been deleted' });
        queryClient.invalidateQueries({ queryKey: ['users', 'list'] });
      }
    } catch (err: any) {
      showErrorToast(err, 'Action failed');
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const checks = React.useMemo(() => {
    const allChecks: Array<{
      id: string; title: string; description: string; why: string;
      passing: Array<{ metadata?: { name?: string; uid?: string }; name?: string; binding?: string; [key: string]: unknown }>; failing: Array<{ metadata?: { name?: string; uid?: string }; name?: string; binding?: string; [key: string]: unknown }>; yamlExample: string;
      action?: { label: string; danger?: boolean; id: string; path?: string };
    }> = [];

    // 1. Identity Providers configured
    const idps = oauthConfig?.spec?.identityProviders || [];
    allChecks.push({
      id: 'identity-providers',
      title: 'Identity Providers',
      description: 'At least one identity provider should be configured for user authentication',
      why: 'Without an identity provider, only kubeadmin can log in. Configure HTPasswd, LDAP, GitHub, Google, or OpenID Connect for real user authentication.',
      passing: idps.length > 0 ? idps : [],
      failing: idps.length === 0 ? [{ metadata: { name: 'No identity providers configured' } }] : [],
      yamlExample: `# Configure via Administration → Cluster Config → OAuth
# Or apply directly:
apiVersion: config.openshift.io/v1
kind: OAuth
metadata:
  name: cluster
spec:
  identityProviders:
  - name: my-htpasswd
    mappingMethod: claim
    type: HTPasswd
    htpasswd:
      fileData:
        name: htpass-secret`,
      action: idps.length === 0 ? { label: 'Configure Identity Provider', id: 'configure-oauth', path: '/admin?tab=config' } : undefined,
    });

    // 2. kubeadmin removed
    const hasKubeAdmin = kubeadminExists;
    allChecks.push({
      id: 'kubeadmin-removed',
      title: 'kubeadmin Removed',
      description: 'The default kubeadmin account should be removed after configuring an identity provider',
      why: 'kubeadmin has full cluster-admin access with a static password. Remove it after setting up real identity providers: oc delete secret kubeadmin -n kube-system',
      passing: hasKubeAdmin ? [] : [{ metadata: { name: 'kubeadmin removed' } }],
      failing: hasKubeAdmin ? [{ metadata: { name: 'kube:admin still exists' } }] : [],
      yamlExample: currentUserIsKubeAdmin
        ? `# You are currently logged in as kubeadmin.
# Log in as another admin user first, then remove kubeadmin.
# oc login -u <other-admin-user>
# oc delete secret kubeadmin -n kube-system`
        : `# This deletes the kubeadmin secret from kube-system.
# Equivalent to: oc delete secret kubeadmin -n kube-system
# WARNING: Irreversible. Verify IdP login works first.`,
      action: hasKubeAdmin && idps.length > 0 && !currentUserIsKubeAdmin
        ? { label: 'Remove kubeadmin', danger: true, id: 'remove-kubeadmin' } : undefined,
    });

    // 3. Cluster-admin bindings audit
    const clusterAdminBindings = clusterRoleBindings.filter((crb) => {
      if (crb.roleRef?.name !== 'cluster-admin') return false;
      const name = crb.metadata?.name || '';
      return !name.startsWith('system:') && !name.startsWith('openshift-');
    });
    const clusterAdminUsers = clusterAdminBindings.flatMap((crb) =>
      (crb.subjects || []).filter((s) => s.kind === 'User' && !s.name?.startsWith('system:')).map((s) => ({
        metadata: { name: s.name, uid: `${crb.metadata.name}-${s.name}` },
        binding: crb.metadata.name,
      }))
    );
    allChecks.push({
      id: 'cluster-admin-audit',
      title: 'Cluster Admin Audit',
      description: 'Review all users and service accounts with cluster-admin privileges',
      why: 'cluster-admin has unrestricted access to all resources. Every cluster-admin binding should be intentional and documented. Excessive cluster-admin grants increase blast radius of compromised accounts.',
      passing: clusterAdminUsers.length <= 2 ? clusterAdminUsers : [],
      failing: clusterAdminUsers.length > 2 ? clusterAdminUsers : [],
      yamlExample: `# List all cluster-admin bindings:
oc get clusterrolebindings -o json | jq '.items[] | select(.roleRef.name=="cluster-admin") | .subjects[]'

# Remove unnecessary binding:
oc delete clusterrolebinding <binding-name>

# Use scoped roles instead:
oc adm policy add-cluster-role-to-user edit <user>`,
      action: clusterAdminUsers.length > 2 ? { label: 'View ClusterRoleBindings', id: 'view-crb', path: '/r/rbac.authorization.k8s.io~v1~clusterrolebindings' } : undefined,
    });

    // 4. Service accounts with cluster-admin
    const saClusterAdmins = clusterAdminBindings.flatMap((crb) =>
      (crb.subjects || []).filter((s) => {
        if (s.kind !== 'ServiceAccount') return false;
        const ns = s.namespace || '';
        return !ns.startsWith('openshift-') && !ns.startsWith('kube-') && ns !== 'openshift';
      }).map((s) => ({
        metadata: { name: `${s.namespace}/${s.name}`, uid: `${crb.metadata.name}-${s.namespace}-${s.name}` },
      }))
    );
    allChecks.push({
      id: 'sa-cluster-admin',
      title: 'Service Account Privileges',
      description: 'Service accounts with cluster-admin should be minimized',
      why: 'Compromised service account tokens can be used from any pod. SA tokens are long-lived and auto-mounted. Prefer scoped roles (edit, view) over cluster-admin for service accounts.',
      passing: saClusterAdmins.length === 0 ? [{ metadata: { name: 'No SAs with cluster-admin' } }] : [],
      failing: saClusterAdmins,
      yamlExample: `# Use scoped roles for service accounts:
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-sa-edit
  namespace: my-namespace
subjects:
- kind: ServiceAccount
  name: my-sa
  namespace: my-namespace
roleRef:
  kind: ClusterRole
  name: edit
  apiGroup: rbac.authorization.k8s.io`,
      action: saClusterAdmins.length > 0 ? { label: 'View ClusterRoleBindings', id: 'view-sa-crb', path: '/r/rbac.authorization.k8s.io~v1~clusterrolebindings' } : undefined,
    });

    // 5. Inactive users
    const activeUsers = new Set(accessTokens.map((t) => (t as K8sResourceExt).userName));
    const inactiveUsers = users.filter((u) => !activeUsers.has(u.metadata.name) && u.metadata.name !== 'kube:admin');
    allChecks.push({
      id: 'inactive-users',
      title: 'Inactive Users',
      description: 'Users without recent OAuth sessions may be stale accounts',
      why: 'Stale user accounts with active role bindings are a security risk. Review and remove users who no longer need access. Inactive accounts can be compromised without detection.',
      passing: users.filter((u) => activeUsers.has(u.metadata.name)),
      failing: inactiveUsers,
      yamlExample: `# Remove inactive user:
oc delete user <username>
oc delete identity <identity-name>

# Review user's role bindings first:
oc get rolebindings,clusterrolebindings --all-namespaces -o json | jq '.items[] | select(.subjects[]?.name=="<username>")'`,
      action: inactiveUsers.length > 0 ? { label: 'View Users', id: 'view-users', path: '/r/user.openshift.io~v1~users' } : undefined,
    });

    // 6. Groups configured
    allChecks.push({
      id: 'groups-configured',
      title: 'Group-Based Access',
      description: 'Use groups for role assignments instead of individual user bindings',
      why: 'Managing RBAC per-user does not scale. Groups enable consistent access control, easier onboarding/offboarding, and auditable policies. Bind roles to groups, then add/remove users from groups.',
      passing: groups.length > 0 ? groups : [],
      failing: groups.length === 0 ? [{ metadata: { name: 'No groups configured' } }] : [],
      yamlExample: `# Create a group:
oc adm groups new developers user1 user2

# Bind a role to the group:
oc adm policy add-cluster-role-to-group edit developers

# Or via YAML:
apiVersion: user.openshift.io/v1
kind: Group
metadata:
  name: developers
users:
- user1
- user2`,
      action: groups.length === 0 ? { label: 'Create Group', id: 'create-group', path: '/create/user.openshift.io~v1~groups' } : undefined,
    });

    return allChecks;
  }, [users, groups, clusterRoleBindings, oauthConfig, accessTokens, kubeadminExists, currentUserIsKubeAdmin]);

  const totalPassing = checks.reduce((s, c) => s + (c.failing.length === 0 ? 1 : 0), 0);
  const score = Math.round((totalPassing / checks.length) * 100);

  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-violet-400" /> Identity & Access Audit
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
                      {pass ? `${check.passing.length} pass` : `${check.failing.length} need attention`}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-600">{expanded ? '▾' : '▸'}</span>
              </button>
              {expanded && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-xs text-slate-400">{check.description}</p>
                  <div className="bg-violet-950/20 border border-violet-900/50 rounded p-3">
                    <div className="text-xs font-medium text-violet-300 mb-1">Why it matters</div>
                    <p className="text-xs text-slate-400">{check.why}</p>
                  </div>
                  {check.failing.length > 0 && (
                    <div>
                      <div className="text-xs text-amber-400 font-medium mb-1.5">Needs attention ({check.failing.length})</div>
                      <div className="space-y-1 max-h-32 overflow-auto">
                        {check.failing.slice(0, 10).map((item, idx) => (
                          <div key={item.metadata?.uid || idx} className="flex items-center gap-2 py-1 px-2 rounded bg-slate-800/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                            <span className="text-xs text-slate-300">{item.metadata?.name}</span>
                            {item.binding && <span className="text-xs text-slate-600">via {item.binding}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {check.passing.length > 0 && (
                    <div>
                      <div className="text-xs text-green-400 font-medium mb-1">Passing ({check.passing.length})</div>
                      <div className="flex flex-wrap gap-1">
                        {check.passing.slice(0, 8).map((item, idx) => (
                          <span key={item.metadata?.uid || item.name || idx} className="text-xs px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded">
                            {item.metadata?.name || item.name || 'OK'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-xs text-slate-500 font-medium mb-1">How to fix:</div>
                    <pre className="text-[11px] text-emerald-400 font-mono bg-slate-950 p-3 rounded overflow-x-auto whitespace-pre-wrap">{check.yamlExample}</pre>
                    {check.action && (
                      <button
                        onClick={() => {
                          if (check.action!.danger) {
                            setConfirmAction(check.action!.id);
                          } else if (check.action!.path) {
                            const pageName = check.action!.path.startsWith('/admin') ? 'Admin'
                              : check.action!.path.startsWith('/access-control') ? 'Access Control'
                              : check.action!.path.startsWith('/users') ? 'Users'
                              : check.action!.label;
                            go(check.action!.path, pageName);
                          }
                        }}
                        className={cn('mt-2 px-3 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors',
                          check.action.danger ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-violet-600 hover:bg-violet-500 text-white')}
                      >
                        {check.action.label} {!check.action.danger && <ArrowRight className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={confirmAction === 'remove-kubeadmin'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => handleAction('remove-kubeadmin')}
        title="Remove kubeadmin?"
        description="This permanently deletes the kubeadmin secret from kube-system. You will no longer be able to log in as kubeadmin. Make sure you can log in with another admin user first. This action cannot be undone."
        confirmLabel="Remove kubeadmin"
        variant="danger"
        loading={actionLoading}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RBAC Health Audit (from AccessControlView)
// ---------------------------------------------------------------------------
function RBACHealthAudit({
  clusterRoles, clusterRoleBindings, roles, roleBindings,
  serviceAccounts, namespaces, users, go,
}: {
  clusterRoles: ClusterRole[]; clusterRoleBindings: ClusterRoleBinding[];
  roles: Role[]; roleBindings: RoleBinding[];
  serviceAccounts: ServiceAccount[]; namespaces: Namespace[];
  users: K8sResource[]; go: (path: string, title: string) => void;
}) {
  const isSystemNS = (ns: string) => ns.startsWith('openshift-') || ns.startsWith('kube-') || ns === 'openshift' || ns === 'default';
  const isSystemRole = (roleName: string) =>
    roleName.startsWith('system:') || roleName.startsWith('openshift:') || roleName.includes(':kube-');

  const checks: AuditCheck[] = React.useMemo(() => {
    const allChecks: AuditCheck[] = [];
    const userNamespaces = namespaces.filter((ns) => !isSystemNS(ns.metadata?.name || ''));
    const userRoleBindings = roleBindings.filter((rb) => !isSystemNS(rb.metadata?.namespace || ''));
    const existingUsers = new Set(users.map((u) => u.metadata?.name).filter(Boolean));

    // 1. Default ServiceAccount privileges
    const defaultSAIssues = userNamespaces.map((ns) => {
      const nsName = ns.metadata.name;
      const defaultSA = serviceAccounts.find((sa) => sa.metadata.namespace === nsName && sa.metadata.name === 'default');
      if (!defaultSA) return null;
      const badBindings = userRoleBindings.filter((rb) => {
        if (rb.metadata.namespace !== nsName) return false;
        const roleRef = rb.roleRef?.name || '';
        if (roleRef !== 'cluster-admin' && roleRef !== 'admin') return false;
        return (rb.subjects || []).some((s) => s.kind === 'ServiceAccount' && s.name === 'default');
      });
      return badBindings.length > 0 ? { namespace: nsName, bindings: badBindings } : null;
    }).filter((x): x is NonNullable<typeof x> => x !== null);

    allChecks.push({
      id: 'default-sa',
      title: 'Default ServiceAccount Privileges',
      description: 'Default ServiceAccounts should not have cluster-admin or admin roles',
      why: 'Every pod that doesn\'t specify a serviceAccountName uses the "default" SA. Granting it elevated privileges means any pod in the namespace inherits those permissions, which violates least privilege.',
      passing: userNamespaces.filter((ns) => !defaultSAIssues.some((issue) => issue.namespace === ns.metadata.name)),
      failing: defaultSAIssues.map((issue) => ({ metadata: { name: issue.namespace, namespace: issue.namespace }, bindings: issue.bindings })),
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

    // 2. Overprivileged RoleBindings
    const overPrivileged = userRoleBindings.filter((rb) => rb.roleRef?.name === 'cluster-admin');
    allChecks.push({
      id: 'overprivileged-bindings',
      title: 'Overprivileged RoleBindings',
      description: 'RoleBindings should not grant cluster-admin in non-system namespaces',
      why: 'cluster-admin grants full cluster access, including reading secrets in all namespaces and modifying cluster resources. Namespace-scoped RoleBindings should use roles like "admin" or "edit" instead.',
      passing: userRoleBindings.filter((rb) => !overPrivileged.includes(rb)),
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
    const userClusterRoles = clusterRoles.filter((cr) => !isSystemRole(cr.metadata?.name || ''));
    const wildcardRoles = userClusterRoles.filter((cr) => {
      const rules = cr.rules || [];
      return rules.some((rule) => {
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
      passing: userClusterRoles.filter((cr) => !wildcardRoles.includes(cr)),
      failing: wildcardRoles,
      yamlExample: `# Instead of wildcards:
rules:
- apiGroups: ["apps"]
  resources: ["deployments", "statefulsets"]    # NOT ["*"]
  verbs: ["get", "list", "watch", "update"]      # NOT ["*"]`,
    });

    // 4. Stale RoleBindings
    const allBoundUsers = new Set<string>();
    for (const rb of userRoleBindings) {
      for (const s of rb.subjects || []) {
        if (s.kind === 'User' && s.name && !s.name.startsWith('system:')) allBoundUsers.add(s.name);
      }
    }
    const staleUsers = [...allBoundUsers].filter((u) => !existingUsers.has(u));
    const staleBindings = staleUsers.length > 0 ? userRoleBindings.filter((rb) => {
      return (rb.subjects || []).some((s) => s.kind === 'User' && staleUsers.includes(s.name));
    }) : [];
    allChecks.push({
      id: 'stale-bindings',
      title: 'Stale RoleBindings',
      description: 'RoleBindings referencing users who have never logged in or were removed',
      why: 'On OpenShift, User objects are created on first login. Bindings to users without User objects may be pre-provisioned (valid) or stale. Review these to ensure they are intentional.',
      passing: userRoleBindings.filter((rb) => !staleBindings.includes(rb)),
      failing: staleBindings,
      yamlExample: `# Identify stale bindings:
# 1. List users: oc get users
# 2. Check RoleBinding subjects
# 3. Delete orphaned bindings:
oc delete rolebinding <name> -n <namespace>`,
    });

    // 5. Namespace isolation
    const namespacesWithBindings = new Set(userRoleBindings.map((rb) => rb.metadata?.namespace).filter(Boolean));
    const isolatedNamespaces = userNamespaces.filter((ns) => !namespacesWithBindings.has(ns.metadata.name));
    allChecks.push({
      id: 'namespace-isolation',
      title: 'Namespace Isolation',
      description: 'User namespaces should have at least one RoleBinding for access control',
      why: 'Namespaces with no RoleBindings have no explicit access control, relying only on cluster-wide permissions. This makes it unclear who can access what and prevents proper multi-tenancy.',
      passing: userNamespaces.filter((ns) => namespacesWithBindings.has(ns.metadata.name)),
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

    // 6. ServiceAccount token automount
    const privilegedSAs = serviceAccounts.filter((sa) => {
      const ns = sa.metadata?.namespace || '';
      if (isSystemNS(ns)) return false;
      const automount = sa.automountServiceAccountToken !== false;
      if (!automount) return false;
      const saName = sa.metadata?.name || '';
      const hasElevated = [...roleBindings, ...clusterRoleBindings].some((binding) => {
        const roleRef = binding.roleRef?.name || '';
        if (roleRef !== 'cluster-admin' && roleRef !== 'admin') return false;
        return (binding.subjects || []).some((s) =>
          s.kind === 'ServiceAccount' && s.name === saName && (!s.namespace || s.namespace === ns)
        );
      });
      return hasElevated;
    });
    const safeSAs = serviceAccounts.filter((sa) => !privilegedSAs.includes(sa) && !isSystemNS(sa.metadata?.namespace || ''));
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

  const handleNavigate = React.useCallback((check: AuditCheck, item: AuditItem) => {
    const name = item.metadata?.name || '';
    const ns = item.metadata?.namespace || '';
    const path = check.id === 'default-sa' || check.id === 'namespace-isolation'
      ? `/r/v1~namespaces/_/${name}`
      : check.id === 'wildcard-rules'
      ? `/yaml/rbac.authorization.k8s.io~v1~clusterroles/_/${name}`
      : `/yaml/rbac.authorization.k8s.io~v1~rolebindings/${ns}/${name}`;
    go(path, name);
  }, [go]);

  return (
    <HealthAuditPanel
      checks={checks}
      title="RBAC Health Audit"
      iconColorClass="text-violet-400"
      onNavigateItem={handleNavigate}
      navigateLabel={() => 'View'}
      maxFailingItems={15}
    />
  );
}

// ---------------------------------------------------------------------------
// Recent RBAC Changes (from AccessControlView)
// ---------------------------------------------------------------------------
function RecentRBACChanges({ clusterRoleBindings, roleBindings, go }: {
  clusterRoleBindings: ClusterRoleBinding[]; roleBindings: RoleBinding[]; go: (path: string, title: string) => void;
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
      ...clusterRoleBindings.map((b) => ({ ...b, _clusterScoped: true })),
      ...roleBindings.map((b) => ({ ...b, _clusterScoped: false })),
    ];

    for (const b of allBindings) {
      const created = b.metadata?.creationTimestamp ? new Date(b.metadata.creationTimestamp) : null;
      if (!created || created.getTime() < sevenDaysAgo) continue;
      const name = b.metadata?.name || '';
      if (name.startsWith('system:') || name.startsWith('openshift-')) continue;
      if (name.includes('installer') || name.includes('pruner')) continue;
      const role = b.roleRef?.name || '';
      const subjects = (b.subjects || [])
        .filter((s: Subject) => !s.name?.startsWith('system:'))
        .map((s: Subject) => `${s.kind}/${s.name}`);
      if (subjects.length === 0) continue;
      const isAdmin = role === 'cluster-admin' || role === 'admin';
      const severity = role === 'cluster-admin' ? 'high' : isAdmin ? 'medium' : 'low';
      changes.push({
        type: isAdmin ? 'privilege-grant' : 'new-binding',
        name, namespace: b.metadata?.namespace, role, subjects,
        when: created, severity, clusterScoped: b._clusterScoped,
      });
    }
    return changes.sort((a, b) => b.when.getTime() - a.when.getTime()).slice(0, 15);
  }, [clusterRoleBindings, roleBindings]);

  if (recentChanges.length === 0) return null;
  const highSeverity = recentChanges.filter((c) => c.severity === 'high');

  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Clock className="w-4 h-4 text-violet-400" />
          Recent RBAC Changes (last 7 days)
        </h2>
        {highSeverity.length > 0 && (
          <span className="text-xs px-2 py-0.5 bg-red-900/50 text-red-300 rounded">{highSeverity.length} privilege escalation{highSeverity.length !== 1 ? 's' : ''}</span>
        )}
      </div>
      <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
        {recentChanges.map((change) => {
          const age = formatAge(change.when);
          const gvr = change.clusterScoped ? 'rbac.authorization.k8s.io~v1~clusterrolebindings' : 'rbac.authorization.k8s.io~v1~rolebindings';
          const path = change.namespace
            ? `/r/${gvr}/${change.namespace}/${change.name}`
            : `/r/${gvr}/_/${change.name}`;
          return (
            <button key={`${change.name}:${change.namespace || ''}:${change.role}:${change.when.getTime()}`} onClick={() => go(path, change.name)}
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
    </Card>
  );
}

