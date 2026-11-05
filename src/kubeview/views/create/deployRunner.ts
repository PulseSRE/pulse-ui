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
}

/** Ask for metadata only: for Secrets this keeps their data out of the response entirely. */
export const METADATA_ONLY = 'application/json;as=PartialObjectMetadata;g=meta.k8s.io;v=v1';
export const METADATA_LIST = 'application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1';

async function message(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.message || errorReason({ status: res.status });
}

async function post(clusterId: string, o: PlannedObject, dryRun: boolean): Promise<ObjectResult> {
  try {
    const res = await k8sFetch(clusterId, `${o.path}${dryRun ? '?dryRun=All' : ''}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o.body),
    });
    if (res.ok) return { kind: o.kind, name: o.name, status: 'ok' };
    const msg = await message(res);
    if (res.status === 403) return { kind: o.kind, name: o.name, status: 'fail', message: `You are not allowed to create ${o.kind} here: ${msg}` };
    if (res.status === 409) return { kind: o.kind, name: o.name, status: 'fail', message: `${o.kind} ${o.name} already exists: ${msg}` };
    return { kind: o.kind, name: o.name, status: 'fail', message: msg };
  } catch (e) {
    return { kind: o.kind, name: o.name, status: dryRun ? 'unknown' : 'fail', message: `${dryRun ? 'Could not check' : 'Request failed'}: ${e instanceof Error ? e.message : String(e)}` };
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
  /** Objects created before the sequence stopped (or all of them). */
  created: PlannedObject[];
  /** Planned but not attempted, because an earlier one failed. */
  skipped: PlannedObject[];
}

/** Create in order; stop at the first failure. `assert` runs before each write (cluster pinning). */
export async function createPlan(clusterId: string, plan: PlannedObject[], assert: () => void, onStep?: (r: ObjectResult[]) => void): Promise<CreateOutcome> {
  const results: ObjectResult[] = [];
  const created: PlannedObject[] = [];
  for (let i = 0; i < plan.length; i++) {
    assert();
    const r = await post(clusterId, plan[i], false);
    results.push(r);
    onStep?.([...results]);
    if (r.status !== 'ok') return { results, created, skipped: plan.slice(i + 1) };
    created.push(plan[i]);
  }
  return { results, created, skipped: [] };
}

/** Delete created objects, newest first. PVCs only when asked. */
export async function deleteCreated(clusterId: string, created: PlannedObject[], opts: { deletePvc: boolean }): Promise<ObjectResult[]> {
  const out: ObjectResult[] = [];
  for (const o of [...created].reverse()) {
    if (o.kind === 'PersistentVolumeClaim' && !opts.deletePvc) { out.push({ kind: o.kind, name: o.name, status: 'ok', message: 'kept' }); continue; }
    try {
      const res = await k8sFetch(clusterId, `${o.path}/${encodeURIComponent(o.name)}?propagationPolicy=Background`, { method: 'DELETE' });
      out.push(res.ok || res.status === 404 ? { kind: o.kind, name: o.name, status: 'ok', message: 'deleted' } : { kind: o.kind, name: o.name, status: 'fail', message: await message(res) });
    } catch (e) {
      out.push({ kind: o.kind, name: o.name, status: 'fail', message: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
