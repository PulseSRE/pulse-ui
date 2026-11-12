/**
 * What rolling back an agent fix will change, from the fix's own rollback data.
 *
 * The agent keeps one of two undos on a completed fix (`rollbackAction`):
 * - `restore_snapshot`: a copy of the object taken just before the fix
 *   (Deployment/StatefulSet/DaemonSet spec, or ConfigMap data, plus labels and
 *   annotations). Rolling back replaces those subtrees on the live object.
 *   The agent refuses when the object was recreated or edited since the fix.
 * - `rollback_deployment`: a revision rollback of the restarted workload.
 *
 * The browser can read the live object, so for a snapshot the confirm shows
 * the exact change, live value → restored value, field by field.
 */
import type { ActionRecord } from './fixHistory';

/** Same shape as WriteConfirmDialog's diff. */
export interface DiffLine { field: string; before?: string; after?: string }
export interface WriteDiff { header: string; lines: DiffLine[] }

export interface FixSnapshot {
  kind: string;
  name: string;
  namespace: string;
  metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> };
  uid?: string;
  spec?: unknown;
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  /** The object's change marker right after the fix (generation, or resourceVersion for a ConfigMap). */
  afterFix?: { generation?: number | null; resourceVersion?: string | null };
}

export type RollbackPlan =
  | { kind: 'snapshot'; snapshot: FixSnapshot; path: string }
  | { kind: 'revision'; input: { namespace?: string; name?: string; revision?: number | string } }
  /** Rollback is offered, but the record does not say how (older agents, unknown tool). */
  | { kind: 'unknown'; tool?: string; input?: Record<string, unknown> };

const PATHS: Record<string, (ns: string, name: string) => string> = {
  Deployment: (ns, n) => `/apis/apps/v1/namespaces/${ns}/deployments/${n}`,
  StatefulSet: (ns, n) => `/apis/apps/v1/namespaces/${ns}/statefulsets/${n}`,
  DaemonSet: (ns, n) => `/apis/apps/v1/namespaces/${ns}/daemonsets/${n}`,
  ConfigMap: (ns, n) => `/api/v1/namespaces/${ns}/configmaps/${n}`,
};

const LAST_APPLIED = 'kubectl.kubernetes.io/last-applied-configuration';

export function rollbackPlan(action: ActionRecord): RollbackPlan {
  const ra = action.rollbackAction;
  if (ra?.tool === 'restore_snapshot') {
    const blob = ra.input?.snapshot;
    let snap: FixSnapshot | null = null;
    if (typeof blob === 'string') {
      try { snap = JSON.parse(blob) as FixSnapshot; } catch { snap = null; }
    } else if (blob && typeof blob === 'object') {
      snap = blob as FixSnapshot;
    }
    const pathOf = snap ? PATHS[snap.kind] : undefined;
    if (snap && pathOf && snap.name && snap.namespace) {
      return { kind: 'snapshot', snapshot: snap, path: pathOf(encodeURIComponent(snap.namespace), encodeURIComponent(snap.name)) };
    }
    return { kind: 'unknown', tool: ra.tool };
  }
  if (ra?.tool === 'rollback_deployment') {
    return { kind: 'revision', input: ra.input as { namespace?: string; name?: string; revision?: number | string } };
  }
  return { kind: 'unknown', tool: ra?.tool, input: ra?.input };
}

function show(v: unknown): string {
  return v === undefined ? '(not set)' : JSON.stringify(v);
}

/** Leaf paths of a JSON value: `spec.template.spec.containers[0].image` → value. */
function flatten(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    if (value.length === 0) { out.set(prefix, []); return; }
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) { out.set(prefix, {}); return; }
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  out.set(prefix, value);
}

/** The subtrees the agent replaces, as it replaces them (see pulse-agent snapshot.restore). */
function restoredFields(snap: FixSnapshot, live: Record<string, unknown> | null): Record<string, unknown> {
  const liveMeta = ((live?.metadata ?? {}) as { annotations?: Record<string, string> });
  const annotations: Record<string, string> = { ...(snap.metadata?.annotations ?? {}) };
  // The agent keeps the live last-applied blob rather than replaying it.
  if (liveMeta.annotations && LAST_APPLIED in liveMeta.annotations) annotations[LAST_APPLIED] = liveMeta.annotations[LAST_APPLIED];
  const out: Record<string, unknown> = {
    'metadata.labels': { ...(snap.metadata?.labels ?? {}) },
    'metadata.annotations': annotations,
  };
  if (snap.kind === 'ConfigMap') {
    out.data = snap.data ?? {};
    out.binaryData = snap.binaryData ?? {};
  } else {
    out.spec = snap.spec ?? {};
  }
  return out;
}

function liveAt(live: Record<string, unknown>, dotted: string): unknown {
  let cur: unknown = live;
  for (const part of dotted.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined;
  return cur;
}

/**
 * The exact change, live → restored. Only fields that differ are listed;
 * an empty list means the live object already matches the snapshot.
 */
export function snapshotDiff(snap: FixSnapshot, live: Record<string, unknown>): WriteDiff {
  const lines: DiffLine[] = [];
  for (const [field, restored] of Object.entries(restoredFields(snap, live))) {
    const before = new Map<string, unknown>();
    const after = new Map<string, unknown>();
    flatten(liveAt(live, field) ?? {}, field, before);
    flatten(restored, field, after);
    const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
    for (const k of keys) {
      const b = before.get(k);
      const a = after.get(k);
      if (JSON.stringify(b) !== JSON.stringify(a)) lines.push({ field: k, before: show(b), after: show(a) });
    }
  }
  return { header: `${snap.kind} ${snap.namespace}/${snap.name} · live → as before the fix`, lines };
}

/**
 * Whether the object changed after the fix, which makes the agent refuse
 * (it never overwrites a later change). `null` when the live object is unknown.
 */
export function changedSinceFix(snap: FixSnapshot, live: Record<string, unknown> | null): { changed: boolean; text: string } | null {
  if (!live) return null;
  const meta = (live.metadata ?? {}) as { uid?: string; generation?: number; resourceVersion?: string };
  if (snap.uid && meta.uid && snap.uid !== meta.uid) {
    return { changed: true, text: `${snap.kind} ${snap.name} was deleted and recreated since the fix; the agent will refuse to roll back.` };
  }
  const marker = snap.afterFix;
  if (!marker) {
    return { changed: true, text: 'Cannot be ruled out: this snapshot does not record the object after the fix, so the agent will refuse and ask you to revert by hand.' };
  }
  if (marker.generation != null) {
    return meta.generation === marker.generation
      ? { changed: false, text: `No (generation ${marker.generation})` }
      : { changed: true, text: `Yes: generation ${marker.generation} → ${meta.generation ?? 'unknown'}. The agent will refuse rather than overwrite that change.` };
  }
  if (marker.resourceVersion != null) {
    return meta.resourceVersion === marker.resourceVersion
      ? { changed: false, text: `No (resourceVersion ${marker.resourceVersion})` }
      : { changed: true, text: `Yes: resourceVersion ${marker.resourceVersion} → ${meta.resourceVersion ?? 'unknown'}. The agent will refuse rather than overwrite that change.` };
  }
  return null;
}
