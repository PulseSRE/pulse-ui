/**
 * Everything a subject (User, Group, ServiceAccount) is granted, and how to
 * take it away again.
 *
 * Access reaches a subject two ways: a RoleBinding or ClusterRoleBinding
 * names it directly, or names a group it belongs to. Group membership is the
 * OpenShift Group objects (user.openshift.io) plus the virtual groups the API
 * server adds on its own (`system:authenticated`, `system:serviceaccounts:<ns>`),
 * which no object lists and nobody can remove a subject from.
 *
 * Removal is precise: a binding that names several subjects is patched with a
 * JSON patch that first `test`s the exact subject at the index it was read
 * at, then removes it, so if someone changed the list in between the server
 * refuses the whole patch instead of removing the wrong entry.
 */
import type { ClusterRoleBinding, RoleBinding, Subject, PolicyRule } from './types';

export type SubjectKind = 'User' | 'Group' | 'ServiceAccount';

export interface SubjectRef {
  kind: SubjectKind;
  name: string;
  /** ServiceAccounts only. */
  namespace?: string;
}

export interface GroupLike {
  metadata: { name: string; uid?: string; resourceVersion?: string };
  users?: string[] | null;
}

type AnyBinding = (ClusterRoleBinding | RoleBinding) & { metadata: { name: string; namespace?: string; uid?: string; resourceVersion?: string; creationTimestamp?: string } };

/** The username the API server uses for a subject (`system:serviceaccount:ns:name` for a ServiceAccount). */
export function usernameOf(ref: SubjectRef): string {
  return ref.kind === 'ServiceAccount' ? `system:serviceaccount:${ref.namespace}:${ref.name}` : ref.name;
}

export function subjectTitle(ref: SubjectRef): string {
  return ref.kind === 'ServiceAccount' ? `ServiceAccount ${ref.namespace}/${ref.name}` : `${ref.kind} ${ref.name}`;
}

/** Pulse page for a subject. */
export function subjectPagePath(ref: SubjectRef): string {
  if (ref.kind === 'ServiceAccount') return `/identity/serviceaccounts/${encodeURIComponent(ref.namespace ?? '')}/${encodeURIComponent(ref.name)}`;
  if (ref.kind === 'Group') return `/identity/groups/${encodeURIComponent(ref.name)}`;
  return `/identity/users/${encodeURIComponent(ref.name)}`;
}

/** A subject as an access review reports it: a username or a group name. */
export function refFromUsername(username: string): SubjectRef {
  const m = /^system:serviceaccount:([^:]+):([^:]+)$/.exec(username);
  if (m) return { kind: 'ServiceAccount', namespace: m[1], name: m[2] };
  return { kind: 'User', name: username };
}

/** True when a binding subject means this subject (a ServiceAccount may also appear as a User with its username). */
export function subjectMatches(s: Subject, ref: SubjectRef, bindingNamespace?: string): boolean {
  if (ref.kind === 'ServiceAccount') {
    if (s.kind === 'ServiceAccount') return s.name === ref.name && (s.namespace || bindingNamespace) === ref.namespace;
    return s.kind === 'User' && s.name === usernameOf(ref);
  }
  return s.kind === ref.kind && s.name === ref.name;
}

/**
 * Virtual groups the API server adds; there is no object to remove a subject from.
 * `system:authenticated:oauth` is added only to users who sign in through OAuth,
 * so it is assumed only when the user has an Identity (`oauth`).
 */
export function virtualGroupsOf(ref: SubjectRef, opts: { oauth?: boolean } = {}): string[] {
  if (ref.kind === 'ServiceAccount') return ['system:serviceaccounts', `system:serviceaccounts:${ref.namespace}`, 'system:authenticated'];
  if (ref.kind === 'User') return opts.oauth === false ? ['system:authenticated'] : ['system:authenticated', 'system:authenticated:oauth'];
  return [];
}

export interface Membership {
  group: string;
  /** False for a group no object lists (system:authenticated…). */
  removable: boolean;
  /** Index of the user in Group.users, for the precise patch. */
  index?: number;
  members?: string[];
  resourceVersion?: string;
}

/** The groups a subject belongs to: Group objects that list it, then the virtual groups. */
export function membershipsOf(ref: SubjectRef, groups: GroupLike[], opts: { oauth?: boolean } = {}): Membership[] {
  if (ref.kind === 'Group') return [];
  const username = usernameOf(ref);
  const out: Membership[] = [];
  for (const g of groups) {
    const users = g.users ?? [];
    const index = users.indexOf(username);
    if (index >= 0) out.push({ group: g.metadata.name, removable: true, index, members: users, resourceVersion: g.metadata.resourceVersion });
  }
  for (const v of virtualGroupsOf(ref, opts)) out.push({ group: v, removable: false });
  return out;
}

export interface BindingSummary {
  kind: 'ClusterRoleBinding' | 'RoleBinding';
  name: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  creationTimestamp?: string;
  roleRef: { kind: string; name: string };
  subjects: Subject[];
}

export interface AccessChain {
  /** Null when the binding names the subject itself. */
  via: Membership | null;
  binding: BindingSummary;
  /** Indexes in binding.subjects that name the subject (or the group, for `via`). */
  indexes: number[];
  /** Everyone else the binding names. */
  others: Subject[];
}

function summarize(b: AnyBinding, kind: BindingSummary['kind']): BindingSummary {
  return {
    kind, name: b.metadata.name, namespace: kind === 'RoleBinding' ? b.metadata.namespace : undefined,
    uid: b.metadata.uid, resourceVersion: b.metadata.resourceVersion, creationTimestamp: b.metadata.creationTimestamp,
    roleRef: { kind: b.roleRef?.kind ?? 'ClusterRole', name: b.roleRef?.name ?? '' },
    subjects: b.subjects ?? [],
  };
}

function chainsFor(target: SubjectRef, via: Membership | null, crbs: AnyBinding[], rbs: AnyBinding[]): AccessChain[] {
  const out: AccessChain[] = [];
  const scan = (b: AnyBinding, kind: BindingSummary['kind']) => {
    const subjects = b.subjects ?? [];
    const ns = kind === 'RoleBinding' ? b.metadata.namespace : undefined;
    const indexes = subjects.flatMap((s, i) => (subjectMatches(s, target, ns) ? [i] : []));
    if (indexes.length === 0) return;
    out.push({ via, binding: summarize(b, kind), indexes, others: subjects.filter((_, i) => !indexes.includes(i)) });
  };
  for (const b of crbs) scan(b, 'ClusterRoleBinding');
  for (const b of rbs) scan(b, 'RoleBinding');
  return out;
}

/**
 * Every binding that grants this subject something: direct ones first, then
 * through each group it belongs to (Group objects and virtual groups).
 */
export function accessChains(ref: SubjectRef, crbs: AnyBinding[], rbs: AnyBinding[], groups: GroupLike[], opts: { oauth?: boolean } = {}): AccessChain[] {
  const direct = chainsFor(ref, null, crbs, rbs);
  const viaGroups = membershipsOf(ref, groups, opts).flatMap((m) => chainsFor({ kind: 'Group', name: m.group }, m, crbs, rbs));
  return [...direct, ...viaGroups];
}

export interface JsonPatchOp { op: 'test' | 'remove' | 'add' | 'replace'; path: string; value?: unknown }

/**
 * Remove the subject at `indexes` from `subjects`: for each index, highest
 * first so the lower ones do not shift, `test` that exact subject is still
 * there, then `remove` it. A concurrent edit makes a test fail and the server
 * applies nothing.
 */
export function removeSubjectsPatch(subjects: Subject[], indexes: number[]): JsonPatchOp[] {
  return [...new Set(indexes)].sort((a, b) => b - a).flatMap((i): JsonPatchOp[] => [
    { op: 'test', path: `/subjects/${i}`, value: subjects[i] },
    { op: 'remove', path: `/subjects/${i}` },
  ]);
}

/** Remove one user from a Group's `users`, refused if the list changed at that index. */
export function removeGroupMemberPatch(username: string, index: number): JsonPatchOp[] {
  return [
    { op: 'test', path: `/users/${index}`, value: username },
    { op: 'remove', path: `/users/${index}` },
  ];
}

export function bindingApiPath(b: Pick<BindingSummary, 'kind' | 'name' | 'namespace'>): string {
  return b.kind === 'ClusterRoleBinding'
    ? `/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/${encodeURIComponent(b.name)}`
    : `/apis/rbac.authorization.k8s.io/v1/namespaces/${encodeURIComponent(b.namespace ?? '')}/rolebindings/${encodeURIComponent(b.name)}`;
}

/**
 * How many paths to cluster-admin `user` (in `userGroups`) has through these
 * bindings, optionally after removing the planned changes: whole bindings
 * deleted, a subject removed from a binding, or the user removed from a group.
 */
export interface RemovalPlan {
  deletedBindings: Set<string>;
  /** binding key → subject indexes removed */
  removedSubjects: Map<string, number[]>;
  /** groups the removed subject leaves */
  leftGroups: Set<string>;
  /** the subject being removed (its group memberships change, not the current user's, unless they are the same) */
  subject: SubjectRef;
}

export function bindingKey(b: Pick<BindingSummary, 'kind' | 'name' | 'namespace'>): string {
  return `${b.kind}/${b.namespace ?? ''}/${b.name}`;
}

/**
 * ClusterRoles that amount to cluster-admin: cluster-admin itself and any role
 * with a rule granting every verb on every resource in every API group, or every
 * verb on every non-resource URL.
 */
export function adminClusterRoles(clusterRoles: Array<{ metadata: { name: string }; rules?: PolicyRule[] | null }>): Set<string> {
  const out = new Set<string>(['cluster-admin']);
  for (const r of clusterRoles) {
    const all = (r.rules ?? []).some((rule) => {
      const v = rule.verbs ?? [];
      if (!v.includes('*')) return false;
      const everyResource = (rule.apiGroups ?? []).includes('*') && (rule.resources ?? []).includes('*');
      return everyResource || (rule.nonResourceURLs ?? []).includes('*');
    });
    if (all) out.add(r.metadata.name);
  }
  return out;
}

export function clusterAdminPaths(user: string, userGroups: string[], crbs: AnyBinding[], plan?: RemovalPlan, adminRoles: Set<string> = new Set(['cluster-admin'])): number {
  const me: SubjectRef = { ...refFromUsername(user) };
  // Leaving a group only changes the current user's paths when they are the one removed.
  const isSelf = plan ? plan.subject.kind !== 'Group' && usernameOf(plan.subject) === user : false;
  const groups = new Set(userGroups);
  if (plan && isSelf) for (const g of plan.leftGroups) groups.delete(g);
  let n = 0;
  for (const b of crbs) {
    if (!adminRoles.has(b.roleRef?.name ?? '')) continue;
    const key = bindingKey({ kind: 'ClusterRoleBinding', name: b.metadata.name });
    if (plan?.deletedBindings.has(key)) continue;
    const removed = new Set(plan?.removedSubjects.get(key) ?? []);
    (b.subjects ?? []).forEach((s, i) => {
      if (removed.has(i)) return;
      if (subjectMatches(s, me) || (s.kind === 'Group' && groups.has(s.name))) n += 1;
    });
  }
  return n;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** True when a rule allows `verb` on `group/resource` (ignoring resourceNames, which narrow it). */
export function ruleAllows(rule: PolicyRule, verb: string, group: string, resource: string): boolean {
  const verbs = rule.verbs ?? [];
  const groups = rule.apiGroups ?? [];
  const resources = rule.resources ?? [];
  // Asking about "*" means every verb, which only a "*" rule grants.
  const verbOk = verbs.includes('*') || (verb !== '*' && verbs.includes(verb));
  const groupOk = groups.includes('*') || groups.includes(group);
  const resourceOk = resources.includes('*') || (resource !== '*' && resources.includes(resource));
  return verbOk && groupOk && resourceOk;
}

/** A short plain-English line for a set of rules. */
export function summarizeRules(rules: Array<{ verbs?: string[]; apiGroups?: string[]; resources?: string[]; resourceNames?: string[] }>): string {
  if (rules.length === 0) return 'nothing';
  if (rules.some((r) => (r.verbs ?? []).includes('*') && (r.resources ?? []).includes('*') && (r.apiGroups ?? []).includes('*'))) {
    return 'all verbs on all resources';
  }
  const parts = rules.slice(0, 3).map((r) => {
    const res = (r.resources ?? []).slice(0, 4).join(', ') + ((r.resources ?? []).length > 4 ? ', …' : '');
    const named = r.resourceNames?.length ? ` (only ${r.resourceNames.join(', ')})` : '';
    return `${(r.verbs ?? []).join(', ')} on ${res || '—'}${named}`;
  });
  return parts.join(' · ') + (rules.length > 3 ? ` · and ${rules.length - 3} more rule${rules.length - 3 === 1 ? '' : 's'}` : '');
}
