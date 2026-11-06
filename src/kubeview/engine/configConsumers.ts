/**
 * "Used by" for ConfigMaps and Secrets: which workloads' pod templates read
 * an object, how (env, envFrom, a volume, a projected volume, an image pull
 * secret), and whether their running pods pick up a change without a
 * restart.
 *
 * Kubernetes facts this relies on:
 * - env (valueFrom) and envFrom are resolved when a container starts, so a
 *   change reaches running pods only after a restart.
 * - A ConfigMap/Secret volume (or a projected source) is refreshed by the
 *   kubelet on its sync period (about a minute), except where it is mounted
 *   with subPath, which is never refreshed. Whether the process re-reads the
 *   file is up to the application: Pulse cannot see that.
 * - An image pull secret (in the pod template, or on the pod's
 *   ServiceAccount) is used at the next image pull; running containers are
 *   not affected.
 * - A Secret named by a volume driver (CSI nodePublishSecretRef, cephfs/rbd/
 *   iscsi/flexVolume secretRef, azureFile secretName) is used when the volume
 *   is next mounted.
 *
 * Secrets: only names and key names are read from pod templates. No value is
 * ever read or shown here.
 */
import type { K8sResource } from './renderers';

export type ConfigKind = 'ConfigMap' | 'Secret';

export const CONSUMER_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'DeploymentConfig', 'CronJob', 'Job'] as const;
export type ConsumerKind = typeof CONSUMER_KINDS[number];

export const CONSUMER_SOURCES: Record<ConsumerKind, { group: string; plural: string; path: (ns: string) => string; version?: string }> = {
  Deployment: { group: 'apps', plural: 'deployments', path: (ns) => `/apis/apps/v1/namespaces/${ns}/deployments` },
  StatefulSet: { group: 'apps', plural: 'statefulsets', path: (ns) => `/apis/apps/v1/namespaces/${ns}/statefulsets` },
  DaemonSet: { group: 'apps', plural: 'daemonsets', path: (ns) => `/apis/apps/v1/namespaces/${ns}/daemonsets` },
  DeploymentConfig: { group: 'apps.openshift.io', plural: 'deploymentconfigs', path: (ns) => `/apis/apps.openshift.io/v1/namespaces/${ns}/deploymentconfigs` },
  CronJob: { group: 'batch', plural: 'cronjobs', path: (ns) => `/apis/batch/v1/namespaces/${ns}/cronjobs` },
  Job: { group: 'batch', plural: 'jobs', path: (ns) => `/apis/batch/v1/namespaces/${ns}/jobs` },
};

/** Kinds whose API may not be served (OpenShift only): a 404 means there are none. */
export const OPTIONAL_KINDS = new Set<string>(['DeploymentConfig']);

/** What the scan does not look at, said wherever its result could be read as complete. */
export const NOT_SCANNED = 'bare Pods, ReplicationControllers, Ingress/Route TLS, custom resources and operators, other namespaces';

/** Kinds a rollout restart (template annotation patch) applies to. */
export const RESTARTABLE_KINDS = new Set<string>(['Deployment', 'StatefulSet', 'DaemonSet']);

export type UsageHow = 'env' | 'envFrom' | 'volume' | 'projected' | 'imagePullSecret' | 'serviceAccountPullSecret' | 'volumeSecretRef';

export interface Usage {
  how: UsageHow;
  container?: string;
  /** Keys read (env), or the volume's `items` keys. Empty for envFrom / whole-volume. */
  keys: string[];
  /** Env var names set from it (env). */
  envVars?: string[];
  /** Where the volume is mounted, per container. */
  mounts?: Array<{ container: string; mountPath: string; subPath: boolean }>;
  /** The reference is optional: the pod starts even when the object is missing. */
  optional?: boolean;
  /** envFrom prefix. */
  prefix?: string;
  /** serviceAccountPullSecret: the ServiceAccount that lists it. */
  serviceAccount?: string;
  /** volumeSecretRef: the volume type (csi driver name, cephfs, rbd…). */
  driver?: string;
}

/** When running pods see a change. */
export type PickUp =
  /** env/envFrom, or a volume mounted with subPath: only new containers. */
  | 'restart'
  /** Volume refreshed by the kubelet; the process may or may not reload it. */
  | 'file'
  /** Image pull secret: next pull, nothing to restart. */
  | 'next-pull'
  /** CronJob: the next run starts with the new values. */
  | 'next-run'
  /** Job: its pods read it at start; only a re-run uses the new values. */
  | 'rerun'
  /** Volume driver credentials: used when the volume is next mounted. */
  | 'mount';

export interface Consumer {
  workload: K8sResource;
  kind: ConsumerKind;
  name: string;
  uses: Usage[];
  pickUp: PickUp;
}

interface EnvVar { name: string; valueFrom?: { configMapKeyRef?: KeyRef; secretKeyRef?: KeyRef } }
interface KeyRef { name?: string; key?: string; optional?: boolean }
interface EnvFrom { prefix?: string; configMapRef?: { name?: string; optional?: boolean }; secretRef?: { name?: string; optional?: boolean } }
interface VolumeMount { name: string; mountPath: string; subPath?: string; subPathExpr?: string }
interface Container { name: string; env?: EnvVar[]; envFrom?: EnvFrom[]; volumeMounts?: VolumeMount[] }
interface KeyItems { items?: Array<{ key: string }>; optional?: boolean }
type SecretRef = { name?: string };
interface Volume {
  name: string;
  csi?: { driver?: string; nodePublishSecretRef?: SecretRef };
  cephfs?: { secretRef?: SecretRef };
  rbd?: { secretRef?: SecretRef };
  iscsi?: { secretRef?: SecretRef };
  flexVolume?: { driver?: string; secretRef?: SecretRef };
  azureFile?: { secretName?: string };
  configMap?: KeyItems & { name?: string };
  secret?: KeyItems & { secretName?: string };
  projected?: { sources?: Array<{ configMap?: KeyItems & { name?: string }; secret?: KeyItems & { name?: string } }> };
}
export interface PodSpecLike {
  containers?: Container[];
  initContainers?: Container[];
  volumes?: Volume[];
  imagePullSecrets?: Array<{ name?: string }>;
  serviceAccountName?: string;
  serviceAccount?: string;
}

/** Secrets a volume's driver reads (not mounted as files), with the volume type. */
export function volumeSecretRefs(v: Volume): Array<{ name: string; driver: string }> {
  const out: Array<{ name: string; driver: string }> = [];
  if (v.csi?.nodePublishSecretRef?.name) out.push({ name: v.csi.nodePublishSecretRef.name, driver: `csi ${v.csi.driver ?? ''}`.trim() });
  if (v.cephfs?.secretRef?.name) out.push({ name: v.cephfs.secretRef.name, driver: 'cephfs' });
  if (v.rbd?.secretRef?.name) out.push({ name: v.rbd.secretRef.name, driver: 'rbd' });
  if (v.iscsi?.secretRef?.name) out.push({ name: v.iscsi.secretRef.name, driver: 'iscsi' });
  if (v.flexVolume?.secretRef?.name) out.push({ name: v.flexVolume.secretRef.name, driver: `flexVolume ${v.flexVolume.driver ?? ''}`.trim() });
  if (v.azureFile?.secretName) out.push({ name: v.azureFile.secretName, driver: 'azureFile' });
  return out;
}

/** The ServiceAccount a pod template runs as. */
export function serviceAccountOf(spec: PodSpecLike | undefined): string {
  return spec?.serviceAccountName || spec?.serviceAccount || 'default';
}
export interface PodTemplateLike { metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> }; spec?: PodSpecLike }

/** The pod template of a workload (a CronJob's is inside its job template). */
export function podTemplateOf(workload: K8sResource): PodTemplateLike | undefined {
  const spec = workload.spec as { template?: PodTemplateLike; jobTemplate?: { spec?: { template?: PodTemplateLike } } } | undefined;
  if (workload.kind === 'CronJob') return spec?.jobTemplate?.spec?.template;
  return spec?.template;
}

function mountsOf(spec: PodSpecLike, volumeName: string) {
  const out: Array<{ container: string; mountPath: string; subPath: boolean }> = [];
  for (const c of [...(spec.initContainers ?? []), ...(spec.containers ?? [])]) {
    for (const m of c.volumeMounts ?? []) {
      if (m.name === volumeName) out.push({ container: c.name, mountPath: m.mountPath, subPath: !!(m.subPath || m.subPathExpr) });
    }
  }
  return out;
}

/** Every way one pod spec uses ConfigMap/Secret `name`. */
export function usagesIn(spec: PodSpecLike | undefined, kind: ConfigKind, name: string): Usage[] {
  if (!spec) return [];
  const out: Usage[] = [];
  for (const c of [...(spec.initContainers ?? []), ...(spec.containers ?? [])]) {
    const keys: string[] = [];
    const vars: string[] = [];
    let optional = false;
    for (const e of c.env ?? []) {
      const ref = kind === 'ConfigMap' ? e.valueFrom?.configMapKeyRef : e.valueFrom?.secretKeyRef;
      if (ref?.name === name) {
        if (ref.key && !keys.includes(ref.key)) keys.push(ref.key);
        vars.push(e.name);
        optional = optional || !!ref.optional;
      }
    }
    if (vars.length) out.push({ how: 'env', container: c.name, keys, envVars: vars, optional: optional || undefined });
    for (const f of c.envFrom ?? []) {
      const ref = kind === 'ConfigMap' ? f.configMapRef : f.secretRef;
      if (ref?.name === name) out.push({ how: 'envFrom', container: c.name, keys: [], optional: ref.optional || undefined, prefix: f.prefix || undefined });
    }
  }
  for (const v of spec.volumes ?? []) {
    const direct = kind === 'ConfigMap'
      ? (v.configMap?.name === name ? v.configMap : undefined)
      : (v.secret?.secretName === name ? v.secret : undefined);
    if (direct) {
      out.push({ how: 'volume', keys: (direct.items ?? []).map((i) => i.key), mounts: mountsOf(spec, v.name), optional: direct.optional || undefined });
    }
    for (const s of v.projected?.sources ?? []) {
      const src = kind === 'ConfigMap' ? s.configMap : s.secret;
      if (src?.name === name) {
        out.push({ how: 'projected', keys: (src.items ?? []).map((i) => i.key), mounts: mountsOf(spec, v.name), optional: src.optional || undefined });
      }
    }
    if (kind === 'Secret') {
      for (const r of volumeSecretRefs(v)) {
        if (r.name === name) out.push({ how: 'volumeSecretRef', keys: [], driver: r.driver, mounts: mountsOf(spec, v.name) });
      }
    }
  }
  if (kind === 'Secret' && (spec.imagePullSecrets ?? []).some((s) => s.name === name)) {
    out.push({ how: 'imagePullSecret', keys: [] });
  }
  return out;
}

/** When the running pods of `kind` see a change, given how they use the object. */
export function pickUpOf(kind: ConsumerKind, uses: Usage[]): PickUp {
  if (kind === 'CronJob') return 'next-run';
  if (kind === 'Job') return 'rerun';
  const needsRestart = uses.some((u) => u.how === 'env' || u.how === 'envFrom'
    || ((u.how === 'volume' || u.how === 'projected') && (u.mounts ?? []).some((m) => m.subPath)));
  if (needsRestart) return 'restart';
  if (uses.some((u) => u.how === 'volume' || u.how === 'projected')) return 'file';
  if (uses.some((u) => u.how === 'volumeSecretRef')) return 'mount';
  return 'next-pull';
}

/** Jobs a CronJob created are covered by the CronJob itself. */
function ownedByCronJob(w: K8sResource): boolean {
  return (w.metadata.ownerReferences ?? []).some((o) => o.kind === 'CronJob');
}

/** ServiceAccounts (by name) whose imagePullSecrets name `secret`. */
export function serviceAccountsPulling(secret: string, serviceAccounts: K8sResource[] | null | undefined): Set<string> {
  return new Set((serviceAccounts ?? [])
    .filter((sa) => ((sa as unknown as { imagePullSecrets?: Array<{ name?: string }> }).imagePullSecrets ?? []).some((s) => s.name === secret))
    .map((sa) => sa.metadata.name));
}

export function findConsumers(kind: ConfigKind, name: string, workloads: K8sResource[], serviceAccounts?: K8sResource[] | null): Consumer[] {
  const out: Consumer[] = [];
  const pullingSas = kind === 'Secret' ? serviceAccountsPulling(name, serviceAccounts) : new Set<string>();
  for (const w of workloads) {
    if (!(CONSUMER_KINDS as readonly string[]).includes(w.kind)) continue;
    if (w.kind === 'Job' && ownedByCronJob(w)) continue;
    const spec = podTemplateOf(w)?.spec;
    const uses = usagesIn(spec, kind, name);
    const sa = serviceAccountOf(spec);
    if (pullingSas.has(sa)) uses.push({ how: 'serviceAccountPullSecret', keys: [], serviceAccount: sa });
    if (uses.length === 0) continue;
    const k = w.kind as ConsumerKind;
    out.push({ workload: w, kind: k, name: w.metadata.name, uses, pickUp: pickUpOf(k, uses) });
  }
  const order = (c: Consumer) => CONSUMER_KINDS.indexOf(c.kind);
  return out.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

/** Every ConfigMap and Secret a pod template references (for delete-with-related). */
export function referencedConfig(spec: PodSpecLike | undefined): { configMaps: string[]; secrets: string[] } {
  const cms = new Set<string>();
  const secrets = new Set<string>();
  if (!spec) return { configMaps: [], secrets: [] };
  for (const c of [...(spec.initContainers ?? []), ...(spec.containers ?? [])]) {
    for (const e of c.env ?? []) {
      if (e.valueFrom?.configMapKeyRef?.name) cms.add(e.valueFrom.configMapKeyRef.name);
      if (e.valueFrom?.secretKeyRef?.name) secrets.add(e.valueFrom.secretKeyRef.name);
    }
    for (const f of c.envFrom ?? []) {
      if (f.configMapRef?.name) cms.add(f.configMapRef.name);
      if (f.secretRef?.name) secrets.add(f.secretRef.name);
    }
  }
  for (const v of spec.volumes ?? []) {
    if (v.configMap?.name) cms.add(v.configMap.name);
    if (v.secret?.secretName) secrets.add(v.secret.secretName);
    for (const s of v.projected?.sources ?? []) {
      if (s.configMap?.name) cms.add(s.configMap.name);
      if (s.secret?.name) secrets.add(s.secret.name);
    }
  }
  for (const v of spec.volumes ?? []) for (const r of volumeSecretRefs(v)) secrets.add(r.name);
  for (const s of spec.imagePullSecrets ?? []) if (s.name) secrets.add(s.name);
  return { configMaps: [...cms].sort(), secrets: [...secrets].sort() };
}

/** One line for how a consumer uses the object, e.g. "env CACHE_SIZE, LOG_LEVEL via configMapKeyRef". */
export function describeUsage(u: Usage, kind: ConfigKind): string {
  const opt = u.optional ? ' (optional)' : '';
  const ctr = u.container ? ` in ${u.container}` : '';
  switch (u.how) {
    case 'env': return `env ${(u.envVars ?? []).join(', ')}${ctr} from key${u.keys.length === 1 ? '' : 's'} ${u.keys.join(', ')} via ${kind === 'ConfigMap' ? 'configMapKeyRef' : 'secretKeyRef'}${opt}`;
    case 'envFrom': return `envFrom: all keys${u.prefix ? ` with prefix ${u.prefix}` : ''}${ctr}${opt}`;
    case 'volume':
    case 'projected': {
      const where = (u.mounts ?? []).length
        ? (u.mounts ?? []).map((m) => `${m.mountPath}${m.subPath ? ' (subPath)' : ''}`).join(', ')
        : 'not mounted by any container';
      const items = u.keys.length ? ` (keys ${u.keys.join(', ')})` : '';
      return `${u.how === 'projected' ? 'projected volume' : 'volume'} mounted at ${where}${items}${opt}`;
    }
    case 'imagePullSecret': return 'image pull secret';
    case 'serviceAccountPullSecret': return `image pull secret of its ServiceAccount ${u.serviceAccount}`;
    case 'volumeSecretRef': return `credentials of a ${u.driver} volume${(u.mounts ?? []).length ? ` mounted at ${(u.mounts ?? []).map((m) => m.mountPath).join(', ')}` : ''}`;
  }
}

export function describePickUp(p: PickUp): { label: string; note?: string } {
  switch (p) {
    case 'restart': return { label: 'Only after a restart' };
    case 'file': return { label: 'File updates in about 60s', note: 'Could not check if the app reloads it' };
    case 'next-pull': return { label: 'At the next image pull', note: 'Running pods are not affected' };
    case 'next-run': return { label: 'At the next scheduled run' };
    case 'rerun': return { label: 'Only if the Job is re-run', note: 'Its pods read the values when they started' };
    case 'mount': return { label: 'When the volume is next mounted', note: 'Mounted volumes keep the credentials they were mounted with' };
  }
}

/** The last time anyone wrote the object, from managedFields (null when not recorded). */
export function lastEditTime(resource: K8sResource): number | null {
  const fields = (resource.metadata as { managedFields?: Array<{ time?: string; operation?: string }> }).managedFields ?? [];
  let latest: number | null = null;
  for (const f of fields) {
    if (!f.time) continue;
    const t = Date.parse(f.time);
    if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t;
  }
  return latest;
}
