/**
 * "Who can <verb> <resource> in <namespace>?" — every subject, with the
 * binding → role chain that grants it.
 *
 * The list comes from OpenShift's ResourceAccessReview
 * (authorization.openshift.io/v1 `resourceaccessreviews`, or
 * `localresourceaccessreviews` for one namespace), the API `oc adm policy
 * who-can` uses. Pulse then finds, in the bindings it can read, which
 * binding and role grant each subject. When the API is not served the panel
 * says so: Pulse does not approximate the answer from bindings alone.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldQuestion, Download, MessageSquare, ArrowRight } from 'lucide-react';
import { k8sCreate, k8sGet, k8sList } from '../../engine/query';
import { useActiveClusterId } from '../../hooks/useClusterBase';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { useFleetStore } from '../../store/fleetStore';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import { askPulse } from '../../engine/askPulse';
import { PulseError } from '../../engine/errors';
import { isPlatformNamespace } from '../../engine/platformNamespaces';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import type { ClusterRole, ClusterRoleBinding, Role, RoleBinding, Namespace } from '../../engine/types';
import {
  refFromUsername, ruleAllows, subjectMatches, subjectPagePath, type GroupLike, type SubjectRef,
} from '../../engine/subjectAccess';

const AUTHZ = '/apis/authorization.openshift.io/v1';
const RBAC = '/apis/rbac.authorization.k8s.io/v1';
const inputCls = 'mt-1 w-full px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200';

export interface WhoCanQuery { verb: string; resource: string; namespace: string }

/** "deployments.apps" → { resource: deployments, group: apps }; "secrets" → core. */
export function splitResource(input: string): { resource: string; group: string } {
  const t = input.trim();
  const dot = t.indexOf('.');
  return dot === -1 ? { resource: t, group: '' } : { resource: t.slice(0, dot), group: t.slice(dot + 1) };
}

export function accessReviewRequest(q: WhoCanQuery) {
  const { resource, group } = splitResource(q.resource);
  const common = { verb: q.verb, resource, resourceAPIGroup: group, resourceName: '' };
  return q.namespace
    ? { path: `${AUTHZ}/namespaces/${encodeURIComponent(q.namespace)}/localresourceaccessreviews`, body: { apiVersion: 'authorization.openshift.io/v1', kind: 'LocalResourceAccessReview', namespace: q.namespace, ...common } }
    : { path: `${AUTHZ}/resourceaccessreviews`, body: { apiVersion: 'authorization.openshift.io/v1', kind: 'ResourceAccessReview', namespace: '', ...common } };
}

type Served = 'yes' | 'no';

/** Whether this cluster serves the ResourceAccessReview APIs. A 403 on discovery is not "no". */
async function reviewApiServed(clusterId: string): Promise<Served> {
  try {
    const list = await k8sGet<{ resources?: Array<{ name: string }> }>(AUTHZ, clusterId);
    const names = new Set((list.resources ?? []).map((r) => r.name));
    return names.has('resourceaccessreviews') && names.has('localresourceaccessreviews') ? 'yes' : 'no';
  } catch (e) {
    if (e instanceof PulseError && e.statusCode === 404) return 'no';
    throw e;
  }
}

export interface Grant {
  binding: { kind: 'ClusterRoleBinding' | 'RoleBinding'; name: string; namespace?: string; created?: string };
  role: { kind: string; name: string };
  /** Set when the grant reaches the subject through a group. */
  viaGroup?: string;
}

export interface WhoCanRow {
  subject: SubjectRef;
  /** For groups: members from the Group object. */
  members?: string[];
  grants: Grant[];
  system: boolean;
}

function isSystemName(ref: SubjectRef): boolean {
  if (ref.kind === 'ServiceAccount') return isPlatformNamespace(ref.namespace);
  return ref.name.startsWith('system:');
}

/** For each subject the review returned, the bindings Pulse can see that grant it. */
export function explain(
  review: { users?: string[] | null; groups?: string[] | null },
  q: WhoCanQuery,
  rbac: { crbs: ClusterRoleBinding[]; rbs: RoleBinding[]; clusterRoles: ClusterRole[]; roles: Role[]; groups: GroupLike[] },
): WhoCanRow[] {
  const { resource, group } = splitResource(q.resource);
  const grantsVia = (b: ClusterRoleBinding | RoleBinding): { kind: string; name: string } | null => {
    const ref = b.roleRef;
    const rules = ref?.kind === 'Role'
      ? rbac.roles.find((r) => r.metadata.name === ref.name && r.metadata.namespace === b.metadata.namespace)?.rules
      : rbac.clusterRoles.find((r) => r.metadata.name === ref?.name)?.rules;
    return rules?.some((r) => ruleAllows(r, q.verb, group, resource)) ? { kind: ref.kind, name: ref.name } : null;
  };
  const bindings: Array<{ b: ClusterRoleBinding | RoleBinding; kind: 'ClusterRoleBinding' | 'RoleBinding' }> = [
    ...rbac.crbs.map((b) => ({ b, kind: 'ClusterRoleBinding' as const })),
    ...rbac.rbs.filter((b) => !q.namespace || b.metadata.namespace === q.namespace).map((b) => ({ b, kind: 'RoleBinding' as const })),
  ];
  const grantsFor = (ref: SubjectRef, viaGroup?: string): Grant[] => bindings.flatMap(({ b, kind }) => {
    if (!(b.subjects ?? []).some((s) => subjectMatches(s, ref, b.metadata.namespace))) return [];
    const role = grantsVia(b);
    return role ? [{ binding: { kind, name: b.metadata.name, namespace: kind === 'RoleBinding' ? b.metadata.namespace : undefined, created: b.metadata.creationTimestamp }, role, viaGroup }] : [];
  });
  const rows: WhoCanRow[] = [];
  for (const g of review.groups ?? []) {
    const ref: SubjectRef = { kind: 'Group', name: g };
    rows.push({ subject: ref, members: rbac.groups.find((x) => x.metadata.name === g)?.users ?? undefined, grants: grantsFor(ref), system: isSystemName(ref) });
  }
  const groupNames = new Set(review.groups ?? []);
  for (const u of review.users ?? []) {
    const ref = refFromUsername(u);
    let grants = grantsFor(ref);
    if (grants.length === 0) {
      // Not named directly: through a Group object that lists the user and is allowed itself.
      for (const g of rbac.groups) if ((g.users ?? []).includes(u) && groupNames.has(g.metadata.name)) grants = [...grants, ...grantsFor({ kind: 'Group', name: g.metadata.name }, g.metadata.name)];
    }
    // A user who can only because a group of theirs can is shown on the group's row, not twice.
    const onlyViaListedGroup = grants.length > 0 && grants.every((x) => x.viaGroup);
    if (onlyViaListedGroup) continue;
    rows.push({ subject: ref, grants, system: isSystemName(ref) });
  }
  return rows;
}

function since(grants: Grant[]): string {
  const ts = grants.map((g) => g.binding.created).filter(Boolean).map((t) => Date.parse(t!)).filter((n) => !Number.isNaN(n));
  if (!ts.length) return '—';
  return new Date(Math.min(...ts)).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

function toCsv(rows: WhoCanRow[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['kind', 'subject', 'members', 'granted through'].join(',')];
  for (const r of rows) {
    const name = r.subject.kind === 'ServiceAccount' ? `${r.subject.namespace}/${r.subject.name}` : r.subject.name;
    const through = r.grants.map((g) => `${g.viaGroup ? `Group ${g.viaGroup} > ` : ''}${g.binding.kind} ${g.binding.namespace ? `${g.binding.namespace}/` : ''}${g.binding.name} > ${g.role.kind} ${g.role.name}`).join('; ');
    lines.push([r.subject.kind, name, (r.members ?? []).join(' '), through].map(esc).join(','));
  }
  return lines.join('\n');
}

export function WhoCanPanel({ namespaces }: { namespaces: Namespace[] }) {
  const clusterId = useActiveClusterId();
  const go = useNavigateTab();
  const remote = useFleetStore((s) => s.activeClusterId) !== LOCAL_CLUSTER_ID;
  const [q, setQ] = React.useState<WhoCanQuery>({ verb: 'delete', resource: 'secrets', namespace: '' });
  const [asked, setAsked] = React.useState<WhoCanQuery | null>(null);
  const [showSystem, setShowSystem] = React.useState(false);

  const servedQ = useQuery({ queryKey: ['who-can', 'served', clusterId], queryFn: () => reviewApiServed(clusterId), staleTime: 300000 });

  const resultQ = useQuery({
    queryKey: ['who-can', 'review', clusterId, asked?.verb, asked?.resource, asked?.namespace],
    enabled: !!asked && servedQ.data === 'yes',
    retry: false,
    queryFn: async () => {
      const a = asked!;
      const { path, body } = accessReviewRequest(a);
      const review = await k8sCreate<{ users?: string[] | null; groups?: string[] | null; evaluationError?: string }>(path, body as never, clusterId);
      // The bindings and roles that explain each answer, read as the viewer.
      const [crbs, rbs, clusterRoles, roles, groups] = await Promise.allSettled([
        k8sList<ClusterRoleBinding>(`${RBAC}/clusterrolebindings`, undefined, clusterId),
        k8sList<RoleBinding>(`${RBAC}/rolebindings`, a.namespace || undefined, clusterId),
        k8sList<ClusterRole>(`${RBAC}/clusterroles`, undefined, clusterId),
        k8sList<Role>(`${RBAC}/roles`, a.namespace || undefined, clusterId),
        k8sList<GroupLike & { apiVersion?: string; kind?: string; metadata: { name: string } }>('/apis/user.openshift.io/v1/groups', undefined, clusterId),
      ]);
      const val = <T,>(r: PromiseSettledResult<T[]>) => (r.status === 'fulfilled' ? r.value : []);
      const unreadable = [['ClusterRoleBindings', crbs], ['RoleBindings', rbs], ['ClusterRoles', clusterRoles], ['Roles', roles], ['Groups', groups]]
        .filter(([, r]) => (r as PromiseSettledResult<unknown>).status === 'rejected').map(([n]) => n as string);
      const rows = explain(review, a, { crbs: val(crbs), rbs: val(rbs), clusterRoles: val(clusterRoles), roles: val(roles), groups: val(groups) as GroupLike[] });
      return { rows, evaluationError: review.evaluationError, unreadable, at: new Date() };
    },
  });

  const set = (patch: Partial<WhoCanQuery>) => setQ((p) => ({ ...p, ...patch }));
  const rows = resultQ.data?.rows ?? [];
  const visible = rows.filter((r) => showSystem || !r.system);
  const hidden = rows.length - visible.length;
  const people = new Set<string>();
  for (const r of rows) if (!r.system) { if (r.subject.kind === 'User') people.add(r.subject.name); for (const m of r.members ?? []) people.add(m); }
  const where = (x: WhoCanQuery) => (x.namespace ? `in ${x.namespace}` : 'cluster-wide');

  const exportCsv = () => {
    const blob = new Blob([toCsv(visible)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url; el.download = `who-can-${asked?.verb}-${asked?.resource}-${asked?.namespace || 'cluster'}.csv`; el.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="who-can-h" className="space-y-3">
      <h3 id="who-can-h" className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"><ShieldQuestion className="w-3.5 h-3.5 text-violet-400" /> Who can</h3>
      <form className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end" onSubmit={(e) => {
        e.preventDefault();
        const next = { ...q, resource: q.resource.trim() };
        if (!next.resource) return;
        // The same question again is a recheck.
        if (asked && asked.verb === next.verb && asked.resource === next.resource && asked.namespace === next.namespace) void resultQ.refetch();
        else setAsked(next);
      }}>
        <label className="text-xs text-slate-400">Verb
          <select aria-label="Who can verb" className={inputCls} value={q.verb} onChange={(e) => set({ verb: e.target.value })}>
            {['get', 'list', 'watch', 'create', 'update', 'patch', 'delete', 'deletecollection', 'impersonate', 'escalate', 'bind', '*'].map((v) => <option key={v} value={v}>{v === '*' ? '* (any)' : v}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400">Resource
          <input aria-label="Who can resource" className={inputCls} value={q.resource} onChange={(e) => set({ resource: e.target.value })} placeholder="secrets or deployments.apps" />
        </label>
        <label className="text-xs text-slate-400 md:col-span-2">In namespace
          <select aria-label="Who can namespace" className={inputCls} value={q.namespace} onChange={(e) => set({ namespace: e.target.value })}>
            <option value="">All (cluster-wide)</option>
            {namespaces.map((n) => <option key={n.metadata.name} value={n.metadata.name}>{n.metadata.name}</option>)}
          </select>
        </label>
        <Button size="sm" type="submit" disabled={!q.resource.trim() || servedQ.data !== 'yes'} loading={resultQ.isFetching}>Check</Button>
      </form>

      {servedQ.isError && <LoadError title="Could not tell whether this cluster serves ResourceAccessReview" error={servedQ.error} onRetry={() => void servedQ.refetch()} />}
      {servedQ.data === 'no' && (
        <p className="text-xs text-slate-400" data-testid="who-can-unavailable">
          Not available on this cluster: listing who can do something needs OpenShift&apos;s ResourceAccessReview API (authorization.openshift.io/v1), which this cluster does not serve. Pulse does not guess it from bindings. Use &quot;Check one subject&quot; below for a yes/no answer.
        </p>
      )}

      {resultQ.isError && <LoadError title="The access review could not be run" error={resultQ.error} onRetry={() => void resultQ.refetch()} />}
      {asked && resultQ.data && (
        <div className="space-y-2" data-testid="who-can-result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-100" role="status">
              {visible.length} subject{visible.length === 1 ? '' : 's'} can {asked.verb} {asked.resource} {where(asked)}
              <span className="ml-2 text-xs text-slate-500">{people.size} {people.size === 1 ? 'person' : 'people'} · checked {resultQ.data.at.toLocaleTimeString()} · RBAC</span>
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={exportCsv}><Download className="w-3.5 h-3.5" /> Export CSV</Button>
              <Button size="sm" variant="secondary" disabled={remote} title={remote ? 'Pulse AI answers about the local cluster only.' : undefined}
                onClick={() => askPulse(`Who can ${asked.verb} ${asked.resource} ${where(asked)}?`, asked.namespace ? { kind: 'Namespace', name: asked.namespace, gvr: 'v1~namespaces' } : undefined)}>
                <MessageSquare className="w-3.5 h-3.5" /> Ask in chat
              </Button>
            </div>
          </div>
          {remote && <p className="text-xs text-slate-500">Pulse AI answers about the local cluster only.</p>}
          {resultQ.data.evaluationError && (
            <p className="text-xs text-amber-300">The review could not evaluate everything ({resultQ.data.evaluationError}); more subjects may be able to.</p>
          )}
          {resultQ.data.unreadable.length > 0 && (
            <p className="text-xs text-amber-300">Could not read {resultQ.data.unreadable.join(', ')}, so some &quot;granted through&quot; chains are missing. The list of subjects is still complete.</p>
          )}
          <table className="w-full text-left text-xs">
            <thead><tr className="text-[11px] uppercase tracking-wide text-slate-500"><th className="pb-1 pr-3 font-medium">Subject</th><th className="pb-1 pr-3 font-medium">Granted through</th><th className="pb-1 font-medium">Since</th></tr></thead>
            <tbody>
              {visible.map((r) => {
                const label = r.subject.kind === 'ServiceAccount' ? `${r.subject.namespace}/${r.subject.name}` : r.subject.name;
                return (
                  <tr key={`${r.subject.kind}/${r.subject.namespace ?? ''}/${r.subject.name}`} className="border-t border-slate-800 align-top">
                    <td className="py-2 pr-3">
                      <button type="button" className="text-blue-400 hover:text-blue-300" onClick={() => go(subjectPagePath(r.subject), r.subject.name)}>{r.subject.kind} {label}</button>
                      {r.subject.kind === 'Group' && <div className="text-slate-500">{r.members?.length ? r.members.join(', ') : 'no members listed'}</div>}
                      {r.subject.kind === 'User' && <div className="text-slate-500">direct</div>}
                    </td>
                    <td className="py-2 pr-3 text-slate-300">
                      {r.grants.length === 0 ? <span className="text-slate-500">Allowed, but no binding Pulse can read explains it (a group the API server adds, or another authorizer).</span>
                        : r.grants.map((g) => (
                          <div key={`${g.binding.kind}/${g.binding.namespace ?? ''}/${g.binding.name}/${g.viaGroup ?? ''}`} className="flex flex-wrap items-center gap-1">
                            {g.viaGroup && <><span className="text-violet-300">Group {g.viaGroup}</span><ArrowRight className="w-3 h-3 text-slate-600" /></>}
                            <span>{g.binding.kind} {g.binding.namespace ? `${g.binding.namespace}/` : ''}{g.binding.name}</span><ArrowRight className="w-3 h-3 text-slate-600" />
                            <span>{g.role.kind} {g.role.name}</span>{g.binding.kind === 'ClusterRoleBinding' && <span className="text-slate-500">· cluster-wide</span>}
                          </div>
                        ))}
                    </td>
                    <td className="py-2 text-slate-500">{since(r.grants)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hidden > 0 && (
            <button type="button" className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setShowSystem(!showSystem)} aria-expanded={showSystem}>
              {showSystem ? 'Hide system subjects' : `${hidden} system subject${hidden === 1 ? '' : 's'} also can (controllers, operators, platform service accounts) — show`}
            </button>
          )}
          <p className="text-xs text-slate-500">RBAC only. Anyone who can exec into a pod running as a listed service account can effectively act as it, and a webhook authorizer can allow more than RBAC shows.</p>
        </div>
      )}
    </section>
  );
}
