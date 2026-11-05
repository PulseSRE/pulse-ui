/**
 * "Deploy an app": the form's model, the objects it creates (in dependency
 * order), validation, and namespace quota headroom. Pure functions; the dry
 * run and the create sequence live in views/create/deployRunner.ts.
 */
import { parseResourceValue } from './formatting';

export type ProbeKind = 'startup' | 'readiness' | 'liveness';

export interface ProbeForm {
  enabled: boolean;
  type: 'http' | 'tcp';
  path: string;
  port: string;
  periodSeconds: string;
  timeoutSeconds: string;
  failureThreshold: string;
}

/** An environment entry. Secret entries hold names only; their values are never read. */
export type EnvEntry =
  | { kind: 'value'; name: string; value: string }
  | { kind: 'configMapAll'; configMap: string }
  | { kind: 'secretAll'; secret: string }
  | { kind: 'configMapKey'; name: string; configMap: string; key: string }
  | { kind: 'secretKey'; name: string; secret: string; key: string };

export interface DeployForm {
  name: string;
  namespace: string;
  source:
    | { type: 'image'; image: string; pullSecret: string }
    | { type: 'git'; gitUrl: string; gitRef: string; contextDir: string; builderImage: string };
  port: string;
  replicas: string;
  env: EnvEntry[];
  storage: { mode: 'none' | 'new' | 'existing'; claimName: string; size: string; storageClass: string; accessMode: 'ReadWriteOnce' | 'ReadWriteMany'; mountPath: string };
  probes: Record<ProbeKind, ProbeForm>;
  resources: { cpuRequest: string; cpuLimit: string; memRequest: string; memLimit: string };
  /** A PodDisruptionBudget (minAvailable 1) when there is more than one replica. */
  pdb: boolean;
  expose: { service: boolean; route: boolean; hostname: string; tls: 'edge' | 'reencrypt' | 'passthrough' | 'none' };
}

const probe = (enabled: boolean, periodSeconds: string, failureThreshold: string): ProbeForm => ({
  enabled, type: 'http', path: '/', port: '', periodSeconds, timeoutSeconds: '2', failureThreshold,
});

export function emptyForm(namespace: string): DeployForm {
  return {
    name: '',
    namespace,
    source: { type: 'image', image: '', pullSecret: '' },
    port: '',
    replicas: '1',
    env: [],
    storage: { mode: 'none', claimName: '', size: '1Gi', storageClass: '', accessMode: 'ReadWriteOnce', mountPath: '' },
    probes: { startup: probe(false, '5', '12'), readiness: probe(true, '10', '3'), liveness: probe(true, '20', '3') },
    resources: { cpuRequest: '', cpuLimit: '', memRequest: '', memLimit: '' },
    pdb: true,
    expose: { service: true, route: true, hostname: '', tls: 'edge' },
  };
}

export interface PlannedObject {
  apiVersion: string;
  kind: string;
  name: string;
  /** Collection path to POST to (namespaced). */
  path: string;
  body: Record<string, unknown>;
  /** One line for the review list. */
  summary: string;
}

const DNS1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const QUANTITY = /^\d+(\.\d+)?(m|k|M|G|T|Ki|Mi|Gi|Ti)?$/;
const HOST = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)+$/;

function int(v: string): number { return Number.parseInt(v, 10); }

export function replicasOf(f: DeployForm): number {
  const n = int(f.replicas);
  return Number.isFinite(n) ? n : 1;
}

export function portOf(f: DeployForm): number | undefined {
  const n = int(f.port);
  return Number.isFinite(n) ? n : undefined;
}

export function claimNameOf(f: DeployForm): string {
  return f.storage.claimName.trim() || `data-${f.name.trim()}`;
}

/** Why the form cannot be dry-run, one message per problem. */
export function validateForm(f: DeployForm, caps: { routes: boolean; builds: boolean }): string[] {
  const errs: string[] = [];
  const name = f.name.trim();
  if (!name) errs.push('Name is required.');
  else if (!DNS1123.test(name) || name.length > 63) errs.push('Name must be lowercase letters, numbers and hyphens, start and end with a letter or number, and be at most 63 characters.');
  if (!f.namespace) errs.push('Choose a namespace.');
  if (f.source.type === 'image') {
    if (!f.source.image.trim()) errs.push('Image is required.');
    else if (/\s/.test(f.source.image.trim())) errs.push('Image must not contain spaces.');
  } else {
    if (!caps.builds) errs.push('Git builds are not available on this cluster.');
    if (!/^(https?:\/\/|git@|ssh:\/\/)\S+$/.test(f.source.gitUrl.trim())) errs.push('Git repository must be an https://, ssh:// or git@ URL.');
    if (!/^[^:\s]+:[^:\s]+$/.test(f.source.builderImage.trim())) errs.push('Builder image must be an image stream tag such as nodejs:20-ubi9.');
  }
  const port = portOf(f);
  if (f.port.trim() && (port === undefined || port < 1 || port > 65535)) errs.push('Container port must be between 1 and 65535.');
  const replicas = int(f.replicas);
  if (!Number.isFinite(replicas) || replicas < 0 || replicas > 100) errs.push('Replicas must be between 0 and 100.');
  for (const e of f.env) {
    if ((e.kind === 'value' || e.kind === 'configMapKey' || e.kind === 'secretKey') && !/^[-._a-zA-Z][-._a-zA-Z0-9]*$/.test(e.name.trim())) errs.push(`"${e.name}" is not a valid environment variable name.`);
    if ((e.kind === 'configMapAll' || e.kind === 'configMapKey') && !DNS1123.test(e.configMap.trim().replace(/\./g, '-'))) errs.push('Choose the ConfigMap for each ConfigMap entry.');
    if ((e.kind === 'secretAll' || e.kind === 'secretKey') && !DNS1123.test(e.secret.trim().replace(/\./g, '-'))) errs.push('Choose the Secret for each Secret entry.');
    if ((e.kind === 'configMapKey' || e.kind === 'secretKey') && !e.key.trim()) errs.push(`Choose the key for ${e.name || 'each variable'}.`);
  }
  if (f.storage.mode !== 'none') {
    if (!f.storage.mountPath.startsWith('/')) errs.push('Mount path must be an absolute path.');
    if (f.storage.mode === 'existing' && !f.storage.claimName.trim()) errs.push('Choose the existing PersistentVolumeClaim.');
    if (f.storage.mode === 'new' && !QUANTITY.test(f.storage.size.trim())) errs.push('Volume size must be a quantity such as 10Gi.');
  }
  const RES_LABEL: Record<string, string> = { cpuRequest: 'CPU request', cpuLimit: 'CPU limit', memRequest: 'Memory request', memLimit: 'Memory limit' };
  for (const [k, v] of Object.entries(f.resources)) {
    if (v.trim() && !QUANTITY.test(v.trim())) errs.push(`${RES_LABEL[k]} "${v}" is not a quantity (e.g. 250m, 512Mi).`);
  }
  const pairs: Array<[string, string, string]> = [['cpuRequest', 'cpuLimit', 'CPU'], ['memRequest', 'memLimit', 'Memory']];
  for (const [req, lim, label] of pairs) {
    const r = f.resources[req as keyof DeployForm['resources']];
    const l = f.resources[lim as keyof DeployForm['resources']];
    if (r && l && QUANTITY.test(r) && QUANTITY.test(l) && parseResourceValue(r) > parseResourceValue(l)) errs.push(`${label} request is above its limit.`);
  }
  for (const [k, p] of Object.entries(f.probes)) {
    if (!p.enabled) continue;
    const pp = p.port.trim() ? int(p.port) : port;
    if (pp === undefined || !Number.isFinite(pp) || pp < 1 || pp > 65535) errs.push(`The ${k} probe needs a port (set the container port or the probe's).`);
    if (p.type === 'http' && !p.path.startsWith('/')) errs.push(`The ${k} probe path must start with /.`);
  }
  if (f.expose.route && caps.routes) {
    if (!f.expose.service) errs.push('A Route needs the Service.');
    if (f.expose.hostname.trim() && !HOST.test(f.expose.hostname.trim())) errs.push('Hostname must be a DNS name such as api.apps.example.com.');
  }
  return errs;
}

function probeSpec(p: ProbeForm, fallbackPort: number | undefined) {
  const port = p.port.trim() ? int(p.port) : fallbackPort;
  const timing = { periodSeconds: int(p.periodSeconds) || 10, timeoutSeconds: int(p.timeoutSeconds) || 1, failureThreshold: int(p.failureThreshold) || 3 };
  return p.type === 'http' ? { httpGet: { path: p.path, port }, ...timing } : { tcpSocket: { port }, ...timing };
}

function envSpec(entries: EnvEntry[]) {
  const env: Array<Record<string, unknown>> = [];
  const envFrom: Array<Record<string, unknown>> = [];
  for (const e of entries) {
    if (e.kind === 'value') env.push({ name: e.name.trim(), value: e.value });
    else if (e.kind === 'configMapKey') env.push({ name: e.name.trim(), valueFrom: { configMapKeyRef: { name: e.configMap.trim(), key: e.key.trim() } } });
    else if (e.kind === 'secretKey') env.push({ name: e.name.trim(), valueFrom: { secretKeyRef: { name: e.secret.trim(), key: e.key.trim() } } });
    else if (e.kind === 'configMapAll') envFrom.push({ configMapRef: { name: e.configMap.trim() } });
    else envFrom.push({ secretRef: { name: e.secret.trim() } });
  }
  return { env, envFrom };
}

/** The image the Deployment starts with; for a Git source the image stream trigger replaces it once the first build pushes. */
export function internalImage(namespace: string, name: string): string {
  return `image-registry.openshift-image-registry.svc:5000/${namespace}/${name}:latest`;
}

/** The form as it will be applied: no Route where the cluster serves none. */
export function effectiveForm(f: DeployForm, caps: { routes: boolean }): DeployForm {
  return caps.routes || !f.expose.route ? f : { ...f, expose: { ...f.expose, route: false } };
}

/** Every object the form creates, in the order they are created (dependencies first). */
export function planObjects(f: DeployForm): PlannedObject[] {
  const name = f.name.trim();
  const ns = f.namespace;
  const labels = { app: name, 'app.kubernetes.io/name': name, 'app.kubernetes.io/managed-by': 'openshiftpulse' };
  const meta = { name, namespace: ns, labels };
  const port = portOf(f);
  const replicas = replicasOf(f);
  const out: PlannedObject[] = [];

  if (f.source.type === 'git') {
    out.push({
      apiVersion: 'image.openshift.io/v1', kind: 'ImageStream', name, path: `/apis/image.openshift.io/v1/namespaces/${ns}/imagestreams`,
      body: { apiVersion: 'image.openshift.io/v1', kind: 'ImageStream', metadata: meta, spec: { lookupPolicy: { local: true } } },
      summary: `receives ${name}:latest from the build`,
    });
    const [builderName, builderTag] = f.source.builderImage.trim().split(':');
    out.push({
      apiVersion: 'build.openshift.io/v1', kind: 'BuildConfig', name, path: `/apis/build.openshift.io/v1/namespaces/${ns}/buildconfigs`,
      body: {
        apiVersion: 'build.openshift.io/v1', kind: 'BuildConfig', metadata: meta,
        spec: {
          source: { type: 'Git', git: { uri: f.source.gitUrl.trim(), ...(f.source.gitRef.trim() ? { ref: f.source.gitRef.trim() } : {}) }, ...(f.source.contextDir.trim() ? { contextDir: f.source.contextDir.trim() } : {}) },
          strategy: { type: 'Source', sourceStrategy: { from: { kind: 'ImageStreamTag', namespace: 'openshift', name: `${builderName}:${builderTag}` } } },
          output: { to: { kind: 'ImageStreamTag', name: `${name}:latest` } },
          triggers: [{ type: 'ConfigChange' }, { type: 'ImageChange', imageChange: {} }],
        },
      },
      summary: `builds ${f.source.gitUrl.trim()}${f.source.gitRef.trim() ? `@${f.source.gitRef.trim()}` : ''} with ${f.source.builderImage.trim()}; starts a build on create`,
    });
  }

  const claim = claimNameOf(f);
  if (f.storage.mode === 'new') {
    out.push({
      apiVersion: 'v1', kind: 'PersistentVolumeClaim', name: claim, path: `/api/v1/namespaces/${ns}/persistentvolumeclaims`,
      body: {
        apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { ...meta, name: claim },
        spec: { accessModes: [f.storage.accessMode], resources: { requests: { storage: f.storage.size.trim() } }, ...(f.storage.storageClass ? { storageClassName: f.storage.storageClass } : {}) },
      },
      summary: `${f.storage.size.trim()} ${f.storage.storageClass || 'default storage class'} · ${f.storage.accessMode}`,
    });
  }

  const { env, envFrom } = envSpec(f.env);
  const resources: Record<string, Record<string, string>> = {};
  const r = f.resources;
  if (r.cpuRequest || r.memRequest) resources.requests = { ...(r.cpuRequest ? { cpu: r.cpuRequest.trim() } : {}), ...(r.memRequest ? { memory: r.memRequest.trim() } : {}) };
  if (r.cpuLimit || r.memLimit) resources.limits = { ...(r.cpuLimit ? { cpu: r.cpuLimit.trim() } : {}), ...(r.memLimit ? { memory: r.memLimit.trim() } : {}) };
  const probes = Object.fromEntries((Object.entries(f.probes) as Array<[ProbeKind, ProbeForm]>).filter(([, p]) => p.enabled).map(([k, p]) => [`${k}Probe`, probeSpec(p, port)]));
  const container = {
    name,
    image: f.source.type === 'image' ? f.source.image.trim() : internalImage(ns, name),
    ...(port ? { ports: [{ containerPort: port, protocol: 'TCP' }] } : {}),
    ...(env.length ? { env } : {}),
    ...(envFrom.length ? { envFrom } : {}),
    ...(Object.keys(resources).length ? { resources } : {}),
    ...probes,
    ...(f.storage.mode !== 'none' ? { volumeMounts: [{ name: 'data', mountPath: f.storage.mountPath }] } : {}),
  };
  const configRefs = [...new Set(f.env.flatMap((e) => (e.kind === 'configMapAll' || e.kind === 'configMapKey' ? [e.configMap] : e.kind === 'secretAll' || e.kind === 'secretKey' ? [e.secret] : [])))];
  out.push({
    apiVersion: 'apps/v1', kind: 'Deployment', name, path: `/apis/apps/v1/namespaces/${ns}/deployments`,
    body: {
      apiVersion: 'apps/v1', kind: 'Deployment',
      metadata: {
        ...meta,
        ...(f.source.type === 'git' ? { annotations: { 'image.openshift.io/triggers': JSON.stringify([{ from: { kind: 'ImageStreamTag', name: `${name}:latest` }, fieldPath: `spec.template.spec.containers[?(@.name=="${name}")].image` }]) } } : {}),
      },
      spec: {
        replicas,
        selector: { matchLabels: { app: name } },
        template: {
          metadata: { labels },
          spec: {
            containers: [container],
            ...(f.source.type === 'image' && f.source.pullSecret ? { imagePullSecrets: [{ name: f.source.pullSecret }] } : {}),
            ...(f.storage.mode !== 'none' ? { volumes: [{ name: 'data', persistentVolumeClaim: { claimName: claim } }] } : {}),
          },
        },
      },
    },
    summary: [
      `${replicas} replica${replicas === 1 ? '' : 's'}`,
      Object.keys(probes).length ? `${Object.keys(probes).length} probe${Object.keys(probes).length === 1 ? '' : 's'}` : 'no probes',
      configRefs.length ? `env from ${configRefs.join(', ')}` : '',
      f.storage.mode !== 'none' ? `mounts ${claim} at ${f.storage.mountPath}` : '',
    ].filter(Boolean).join(' · '),
  });

  if (f.pdb && replicas > 1) {
    out.push({
      apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', name, path: `/apis/policy/v1/namespaces/${ns}/poddisruptionbudgets`,
      body: { apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: meta, spec: { minAvailable: 1, selector: { matchLabels: { app: name } } } },
      summary: 'minAvailable 1 · added because replicas > 1',
    });
  }
  if (f.expose.service && port) {
    out.push({
      apiVersion: 'v1', kind: 'Service', name, path: `/api/v1/namespaces/${ns}/services`,
      body: { apiVersion: 'v1', kind: 'Service', metadata: meta, spec: { selector: { app: name }, ports: [{ name: `${port}-tcp`, port, targetPort: port, protocol: 'TCP' }] } },
      summary: `${port} → ${port}`,
    });
    if (f.expose.route) {
      const tls = f.expose.tls === 'none' ? undefined
        : f.expose.tls === 'edge' ? { termination: 'edge', insecureEdgeTerminationPolicy: 'Redirect' }
          : { termination: f.expose.tls };
      out.push({
        apiVersion: 'route.openshift.io/v1', kind: 'Route', name, path: `/apis/route.openshift.io/v1/namespaces/${ns}/routes`,
        body: {
          apiVersion: 'route.openshift.io/v1', kind: 'Route', metadata: meta,
          spec: { ...(f.expose.hostname.trim() ? { host: f.expose.hostname.trim() } : {}), to: { kind: 'Service', name }, port: { targetPort: `${port}-tcp` }, ...(tls ? { tls } : {}) },
        },
        summary: `${f.expose.hostname.trim() || 'generated hostname'} · ${f.expose.tls === 'none' ? 'no TLS' : f.expose.tls === 'edge' ? 'edge TLS · redirect' : `${f.expose.tls} TLS`}`,
      });
    }
  }
  return out;
}

/** ConfigMaps and Secrets the form references by name (never their values). */
export function referencedConfig(f: DeployForm): { configMaps: string[]; secrets: string[] } {
  const cms = new Set<string>();
  const secrets = new Set<string>();
  for (const e of f.env) {
    if (e.kind === 'configMapAll' || e.kind === 'configMapKey') cms.add(e.configMap.trim());
    if (e.kind === 'secretAll' || e.kind === 'secretKey') secrets.add(e.secret.trim());
  }
  if (f.source.type === 'image' && f.source.pullSecret) secrets.add(f.source.pullSecret);
  return { configMaps: [...cms].filter(Boolean), secrets: [...secrets].filter(Boolean) };
}

export interface QuotaLine {
  resource: string;
  quota: string;
  hard: number;
  used: number;
  /** used + what this app's pods request once all replicas run. */
  after: number;
  /** after + one more pod during the next rollout (maxSurge 25%, at least 1). */
  duringRollout: number;
  /** The quota limits this resource but the form does not set it, so pods are rejected. */
  unsetButRequired?: boolean;
}

export interface Quota {
  metadata: { name: string };
  spec?: { hard?: Record<string, string> };
  status?: { hard?: Record<string, string>; used?: Record<string, string> };
}

/** Quota headroom for this app in its namespace. */
export function quotaHeadroom(f: DeployForm, quotas: Quota[]): QuotaLine[] {
  const replicas = replicasOf(f);
  const surge = replicas > 0 ? Math.max(1, Math.ceil(replicas * 0.25)) : 0;
  const perPod: Record<string, string> = {
    'requests.cpu': f.resources.cpuRequest, cpu: f.resources.cpuRequest, 'limits.cpu': f.resources.cpuLimit,
    'requests.memory': f.resources.memRequest, memory: f.resources.memRequest, 'limits.memory': f.resources.memLimit,
  };
  const lines: QuotaLine[] = [];
  for (const q of quotas) {
    const hard = q.status?.hard ?? q.spec?.hard ?? {};
    const used = q.status?.used ?? {};
    for (const [res, hv] of Object.entries(hard)) {
      const h = parseResourceValue(hv);
      const u = parseResourceValue(used[res] ?? '0');
      let add = 0;
      let rollout = 0;
      let unset = false;
      if (res in perPod) {
        const v = perPod[res]?.trim();
        if (!v) unset = replicas > 0;
        else { add = parseResourceValue(v) * replicas; rollout = parseResourceValue(v) * surge; }
      } else if (res === 'pods' || res === 'count/pods') { add = replicas; rollout = surge; }
      else if (res === 'requests.storage' && f.storage.mode === 'new') add = parseResourceValue(f.storage.size);
      else if (res === 'persistentvolumeclaims' && f.storage.mode === 'new') add = 1;
      else if (res === 'services' || res === 'count/services') add = f.expose.service && portOf(f) ? 1 : 0;
      else continue;
      lines.push({ resource: res, quota: q.metadata.name, hard: h, used: u, after: u + add, duringRollout: u + add + rollout, ...(unset ? { unsetButRequired: true } : {}) });
    }
  }
  return lines;
}
