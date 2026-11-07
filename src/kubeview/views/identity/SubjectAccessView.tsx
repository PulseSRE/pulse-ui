/**
 * One subject's access: a User, Group or ServiceAccount.
 *
 * - Where the access comes from: every RoleBinding and ClusterRoleBinding
 *   that names the subject, directly or through a group it belongs to, as a
 *   chain subject → group → binding → role.
 * - Effective permissions per namespace, computed by impersonating the
 *   subject and running a read-only SelfSubjectRulesReview (engine/rulesReview).
 * - "Remove access…", which lists every change before anything is sent.
 *
 * A list that could not be read is an error, never "no access".
 */
import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { User, Users, Key, UserCheck, UserMinus, KeyRound, ArrowRight, RefreshCw, HelpCircle, History } from 'lucide-react';
import { k8sGet, k8sList } from '../../engine/query';
import { useActiveClusterId } from '../../hooks/useClusterBase';
import { useCanI } from '../../hooks/useCanI';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { useUIStore } from '../../store/uiStore';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { AskPulseCard, usePageChatContext } from '../detail/AskPulseCard';
import { PulseError } from '../../engine/errors';
import { formatTime } from '../../engine/format';
import type { ClusterRoleBinding, RoleBinding } from '../../engine/types';
import {
  accessChains, membershipsOf, subjectTitle, usernameOf, subjectPagePath, summarizeRules,
  type AccessChain, type GroupLike, type SubjectKind, type SubjectRef,
} from '../../engine/subjectAccess';
import { rulesReviewAs, type RulesReview } from '../../engine/rulesReview';
import { RemoveAccessDialog } from './RemoveAccessDialog';

const RBAC = '/apis/rbac.authorization.k8s.io/v1';

function is404(e: unknown): boolean {
  return e instanceof PulseError && e.statusCode === 404;
}

export interface SubjectData {
  crbs: ClusterRoleBinding[];
  rbs: RoleBinding[];
  groups: GroupLike[];
  /** Lists that could not be read, by name, with the error. */
  failed: Array<{ what: string; error: unknown }>;
  loading: boolean;
  refetch: () => void;
}

/** Bindings (all namespaces) and Group objects, read as the viewer. */
export function useSubjectData(): SubjectData {
  const clusterId = useActiveClusterId();
  const crbQ = useQuery({ queryKey: ['subject-access', 'crbs', clusterId], queryFn: () => k8sList<ClusterRoleBinding>(`${RBAC}/clusterrolebindings`, undefined, clusterId), staleTime: 15000 });
  const rbQ = useQuery({ queryKey: ['subject-access', 'rbs', clusterId], queryFn: () => k8sList<RoleBinding>(`${RBAC}/rolebindings`, undefined, clusterId), staleTime: 15000 });
  // A cluster without the OpenShift user API has no Group objects (404); a 403 is unknown.
  const groupQ = useQuery({
    queryKey: ['subject-access', 'groups', clusterId],
    queryFn: async () => {
      try { return await k8sList<GroupLike & { apiVersion?: string; kind?: string }>('/apis/user.openshift.io/v1/groups', undefined, clusterId); } catch (e) { if (is404(e)) return []; throw e; }
    },
    staleTime: 15000,
  });
  const failed = [
    crbQ.isError && { what: 'ClusterRoleBindings', error: crbQ.error },
    rbQ.isError && { what: 'RoleBindings', error: rbQ.error },
    groupQ.isError && { what: 'Groups', error: groupQ.error },
  ].filter(Boolean) as SubjectData['failed'];
  return {
    crbs: crbQ.data ?? [], rbs: rbQ.data ?? [], groups: (groupQ.data ?? []) as GroupLike[],
    failed,
    loading: crbQ.isLoading || rbQ.isLoading || groupQ.isLoading,
    refetch: () => { void crbQ.refetch(); void rbQ.refetch(); void groupQ.refetch(); },
  };
}

function KindIcon({ kind, className = 'w-4 h-4' }: { kind: SubjectKind; className?: string }) {
  if (kind === 'Group') return <Users className={`${className} text-blue-400`} aria-hidden />;
  if (kind === 'ServiceAccount') return <Key className={`${className} text-teal-400`} aria-hidden />;
  return <User className={`${className} text-blue-400`} aria-hidden />;
}

function bindingLabel(c: AccessChain): string {
  return c.binding.kind === 'ClusterRoleBinding' ? `ClusterRoleBinding ${c.binding.name}` : `RoleBinding ${c.binding.namespace}/${c.binding.name}`;
}

function chainNote(c: AccessChain, ref: SubjectRef, groups: GroupLike[]): string {
  if (c.via) {
    if (!c.via.removable) {
      return c.via.group.startsWith('system:serviceaccounts') ? 'every service account in its group · added by the API server'
        : c.via.group === 'system:authenticated:oauth' ? 'every user signed in through OAuth · ends when sign-in ends'
          : 'every signed-in user · added by the API server';
    }
    const g = groups.find((x) => x.metadata.name === c.via!.group);
    const n = g?.users?.length ?? 0;
    return `group has ${n} member${n === 1 ? '' : 's'}`;
  }
  if (c.others.length === 0) return `${subjectTitle(ref).split(' ')[0] === 'Group' ? 'the group' : ref.name} is the only subject`;
  const names = c.others.map((s) => s.name);
  return `shared with ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`;
}

/** The role a namespace's access comes from, for the "Level" column. */
function levelFor(ns: string, chains: AccessChain[]): string {
  const roles = [...new Set(chains.filter((c) => c.binding.kind === 'RoleBinding' && c.binding.namespace === ns).map((c) => c.binding.roleRef.name))];
  if (roles.length === 0) return 'cluster-wide only';
  if (roles.length === 1 && ['admin', 'edit', 'view', 'cluster-admin'].includes(roles[0])) return roles[0];
  return roles.length === 1 ? roles[0] : 'custom';
}

function grantedBy(ns: string, chains: AccessChain[]): string {
  const here = chains.filter((c) => c.binding.kind === 'RoleBinding' && c.binding.namespace === ns);
  const parts = here.map((c) => (c.via ? `group ${c.via.group}` : `direct · ${c.binding.name}`));
  const cluster = chains.filter((c) => c.binding.kind === 'ClusterRoleBinding').length;
  if (cluster) parts.push(`${cluster} cluster-wide binding${cluster === 1 ? '' : 's'}`);
  return parts.join(' · ') || '—';
}

function RulesRow({ ns, review, error, loading, chains }: {
  ns: string; review?: RulesReview; error?: unknown; loading: boolean; chains: AccessChain[];
}) {
  const [open, setOpen] = React.useState(false);
  let what: React.ReactNode;
  let level: React.ReactNode = levelFor(ns, chains);
  if (loading) {
    what = <span className="text-slate-500">Checking…</span>;
  } else if (error) {
    what = <span className="text-red-300">Could not check: {error instanceof Error ? error.message : String(error)}</span>;
    level = <span className="text-slate-500" data-unknown>unknown</span>;
  } else if (review?.incomplete) {
    what = <span className="text-amber-300">Could not check — the rules review came back incomplete{review.evaluationError ? `: ${review.evaluationError}` : ''}. The list may be missing permissions.</span>;
    level = <span className="text-slate-500" data-unknown>unknown</span>;
  } else if (review) {
    what = (
      <>
        {summarizeRules(review.resourceRules)}
        {review.resourceRules.length > 0 && (
          <button type="button" onClick={() => setOpen(!open)} className="ml-2 text-blue-400 hover:text-blue-300" aria-expanded={open}>
            {open ? 'Hide rules' : `All ${review.resourceRules.length} rules`}
          </button>
        )}
        {open && (
          <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-slate-400" aria-label={`Rules in ${ns}`}>
            {review.resourceRules.map((r, i) => (
              <li key={i}>{(r.verbs ?? []).join(',')} {(r.apiGroups ?? []).map((g) => g || 'core').join(',')}/{(r.resources ?? []).join(',')}{r.resourceNames?.length ? ` [${r.resourceNames.join(',')}]` : ''}</li>
            ))}
          </ul>
        )}
      </>
    );
  }
  return (
    <tr className="border-t border-slate-800 align-top">
      <td className="py-2 pr-3 font-mono text-xs text-slate-200">{ns}</td>
      <td className="py-2 pr-3 text-xs text-slate-300">{level}</td>
      <td className="py-2 pr-3 text-xs text-slate-300">{what}</td>
      <td className="py-2 text-xs text-slate-500">{grantedBy(ns, chains)}</td>
    </tr>
  );
}

function EffectivePermissions({ subject, chains, groupNames, oauthAssumed }: { subject: SubjectRef; chains: AccessChain[]; groupNames: string[]; oauthAssumed?: boolean }) {
  const clusterId = useActiveClusterId();
  const username = usernameOf(subject);
  const { allowed: canImpersonate, isLoading: permLoading } = useCanI('impersonate', '', subject.kind === 'ServiceAccount' ? 'serviceaccounts' : 'users', subject.kind === 'ServiceAccount' ? subject.namespace : undefined);
  const needsGroups = subject.kind === 'User' && groupNames.some((g) => g !== 'system:authenticated');
  const { allowed: canImpersonateGroups, isLoading: groupPermLoading } = useCanI('impersonate', '', 'groups');
  const [extra, setExtra] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState('');
  const namespaces = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of chains) if (c.binding.kind === 'RoleBinding' && c.binding.namespace) set.add(c.binding.namespace);
    if (subject.kind === 'ServiceAccount' && subject.namespace) set.add(subject.namespace);
    for (const n of extra) set.add(n);
    return [...set].sort();
  }, [chains, subject, extra]);
  const groupsForReview = needsGroups && canImpersonateGroups ? groupNames : [];
  const enabled = !permLoading && canImpersonate && !groupPermLoading;
  const q = useQuery({
    queryKey: ['subject-access', 'rules', clusterId, username, groupsForReview.join(','), namespaces.join(',')],
    enabled: enabled && namespaces.length > 0,
    staleTime: 60000,
    queryFn: async () => {
      const out = await Promise.all(namespaces.map(async (ns) => {
        try { return { ns, review: await rulesReviewAs(clusterId, ns, subject, groupsForReview) }; } catch (error) { return { ns, error }; }
      }));
      return { at: new Date(), rows: out as Array<{ ns: string; review?: RulesReview; error?: unknown }> };
    },
  });

  const ranAsGroups = groupsForReview.filter((g) => g !== 'system:authenticated');
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Effective permissions</h2>
          <p className="text-xs text-slate-400 mt-0.5" data-testid="rules-review-note">
            Computed by impersonating {username}: a read-only SelfSubjectRulesReview in each namespace
            {ranAsGroups.length > 0 ? `, run as ${subject.name} alone and in each of ${ranAsGroups.join(', ')}, combined` : ''}.
            {q.data && ` Checked ${formatTime(q.data.at)}.`} RBAC only; cluster-wide grants appear in every namespace.
          </p>
          {oauthAssumed && (
            <p className="text-xs text-amber-300 mt-1" data-testid="oauth-assumed">May overstate: it includes system:authenticated:oauth, which applies only if {subject.name} signs in through OAuth (their User object could not be read).</p>
          )}
          {needsGroups && !groupPermLoading && !canImpersonateGroups && (
            <p className="text-xs text-amber-300 mt-1">You may not impersonate groups, so access {subject.name} gets through groups is not included below.</p>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={() => void q.refetch()} disabled={!enabled || q.isFetching} loading={q.isFetching}>
          <RefreshCw className="w-3.5 h-3.5" /> Recheck
        </Button>
      </div>
      <div className="p-4">
        {!permLoading && !canImpersonate ? (
          <p className="text-xs text-slate-400 flex items-center gap-1.5" data-testid="rules-review-denied">
            <HelpCircle className="w-3.5 h-3.5 text-slate-500" /> Could not check: this needs permission to impersonate {username}, which you do not have.
          </p>
        ) : namespaces.length === 0 ? (
          <p className="text-xs text-slate-400">No RoleBinding names {subject.name} in any namespace. Add a namespace below to check what cluster-wide grants allow there.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                <th className="pb-1 pr-3 font-medium">Namespace</th><th className="pb-1 pr-3 font-medium">Level</th>
                <th className="pb-1 pr-3 font-medium">What {subject.name} can do</th><th className="pb-1 font-medium">Granted by</th>
              </tr>
            </thead>
            <tbody>
              {namespaces.map((ns) => {
                const row = q.data?.rows.find((r) => r.ns === ns);
                return <RulesRow key={ns} ns={ns} chains={chains} loading={!row && (q.isLoading || q.isFetching || permLoading)} review={row?.review} error={row?.error ?? (q.isError ? q.error : undefined)} />;
              })}
            </tbody>
          </table>
        )}
        <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (v && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(v)) { setExtra((x) => [...new Set([...x, v])]); setDraft(''); } }}>
          <label htmlFor="rules-extra-ns" className="text-xs text-slate-400">Check another namespace</label>
          <input id="rules-extra-ns" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="namespace" className="px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200" />
          <Button size="sm" variant="secondary" type="submit" disabled={!canImpersonate}>Check</Button>
        </form>
      </div>
    </Card>
  );
}

function Chains({ subject, chains, groups }: { subject: SubjectRef; chains: AccessChain[]; groups: GroupLike[] }) {
  const go = useNavigateTab();
  const viaGroups = chains.filter((c) => c.via).length;
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Where the access comes from</h2>
        <span className="text-xs text-slate-500">{chains.length} binding{chains.length === 1 ? '' : 's'}{viaGroups ? ` · ${viaGroups} through groups` : ''}</span>
      </div>
      {chains.length === 0 ? (
        <p className="p-4 text-xs text-slate-400">No RoleBinding or ClusterRoleBinding names {subject.name} or a group it belongs to.</p>
      ) : (
        <ul className="divide-y divide-slate-800" aria-label="Access chains">
          {chains.map((c) => {
            const bindingPath = c.binding.kind === 'ClusterRoleBinding'
              ? `/r/rbac.authorization.k8s.io~v1~clusterrolebindings/_/${c.binding.name}`
              : `/r/rbac.authorization.k8s.io~v1~rolebindings/${c.binding.namespace}/${c.binding.name}`;
            const rolePath = c.binding.roleRef.kind === 'Role'
              ? `/r/rbac.authorization.k8s.io~v1~roles/${c.binding.namespace}/${c.binding.roleRef.name}`
              : `/r/rbac.authorization.k8s.io~v1~clusterroles/_/${c.binding.roleRef.name}`;
            return (
              <li key={`${c.via?.group ?? ''}|${c.binding.kind}/${c.binding.namespace ?? ''}/${c.binding.name}`} className="px-4 py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-1.5 text-slate-300">
                  <span className="font-medium text-slate-200">{subject.name}</span><ArrowRight className="w-3 h-3 text-slate-600" aria-hidden />
                  {c.via && (<>
                    {c.via.removable
                      ? <button type="button" className="text-blue-300 hover:text-blue-200" onClick={() => go(subjectPagePath({ kind: 'Group', name: c.via!.group }), c.via!.group)}>Group {c.via.group}</button>
                      : <span className="text-blue-300">Group {c.via.group}</span>}
                    <ArrowRight className="w-3 h-3 text-slate-600" aria-hidden />
                  </>)}
                  <button type="button" className="text-blue-400 hover:text-blue-300" onClick={() => go(bindingPath, c.binding.name)}>{bindingLabel(c)}</button>
                  <ArrowRight className="w-3 h-3 text-slate-600" aria-hidden />
                  <button type="button" className="text-blue-400 hover:text-blue-300" onClick={() => go(rolePath, c.binding.roleRef.name)}>{c.binding.roleRef.kind} {c.binding.roleRef.name}</button>
                </div>
                <div className="mt-0.5 text-slate-500">{chainNote(c, subject, groups)}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function SubjectAccessPage({ subject }: { subject: SubjectRef }) {
  const clusterId = useActiveClusterId();
  const go = useNavigateTab();
  const addToast = useUIStore((s) => s.addToast);
  const impersonateUser = useUIStore((s) => s.impersonateUser);
  const setImpersonation = useUIStore((s) => s.setImpersonation);
  const data = useSubjectData();
  const [removing, setRemoving] = React.useState(false);
  const username = usernameOf(subject);

  const userQ = useQuery({
    queryKey: ['subject-access', 'user', clusterId, subject.name],
    enabled: subject.kind === 'User',
    queryFn: async () => {
      try { return await k8sGet<{ metadata: { name: string; uid?: string; resourceVersion?: string }; identities?: string[] }>(`/apis/user.openshift.io/v1/users/${encodeURIComponent(subject.name)}`, clusterId); } catch (e) { if (is404(e)) return null; throw e; }
    },
  });

  // system:authenticated:oauth applies only to OAuth sign-ins: assumed when the user has an Identity
  // or when that could not be read (then the page says the result may overstate).
  const oauth = subject.kind === 'User' && userQ.data !== undefined ? (userQ.data?.identities?.length ?? 0) > 0 : undefined;
  const chains = React.useMemo(() => accessChains(subject, data.crbs, data.rbs, data.groups, { oauth }), [subject, data.crbs, data.rbs, data.groups, oauth]);
  const memberships = React.useMemo(() => membershipsOf(subject, data.groups, { oauth }), [subject, data.groups, oauth]);
  const group = subject.kind === 'Group' ? data.groups.find((g) => g.metadata.name === subject.name) : undefined;

  usePageChatContext(subject.kind === 'ServiceAccount'
    ? { kind: 'ServiceAccount', name: subject.name, namespace: subject.namespace, gvr: 'v1~serviceaccounts' }
    : { kind: subject.kind, name: subject.name, gvr: subject.kind === 'Group' ? 'user.openshift.io~v1~groups' : 'user.openshift.io~v1~users' });

  const objectPath = subject.kind === 'ServiceAccount'
    ? `/r/v1~serviceaccounts/${subject.namespace}/${subject.name}`
    : subject.kind === 'Group' ? `/r/user.openshift.io~v1~groups/_/${subject.name}` : `/r/user.openshift.io~v1~users/_/${subject.name}`;

  const realGroups = memberships.filter((m) => m.removable).map((m) => m.group);
  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <nav className="text-xs text-slate-500" aria-label="Breadcrumb">
          <button type="button" className="hover:text-slate-300" onClick={() => go(subject.kind === 'User' ? '/identity' : '/identity?tab=groups-sa', 'Identity & Access')}>{subject.kind === 'User' ? 'Users' : subject.kind === 'Group' ? 'Groups' : 'Service accounts'}</button>
          {' / '}<span className="text-slate-300">{subject.kind === 'ServiceAccount' ? `${subject.namespace}/${subject.name}` : subject.name}</span>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><KindIcon kind={subject.kind} className="w-6 h-6" />{subject.name}
              <span className="text-xs font-normal px-1.5 py-0.5 rounded-sm bg-slate-800 text-slate-400">{subject.kind === 'ServiceAccount' ? `ServiceAccount in ${subject.namespace}` : subject.kind}</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              {subject.kind === 'User' && (userQ.isError ? 'User object could not be read'
                : userQ.data === null ? 'No User object (has not signed in through OAuth, or was deleted)'
                  : userQ.data?.identities?.length ? `Identity ${userQ.data.identities.join(', ')}` : null)}
              {subject.kind !== 'Group' && realGroups.length > 0 && ` · groups ${realGroups.join(', ')}`}
              {subject.kind === 'Group' && (group ? `${group.users?.length ?? 0} members${group.users?.length ? `: ${group.users.join(', ')}` : ''}` : data.failed.some((f) => f.what === 'Groups') ? 'Members could not be read' : 'No Group object (bindings may still name it)')}
              {' · '}<button type="button" className="text-blue-400 hover:text-blue-300" onClick={() => go(objectPath, subject.name)}>Open the object</button>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {subject.kind !== 'Group' && (
              <Button size="sm" variant="secondary" disabled={impersonateUser === username}
                onClick={() => { setImpersonation(username); addToast({ type: 'warning', title: `Impersonating ${username}`, detail: 'All API requests now use this identity' }); }}>
                <UserCheck className="w-3.5 h-3.5" /> {impersonateUser === username ? 'Impersonating' : 'Impersonate'}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => go('/identity?tab=rbac', 'Identity & Access')}><KeyRound className="w-3.5 h-3.5" /> Grant access</Button>
            <Button size="sm" variant="danger" onClick={() => setRemoving(true)} disabled={data.loading}><UserMinus className="w-3.5 h-3.5" /> Remove access…</Button>
          </div>
        </div>

        {data.failed.length > 0 && (
          <LoadError title={`Could not read ${data.failed.map((f) => f.what).join(', ')} — the access shown below is incomplete`} error={data.failed[0].error} onRetry={data.refetch} />
        )}

        {subject.kind !== 'Group' && !data.loading && (
          <EffectivePermissions subject={subject} chains={chains} groupNames={memberships.map((m) => m.group)} oauthAssumed={subject.kind === 'User' && oauth === undefined} />
        )}
        {subject.kind === 'Group' && (
          <p className="text-xs text-slate-400">Effective permissions are computed per user. Open a member to see theirs.</p>
        )}

        {data.loading ? <p className="text-xs text-slate-500">Checking bindings…</p>
          : data.failed.some((f) => f.what !== 'Groups') ? null
            : <Chains subject={subject} chains={chains} groups={data.groups} />}

        <Card>
          <div className="px-4 py-3 border-b border-slate-800"><h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2"><History className="w-4 h-4 text-slate-500" /> Recent API actions</h2></div>
          <p className="p-4 text-xs text-slate-400" data-testid="api-actions-unavailable">
            Not available: Pulse cannot read the API server audit log on this cluster, so it cannot show what {subject.name} did. Use <code className="font-mono text-slate-300">oc adm node-logs --role=master --path=kube-apiserver/</code> to search it.
          </p>
        </Card>

        <AskPulseCard
          context={subject.kind === 'ServiceAccount' ? { kind: 'ServiceAccount', name: subject.name, namespace: subject.namespace, gvr: 'v1~serviceaccounts' } : { kind: subject.kind, name: subject.name, gvr: subject.kind === 'Group' ? 'user.openshift.io~v1~groups' : 'user.openshift.io~v1~users' }}
          placeholder={`What can ${subject.name} do, and is any of it more than needed?`}
        />
      </div>
      {removing && (
        <RemoveAccessDialog
          subject={subject}
          data={data}
          chains={chains.filter((c) => !c.via)}
          memberships={memberships}
          userObject={subject.kind === 'User' ? userQ.data ?? null : null}
          userObjectError={subject.kind === 'User' && userQ.isError ? userQ.error : undefined}
          onClose={() => setRemoving(false)}
        />
      )}
    </div>
  );
}

/** Route element: /identity/users/:name, /identity/groups/:name, /identity/serviceaccounts/:namespace/:name. */
export default function SubjectAccessView({ kind }: { kind: SubjectKind }) {
  const { name = '', namespace } = useParams();
  const subject = React.useMemo<SubjectRef>(() => ({ kind, name: decodeURIComponent(name), namespace: kind === 'ServiceAccount' ? namespace : undefined }), [kind, name, namespace]);
  return <SubjectAccessPage key={`${kind}/${namespace ?? ''}/${name}`} subject={subject} />;
}
