/**
 * Preview a Helm install, upgrade or values change before it runs.
 *
 * 1. Render: `helm template` runs in the same runner Job, image, ServiceAccount
 *    and Role as every other Helm action (runHelmAction). Rendering touches
 *    nothing on the cluster, so the runner needs no permission it does not
 *    already have. The UI reads the rendered manifests from the Job's log.
 * 2. Diff: the render is compared object by object with the release's current
 *    manifest from its release record (empty for an install).
 * 3. Check: every added or changed object is sent to the API server with
 *    dryRun=All as the signed-in user, and every object is checked against
 *    the runner's Role. Nothing is applied.
 */
import { k8sFetch } from '../../engine/query';
import { decodeHelmRelease } from '../../engine/helmRelease';
import { resolveKind } from '../../engine/kindRegistry';
import { errorReason } from '../../engine/readResult';
import {
  diffObjects, hooksFor, parseRendered, recordHooks, testHooks,
  type ObjectChange, type RenderedObject,
} from '../../engine/helmManifest';
import { deleteHelmJob, readHelmJobOutput, runHelmAction, type HelmRequest } from './helmRunner';
import { runnerCanManage } from './helmInstall';

export interface ReleaseRecord {
  manifest: string;
  hooks: unknown[];
  config: Record<string, unknown>;
  chartVersion?: string;
}

/** Read one revision's release record. Throws when it cannot be read or decoded. */
export async function fetchReleaseRecord(clusterId: string, namespace: string, secretName: string): Promise<ReleaseRecord> {
  const res = await k8sFetch(clusterId, `/api/v1/namespaces/${namespace}/secrets/${encodeURIComponent(secretName)}`);
  if (!res.ok) throw new Error(`The release record ${secretName} could not be read: ${errorReason({ status: res.status })}`);
  const secret = await res.json();
  const rel = await decodeHelmRelease(secret?.data?.release);
  if (!rel) throw new Error(`The release record ${secretName} could not be decoded`);
  return {
    manifest: typeof rel.manifest === 'string' ? rel.manifest : '',
    hooks: Array.isArray(rel.hooks) ? rel.hooks : [],
    config: rel.config && typeof rel.config === 'object' ? rel.config : {},
    chartVersion: rel.chart?.metadata?.version,
  };
}

export interface ClusterCapabilities {
  kubeVersion?: string;
  apiVersions?: string[];
  /** Why the render could not use the cluster's version or API list. */
  note?: string;
}

/**
 * The cluster's version and API groups, passed to helm template so charts
 * that branch on .Capabilities (e.g. "is route.openshift.io/v1 served?")
 * render as they would on this cluster.
 */
export async function clusterCapabilities(clusterId: string): Promise<ClusterCapabilities> {
  const out: ClusterCapabilities = {};
  const missing: string[] = [];
  try {
    const v = await k8sFetch(clusterId, '/version');
    if (v.ok) {
      const gitVersion = (await v.json())?.gitVersion;
      if (typeof gitVersion === 'string') out.kubeVersion = gitVersion.replace(/\+.*$/, '');
    } else missing.push('version');
  } catch { missing.push('version'); }
  try {
    const a = await k8sFetch(clusterId, '/apis');
    if (a.ok) {
      const groups = ((await a.json())?.groups ?? []) as Array<{ versions?: Array<{ groupVersion?: string }> }>;
      out.apiVersions = ['v1', ...groups.flatMap((g) => (g.versions ?? []).map((x) => x.groupVersion).filter((x): x is string => !!x))];
    } else missing.push('API list');
  } catch { missing.push('API list'); }
  if (missing.length) out.note = `Rendered without the cluster's ${missing.join(' and ')}: charts that check .Capabilities may render differently on the cluster.`;
  return out;
}

export type CheckStatus = 'ok' | 'fail' | 'unknown';

export interface ObjectCheck {
  status: CheckStatus;
  message?: string;
}

export interface PreviewEntry extends ObjectChange {
  check: ObjectCheck;
}

export interface HelmPreview {
  at: number;
  action: 'install' | 'upgrade';
  entries: PreviewEntry[];
  /** Hooks that run for this action, in weight order. */
  hooks: RenderedObject[];
  testHooks: RenderedObject[];
  warnings: string[];
  capabilitiesNote?: string;
}

function pathFor(o: { apiVersion: string; kind: string; namespace: string }, name?: string): string {
  const r = resolveKind(o.kind, o.apiVersion);
  const base = r.group ? `/apis/${r.group}/${r.version}` : `/api/${r.version}`;
  const ns = o.namespace ? `/namespaces/${o.namespace}` : '';
  return `${base}${ns}/${r.plural}${name ? `/${encodeURIComponent(name)}` : ''}`;
}

async function statusMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.message || errorReason({ status: res.status });
}

/** Who owns an existing object, per Helm's ownership annotations. */
async function existingOwner(clusterId: string, e: ObjectChange): Promise<{ release?: string; namespace?: string } | null> {
  const res = await k8sFetch(clusterId, pathFor(e, e.name));
  if (!res.ok) return null;
  const ann = (await res.json())?.metadata?.annotations ?? {};
  return { release: ann['meta.helm.sh/release-name'], namespace: ann['meta.helm.sh/release-namespace'] };
}

/** Dry-run one object as the signed-in user, plus the runner Role check. */
export async function checkObject(clusterId: string, e: ObjectChange, release: { name: string; namespace: string }): Promise<ObjectCheck> {
  if (!runnerCanManage(e.apiVersion, e.kind)) {
    return { status: 'fail', message: `The Helm runner's Role in ${release.namespace} cannot ${e.change === 'removed' ? 'delete' : 'manage'} ${e.kind}, so helm would stop here.` };
  }
  if (e.change === 'removed') return { status: 'ok', message: 'Helm deletes it.' };
  try {
    const res = e.change === 'added'
      ? await k8sFetch(clusterId, `${pathFor(e)}?dryRun=All`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e.doc) })
      : await k8sFetch(clusterId, `${pathFor(e, e.name)}?dryRun=All&fieldManager=helm&force=true`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/apply-patch+yaml' }, body: JSON.stringify(e.doc),
      });
    if (res.ok) return { status: 'ok' };
    if (res.status === 409 && e.change === 'added') {
      const owner = await existingOwner(clusterId, e);
      if (owner?.release === release.name && (owner.namespace ?? release.namespace) === release.namespace) {
        return { status: 'ok', message: 'Already exists and is marked as part of this release; Helm adopts it.' };
      }
      return {
        status: 'fail',
        message: owner?.release
          ? `Already exists and belongs to release ${owner.release}${owner.namespace ? ` in ${owner.namespace}` : ''}.`
          : `Already exists${e.namespace ? ` in ${e.namespace}` : ''} and is not part of this release, so Helm refuses to take it over.`,
      };
    }
    if (res.status === 403 || res.status === 401) return { status: 'unknown', message: `Could not check: you are not allowed to dry-run ${e.kind} here (${await statusMessage(res)}).` };
    return { status: 'fail', message: await statusMessage(res) };
  } catch (err) {
    return { status: 'unknown', message: `Could not check: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export class HelmRenderError extends Error {
  constructor(public readonly log: string) {
    const lastError = log.split('\n').map((l) => l.trim()).filter(Boolean).reverse().find((l) => /^Error:/i.test(l));
    super(lastError ?? `helm template failed${log.trim() ? `: ${log.trim().split('\n').slice(-3).join(' ')}` : ''}`);
  }
}

export interface PreviewRequest {
  clusterId: string;
  namespace: string;
  releaseName: string;
  chart: Extract<HelmRequest, { action: 'template' }>['chart'];
  /** The values helm renders with (already merged for --reuse-values). */
  valuesYaml: string;
  /** The current revision's record, for an upgrade or values change. */
  current?: ReleaseRecord;
  /** Test seam: how long to wait for the Job. */
  timeoutMs?: number;
  pollMs?: number;
}

export async function runHelmPreview(req: PreviewRequest): Promise<HelmPreview> {
  const action = req.current ? 'upgrade' : 'install';
  const caps = await clusterCapabilities(req.clusterId);
  const jobName = await runHelmAction(req.clusterId, req.namespace, {
    action: 'template', releaseName: req.releaseName, chart: req.chart,
    isUpgrade: !!req.current, kubeVersion: caps.kubeVersion, apiVersions: caps.apiVersions,
  }, req.valuesYaml);
  let output;
  try {
    output = await readHelmJobOutput(req.clusterId, req.namespace, jobName, { timeoutMs: req.timeoutMs, pollMs: req.pollMs });
  } finally {
    await deleteHelmJob(req.clusterId, req.namespace, jobName);
  }
  if (!output.succeeded) throw new HelmRenderError(output.log);
  const rendered = parseRendered(output.log, req.namespace);
  const current = req.current ? parseRendered(req.current.manifest, req.namespace).objects : [];
  const changes = diffObjects(current, rendered.objects);
  const release = { name: req.releaseName, namespace: req.namespace };
  const checks = await mapLimit(changes, 4, (c) => (c.change === 'unchanged' ? Promise.resolve<ObjectCheck>({ status: 'ok' }) : checkObject(req.clusterId, c, release)));
  const hooks = hooksFor(rendered.objects, action);
  // A hook the runner cannot create fails the action as surely as an object.
  const blockedHooks = hooks.filter((h) => !runnerCanManage(h.apiVersion, h.kind));
  const entries: PreviewEntry[] = changes.map((c, i) => ({ ...c, check: checks[i] }));
  for (const h of blockedHooks) {
    entries.push({
      change: 'added', key: `hook:${h.key}`, apiVersion: h.apiVersion, kind: h.kind, name: h.name, namespace: h.namespace, doc: h.doc,
      check: { status: 'fail', message: `This ${h.hook!.events.join(', ')} hook is a ${h.kind}, which the Helm runner's Role in ${req.namespace} cannot create.` },
    });
  }
  return {
    at: Date.now(),
    action,
    entries,
    hooks,
    testHooks: testHooks(rendered.objects),
    warnings: rendered.warnings,
    capabilitiesNote: caps.note,
  };
}

/** Hooks of a release record that a rollback runs. */
export function rollbackHooks(record: ReleaseRecord, namespace: string): RenderedObject[] {
  return hooksFor(recordHooks(record.hooks, namespace), 'rollback');
}

/** Counts for the summary line. */
export function previewCounts(p: Pick<HelmPreview, 'entries'>) {
  const c = { added: 0, changed: 0, removed: 0, unchanged: 0, failing: 0, unknown: 0 };
  for (const e of p.entries) {
    if (!e.key.startsWith('hook:')) c[e.change]++;
    if (e.check.status === 'fail') c.failing++;
    if (e.check.status === 'unknown') c.unknown++;
  }
  return c;
}
