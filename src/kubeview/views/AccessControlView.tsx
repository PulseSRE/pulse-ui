import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Shield, Users, Key, Lock, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';

export default function AccessControlView() {
  const navigate = useNavigate();
  const addTab = useUIStore((s) => s.addTab);
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const [activeTab, setActiveTab] = React.useState<'overview' | 'roles' | 'bindings' | 'sa'>('overview');

  const { data: clusterRoles = [] } = useQuery<K8sResource[]>({
    queryKey: ['access', 'clusterroles'],
    queryFn: () => k8sList('/apis/rbac.authorization.k8s.io/v1/clusterroles'),
    staleTime: 60000,
  });

  const { data: clusterRoleBindings = [] } = useQuery<K8sResource[]>({
    queryKey: ['access', 'clusterrolebindings'],
    queryFn: () => k8sList('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings'),
    staleTime: 60000,
  });

  const { data: roles = [] } = useQuery<K8sResource[]>({
    queryKey: ['access', 'roles'],
    queryFn: () => k8sList('/apis/rbac.authorization.k8s.io/v1/roles'),
    staleTime: 60000,
  });

  const { data: roleBindings = [] } = useQuery<K8sResource[]>({
    queryKey: ['access', 'rolebindings'],
    queryFn: () => k8sList('/apis/rbac.authorization.k8s.io/v1/rolebindings'),
    staleTime: 60000,
  });

  const { data: allServiceAccounts = [] } = useQuery<K8sResource[]>({
    queryKey: ['access', 'serviceaccounts'],
    queryFn: () => k8sList('/api/v1/serviceaccounts'),
    staleTime: 60000,
  });

  // Apply namespace filter to namespaced resources
  const filteredRoles = React.useMemo(() => selectedNamespace === '*' ? roles : roles.filter((r: any) => r.metadata?.namespace === selectedNamespace), [roles, selectedNamespace]);
  const filteredRoleBindings = React.useMemo(() => selectedNamespace === '*' ? roleBindings : roleBindings.filter((r: any) => r.metadata?.namespace === selectedNamespace), [roleBindings, selectedNamespace]);
  const serviceAccounts = React.useMemo(() => selectedNamespace === '*' ? allServiceAccounts : allServiceAccounts.filter((s: any) => s.metadata?.namespace === selectedNamespace), [allServiceAccounts, selectedNamespace]);

  // Find cluster-admin bindings
  const clusterAdminBindings = React.useMemo(() => {
    return clusterRoleBindings.filter((b: any) => {
      const roleRef = b.roleRef;
      return roleRef?.name === 'cluster-admin';
    });
  }, [clusterRoleBindings]);

  // Find subjects with broad permissions
  const broadPermissions = React.useMemo(() => {
    const subjects: Array<{ name: string; kind: string; binding: string; namespace?: string }> = [];
    for (const b of clusterAdminBindings as any[]) {
      for (const s of b.subjects || []) {
        subjects.push({ name: s.name, kind: s.kind, binding: b.metadata.name, namespace: s.namespace });
      }
    }
    return subjects;
  }, [clusterAdminBindings]);

  // Namespace breakdown
  const saByNamespace = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const sa of serviceAccounts) {
      const ns = sa.metadata.namespace || '';
      map.set(ns, (map.get(ns) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [serviceAccounts]);

  const go = useNavigateTab();

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Shield className="w-6 h-6 text-indigo-500" />
            Access Control
          </h1>
          <p className="text-sm text-slate-400 mt-1">RBAC overview — roles, bindings, and service accounts</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1 w-fit">
          {(['overview', 'roles', 'bindings', 'sa'] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={cn('px-4 py-1.5 text-xs rounded-md transition-colors capitalize', activeTab === tab ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              {tab === 'sa' ? 'Service Accounts' : tab}
            </button>
          ))}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Cluster Roles" value={clusterRoles.length} onClick={() => go('/r/rbac.authorization.k8s.io~v1~clusterroles', 'ClusterRoles')} />
          <StatCard label="Cluster Bindings" value={clusterRoleBindings.length} onClick={() => go('/r/rbac.authorization.k8s.io~v1~clusterrolebindings', 'ClusterRoleBindings')} />
          <StatCard label="Roles" value={filteredRoles.length} onClick={() => go('/r/rbac.authorization.k8s.io~v1~roles', 'Roles')} />
          <StatCard label="Role Bindings" value={filteredRoleBindings.length} onClick={() => go('/r/rbac.authorization.k8s.io~v1~rolebindings', 'RoleBindings')} />
          <StatCard label="Service Accounts" value={serviceAccounts.length} onClick={() => go('/r/v1~serviceaccounts', 'ServiceAccounts')} />
        </div>

        {activeTab === 'overview' && (
          <>
            {/* Cluster Admin subjects */}
            <Panel title={`Cluster Admin Subjects (${broadPermissions.length})`} icon={<AlertTriangle className="w-4 h-4 text-yellow-500" />}>
              {broadPermissions.length === 0 ? (
                <div className="text-sm text-slate-500 py-4 text-center">No cluster-admin bindings found</div>
              ) : (
                <div className="space-y-1">
                  {broadPermissions.slice(0, 15).map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50">
                      <div className="flex items-center gap-2">
                        {s.kind === 'ServiceAccount' ? <Key className="w-3.5 h-3.5 text-teal-400" /> :
                         s.kind === 'User' ? <Users className="w-3.5 h-3.5 text-blue-400" /> :
                         <Lock className="w-3.5 h-3.5 text-purple-400" />}
                        <span className="text-sm text-slate-200">{s.name}</span>
                        <span className="text-xs text-slate-500">{s.kind}</span>
                        {s.namespace && <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{s.namespace}</span>}
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
          </>
        )}

        {activeTab === 'roles' && (
          <Panel title={`Cluster Roles (${clusterRoles.length}) + Roles (${filteredRoles.length})`} icon={<Shield className="w-4 h-4 text-indigo-500" />}>
            <div className="space-y-1 max-h-96 overflow-auto">
              {[...clusterRoles.slice(0, 20), ...roles.slice(0, 20)].map((role) => (
                <div key={role.metadata.uid} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50 cursor-pointer" onClick={() => go(`/r/rbac.authorization.k8s.io~v1~${role.metadata.namespace ? 'roles' : 'clusterroles'}${role.metadata.namespace ? `/${role.metadata.namespace}` : '/_'}/${role.metadata.name}`, role.metadata.name)}>
                  <div className="flex items-center gap-2">
                    <Shield className={cn('w-3.5 h-3.5', role.metadata.namespace ? 'text-blue-400' : 'text-indigo-400')} />
                    <span className="text-sm text-slate-200 truncate">{role.metadata.name}</span>
                    {role.metadata.namespace && <span className="text-xs text-slate-500">{role.metadata.namespace}</span>}
                  </div>
                  <span className="text-xs text-slate-500">{role.metadata.namespace ? 'Role' : 'ClusterRole'}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {activeTab === 'bindings' && (
          <Panel title={`All Bindings (${clusterRoleBindings.length + filteredRoleBindings.length})`} icon={<Lock className="w-4 h-4 text-purple-500" />}>
            <div className="space-y-1 max-h-96 overflow-auto">
              {[...clusterRoleBindings.slice(0, 20), ...roleBindings.slice(0, 20)].map((b: any) => (
                <div key={b.metadata.uid} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50">
                  <div className="flex items-center gap-2 min-w-0">
                    <Lock className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                    <span className="text-sm text-slate-200 truncate">{b.metadata.name}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-slate-500">→ {b.roleRef?.name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{(b.subjects || []).length} subjects</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {activeTab === 'sa' && (
          <Panel title={`Service Accounts (${serviceAccounts.length})`} icon={<Key className="w-4 h-4 text-teal-500" />}>
            <div className="space-y-1 max-h-96 overflow-auto">
              {serviceAccounts.slice(0, 30).map((sa) => (
                <div key={sa.metadata.uid} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50 cursor-pointer" onClick={() => go(`/r/v1~serviceaccounts/${sa.metadata.namespace}/${sa.metadata.name}`, sa.metadata.name)}>
                  <div className="flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-teal-400" />
                    <span className="text-sm text-slate-200">{sa.metadata.name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{sa.metadata.namespace}</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-slate-600" />
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <div onClick={onClick} className="bg-slate-900 rounded-lg border border-slate-800 p-3 cursor-pointer hover:border-slate-600 transition-colors">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-xl font-bold text-slate-100">{value}</div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">{icon}{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
