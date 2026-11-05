/**
 * Dry run and create for "Deploy an app", as the signed-in user, against the
 * cluster the dialog was opened on.
 *
 * - dryRunPlan: every planned object is POSTed with dryRun=All; nothing is
 *   created. A rejection is "would fail" with the API server's message.
 * - extraChecks: what the dry run cannot see (referenced ConfigMaps and
 *   Secrets exist, the Route hostname is free, NetworkPolicies, volume
 *   binding). Secrets are read as metadata only, so their values never reach
 *   the browser.
 * - createPlan: creates in dependency order and stops at the first failure,
 *   reporting each object.
 */
import { k8sFetch } from '../../engine/query';
import { errorReason } from '../../engine/readResult';
import type { DeployForm, PlannedObject } from '../../engine/deployApp';
import { claimNameOf, referencedConfig, replicasOf } from '../../engine/deployApp';

export type ResultStatus = 'ok' | 'fail' | 'unknown';

export interface ObjectResult {
  kind: string;
  name: string;
  status: ResultStatus;
  message?: string;
  /** uid of the object a real create made, so cleanup deletes exactly that object. */
  uid?: string;
  /** Warning headers the API server returned (deprecations, Pod Security). */
  warnings?: string[];
}

/** Ask for metadata only: for Secrets this keeps their data out of the response entirely. */
export const METADATA_ONLY = 'application/json;as=PartialObjectMetadata;g=meta.k8s.io;v=v1';
export const METADATA_LIST = 'application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1';

async function message(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.message || errorReason({ status: res.status });
}

/** The text of each Warning header (`299 - "text"`). */
export function warningTexts(res: Response): string[] {
  const raw = res.headers.get('Warning');
  if (!raw) return [];
  return [...raw.matchAll(/\d{3} \S+ "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"'));
}

async function post(clusterId: string, o: PlannedObject, dryRun: boolean): Promise<ObjectResult> {
  try {
    const res = await k8sFetch(clusterId, `${o.path}${dryRun ? '?dryRun=All' : ''}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o.body),
    });
    const warnings = warningTexts(res);
    if (res.ok) {
      const uid = dryRun ? undefined : (await res.json().catch(() => null))?.metadata?.uid;
      return { kind: o.kind, name: o.name, status: 'ok', ...(uid ? { uid } : {}), ...(warnings.length ? { warnings, message: `Warning: ${warnings.join('; ')}` } : {}) };
    }
    const msg = await message(res);
    if (res.status === 403) return { kind: o.kind, name: o.name, status: 'fail', message: `You are not allowed to create ${o.kind} here: ${msg}` };
    if (res.status === 409) return { kind: o.kind, name: o.name, status: 'fail', message: `${o.kind} ${o.name} already exists: ${msg}` };
    return { kind: o.kind, name: o.name, status: 'fail', message: msg };
  } catch (e) {
    // No answer: a dry run is unchecked; a create may or may not have happened.
    return { kind: o.kind, name: o.name, status: 'unknown', message: `${dryRun ? 'Could not check' : 'No answer from the API server, so it may or may not exist'}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function dryRunPlan(clusterId: string, plan: PlannedObject[]): Promise<ObjectResult[]> {
  return Promise.all(plan.map((o) => post(clusterId, o, true)));
}

export interface Check {
  id: string;
  status: 'pass' | 'warning' | 'fail' | 'unknown';
  text: string;
}

async function exists(clusterId: string, path: string): Promise<'yes' | 'no' | { unknown: string }> {
  try {
    const res = await k8sFetch(clusterId, path, { headers: { Accept: METADATA_ONLY } });
    if (res.ok) return 'yes';
    if (res.status === 404) return 'no';
    return { unknown: errorReason({ status: res.status }) };
  } catch (e) {
    return { unknown: e instanceof Error ? e.message : String(e) };
  }
}

/** What the dry run does not check. Each read that fails is "could not check", never a pass. */
export async function extraChecks(clusterId: string, f: DeployForm, opts: { storageClassBinding?: string }): Promise<Check[]> {
  const ns = f.namespace;
  const checks: Check[] = [];
  const refs = referencedConfig(f);
  const refChecks = await Promise.all([
    ...refs.configMaps.map(async (n) => ({ what: `ConfigMap ${n}`, r: await exists(clusterId, `/api/v1/namespaces/${ns}/configmaps/${encodeURIComponent(n)}`) })),
    ...refs.secrets.map(async (n) => ({ what: `Secret ${n}`, r: await exists(clusterId, `/api/v1/namespaces/${ns}/secrets/${encodeURIComponent(n)}`) })),
  ]);
  for (const { what, r } of refChecks) {
    checks.push(r === 'yes' ? { id: what, status: 'pass', text: `${what} exists in ${ns}` }
      : r === 'no' ? { id: what, status: 'fail', text: `${what} does not exist in ${ns}: the pods would not start. Create it first or remove the reference.` }
        : { id: what, status: 'unknown', text: `Could not check that ${what} exists (${r.unknown})` });
  }
  for (const e of f.env) {
    if (e.kind === 'secretKey' && e.secret.trim()) {
      checks.push({ id: `key:${e.secret}/${e.key}`, status: 'unknown', text: `Key ${e.key} in Secret ${e.secret}: not checked, because Pulse does not read Secret contents. If it is missing, the pods will not start.` });
    }
    if (e.kind === 'configMapKey' && e.configMap.trim()) {
      try {
        const res = await k8sFetch(clusterId, `/api/v1/namespaces/${ns}/configmaps/${encodeURIComponent(e.configMap.trim())}`);
        if (res.ok) {
          const cm = await res.json();
          const has = e.key in (cm.data ?? {}) || e.key in (cm.binaryData ?? {});
          checks.push({ id: `key:${e.configMap}/${e.key}`, status: has ? 'pass' : 'fail', text: has ? `ConfigMap ${e.configMap} has key ${e.key}` : `ConfigMap ${e.configMap} has no key ${e.key}: the pods would not start` });
        } else if (res.status !== 404) checks.push({ id: `key:${e.configMap}/${e.key}`, status: 'unknown', text: `Could not check key ${e.key} in ConfigMap ${e.configMap} (${errorReason({ status: res.status })})` });
      } catch {
        checks.push({ id: `key:${e.configMap}/${e.key}`, status: 'unknown', text: `Could not check key ${e.key} in ConfigMap ${e.configMap}` });
      }
    }
  }
  if (f.source.type === 'git') {
    const tag = f.source.builderImage.trim();
    const r = await exists(clusterId, `/apis/image.openshift.io/v1/namespaces/openshift/imagestreamtags/${encodeURIComponent(tag)}`);
    checks.push(r === 'yes' ? { id: 'builder', status: 'pass', text: `Builder image ${tag} exists in the openshift namespace` }
      : r === 'no' ? { id: 'builder', status: 'fail', text: `Builder image ${tag} does not exist in the openshift namespace, so the build cannot start` }
        : { id: 'builder', status: 'unknown', text: `Could not check builder image ${tag} (${r.unknown})` });
    checks.push({ id: 'registry', status: 'unknown', text: `Internal registry: the pods wait for the first build to push ${f.name.trim()}:latest, so they cannot start until it succeeds` });
  } else {
    checks.push({ id: 'pull', status: 'unknown', text: `Image pull: ${f.source.image.trim()} is not pulled by the dry run; a wrong image or pull secret shows as ImagePullBackOff after Create` });
  }
  checks.push({ id: 'admission', status: 'unknown', text: 'Pod admission (SCC / Pod Security): the dry run creates the Deployment, not its pods, so whether the pods are admitted shows only after Create' });
  if (f.storage.mode === 'existing') {
    const claim = claimNameOf(f);
    const r = await exists(clusterId, `/api/v1/namespaces/${ns}/persistentvolumeclaims/${encodeURIComponent(claim)}`);
    checks.push(r === 'yes' ? { id: 'pvc', status: 'pass', text: `PersistentVolumeClaim ${claim} exists` }
      : r === 'no' ? { id: 'pvc', status: 'fail', text: `PersistentVolumeClaim ${claim} does not exist in ${ns}` }
        : { id: 'pvc', status: 'unknown', text: `Could not check PersistentVolumeClaim ${claim} (${r.unknown})` });
  }
  if (f.storage.mode !== 'none' && f.storage.accessMode === 'ReadWriteOnce' && replicasOf(f) > 1) {
    checks.push({ id: 'rwo', status: 'warning', text: `ReadWriteOnce volume with ${replicasOf(f)} replicas: all pods must run on one node. Use a ReadWriteMany storage class or 1 replica.` });
  }
  if (f.storage.mode === 'new' && opts.storageClassBinding === 'WaitForFirstConsumer') {
    checks.push({ id: 'binding', status: 'unknown', text: `Volume binding: ${f.storage.storageClass || 'the default storage class'} binds when the first pod is scheduled, so a zone or capacity problem shows only after Create` });
  }
  const host = f.expose.route ? f.expose.hostname.trim() : '';
  if (host) {
    try {
      const res = await k8sFetch(clusterId, `/apis/route.openshift.io/v1/routes?fieldSelector=${encodeURIComponent(`spec.host=${host}`)}`, { headers: { Accept: METADATA_LIST } });
      if (res.ok) {
        // Metadata only: the field selector already matched the host.
        const items = ((await res.json()).items ?? []) as Array<{ metadata: { name: string; namespace: string } }>;
        const other = items.find((i) => !(i.metadata.namespace === ns && i.metadata.name === f.name.trim()));
        checks.push(other
          ? { id: 'host', status: 'fail', text: `Host ${host} is already claimed by Route ${other.metadata.name} in namespace ${other.metadata.namespace} (HostAlreadyClaimed). Pick another hostname.` }
          : { id: 'host', status: 'pass', text: `No other Route uses ${host}` });
      } else checks.push({ id: 'host', status: 'unknown', text: `Could not check whether another Route already uses ${host} (${errorReason({ status: res.status })})` });
    } catch (e) {
      checks.push({ id: 'host', status: 'unknown', text: `Could not check whether another Route already uses ${host} (${e instanceof Error ? e.message : String(e)})` });
    }
  }
  if (f.expose.route) {
    try {
      const res = await k8sFetch(clusterId, `/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies`, { headers: { Accept: METADATA_LIST } });
      if (res.ok) {
        const n = ((await res.json()).items ?? []).length;
        if (n > 0) checks.push({ id: 'netpol', status: 'unknown', text: `Router reachability: ${ns} has ${n} NetworkPolicy object${n === 1 ? '' : 's'}; Pulse cannot tell yet whether the router may reach the pods` });
      } else checks.push({ id: 'netpol', status: 'unknown', text: `Could not read NetworkPolicies in ${ns} (${errorReason({ status: res.status })}), so router reachability is not checked` });
    } catch {
      checks.push({ id: 'netpol', status: 'unknown', text: `Could not read NetworkPolicies in ${ns}, so router reachability is not checked` });
    }
  }
  return checks;
}

export interface CreateOutcome {
  results: ObjectResult[];
  /** Objects created (with their uid) before the sequence stopped, or all of them. */
  created: Array<PlannedObject & { uid?: string }>;
  /** A create that got no answer: it may exist. */
  uncertain: PlannedObject[];
  /** Planned but not attempted, because an earlier one failed. */
  skipped: PlannedObject[];
  /** Why the sequence stopped before trying an object (e.g. the active cluster changed). */
  stoppedBecause?: string;
  /** When the sequence started, to recognise an object it may have created. */
  startedAt: number;
}

/**
 * Create in order; stop at the first failure. `assert` runs before each write
 * (cluster pinning); if it throws, the sequence stops there and still reports
 * what it created, so cleanup is offered.
 */
export async function createPlan(clusterId: string, plan: PlannedObject[], assert: () => void, onStep?: (r: ObjectResult[]) => void): Promise<CreateOutcome> {
  const startedAt = Date.now();
  const results: ObjectResult[] = [];
  const created: CreateOutcome['created'] = [];
  for (let i = 0; i < plan.length; i++) {
    try {
      assert();
    } catch (e) {
      return { results, created, uncertain: [], skipped: plan.slice(i), stoppedBecause: e instanceof Error ? e.message : String(e), startedAt };
    }
    const r = await post(clusterId, plan[i], false);
    results.push(r);
    onStep?.([...results]);
    if (r.status === 'unknown') return { results, created, uncertain: [plan[i]], skipped: plan.slice(i + 1), startedAt };
    if (r.status !== 'ok') return { results, created, uncertain: [], skipped: plan.slice(i + 1), startedAt };
    created.push({ ...plan[i], uid: r.uid });
  }
  return { results, created, uncertain: [], skipped: [], startedAt };
}

async function deleteOne(clusterId: string, o: PlannedObject, uid: string): Promise<ObjectResult> {
  try {
    const res = await k8sFetch(clusterId, `${o.path}/${encodeURIComponent(o.name)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      // Only the object this form created: a same-named replacement has another uid and is left alone.
      body: JSON.stringify({ kind: 'DeleteOptions', apiVersion: 'v1', propagationPolicy: 'Background', preconditions: { uid } }),
    });
    if (res.ok || res.status === 404) return { kind: o.kind, name: o.name, status: 'ok', message: res.status === 404 ? 'already gone' : 'deleted' };
    if (res.status === 409) return { kind: o.kind, name: o.name, status: 'fail', message: 'not deleted: the object there now is not the one Pulse created' };
    return { kind: o.kind, name: o.name, status: 'fail', message: await message(res) };
  } catch (e) {
    return { kind: o.kind, name: o.name, status: 'fail', message: e instanceof Error ? e.message : String(e) };
  }
}

/** The uid of an object whose create got no answer, if it is recognisably the one Pulse just created. */
async function uidIfOurs(clusterId: string, o: PlannedObject, since: number): Promise<string | null> {
  try {
    const res = await k8sFetch(clusterId, `${o.path}/${encodeURIComponent(o.name)}`, { headers: { Accept: METADATA_ONLY } });
    if (!res.ok) return null;
    const meta = (await res.json())?.metadata ?? {};
    const created = Date.parse(meta.creationTimestamp ?? '');
    return meta.labels?.['app.kubernetes.io/managed-by'] === 'openshiftpulse' && Number.isFinite(created) && created >= since - 60_000 ? meta.uid ?? null : null;
  } catch {
    return null;
  }
}

/** Delete what was created, newest first, each only if it still has the uid it was created with. PVCs only when asked. */
export async function deleteCreated(clusterId: string, outcome: Pick<CreateOutcome, 'created' | 'uncertain' | 'startedAt'>, opts: { deletePvc: boolean }): Promise<ObjectResult[]> {
  const out: ObjectResult[] = [];
  for (const o of outcome.uncertain) {
    const uid = await uidIfOurs(clusterId, o, outcome.startedAt);
    out.push(uid ? await deleteOne(clusterId, o, uid) : { kind: o.kind, name: o.name, status: 'unknown', message: 'not deleted: Pulse could not confirm it created this object; check it yourself' });
  }
  for (const o of [...outcome.created].reverse()) {
    if (o.kind === 'PersistentVolumeClaim' && !opts.deletePvc) { out.push({ kind: o.kind, name: o.name, status: 'ok', message: 'kept' }); continue; }
    if (!o.uid) { out.push({ kind: o.kind, name: o.name, status: 'unknown', message: 'not deleted: its uid was not returned, so Pulse cannot be sure it is the same object' }); continue; }
    out.push(await deleteOne(clusterId, o, o.uid));
  }
  return out;
}
