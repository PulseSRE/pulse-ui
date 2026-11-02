/**
 * Facts about a pod, read straight from the pod object: what state it is in,
 * how its containers last ended, how their probes are timed and which other
 * objects (pull secrets, PVCs, ConfigMaps, Secrets) they depend on.
 *
 * Pure functions, so the pod page, the fix builders and the tests agree on one
 * reading of `status.containerStatuses[].lastState` and the probe defaults.
 */
import type { Container, ContainerStatus, Pod, Probe } from './types';
import { toEpochMs } from './format';

type PodLike = { spec?: Pod['spec']; status?: Pod['status']; metadata?: { namespace?: string } };

const BAD_WAITING = new Set(['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'CreateContainerConfigError', 'CreateContainerError', 'InvalidImageName', 'RunContainerError']);

export interface Termination {
  reason: string;
  exitCode: number | null;
  startedAt?: string;
  finishedAt?: string;
  /** How long that instance ran, when both times are known. */
  ranForMs: number | null;
}

/** How a container's previous instance ended (`lastState.terminated`), or null. */
export function lastTermination(cs: ContainerStatus | undefined): Termination | null {
  const t = cs?.lastState?.terminated;
  if (!t) return null;
  const s = toEpochMs(t.startedAt);
  const f = toEpochMs(t.finishedAt);
  return {
    reason: t.reason || 'Terminated',
    exitCode: typeof t.exitCode === 'number' ? t.exitCode : null,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
    ranForMs: s !== null && f !== null && f >= s ? f - s : null,
  };
}

/**
 * The container to talk about: the one whose last instance ended most
 * recently, else one that is waiting in a bad state, else the first.
 */
export function primaryContainer(pod: PodLike): { name: string; status?: ContainerStatus } | null {
  const containers = pod.spec?.containers ?? [];
  if (containers.length === 0) return null;
  const statuses = pod.status?.containerStatuses ?? [];
  const ended = statuses
    .filter((c) => c.lastState?.terminated)
    .sort((a, b) => (toEpochMs(b.lastState?.terminated?.finishedAt) ?? 0) - (toEpochMs(a.lastState?.terminated?.finishedAt) ?? 0))[0];
  const bad = statuses.find((c) => c.state?.waiting?.reason && BAD_WAITING.has(c.state.waiting.reason));
  const pick = ended ?? bad;
  if (pick) return { name: pick.name, status: pick };
  return { name: containers[0].name, status: statuses.find((s) => s.name === containers[0].name) };
}

/** "Waiting · CrashLoopBackOff (back-off 2m40s restarting …)" etc. */
export function currentStateText(cs: ContainerStatus | undefined): string {
  const st = cs?.state;
  if (!st) return 'Unknown (no status reported yet)';
  if (st.running) return `Running${st.running.startedAt ? ` since ${new Date(st.running.startedAt).toLocaleTimeString()}` : ''}${cs?.ready === false ? ' · not ready' : ''}`;
  if (st.waiting) {
    const msg = st.waiting.message ? ` (${st.waiting.message.length > 80 ? `${st.waiting.message.slice(0, 80)}…` : st.waiting.message})` : '';
    return `Waiting · ${st.waiting.reason || 'Waiting'}${msg}`;
  }
  if (st.terminated) return `Terminated · ${st.terminated.reason || 'exit'} · exit ${st.terminated.exitCode ?? '—'}`;
  return 'Unknown';
}

/** Kubernetes probe defaults, so an unset field is shown as what actually applies. */
export const PROBE_DEFAULTS = { initialDelaySeconds: 0, periodSeconds: 10, timeoutSeconds: 1, failureThreshold: 3 } as const;

export function probeHandler(probe: Probe): string {
  if (probe.httpGet) return `HTTP ${probe.httpGet.path || '/'} :${probe.httpGet.port}`;
  if (probe.tcpSocket) return `TCP :${probe.tcpSocket.port}`;
  if (probe.exec) return `exec ${(probe.exec.command || []).join(' ').slice(0, 40)}`;
  const grpc = (probe as Probe & { grpc?: { port: number } }).grpc;
  if (grpc) return `gRPC :${grpc.port}`;
  return 'configured';
}

/** "HTTP /healthz :8080 · delay 5s · every 10s · timeout 1s · 3 failures". */
export function probeTiming(probe: Probe): string {
  const d = probe.initialDelaySeconds ?? PROBE_DEFAULTS.initialDelaySeconds;
  const p = probe.periodSeconds ?? PROBE_DEFAULTS.periodSeconds;
  const t = probe.timeoutSeconds ?? PROBE_DEFAULTS.timeoutSeconds;
  const f = probe.failureThreshold ?? PROBE_DEFAULTS.failureThreshold;
  return `${probeHandler(probe)} · delay ${d}s · every ${p}s · timeout ${t}s · ${f} failure${f === 1 ? '' : 's'}`;
}

/** Seconds a probe allows before it gives up: delay + period × failures. */
export function probeBudgetSeconds(probe: Probe): number {
  return (probe.initialDelaySeconds ?? 0) + (probe.periodSeconds ?? PROBE_DEFAULTS.periodSeconds) * (probe.failureThreshold ?? PROBE_DEFAULTS.failureThreshold);
}

export interface ResourceRef {
  kind: 'Secret' | 'PersistentVolumeClaim' | 'ConfigMap';
  name: string;
  /** Why it is listed: "pull secret", "volume data", "envFrom", "env DB_URL". */
  use: string;
  /** UI path of its detail page. */
  path: string;
}

const PLURAL: Record<ResourceRef['kind'], string> = { Secret: 'secrets', PersistentVolumeClaim: 'persistentvolumeclaims', ConfigMap: 'configmaps' };

type VolumeLike = {
  name: string;
  configMap?: { name?: string };
  secret?: { secretName?: string };
  persistentVolumeClaim?: { claimName?: string };
  projected?: { sources?: Array<{ configMap?: { name?: string }; secret?: { name?: string } }> };
};

/** Objects a container depends on: the pod's pull secrets and what the container mounts or reads from env. */
export function containerRefs(pod: PodLike, container: Container): ResourceRef[] {
  const ns = pod.metadata?.namespace || '_';
  const refs: ResourceRef[] = [];
  const seen = new Set<string>();
  const add = (kind: ResourceRef['kind'], name: string | undefined, use: string) => {
    if (!name) return;
    const key = `${kind}/${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ kind, name, use, path: `/r/v1~${PLURAL[kind]}/${ns}/${name}` });
  };
  const spec = (pod.spec ?? {}) as Pod['spec'] & { imagePullSecrets?: Array<{ name?: string }>; volumes?: VolumeLike[] };
  for (const s of spec.imagePullSecrets ?? []) add('Secret', s.name, 'pull secret');
  const mounted = new Set((container.volumeMounts ?? []).map((m) => m.name));
  for (const v of (spec.volumes ?? []) as VolumeLike[]) {
    if (!mounted.has(v.name)) continue;
    add('PersistentVolumeClaim', v.persistentVolumeClaim?.claimName, `volume ${v.name}`);
    add('ConfigMap', v.configMap?.name, `volume ${v.name}`);
    add('Secret', v.secret?.secretName, `volume ${v.name}`);
    for (const src of v.projected?.sources ?? []) {
      add('ConfigMap', src.configMap?.name, `volume ${v.name}`);
      add('Secret', src.secret?.name, `volume ${v.name}`);
    }
  }
  for (const e of (container.envFrom ?? []) as Array<{ configMapRef?: { name?: string }; secretRef?: { name?: string } }>) {
    add('ConfigMap', e.configMapRef?.name, 'envFrom');
    add('Secret', e.secretRef?.name, 'envFrom');
  }
  for (const e of (container.env ?? []) as Array<{ name: string; valueFrom?: { configMapKeyRef?: { name?: string }; secretKeyRef?: { name?: string } } }>) {
    add('ConfigMap', e.valueFrom?.configMapKeyRef?.name, `env ${e.name}`);
    add('Secret', e.valueFrom?.secretKeyRef?.name, `env ${e.name}`);
  }
  return refs;
}
