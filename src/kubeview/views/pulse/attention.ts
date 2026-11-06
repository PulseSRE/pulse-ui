/**
 * "What needs attention": one worst-first list, from the monitor's open
 * findings.
 *
 * Home used to filter pods in the browser with rules of its own (no system
 * namespaces, no Job pods, no OOMKilled, no CreateContainerConfigError, no
 * running-but-not-ready), so one cluster looked different here than in the
 * Inbox, which uses the monitor's scanners. Now the monitor is the source;
 * the browser computes a list only when the monitor cannot be reached (or the
 * active cluster is not the one it watches), and the page says so.
 *
 * Cause text: the investigation's suspected cause when there is one, else
 * the diagnosis engine's reading of the live object (engine/diagnosis.ts),
 * else the scanner's summary.
 */
import { diagnoseResource, type Diagnosis } from '../../engine/diagnosis';
import { isSystemNamespace } from '../../engine/namespace';
import { resourceDetailUrl } from '../../engine/gvr';
import type { Finding, InvestigationReport, ScanReport } from '../../engine/monitorClient';
import type { InboxItem } from '../../engine/inboxApi';
import type { K8sResource } from '../../engine/renderers';
import type { ClusterOperator, Node, Pod, PersistentVolumeClaim } from '../../engine/types';
import type { Deployment } from '../../engine/types/apps';

export type Severity = 'critical' | 'warning';

export interface AttentionRow {
  key: string;
  severity: Severity;
  /** '' for cluster-scoped. */
  namespace: string;
  /** In an openshift-* / kube-* namespace: collapsed by default. */
  system: boolean;
  resource?: { kind: string; name: string; namespace?: string };
  problem: string;
  cause: string;
  causeSource: 'investigation' | 'diagnosis' | 'finding';
  /** When the condition began (epoch ms). */
  startedAt: number;
  confidence: number | null;
  confidenceSource: 'investigated' | 'scanner' | null;
  findingId?: string;
  inboxItem?: InboxItem;
  fixReady: boolean;
  noisy: boolean;
  path?: string;
  /** Firing alerts about the same resource, folded into this row. */
  alsoAlerts?: string[];
}

export interface CouldNotCheck {
  title: string;
  detail: string;
  remedy?: string;
}

export interface AttentionModel {
  source: 'monitor' | 'client' | 'checking';
  /** Why the browser computed the list (source 'client'). */
  fallbackReason?: string;
  rows: AttentionRow[];
  noisy: AttentionRow[];
  couldNotCheck: CouldNotCheck[];
  scanners?: { ran: number; total: number };
  lastScanTime: number;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1 };
const API_VERSIONS: Record<string, string> = {
  Pod: 'v1', Node: 'v1', PersistentVolumeClaim: 'v1', Service: 'v1', ConfigMap: 'v1', Namespace: 'v1',
  Deployment: 'apps/v1', StatefulSet: 'apps/v1', DaemonSet: 'apps/v1', ReplicaSet: 'apps/v1',
  Job: 'batch/v1', CronJob: 'batch/v1',
  HorizontalPodAutoscaler: 'autoscaling/v2',
  ClusterOperator: 'config.openshift.io/v1',
  Route: 'route.openshift.io/v1',
};

export const NOISE_HIDE_THRESHOLD = 0.5;

export function isSystem(ns: string): boolean {
  return !!ns && isSystemNamespace(ns);
}

function pathFor(r: { kind: string; name: string; namespace?: string }): string | undefined {
  const apiVersion = API_VERSIONS[r.kind];
  if (!apiVersion || !r.name) return undefined;
  return resourceDetailUrl({ apiVersion, kind: r.kind, metadata: { name: r.name, namespace: r.namespace || undefined } });
}

export interface LiveObjects {
  pods: Pod[];
  deployments: Deployment[];
  nodes: Node[];
  pvcs: PersistentVolumeClaim[];
  /** Read only by the browser fallback; the monitor has its own operator scanner. */
  operators?: ClusterOperator[];
}

function findObject(live: LiveObjects, r: { kind: string; name: string; namespace?: string }): K8sResource | undefined {
  const match = (o: { metadata?: { name?: string; namespace?: string } }) =>
    o.metadata?.name === r.name && (o.metadata?.namespace || '') === (r.namespace || '');
  const list: Array<{ metadata?: { name?: string; namespace?: string } }> =
    r.kind === 'Pod' ? live.pods : r.kind === 'Deployment' ? live.deployments : r.kind === 'Node' ? live.nodes : r.kind === 'PersistentVolumeClaim' ? live.pvcs : [];
  const found = list.find(match);
  // List responses carry no per-item kind; the diagnosis engine needs it.
  return found ? ({ ...found, kind: r.kind } as unknown as K8sResource) : undefined;
}

export function diagnosisText(d: Diagnosis): string {
  return d.detail ? `${d.title}: ${d.detail}` : d.title;
}

/**
 * The finding's own Inbox item: by finding id, else an item of the same
 * category on the same resource (the bridge keys items "<category>:<ns>:<Kind>/<name>").
 * Never another category's item that happens to name the same pod.
 */
export function inboxFor(f: Finding, items: InboxItem[]): InboxItem | undefined {
  const byFinding = items.find((i) => i.finding_id === f.id);
  if (byFinding) return byFinding;
  const r = f.resources?.[0];
  if (!r) return undefined;
  return items.find((i) =>
    (i.correlation_key || '').startsWith(`${f.category}:`)
    && (i.resources || []).some((x) => x.kind === r.kind && x.name === r.name && (x.namespace || '') === (r.namespace || '')));
}

function resourceKey(r?: { kind: string; name: string; namespace?: string }): string | null {
  return r && r.kind !== 'Alert' ? `${r.kind}/${r.namespace || ''}/${r.name}` : null;
}

/**
 * One row per resource: a firing-alert finding about a resource that already
 * has a row is folded into it as "Also in: alert X", so a crashlooping pod
 * and its KubePodCrashLooping alert are one problem, not two.
 */
export function foldAlerts(rows: AttentionRow[], findings: Finding[]): AttentionRow[] {
  const alertIds = new Set(findings.filter((f) => f.category === 'alerts').map((f) => f.id));
  const byResource = new Map<string, AttentionRow>();
  for (const r of rows) {
    const k = resourceKey(r.resource);
    if (k && r.findingId && !alertIds.has(r.findingId) && !byResource.has(k)) byResource.set(k, r);
  }
  const out: AttentionRow[] = [];
  for (const r of rows) {
    const k = resourceKey(r.resource);
    const host = k && r.findingId && alertIds.has(r.findingId) ? byResource.get(k) : undefined;
    if (host) {
      host.alsoAlerts = [...(host.alsoAlerts || []), r.problem.split(' · ').pop() || r.problem];
      if (r.severity === 'critical') host.severity = 'critical';
      continue;
    }
    out.push(r);
  }
  return out;
}

export function rowsFromFindings(
  findings: Finding[],
  investigations: InvestigationReport[],
  inbox: InboxItem[],
  live: LiveObjects,
  pendingFixFor: Set<string>,
): { rows: AttentionRow[]; noisy: AttentionRow[]; degraded: Finding[] } {
  const rows: AttentionRow[] = [];
  const noisy: AttentionRow[] = [];
  const degraded: Finding[] = [];
  for (const f of findings) {
    if (f.category === 'degraded') { degraded.push(f); continue; }
    if (f.severity !== 'critical' && f.severity !== 'warning') continue;
    const r = f.resources?.[0];
    const ns = r?.namespace || '';
    const inv = investigations
      .filter((i) => i.findingId === f.id && i.status === 'completed')
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    const obj = r ? findObject(live, r) : undefined;
    const diagnosis = obj ? diagnoseResource(obj).find((d) => d.severity !== 'info') : undefined;
    const item = inboxFor(f, inbox);
    const itemInv = item?.metadata as { suspected_cause?: string; investigation_confidence?: number; action_plan?: unknown } | undefined;
    const cause = inv?.suspectedCause || itemInv?.suspected_cause || (diagnosis ? diagnosisText(diagnosis) : '') || f.summary;
    const causeSource: AttentionRow['causeSource'] = inv?.suspectedCause || itemInv?.suspected_cause ? 'investigation' : diagnosis ? 'diagnosis' : 'finding';
    const invConfidence = typeof inv?.confidence === 'number' ? inv.confidence : typeof itemInv?.investigation_confidence === 'number' ? itemInv.investigation_confidence : null;
    const row: AttentionRow = {
      key: f.id,
      severity: f.severity,
      namespace: ns,
      system: isSystem(ns),
      resource: r ? { kind: r.kind, name: r.name, namespace: r.namespace } : undefined,
      problem: r ? `${ns ? `${ns}/` : ''}${r.name} · ${f.title}` : f.title,
      cause,
      causeSource,
      startedAt: f.startedAt || f.timestamp,
      confidence: invConfidence ?? (typeof f.confidence === 'number' ? f.confidence : null),
      confidenceSource: invConfidence !== null ? 'investigated' : typeof f.confidence === 'number' ? 'scanner' : null,
      findingId: f.id,
      inboxItem: item,
      fixReady: pendingFixFor.has(f.id) || !!itemInv?.action_plan,
      noisy: (f.noiseScore ?? 0) >= NOISE_HIDE_THRESHOLD,
      path: r ? pathFor(r) : undefined,
    };
    (row.noisy ? noisy : rows).push(row);
  }
  return { rows: sortRows(foldAlerts(rows, findings)), noisy: sortRows(noisy), degraded };
}

export function sortRows(rows: AttentionRow[]): AttentionRow[] {
  return [...rows].sort((a, b) =>
    (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    || ((b.confidence ?? -1) - (a.confidence ?? -1))
    || (b.startedAt - a.startedAt));
}

/**
 * The browser's own reading, for when the monitor is unreachable: every live
 * object the diagnosis engine flags, system namespaces and Job pods included.
 */
export function rowsFromClient(live: LiveObjects): AttentionRow[] {
  const rows: AttentionRow[] = [];
  // List responses carry no per-item kind; the diagnosis engine needs it.
  const withKind = (o: object, kind: string) => ({ obj: { ...o, kind } as unknown as K8sResource, kind });
  const all: Array<{ obj: K8sResource; kind: string }> = [
    ...live.pods.map((o) => withKind(o, 'Pod')),
    ...live.deployments.map((o) => withKind(o, 'Deployment')),
    ...live.nodes.map((o) => withKind(o, 'Node')),
    ...live.pvcs.map((o) => withKind(o, 'PersistentVolumeClaim')),
  ];
  for (const { obj, kind } of all) {
    // Completed Job pods are done, not broken.
    if (kind === 'Pod' && (obj as unknown as Pod).status?.phase === 'Succeeded') continue;
    const ds = diagnoseResource(obj).filter((d) => d.severity === 'critical' || d.severity === 'warning');
    if (ds.length === 0) continue;
    const worst = ds.find((d) => d.severity === 'critical') ?? ds[0];
    const ns = obj.metadata.namespace || '';
    const r = { kind, name: obj.metadata.name, namespace: ns || undefined };
    rows.push({
      key: `${kind}/${ns}/${obj.metadata.name}`,
      severity: worst.severity as Severity,
      namespace: ns,
      system: isSystem(ns),
      resource: r,
      problem: `${ns ? `${ns}/` : ''}${obj.metadata.name} · ${worst.title}`,
      cause: worst.detail || worst.title,
      causeSource: 'diagnosis',
      startedAt: Date.parse(String(obj.metadata.creationTimestamp ?? '')) || Date.now(),
      confidence: null,
      confidenceSource: null,
      fixReady: false,
      noisy: false,
      path: pathFor(r),
    });
  }
  for (const op of live.operators || []) {
    const degraded = (op.status?.conditions || []).find((c) => c.type === 'Degraded' && c.status === 'True');
    if (!degraded) continue;
    const r = { kind: 'ClusterOperator', name: op.metadata.name };
    rows.push({
      key: `ClusterOperator//${op.metadata.name}`,
      severity: 'critical',
      namespace: '',
      system: false,
      resource: r,
      problem: `Operator ${op.metadata.name} degraded`,
      cause: degraded.message || degraded.reason || 'Cluster operator not functioning',
      causeSource: 'diagnosis',
      startedAt: Date.parse(String(degraded.lastTransitionTime ?? '')) || Date.now(),
      confidence: null,
      confidenceSource: null,
      fixReady: false,
      noisy: false,
      path: pathFor(r),
    });
  }
  return sortRows(rows);
}

export function couldNotCheckFrom(degraded: Finding[], report: ScanReport | null): { items: CouldNotCheck[]; scanners?: { ran: number; total: number } } {
  const items: CouldNotCheck[] = degraded.map((f) => ({ title: f.title, detail: f.summary, remedy: f.remedy }));
  const failed = (report?.scanners || []).filter((s) => s.status === 'error');
  for (const s of failed) {
    if (items.some((i) => i.title.includes(s.displayName) || i.detail.includes(s.displayName))) continue;
    items.push({ title: `${s.displayName} scanner failed in the last scan`, detail: s.description });
  }
  const total = report?.scanners?.length ?? 0;
  return { items, scanners: total ? { ran: total - failed.length, total } : undefined };
}
