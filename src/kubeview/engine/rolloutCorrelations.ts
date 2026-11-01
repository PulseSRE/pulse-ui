/**
 * Alerts and findings tied to workload revisions, for the rollout timeline.
 *
 * Two sources: the agent's `rollout_history.correlations` (free-form entries
 * per revision), and the client's own monitor findings and inbox items that
 * name the workload or one of its pods, placed in the revision whose lifetime
 * they started in.
 */
import type { Finding } from './monitorClient';
import type { InboxItem } from './inboxApi';
import { isExternalUrl, isKnownRoute } from './routeTable';

export interface CorrelatedSignal {
  label: string;
  severity?: string;
  /** Internal route (followed through the router) or external URL. */
  href?: string;
  source: 'agent' | 'finding' | 'inbox';
}

export interface RevisionCorrelation {
  revision: number;
  items: CorrelatedSignal[];
}

function safeHref(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const link = raw.trim();
  if (isExternalUrl(link)) return /^https?:\/\//i.test(link) ? link : undefined;
  return isKnownRoute(link) ? link : undefined;
}

/**
 * The agent spec says `alertsOrFindings[]` without fixing the entry shape:
 * accept plain strings and objects with a title/name/alertname/summary, an
 * optional severity, and a link (link/href/url) or an inbox item id.
 */
export function normalizeAgentCorrelations(raw: unknown): RevisionCorrelation[] {
  if (!Array.isArray(raw)) return [];
  const out: RevisionCorrelation[] = [];
  for (const c of raw) {
    const revision = Number((c as { revision?: unknown })?.revision);
    const entries = (c as { alertsOrFindings?: unknown })?.alertsOrFindings;
    if (!Number.isInteger(revision) || !Array.isArray(entries)) continue;
    const items: CorrelatedSignal[] = [];
    for (const e of entries) {
      if (typeof e === 'string') {
        if (e.trim()) items.push({ label: e.trim(), source: 'agent' });
        continue;
      }
      if (!e || typeof e !== 'object') continue;
      const o = e as Record<string, unknown>;
      const label = [o.title, o.name, o.alertname, o.summary, o.message].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
      if (!label) continue;
      const inboxId = [o.inboxItemId, o.taskId].find((v) => typeof v === 'string' && v) as string | undefined;
      items.push({
        label: label.trim(),
        severity: typeof o.severity === 'string' ? o.severity : undefined,
        href: safeHref(o.link ?? o.href ?? o.url) ?? (inboxId ? `/inbox?task=${encodeURIComponent(inboxId)}` : undefined),
        source: 'agent',
      });
    }
    if (items.length) out.push({ revision, items });
  }
  return out;
}

export interface RevisionWindow {
  revision: number;
  /** ReplicaSet or ControllerRevision name. */
  name: string;
  createdAt?: string;
}

interface WorkloadRef { kind: string; namespace: string; name: string }

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The revision a signal belongs to: exactly, when it names a pod or
 * ReplicaSet of a known Deployment revision; otherwise by when it started.
 * Null when it is not about this workload.
 */
function revisionFor(
  resources: Array<{ kind: string; name: string; namespace?: string }>,
  startedMs: number,
  workload: WorkloadRef,
  revisions: RevisionWindow[],
): number | null {
  let aboutWorkload = false;
  for (const r of resources) {
    if (r.namespace && r.namespace !== workload.namespace) continue;
    if (r.kind === workload.kind && r.name === workload.name) { aboutWorkload = true; continue; }
    if (workload.kind === 'Deployment' && (r.kind === 'Pod' || r.kind === 'ReplicaSet')) {
      // Pods and ReplicaSets of a Deployment carry the ReplicaSet's name: an exact revision.
      const hit = revisions.find((rev) => (r.kind === 'ReplicaSet' ? r.name === rev.name : r.name.startsWith(`${rev.name}-`)));
      if (hit) return hit.revision;
    }
    if (r.kind === 'Pod') {
      const own = workload.kind === 'StatefulSet'
        ? new RegExp(`^${escapeRe(workload.name)}-\\d+$`)
        : workload.kind === 'DaemonSet' ? new RegExp(`^${escapeRe(workload.name)}-[a-z0-9]{5}$`) : null;
      if (own?.test(r.name)) aboutWorkload = true;
    }
  }
  if (!aboutWorkload || !Number.isFinite(startedMs)) return null;
  const dated = revisions
    .filter((r) => r.createdAt && Number.isFinite(Date.parse(r.createdAt)))
    .sort((a, b) => Date.parse(a.createdAt!) - Date.parse(b.createdAt!));
  let found: number | null = null;
  for (const r of dated) {
    if (Date.parse(r.createdAt!) <= startedMs) found = r.revision;
    else break;
  }
  return found;
}

/**
 * Monitor findings and inbox items the client already holds, by revision. A
 * finding links to its inbox item when the client has one; an inbox item
 * links to itself. A finding and the inbox item made from it are one entry.
 */
export function correlateClientSignals(
  workload: WorkloadRef,
  revisions: RevisionWindow[],
  findings: Finding[],
  inboxItems: InboxItem[],
): RevisionCorrelation[] {
  const byRev = new Map<number, CorrelatedSignal[]>();
  const add = (rev: number | null, s: CorrelatedSignal) => {
    if (rev === null) return;
    if (!byRev.has(rev)) byRev.set(rev, []);
    byRev.get(rev)!.push(s);
  };
  const inboxByFinding = new Map(inboxItems.filter((i) => i.finding_id).map((i) => [i.finding_id!, i]));
  const shownInbox = new Set<string>();
  for (const f of findings) {
    const item = inboxByFinding.get(f.id);
    if (item) shownInbox.add(item.id);
    add(revisionFor(f.resources || [], f.timestamp, workload, revisions), {
      label: f.title,
      severity: f.severity,
      href: item ? `/inbox?task=${encodeURIComponent(item.id)}` : undefined,
      source: 'finding',
    });
  }
  for (const i of inboxItems) {
    if (shownInbox.has(i.id)) continue;
    add(revisionFor(i.resources || [], i.created_at * 1000, workload, revisions), {
      label: i.title,
      severity: i.severity ?? undefined,
      href: `/inbox?task=${encodeURIComponent(i.id)}`,
      source: 'inbox',
    });
  }
  return [...byRev.entries()].map(([revision, items]) => ({ revision, items }));
}

/** Merge correlation lists by revision. */
export function mergeCorrelations(...lists: RevisionCorrelation[][]): Map<number, CorrelatedSignal[]> {
  const out = new Map<number, CorrelatedSignal[]>();
  for (const list of lists) {
    for (const c of list) {
      if (!out.has(c.revision)) out.set(c.revision, []);
      out.get(c.revision)!.push(...c.items);
    }
  }
  return out;
}
