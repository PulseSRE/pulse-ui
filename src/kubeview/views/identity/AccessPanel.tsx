/**
 * RBAC actions on the Identity page: grant a role (RoleBinding or
 * ClusterRoleBinding), list and revoke bindings, and check "who can" with a
 * SubjectAccessReview.
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Search, ShieldQuestion, CheckCircle, XCircle } from 'lucide-react';
import { k8sCreate } from '../../engine/query';
import type { ClusterRole, ClusterRoleBinding, Role, RoleBinding, Namespace } from '../../engine/types';
import { useActiveClusterId } from '../../hooks/useClusterBase';
import { useCanI } from '../../hooks/useCanI';
import { usePinnedAction, errorMessage } from '../../hooks/usePinnedAction';
import { useUIStore } from '../../store/uiStore';
import { isSystemBinding } from '../../engine/clusterAdmins';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { RevokeBindingButton, subjectLabel, type BindingRef } from '../../components/rbac/RevokeBinding';

const RBAC = 'rbac.authorization.k8s.io';
const inputCls = 'mt-1 w-full px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200';

export type SubjectKind = 'User' | 'Group' | 'ServiceAccount';

export interface GrantRequest {
  scope: 'namespace' | 'cluster';
  namespace: string;
  roleKind: 'ClusterRole' | 'Role';
  roleName: string;
  subjectKind: SubjectKind;
  subjectName: string;
  subjectNamespace: string;
  bindingName: string;
}

export function suggestBindingName(subject: string, role: string): string {
  return `${subject}-${role}`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'binding';
}

export function grantBody(g: GrantRequest) {
  const subject = g.subjectKind === 'ServiceAccount'
    ? { kind: 'ServiceAccount', name: g.subjectName, namespace: g.subjectNamespace }
    : { kind: g.subjectKind, apiGroup: RBAC, name: g.subjectName };
  const isCluster = g.scope === 'cluster';
  return {
    path: isCluster ? `/apis/${RBAC}/v1/clusterrolebindings` : `/apis/${RBAC}/v1/namespaces/${g.namespace}/rolebindings`,
    body: {
      apiVersion: `${RBAC}/v1`,
      kind: isCluster ? 'ClusterRoleBinding' : 'RoleBinding',
      metadata: isCluster ? { name: g.bindingName } : { name: g.bindingName, namespace: g.namespace },
      roleRef: { apiGroup: RBAC, kind: isCluster ? 'ClusterRole' : g.roleKind, name: g.roleName },
      subjects: [subject],
    },
  };
}

function GrantAccess({ clusterRoles, roles, namespaces }: { clusterRoles: ClusterRole[]; roles: Role[]; namespaces: Namespace[] }) {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const [g, setG] = React.useState<GrantRequest>({
    scope: 'namespace', namespace: '', roleKind: 'ClusterRole', roleName: 'view',
    subjectKind: 'User', subjectName: '', subjectNamespace: '', bindingName: '',
  });
  const set = (patch: Partial<GrantRequest>) => setG((prev) => ({ ...prev, ...patch }));
  const { allowed: canBindNs } = useCanI('create', RBAC, 'rolebindings', g.namespace || undefined);
  const { allowed: canBindCluster } = useCanI('create', RBAC, 'clusterrolebindings');
  const allowed = g.scope === 'cluster' ? canBindCluster : canBindNs;
  const action = usePinnedAction<GrantRequest>();
  const bindingName = g.bindingName || suggestBindingName(g.subjectName, g.roleName);
  const nsRoles = roles.filter((r) => r.metadata.namespace === g.namespace);
  const roleOptions = g.roleKind === 'Role' && g.scope === 'namespace' ? nsRoles : clusterRoles;
  const ready = !!g.roleName && !!g.subjectName && (g.scope === 'cluster' || !!g.namespace) && (g.subjectKind !== 'ServiceAccount' || !!g.subjectNamespace);

  const confirm = () => action.run('Granting access', async (req, clusterId) => {
    const { path, body } = grantBody(req);
    await k8sCreate(path, body, clusterId);
    addToast({ type: 'success', title: `${body.kind} ${req.bindingName} created`, detail: `${subjectLabel(body.subjects[0])} → ${req.roleName}` });
    queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] });
  });

  const t = action.pending?.target;
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5 text-violet-400" /> Grant access</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <label className="text-xs text-slate-400">Scope
          <select aria-label="Scope" className={inputCls} value={g.scope} onChange={(e) => set({ scope: e.target.value as GrantRequest['scope'], roleKind: 'ClusterRole' })}>
            <option value="namespace">One namespace (RoleBinding)</option>
            <option value="cluster">Whole cluster (ClusterRoleBinding)</option>
          </select>
        </label>
        {g.scope === 'namespace' && (
          <label className="text-xs text-slate-400">Namespace
            <select aria-label="Binding namespace" className={inputCls} value={g.namespace} onChange={(e) => set({ namespace: e.target.value })}>
              <option value="">Choose…</option>
              {namespaces.map((n) => <option key={n.metadata.name} value={n.metadata.name}>{n.metadata.name}</option>)}
            </select>
          </label>
        )}
        {g.scope === 'namespace' && (
          <label className="text-xs text-slate-400">Role kind
            <select aria-label="Role kind" className={inputCls} value={g.roleKind} onChange={(e) => set({ roleKind: e.target.value as GrantRequest['roleKind'], roleName: '' })}>
              <option value="ClusterRole">ClusterRole</option>
              <option value="Role">Role in this namespace</option>
            </select>
          </label>
        )}
        <label className="text-xs text-slate-400">Role
          <select aria-label="Role" className={inputCls} value={g.roleName} onChange={(e) => set({ roleName: e.target.value })}>
            <option value="">Choose…</option>
            {roleOptions.map((r) => <option key={r.metadata.name} value={r.metadata.name}>{r.metadata.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400">Subject kind
          <select aria-label="Subject kind" className={inputCls} value={g.subjectKind} onChange={(e) => set({ subjectKind: e.target.value as SubjectKind })}>
            <option>User</option><option>Group</option><option>ServiceAccount</option>
          </select>
        </label>
        <label className="text-xs text-slate-400">Subject name
          <input aria-label="Subject name" className={inputCls} value={g.subjectName} onChange={(e) => set({ subjectName: e.target.value.trim() })} />
        </label>
        {g.subjectKind === 'ServiceAccount' && (
          <label className="text-xs text-slate-400">ServiceAccount namespace
            <input aria-label="ServiceAccount namespace" className={inputCls} value={g.subjectNamespace} onChange={(e) => set({ subjectNamespace: e.target.value.trim() })} />
          </label>
        )}
        <label className="text-xs text-slate-400">Binding name
          <input aria-label="Binding name" className={inputCls} value={bindingName} onChange={(e) => set({ bindingName: e.target.value.trim() })} />
        </label>
      </div>
      <Button size="sm" disabled={!ready || !allowed} title={allowed ? undefined : `You do not have permission to create ${g.scope === 'cluster' ? 'ClusterRoleBindings' : 'RoleBindings'}`}
        onClick={() => action.open({ ...g, bindingName })}>
        Grant
      </Button>
      <ConfirmDialog
        open={!!t}
        onClose={action.close}
        onConfirm={confirm}
        title={t ? `Grant ${t.roleName} to ${t.subjectName}?` : ''}
        description={t ? `Creates ${t.scope === 'cluster' ? 'ClusterRoleBinding' : `RoleBinding in ${t.namespace}`} ${t.bindingName} binding ${t.scope === 'cluster' ? 'ClusterRole' : t.roleKind} ${t.roleName} to ${t.subjectKind === 'ServiceAccount' ? `ServiceAccount ${t.subjectNamespace}/${t.subjectName}` : `${t.subjectKind} ${t.subjectName}`}${t.scope === 'cluster' ? ' across every namespace' : ''}.` : ''}
        confirmLabel="Grant"
        variant="warning"
        loading={action.running}
      >
        {action.error && <LoadError className="mt-3" title="Access was not granted" error={action.error} />}
      </ConfirmDialog>
    </div>
  );
}

function BindingsList({ clusterRoleBindings, roleBindings }: { clusterRoleBindings: ClusterRoleBinding[]; roleBindings: RoleBinding[] }) {
  const [q, setQ] = React.useState('');
  const [showSystem, setShowSystem] = React.useState(false);
  const all: BindingRef[] = React.useMemo(() => [
    ...clusterRoleBindings.map((b): BindingRef => ({ kind: 'ClusterRoleBinding', name: b.metadata.name, uid: b.metadata.uid, roleRef: b.roleRef, subjects: b.subjects || [] })),
    ...roleBindings.map((b): BindingRef => ({ kind: 'RoleBinding', name: b.metadata.name, namespace: b.metadata.namespace, uid: b.metadata.uid, roleRef: b.roleRef, subjects: b.subjects || [] })),
  ], [clusterRoleBindings, roleBindings]);
  const needle = q.toLowerCase();
  const shown = all.filter((b) => (showSystem || !isSystemBinding(b.name))
    && (!needle || b.name.toLowerCase().includes(needle) || b.roleRef.name.toLowerCase().includes(needle) || b.subjects.some((s) => s.name.toLowerCase().includes(needle))));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-slate-300">Bindings</h3>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
          <input aria-label="Filter bindings" placeholder="subject, role or binding" value={q} onChange={(e) => setQ(e.target.value)}
            className="w-full pl-6 pr-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200" />
        </div>
        <label className="flex items-center gap-1 text-xs text-slate-400"><input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} /> system</label>
      </div>
      <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
        {shown.length === 0 ? <p className="py-3 text-xs text-slate-500">No bindings match.</p> : shown.slice(0, 100).map((b) => (
          <div key={`${b.kind}/${b.namespace ?? ''}/${b.name}`} className="py-1.5 flex items-center gap-2 text-xs">
            <span className="text-slate-500 w-36 shrink-0 truncate">{b.kind === 'ClusterRoleBinding' ? 'cluster' : b.namespace}</span>
            <span className="text-slate-200 font-mono truncate">{b.roleRef.name}</span>
            <span className="text-slate-500">→</span>
            <span className="text-slate-300 truncate flex-1">{b.subjects.map(subjectLabel).join(', ') || '(no subjects)'}</span>
            <RevokeBindingButton binding={b} />
          </div>
        ))}
        {shown.length > 100 && <p className="py-2 text-xs text-slate-500">{shown.length - 100} more — narrow the filter.</p>}
      </div>
    </div>
  );
}

export interface AccessCheck { verb: string; group: string; resource: string; namespace: string; user: string; groups: string }

export function accessReviewBody(c: AccessCheck) {
  const groups = c.groups.split(',').map((g) => g.trim()).filter(Boolean);
  return {
    apiVersion: 'authorization.k8s.io/v1',
    kind: 'SubjectAccessReview',
    spec: {
      resourceAttributes: { verb: c.verb, group: c.group, resource: c.resource, ...(c.namespace ? { namespace: c.namespace } : {}) },
      ...(c.user ? { user: c.user } : {}),
      ...(groups.length ? { groups } : {}),
    },
  };
}

function WhoCan() {
  const clusterId = useActiveClusterId();
  const [c, setC] = React.useState<AccessCheck>({ verb: 'get', group: '', resource: 'pods', namespace: '', user: '', groups: '' });
  const [result, setResult] = React.useState<{ allowed: boolean; reason?: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const set = (patch: Partial<AccessCheck>) => { setC((p) => ({ ...p, ...patch })); setResult(null); };

  const check = async () => {
    setChecking(true); setError(null); setResult(null);
    try {
      const res = await k8sCreate<{ status?: { allowed?: boolean; reason?: string; denied?: boolean } }>(
        '/apis/authorization.k8s.io/v1/subjectaccessreviews', accessReviewBody(c) as never, clusterId);
      setResult({ allowed: res.status?.allowed === true, reason: res.status?.reason });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"><ShieldQuestion className="w-3.5 h-3.5 text-violet-400" /> Who can…?</h3>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <label className="text-xs text-slate-400">User<input aria-label="Check user" className={inputCls} value={c.user} onChange={(e) => set({ user: e.target.value.trim() })} placeholder="alice" /></label>
        <label className="text-xs text-slate-400">Groups<input aria-label="Check groups" className={inputCls} value={c.groups} onChange={(e) => set({ groups: e.target.value })} placeholder="dev,qa" /></label>
        <label className="text-xs text-slate-400">Verb
          <select aria-label="Check verb" className={inputCls} value={c.verb} onChange={(e) => set({ verb: e.target.value })}>
            {['get', 'list', 'watch', 'create', 'update', 'patch', 'delete', '*'].map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400">API group<input aria-label="Check API group" className={inputCls} value={c.group} onChange={(e) => set({ group: e.target.value.trim() })} placeholder="(core)" /></label>
        <label className="text-xs text-slate-400">Resource<input aria-label="Check resource" className={inputCls} value={c.resource} onChange={(e) => set({ resource: e.target.value.trim() })} /></label>
        <label className="text-xs text-slate-400">Namespace<input aria-label="Check namespace" className={inputCls} value={c.namespace} onChange={(e) => set({ namespace: e.target.value.trim() })} placeholder="(all)" /></label>
      </div>
      <Button size="sm" variant="secondary" loading={checking} disabled={(!c.user && !c.groups.trim()) || !c.resource} onClick={check}>Check</Button>
      {error && <LoadError title="The access check could not be run" error={error} />}
      {result && (
        <p role="status" className={result.allowed ? 'text-xs text-emerald-300 flex items-center gap-1.5' : 'text-xs text-red-300 flex items-center gap-1.5'}>
          {result.allowed ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {c.user || `groups ${c.groups}`} {result.allowed ? 'can' : 'cannot'} {c.verb} {c.group ? `${c.resource}.${c.group}` : c.resource} {c.namespace ? `in ${c.namespace}` : 'cluster-wide'}
          {result.reason ? ` — ${result.reason}` : ''}
        </p>
      )}
    </div>
  );
}

export function AccessPanel(props: {
  clusterRoles: ClusterRole[]; roles: Role[]; namespaces: Namespace[];
  clusterRoleBindings: ClusterRoleBinding[]; roleBindings: RoleBinding[];
}) {
  return (
    <Card className="p-4 space-y-6">
      <GrantAccess clusterRoles={props.clusterRoles} roles={props.roles} namespaces={props.namespaces} />
      <BindingsList clusterRoleBindings={props.clusterRoleBindings} roleBindings={props.roleBindings} />
      <WhoCan />
    </Card>
  );
}
