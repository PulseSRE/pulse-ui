/**
 * RBAC, SCC and webhook change history kept by the agent (`GET /rbac/changes`)
 * and the Pulse write ledger (`POST /rbac/ledger`). Contract: pulse-agent
 * API_CONTRACT.md.
 *
 * The agent observes these objects on each audit scan and keeps every
 * version, so a change comes with what it replaced. Who made a change is
 * known only when it was made through Pulse (the ledger); otherwise only the
 * client that wrote it (managedFields). An agent from before this endpoint
 * answers 404: the caller says so and falls back, nothing is invented.
 */
import { agentFetch } from './safeQuery';

const BASE = '/api/agent/rbac';

export type RbacKind =
  | 'Role' | 'ClusterRole' | 'RoleBinding' | 'ClusterRoleBinding'
  | 'SecurityContextConstraints' | 'ValidatingWebhookConfiguration' | 'MutatingWebhookConfiguration';

/** kind → API group, version, plural, namespaced. */
export const RBAC_KINDS: Record<RbacKind, { group: string; version: string; plural: string; namespaced: boolean }> = {
  Role: { group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'roles', namespaced: true },
  ClusterRole: { group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'clusterroles', namespaced: false },
  RoleBinding: { group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'rolebindings', namespaced: true },
  ClusterRoleBinding: { group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'clusterrolebindings', namespaced: false },
  SecurityContextConstraints: { group: 'security.openshift.io', version: 'v1', plural: 'securitycontextconstraints', namespaced: false },
  ValidatingWebhookConfiguration: { group: 'admissionregistration.k8s.io', version: 'v1', plural: 'validatingwebhookconfigurations', namespaced: false },
  MutatingWebhookConfiguration: { group: 'admissionregistration.k8s.io', version: 'v1', plural: 'mutatingwebhookconfigurations', namespaced: false },
};

export interface RbacChange {
  id: number;
  kind: RbacKind;
  namespace: string;
  name: string;
  change: 'created' | 'updated' | 'deleted';
  observed_at: string;
  manager: string;
  operation: string;
  manager_time: string | null;
  /** The Pulse write that made it, when there is one. */
  /** The Pulse write that produced exactly this version (matched by resourceVersion). */
  actor: { name: string; verified?: boolean; source: 'ui' | 'agent'; at: string; ledger_id: number; reason: string } | null;
  resource_version?: string;
  previous_id: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface RbacHistory {
  history: {
    since: string | null;
    last_observed_at: string | null;
    last_error: string | null;
    kinds: string[];
    unwatched: Array<{ kind: string; reason: string }>;
    retention_days: number;
    source: 'observed';
  };
  changes: RbacChange[];
  ledger: Array<{ id: number; at: string; actor: string; source: string; verb: string; kind: string; namespace: string; name: string; reason: string; outcome: string }>;
  hidden: number;
  system_hidden: number;
  truncated?: boolean;
}

export type HistoryResult = { state: 'ok'; data: RbacHistory } | { state: 'absent' };

export class RbacHistoryError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'RbacHistoryError';
  }
}

async function detailOf(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.detail === 'string' ? body.detail : typeof body?.error === 'string' ? body.error : '';
  } catch {
    return '';
  }
}

export async function fetchRbacHistory(opts: { includeSystem?: boolean; since?: string } = {}): Promise<HistoryResult> {
  const q = new URLSearchParams();
  if (opts.includeSystem) q.set('include_system', 'true');
  if (opts.since) q.set('since', opts.since);
  const res = await agentFetch(`${BASE}/changes${q.toString() ? `?${q}` : ''}`);
  if (res.status === 404) return { state: 'absent' };
  if (!res.ok) {
    const d = await detailOf(res);
    throw new RbacHistoryError(res.status, res.status === 401
      ? `The agent could not read the cluster as you (${d || 'no user token'}). Sign in again and retry.`
      : `Could not load RBAC change history (${res.status})${d ? `: ${d}` : ''}`);
  }
  const data = (await res.json()) as RbacHistory;
  if (!data || !Array.isArray(data.changes) || !data.history) throw new RbacHistoryError(res.status, 'Could not load RBAC change history: the agent sent an unexpected response.');
  return { state: 'ok', data };
}

export { recordLedger, type LedgerResult } from './writeLedger';

export function objectPath(kind: RbacKind, namespace: string, name?: string): string {
  const k = RBAC_KINDS[kind];
  const base = `/apis/${k.group}/${k.version}${k.namespaced ? `/namespaces/${encodeURIComponent(namespace)}` : ''}/${k.plural}`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

type Obj = { metadata?: Record<string, unknown>; [key: string]: unknown };

/**
 * The request that puts the stored previous version back.
 * - The object exists: PUT the previous version carrying the live
 *   resourceVersion, so a change made since the page read it is refused (409).
 *   The live ownerReferences are kept (the owner may have been re-created with
 *   a new uid), and for webhook configurations each webhook keeps the live
 *   `clientConfig.caBundle`, which the operator that serves it rotates.
 * - It is gone: POST the previous version. ownerReferences are dropped: they
 *   name an owner uid that may no longer exist, and the garbage collector
 *   would delete the restored object again.
 */
export function restoreRequest(change: Pick<RbacChange, 'kind' | 'namespace' | 'name' | 'before'>, live: Obj | null) {
  const k = RBAC_KINDS[change.kind];
  const before = JSON.parse(JSON.stringify(change.before ?? {})) as Obj;
  const meta: Record<string, unknown> = { ...(before.metadata ?? {}), name: change.name, ...(k.namespaced ? { namespace: change.namespace } : {}) };
  delete meta.ownerReferences;
  const body: Obj = { ...before, apiVersion: `${k.group}/${k.version}`, kind: change.kind, metadata: meta };
  if (live) {
    const liveMeta = (live.metadata ?? {}) as { resourceVersion?: string; ownerReferences?: unknown };
    meta.resourceVersion = liveMeta.resourceVersion;
    if (liveMeta.ownerReferences) meta.ownerReferences = liveMeta.ownerReferences;
    if (change.kind === 'ValidatingWebhookConfiguration' || change.kind === 'MutatingWebhookConfiguration') {
      type Hook = { name?: string; clientConfig?: { caBundle?: string } };
      const liveHooks = (live.webhooks ?? []) as Hook[];
      body.webhooks = ((body.webhooks ?? []) as Hook[]).map((w) => {
        const ca = liveHooks.find((l) => l.name === w.name)?.clientConfig?.caBundle;
        return ca ? { ...w, clientConfig: { ...(w.clientConfig ?? {}), caBundle: ca } } : w;
      });
    }
    return { method: 'PUT' as const, path: objectPath(change.kind, change.namespace, change.name), body };
  }
  return { method: 'POST' as const, path: objectPath(change.kind, change.namespace), body };
}

type Rule = { verbs?: string[]; apiGroups?: string[]; resources?: string[]; nonResourceURLs?: string[] };

function ruleGrants(r: Rule): string[] {
  const out: string[] = [];
  const v = r.verbs ?? []; const g = r.apiGroups ?? []; const res = r.resources ?? [];
  const where = `${res.join(',') || (r.nonResourceURLs ?? []).join(',')}${g.length ? ` in ${g.map((x) => x || 'core').join(',')}` : ''}`;
  if (v.includes('*') || g.includes('*') || res.includes('*') || (r.nonResourceURLs ?? []).includes('*')) out.push(`wildcard: ${v.join(',')} on ${where}`);
  for (const verb of ['escalate', 'bind', 'impersonate']) if (v.includes(verb)) out.push(`${verb} on ${where}`);
  if (res.some((x) => x === 'secrets' || x === '*') && (g.includes('') || g.includes('*')) && v.some((x) => ['get', 'list', 'watch', '*'].includes(x))) {
    out.push(`read Secrets (${v.filter((x) => ['get', 'list', 'watch', '*'].includes(x)).join(',')})`);
  }
  return out;
}

/** Sensitive grants in a Role/ClusterRole's rules. */
export function sensitiveGrants(kind: RbacKind, obj: Obj | null | undefined): string[] {
  if (!obj || (kind !== 'Role' && kind !== 'ClusterRole')) return [];
  return [...new Set(((obj.rules ?? []) as Rule[]).flatMap(ruleGrants))];
}

type Subject = { kind: string; name: string; namespace?: string };
const subjectKey = (s: Subject) => `${s.kind}/${s.namespace ?? ''}/${s.name}`;
const subjectText = (s: Subject) => (s.kind === 'ServiceAccount' ? `ServiceAccount ${s.namespace}/${s.name}` : `${s.kind} ${s.name}`);

/** Roles a binding to which hands over broad control. */
export const PRIVILEGED_ROLES = new Set(['cluster-admin', 'admin', 'edit']);

const SCC_FLAGS: Array<[string, string]> = [
  ['allowPrivilegedContainer', 'privileged containers'],
  ['allowHostNetwork', 'host network'],
  ['allowHostPID', 'host PID namespace'],
  ['allowHostPorts', 'host ports'],
  ['allowHostIPC', 'host IPC namespace'],
  ['allowPrivilegeEscalation', 'privilege escalation'],
];

/**
 * What a restore would grant or weaken that the live object does not: for
 * Roles, new wildcard/escalate/bind/impersonate/Secret-read rules; for
 * bindings, every added subject, a changed roleRef, and binding a privileged
 * role (cluster-admin, admin, edit or a custom all-powerful role in
 * `adminRoles`); for SCCs, newly allowed privileged settings; for webhooks,
 * removed webhooks and changed failurePolicy/sideEffects. `live` null means
 * the object is re-created, so everything in it counts.
 */
export function escalationOnRestore(kind: RbacKind, live: Obj | null, restored: Obj, adminRoles: Set<string> = new Set()): string[] {
  if (kind === 'Role' || kind === 'ClusterRole') {
    const now = new Set(sensitiveGrants(kind, live));
    return sensitiveGrants(kind, restored).filter((g) => !now.has(g));
  }
  if (kind === 'RoleBinding' || kind === 'ClusterRoleBinding') {
    const out: string[] = [];
    const lr = live?.roleRef as { kind?: string; name?: string } | undefined;
    const rr = restored.roleRef as { kind?: string; name?: string } | undefined;
    const liveSubs = new Set(((live?.subjects ?? []) as Subject[]).map(subjectKey));
    const added = ((restored.subjects ?? []) as Subject[]).filter((x) => !liveSubs.has(subjectKey(x)));
    const roleChanged = !!live && (lr?.name !== rr?.name || lr?.kind !== rr?.kind);
    if (roleChanged) out.push(`changes the role from ${lr?.kind ?? ''} ${lr?.name ?? '?'} to ${rr?.kind ?? ''} ${rr?.name ?? '?'}`);
    for (const a of added) out.push(`adds ${subjectText(a)}`);
    const privileged = rr?.name && (PRIVILEGED_ROLES.has(rr.name) || adminRoles.has(rr.name));
    if (privileged && (roleChanged || added.length > 0 || !live)) out.push(`binds ${rr!.name}${(restored.subjects as Subject[] | undefined)?.length ? ` to ${(restored.subjects as Subject[]).map(subjectText).join(', ')}` : ''}`);
    return out;
  }
  if (kind === 'SecurityContextConstraints') {
    const out: string[] = [];
    const l = (live ?? {}) as Record<string, unknown>;
    const r = restored as Record<string, unknown>;
    for (const [f, label] of SCC_FLAGS) if (r[f] === true && l[f] !== true) out.push(`allows ${label} (${f})`);
    const ru = (x: Record<string, unknown>) => (x.runAsUser as { type?: string } | undefined)?.type;
    if (ru(r) === 'RunAsAny' && ru(l) !== 'RunAsAny') out.push('lets pods run as any user, including root (runAsUser RunAsAny)');
    const liveCaps = new Set((l.allowedCapabilities as string[] | undefined) ?? []);
    for (const c of (r.allowedCapabilities as string[] | undefined) ?? []) if (!liveCaps.has(c)) out.push(`allows capability ${c}`);
    const liveVols = new Set((l.volumes as string[] | undefined) ?? []);
    for (const v of (r.volumes as string[] | undefined) ?? []) if (!liveVols.has(v) && (v === 'hostPath' || v === '*')) out.push(`allows ${v === '*' ? 'every volume type, including hostPath' : 'hostPath volumes'}`);
    const liveUsers = new Set((l.users as string[] | undefined) ?? []);
    for (const u of (r.users as string[] | undefined) ?? []) if (!liveUsers.has(u)) out.push(`grants this SCC to ${u}`);
    const liveGroups = new Set((l.groups as string[] | undefined) ?? []);
    for (const g of (r.groups as string[] | undefined) ?? []) if (!liveGroups.has(g)) out.push(`grants this SCC to group ${g}`);
    return out;
  }
  if (kind === 'ValidatingWebhookConfiguration' || kind === 'MutatingWebhookConfiguration') {
    type Hook = { name?: string; failurePolicy?: string; sideEffects?: string };
    const out: string[] = [];
    const lh = (live?.webhooks ?? []) as Hook[];
    const rh = (restored.webhooks ?? []) as Hook[];
    for (const w of lh) {
      const r = rh.find((x) => x.name === w.name);
      if (!r) { out.push(`removes webhook ${w.name}`); continue; }
      if ((r.failurePolicy ?? 'Fail') !== (w.failurePolicy ?? 'Fail')) out.push(`changes failurePolicy of ${w.name} from ${w.failurePolicy ?? 'Fail'} to ${r.failurePolicy ?? 'Fail'}`);
      if ((r.sideEffects ?? '') !== (w.sideEffects ?? '')) out.push(`changes sideEffects of ${w.name} from ${w.sideEffects ?? '(unset)'} to ${r.sideEffects ?? '(unset)'}`);
    }
    return out;
  }
  return [];
}

const SERVER_FIELDS = ['managedFields', 'resourceVersion', 'uid', 'creationTimestamp', 'generation', 'selfLink'];

/** An object as the history stores it: no status, no server-owned metadata. */
export function comparable(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  const copy = JSON.parse(JSON.stringify(obj)) as Record<string, unknown> & { metadata?: Record<string, unknown> };
  if (copy.metadata) for (const f of SERVER_FIELDS) delete copy.metadata[f];
  delete copy.status;
  return copy;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

export function stableLines(obj: unknown): string[] {
  return obj == null ? [] : JSON.stringify(sortKeys(obj), null, 2).split('\n');
}

export interface DiffLine { op: ' ' | '+' | '-'; text: string }

/** Line diff (LCS) of two objects; null when they are too large to diff here. */
export function lineDiff(a: unknown, b: unknown, maxLines = 600): DiffLine[] | null {
  const x = stableLines(a);
  const y = stableLines(b);
  if (x.length > maxLines || y.length > maxLines) return null;
  const n = x.length; const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ op: ' ', text: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ op: '-', text: x[i] }); i++; }
    else { out.push({ op: '+', text: y[j] }); j++; }
  }
  while (i < n) out.push({ op: '-', text: x[i++] });
  while (j < m) out.push({ op: '+', text: y[j++] });
  return out;
}

/** Only the changed lines and a little context around them. */
export function compactDiff(lines: DiffLine[], context = 2): Array<DiffLine | { op: '…'; text: string }> {
  const keep = new Set<number>();
  lines.forEach((l, i) => { if (l.op !== ' ') for (let k = i - context; k <= i + context; k++) keep.add(k); });
  const out: Array<DiffLine | { op: '…'; text: string }> = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep.has(i)) {
      if (skipped) { out.push({ op: '…', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` }); skipped = 0; }
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ op: '…', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
  return out;
}
