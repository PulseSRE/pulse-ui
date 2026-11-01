/**
 * The requests behind workload, storage, compute and metadata actions.
 *
 * Each builder returns exactly what is sent (path, patch type, body) so the
 * menus that call them and the tests that check them agree on one request.
 * Writes that are computed from a loaded object carry its resourceVersion:
 * if anything changed it since, the API server refuses instead of applying a
 * decision made about an object that no longer looks like that.
 */
import { buildApiPathFromResource } from '../hooks/useResourceUrl';
import { k8sCreate, k8sDelete, k8sPatch } from './query';
import type { K8sResource } from './renderers';

export const MERGE_PATCH = 'application/merge-patch+json';
export const JSON_PATCH = 'application/json-patch+json';
export const STRATEGIC_PATCH = 'application/strategic-merge-patch+json';

export interface WriteRequest {
  method: 'PATCH' | 'POST' | 'DELETE';
  path: string;
  patchType?: string;
  body?: unknown;
}

/** Send one write to one cluster. */
export async function sendWrite(req: WriteRequest, clusterId: string): Promise<unknown> {
  if (req.method === 'PATCH') return k8sPatch(req.path, req.body, req.patchType, clusterId);
  if (req.method === 'POST') return k8sCreate(req.path, req.body, clusterId);
  return k8sDelete(req.path, clusterId, req.body as { uid?: string; resourceVersion?: string } | undefined);
}

export function apiPathOf(resource: K8sResource): string {
  return buildApiPathFromResource(resource);
}

function rvMeta(resource: K8sResource): Record<string, unknown> {
  const rv = resource.metadata?.resourceVersion;
  return rv ? { metadata: { resourceVersion: rv } } : {};
}

/** `kubectl rollout restart`: stamp the pod template so every pod is replaced. */
export function rolloutRestart(resource: K8sResource, now: Date = new Date()): WriteRequest {
  return {
    method: 'PATCH',
    path: apiPathOf(resource),
    patchType: STRATEGIC_PATCH,
    body: { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': now.toISOString() } } } } },
  };
}

/**
 * Set an exact replica count, conditional on the version it was read from.
 * `viaScale` writes the scale subresource instead (for users who may patch
 * `<resource>/scale` but not the object itself); it carries the same
 * resourceVersion.
 */
export function setReplicas(resource: K8sResource, replicas: number, viaScale = false): WriteRequest {
  return {
    method: 'PATCH',
    path: viaScale ? `${apiPathOf(resource)}/scale` : apiPathOf(resource),
    patchType: MERGE_PATCH,
    body: { ...rvMeta(resource), spec: { replicas: Math.max(0, Math.floor(replicas)) } },
  };
}

/** `kubectl rollout pause|resume`. */
export function setRolloutPaused(resource: K8sResource, paused: boolean): WriteRequest {
  return { method: 'PATCH', path: apiPathOf(resource), patchType: MERGE_PATCH, body: { spec: { paused } } };
}

/** Suspend or resume a CronJob's schedule. */
export function setCronJobSuspended(resource: K8sResource, suspend: boolean): WriteRequest {
  return { method: 'PATCH', path: apiPathOf(resource), patchType: MERGE_PATCH, body: { spec: { suspend } } };
}

/** A DNS-1123 name `<base>-<suffix>`, trimmed so it stays within 63 characters. */
export function uniqueName(base: string, tag: string, now: number = Date.now()): string {
  const suffix = `${tag}-${now.toString(36).slice(-5)}`;
  const room = 63 - suffix.length - 1;
  const head = base.slice(0, room).replace(/[-.]+$/, '');
  return `${head}-${suffix}`;
}

interface JobTemplate {
  metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> };
  spec?: Record<string, unknown>;
}

/**
 * `oc create job <name> --from=cronjob/<cronjob>`: a Job from the CronJob's
 * template, owned by the CronJob (so it shows in its history and is cleaned
 * up with it) and marked as manually instantiated, as kubectl marks it.
 */
export function jobFromCronJob(cronJob: K8sResource, now: number = Date.now()): WriteRequest {
  const ns = cronJob.metadata.namespace || 'default';
  const tpl = ((cronJob.spec as { jobTemplate?: JobTemplate } | undefined)?.jobTemplate) ?? {};
  const name = uniqueName(cronJob.metadata.name, 'manual', now);
  return {
    method: 'POST',
    path: `/apis/batch/v1/namespaces/${ns}/jobs`,
    body: {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name,
        namespace: ns,
        labels: { ...(tpl.metadata?.labels ?? {}) },
        annotations: { ...(tpl.metadata?.annotations ?? {}), 'cronjob.kubernetes.io/instantiate': 'manual' },
        ownerReferences: [{
          apiVersion: 'batch/v1',
          kind: 'CronJob',
          name: cronJob.metadata.name,
          uid: cronJob.metadata.uid,
          controller: true,
          blockOwnerDeletion: true,
        }],
      },
      spec: tpl.spec ?? {},
    },
  };
}

/** Labels the Job controller stamps on a Job and its pod template; a copy must not carry them. */
const JOB_CONTROLLER_LABELS = ['controller-uid', 'batch.kubernetes.io/controller-uid', 'job-name', 'batch.kubernetes.io/job-name'];

function withoutControllerLabels(labels: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels ?? {})) if (!JOB_CONTROLLER_LABELS.includes(k)) out[k] = v;
  return out;
}

/**
 * Re-run a Job: a new Job with the same pod template. The generated
 * selector and the controller-uid/job-name labels belong to the old Job;
 * copied as-is the API server rejects the new one (or, with manualSelector,
 * it would adopt the old Job's pods), so they are dropped and regenerated.
 */
export function rerunJob(job: K8sResource, now: number = Date.now()): WriteRequest {
  const ns = job.metadata.namespace || 'default';
  const spec = { ...((job.spec as Record<string, unknown>) ?? {}) };
  delete spec.selector;
  delete spec.manualSelector;
  const template = (spec.template as { metadata?: { labels?: Record<string, string> } & Record<string, unknown>; spec?: unknown } | undefined) ?? {};
  spec.template = {
    ...template,
    metadata: { ...(template.metadata ?? {}), labels: withoutControllerLabels(template.metadata?.labels) },
  };
  const base = job.metadata.name.replace(/-rerun-[a-z0-9]+$/, '');
  const annotations = { ...(job.metadata.annotations ?? {}) };
  delete annotations['batch.kubernetes.io/job-tracking'];
  return {
    method: 'POST',
    path: `/apis/batch/v1/namespaces/${ns}/jobs`,
    body: {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: uniqueName(base, 'rerun', now),
        namespace: ns,
        labels: withoutControllerLabels(job.metadata.labels),
        annotations: { ...annotations, 'openshiftpulse/rerun-of': job.metadata.name },
      },
      spec,
    },
  };
}

/** JSON Pointer escaping (RFC 6901): `~` → `~0`, `/` → `~1`. */
export function escapeJsonPointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export type MetadataField = 'labels' | 'annotations';

/**
 * Add, change or remove one label or annotation with a JSON patch. The patch
 * starts with a `test` of the resourceVersion it was computed from, so it
 * applies to that version only: an edit made since is not overwritten.
 * `value: null` removes the key.
 */
export function metadataPatch(resource: K8sResource, field: MetadataField, key: string, value: string | null, path: string = apiPathOf(resource)): WriteRequest {
  const ops: Array<Record<string, unknown>> = [];
  const rv = resource.metadata?.resourceVersion;
  if (rv) ops.push({ op: 'test', path: '/metadata/resourceVersion', value: rv });
  const current = (resource.metadata?.[field] as Record<string, string> | undefined);
  const pointer = `/metadata/${field}/${escapeJsonPointer(key)}`;
  if (value === null) {
    ops.push({ op: 'remove', path: pointer });
  } else {
    if (!current) ops.push({ op: 'add', path: `/metadata/${field}`, value: {} });
    ops.push({ op: current && key in current ? 'replace' : 'add', path: pointer, value });
  }
  return { method: 'PATCH', path, patchType: JSON_PATCH, body: ops };
}

const NAME_RE = /^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
const DNS_SUBDOMAIN_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** Why a label/annotation key is invalid, or null. */
export function validateMetadataKey(key: string): string | null {
  if (!key) return 'Key is required';
  const parts = key.split('/');
  if (parts.length > 2) return 'Key may contain at most one "/"';
  const [prefix, name] = parts.length === 2 ? parts : [undefined, parts[0]];
  if (prefix !== undefined && (!prefix || prefix.length > 253 || !DNS_SUBDOMAIN_RE.test(prefix))) {
    return 'Prefix must be a DNS subdomain (lowercase letters, digits, "-" and "."), at most 253 characters';
  }
  if (!name || name.length > 63 || !NAME_RE.test(name)) {
    return 'Name must be 1–63 characters: letters, digits, "-", "_" or ".", starting and ending with a letter or digit';
  }
  return null;
}

/** Why a label value is invalid, or null. */
export function validateLabelValue(value: string): string | null {
  if (value === '') return null;
  if (value.length > 63 || !NAME_RE.test(value)) {
    return 'Value must be at most 63 characters: letters, digits, "-", "_" or ".", starting and ending with a letter or digit';
  }
  return null;
}

/** Parse a Kubernetes quantity into bytes (binary and decimal suffixes). NaN when unparseable. */
export function quantityToBytes(q: string): number {
  const m = String(q).trim().match(/^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei|m|k|K|M|G|T|P|E)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  const mult: Record<string, number> = {
    '': 1, m: 1e-3, Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60,
    k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
  };
  return n * mult[m[2] ?? ''];
}

/** Expand a PVC: raise spec.resources.requests.storage, conditional on the version read. */
export function expandPvc(pvc: K8sResource, storage: string): WriteRequest {
  return {
    method: 'PATCH',
    path: apiPathOf(pvc),
    patchType: MERGE_PATCH,
    body: { ...rvMeta(pvc), spec: { resources: { requests: { storage } } } },
  };
}

export const DEFAULT_SC_ANNOTATION = 'storageclass.kubernetes.io/is-default-class';

export const BETA_DEFAULT_SC_ANNOTATION = 'storageclass.beta.kubernetes.io/is-default-class';

export function isDefaultStorageClass(sc: K8sResource): boolean {
  const a = sc.metadata.annotations ?? {};
  return a[DEFAULT_SC_ANNOTATION] === 'true' || a[BETA_DEFAULT_SC_ANNOTATION] === 'true';
}

/**
 * Make one StorageClass the default: set the annotation on the target first
 * (so there is never a moment with no default), then clear both the GA and
 * the beta default annotation on every other class that has either.
 */
export function setDefaultStorageClass(target: K8sResource, all: K8sResource[]): WriteRequest[] {
  const clears = all
    .filter((sc) => sc.metadata.name !== target.metadata.name && isDefaultStorageClass(sc))
    .map((sc) => ({
      method: 'PATCH' as const,
      path: `/apis/storage.k8s.io/v1/storageclasses/${sc.metadata.name}`,
      patchType: MERGE_PATCH,
      body: { metadata: { annotations: { [DEFAULT_SC_ANNOTATION]: 'false', [BETA_DEFAULT_SC_ANNOTATION]: null } } },
    }));
  return [
    {
      method: 'PATCH',
      path: `/apis/storage.k8s.io/v1/storageclasses/${target.metadata.name}`,
      patchType: MERGE_PATCH,
      body: { metadata: { annotations: { [DEFAULT_SC_ANNOTATION]: 'true' } } },
    },
    ...clears,
  ];
}

/**
 * Pause or unpause a MachineConfigPool (pausing holds config rollouts and the
 * reboots they cause), conditional on the version read.
 */
export function setMcpPaused(mcp: K8sResource, paused: boolean): WriteRequest {
  return {
    method: 'PATCH',
    path: `/apis/machineconfiguration.openshift.io/v1/machineconfigpools/${mcp.metadata.name}`,
    patchType: MERGE_PATCH,
    body: { ...rvMeta(mcp), spec: { paused } },
  };
}

/** Set an HPA's min/max replicas, conditional on the version read. */
export function setHpaBounds(hpa: K8sResource, minReplicas: number, maxReplicas: number): WriteRequest {
  return {
    method: 'PATCH',
    path: apiPathOf(hpa),
    patchType: MERGE_PATCH,
    body: { ...rvMeta(hpa), spec: { minReplicas, maxReplicas } },
  };
}

/** The URL a Route serves: https when it terminates TLS, http otherwise. */
export function routeUrl(route: K8sResource): string | null {
  const spec = route.spec as { host?: string; path?: string; tls?: unknown } | undefined;
  const host = spec?.host || (route.status as { ingress?: Array<{ host?: string }> } | undefined)?.ingress?.[0]?.host;
  if (!host) return null;
  return `${spec?.tls ? 'https' : 'http'}://${host}${spec?.path || ''}`;
}

/**
 * Delete an object, but only the one that was on screen: the uid
 * precondition stops a newer object that reused the name from being deleted.
 */
export function deleteRequest(resource: K8sResource): WriteRequest {
  const uid = resource.metadata?.uid;
  return { method: 'DELETE', path: apiPathOf(resource), body: uid ? { uid } : undefined };
}
