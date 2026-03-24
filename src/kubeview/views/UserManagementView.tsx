import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users, User, Shield, Key, ArrowRight, CheckCircle, AlertCircle, AlertTriangle,
  UserCheck, Search, Activity, Clock, Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList, k8sGet, k8sDelete } from '../engine/query';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import type { K8sResource } from '../engine/renderers';
import type { ClusterRoleBinding, Subject } from '../engine/types';
import { formatAge } from '../engine/dateUtils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';

export default function UserManagementView() {
  const go = useNavigateTab();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const impersonateUser = useUIStore((s) => s.impersonateUser);
  const setImpersonation = useUIStore((s) => s.setImpersonation);
  const clearImpersonation = useUIStore((s) => s.clearImpersonation);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'users' | 'groups' | 'serviceaccounts'>('users');

  // Fetch users
  const { data: users = [] } = useQuery<K8sResource[]>({
    queryKey: ['users', 'list'],
    queryFn: () => k8sList('/apis/user.openshift.io/v1/users').catch(() => []),
    staleTime: 60000,
  });

  // Fetch groups
  const { data: groups = [] } = useQuery<K8sResource[]>({
    queryKey: ['groups', 'list'],
    queryFn: () => k8sList('/apis/user.openshift.io/v1/groups').catch(() => []),
    staleTime: 60000,
  });

  // Fetch service accounts (all namespaces)
  const { data: serviceAccounts = [] } = useQuery<K8sResource[]>({
    queryKey: ['serviceaccounts', 'list'],
    queryFn: () => k8sList('/api/v1/serviceaccounts').catch(() => []),
    staleTime: 60000,
  });

  // Fetch cluster role bindings for role info
  const { data: clusterRoleBindings = [] } = useQuery<K8sResource[]>({
    queryKey: ['clusterrolebindings', 'list'],
    queryFn: () => k8sList('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings').catch(() => []),
    staleTime: 120000,
  });

  // Check if kubeadmin secret exists (more reliable than checking user)
  const { data: kubeadminSecret } = useQuery({
    queryKey: ['users', 'kubeadmin-secret'],
    queryFn: async () => {
      const res = await fetch(`/api/kubernetes/api/v1/namespaces/kube-system/secrets/kubeadmin`);
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

  // Build user → roles map
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

  const handleImpersonate = (username: string) => {
    setImpersonation(username);
    addToast({ type: 'warning', title: `Impersonating ${username}`, detail: 'All API requests now use this identity' });
  };

  // Filter
  const q = search.toLowerCase();
  const filteredUsers = users.filter((u: any) => !q || u.metadata.name.toLowerCase().includes(q));
  const filteredGroups = groups.filter((g: any) => !q || g.metadata.name.toLowerCase().includes(q));
  const filteredSAs = serviceAccounts.filter((sa: any) => {
    if (!q) return true;
    return sa.metadata.name.toLowerCase().includes(q) || sa.metadata.namespace?.toLowerCase().includes(q);
  });

  // Exclude system SAs for cleaner view
  const appSAs = filteredSAs.filter((sa: any) => {
    const ns = sa.metadata.namespace || '';
    return !ns.startsWith('openshift-') && !ns.startsWith('kube-') && ns !== 'openshift' && sa.metadata.name !== 'default';
  });

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-500" /> User Management
          </h1>
          <p className="text-sm text-slate-400 mt-1">Users, groups, service accounts, and impersonation</p>
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

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button onClick={() => setActiveTab('users')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Users</div>
            <div className="text-xl font-bold text-slate-100">{users.length}</div>
          </button>
          <button onClick={() => setActiveTab('groups')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Groups</div>
            <div className="text-xl font-bold text-slate-100">{groups.length}</div>
          </button>
          <button onClick={() => setActiveTab('serviceaccounts')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Service Accounts</div>
            <div className="text-xl font-bold text-slate-100">{serviceAccounts.length}</div>
          </button>
          <button onClick={() => go('/r/rbac.authorization.k8s.io~v1~clusterrolebindings', 'ClusterRoleBindings')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Cluster Role Bindings</div>
            <div className="text-xl font-bold text-slate-100">{clusterRoleBindings.length}</div>
          </button>
        </div>

        {/* Tabs + Search */}
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-slate-900 rounded-lg p-1">
            {([
              { id: 'users' as const, label: `Users (${users.length})` },
              { id: 'groups' as const, label: `Groups (${groups.length})` },
              { id: 'serviceaccounts' as const, label: `Service Accounts` },
            ]).map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn('px-3 py-1.5 text-xs rounded-md transition-colors', activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="w-full pl-9 pr-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {/* Users tab */}
        {activeTab === 'users' && (
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100">Users</h2>
            </div>
            <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
              {filteredUsers.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">No users found</div>
              ) : filteredUsers.map((user: any) => {
                const roles = userRoles.get(user.metadata.name) || [];
                const isAdmin = roles.some(r => r === 'cluster-admin');
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
                          {roles.length > 0 && roles.length <= 3 && roles.map(r => (
                            <span key={r} className="text-xs px-1 py-0.5 bg-slate-800 text-slate-500 rounded">{r}</span>
                          ))}
                          {roles.length > 3 && <span className="text-xs text-slate-600">+{roles.length} roles</span>}
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
          </div>
        )}

        {/* Groups tab */}
        {activeTab === 'groups' && (
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100">Groups</h2>
            </div>
            <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
              {filteredGroups.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">No groups found</div>
              ) : filteredGroups.map((group: any) => {
                const members = group.users || [];
                const roles = userRoles.get(`group:${group.metadata.name}`) || [];
                return (
                  <div key={group.metadata.uid} className="px-4 py-3 hover:bg-slate-800/30 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-indigo-400" />
                        <span className="text-sm font-medium text-slate-200">{group.metadata.name}</span>
                        <span className="text-xs text-slate-500">{members.length} member{members.length !== 1 ? 's' : ''}</span>
                      </div>
                      {roles.length > 0 && (
                        <div className="flex gap-1">
                          {roles.slice(0, 3).map(r => (
                            <span key={r} className="text-xs px-1.5 py-0.5 bg-indigo-900/50 text-indigo-300 rounded">{r}</span>
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
          </div>
        )}

        {/* Service Accounts tab */}
        {activeTab === 'serviceaccounts' && (
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Service Accounts (application namespaces)</h2>
              <button onClick={() => go('/r/v1~serviceaccounts', 'ServiceAccounts')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
            </div>
            <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
              {appSAs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">No application service accounts found</div>
              ) : appSAs.slice(0, 50).map((sa: any) => {
                const saName = `system:serviceaccount:${sa.metadata.namespace}:${sa.metadata.name}`;
                const roles = userRoles.get(saName) || [];
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
                      {roles.length > 0 && (
                        <span className="text-xs text-slate-500">{roles.length} role{roles.length !== 1 ? 's' : ''}</span>
                      )}
                      <button
                        onClick={() => handleImpersonate(saName)}
                        className="px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 rounded transition-colors"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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

        {/* Recent Sessions */}
        {accessTokens.length > 0 && (
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" /> Recent Sessions ({accessTokens.length})
              </h2>
              <button onClick={() => go('/r/oauth.openshift.io~v1~oauthaccesstokens', 'OAuthAccessTokens')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
            </div>
            <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
              {(accessTokens as K8sResource[]).sort((a: any, b: any) =>
                new Date(b.metadata.creationTimestamp || 0).getTime() - new Date(a.metadata.creationTimestamp || 0).getTime()
              ).slice(0, 15).map((token: any) => {
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
          </div>
        )}

        {/* Quick links */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
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
        </div>
      </div>
    </div>
  );
}

// ===== Identity & Access Audit =====

function IdentityAudit({ users, groups, clusterRoleBindings, oauthConfig, accessTokens, kubeadminExists, go, addToast, queryClient }: {
  users: K8sResource[]; groups: K8sResource[]; clusterRoleBindings: ClusterRoleBinding[]; oauthConfig: any;
  accessTokens: K8sResource[]; kubeadminExists: boolean; go: (path: string, title: string) => void;
  addToast: (t: any) => void; queryClient: any;
}) {
  const [expandedCheck, setExpandedCheck] = React.useState<string | null>(null);
  const [confirmAction, setConfirmAction] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);

  // Check current user identity
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
      addToast({ type: 'error', title: 'Action failed', detail: err.message });
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

    // 2. kubeadmin removed (check the secret, not the user object)
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
      // Only allow removal if IdP configured AND current user is not kubeadmin
      action: hasKubeAdmin && idps.length > 0 && !currentUserIsKubeAdmin
        ? { label: 'Remove kubeadmin', danger: true, id: 'remove-kubeadmin' } : undefined,
    });

    // 3. Cluster-admin bindings audit (exclude system-provided bindings)
    const clusterAdminBindings = clusterRoleBindings.filter((crb) => {
      if (crb.roleRef?.name !== 'cluster-admin') return false;
      const name = crb.metadata?.name || '';
      // Skip system-provided bindings (these are expected)
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
        // Exclude platform service accounts
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

    // 5. Inactive users (users with no recent tokens)
    const activeUsers = new Set(accessTokens.map((t) => (t as any).userName));
    const inactiveUsers = users.filter(u => !activeUsers.has(u.metadata.name) && u.metadata.name !== 'kube:admin');
    allChecks.push({
      id: 'inactive-users',
      title: 'Inactive Users',
      description: 'Users without recent OAuth sessions may be stale accounts',
      why: 'Stale user accounts with active role bindings are a security risk. Review and remove users who no longer need access. Inactive accounts can be compromised without detection.',
      passing: users.filter(u => activeUsers.has(u.metadata.name)),
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
  }, [users, groups, clusterRoleBindings, oauthConfig, accessTokens, kubeadminExists]);

  const totalPassing = checks.reduce((s, c) => s + (c.failing.length === 0 ? 1 : 0), 0);
  const score = Math.round((totalPassing / checks.length) * 100);

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" /> Identity & Access Audit
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
                  <div className="bg-blue-950/20 border border-blue-900/50 rounded p-3">
                    <div className="text-xs font-medium text-blue-300 mb-1">Why it matters</div>
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
                            // Use page name as tab title, not action label
                            const pageName = check.action!.path.startsWith('/admin') ? 'Admin'
                              : check.action!.path.startsWith('/access-control') ? 'Access Control'
                              : check.action!.path.startsWith('/users') ? 'Users'
                              : check.action!.label;
                            go(check.action!.path, pageName);
                          }
                        }}
                        className={cn('mt-2 px-3 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors',
                          check.action.danger ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white')}
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
    </div>
  );
}
