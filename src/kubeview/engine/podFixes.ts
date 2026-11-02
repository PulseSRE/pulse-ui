/**
 * Guided fixes for a failing pod, applied to what owns it.
 *
 * Patching the pod would be undone by the next rollout (and Kubernetes rejects
 * most pod spec changes anyway), so every template fix patches the
 * Deployment/StatefulSet/DaemonSet. Each fix carries exactly the request that
 * is sent — a JSON Patch that first tests the resourceVersion the page read,
 * so a concurrent change is refused rather than overwritten — together with
 * the before/after of every field it changes, its impact and how to undo it.
 *
 * The rules start from engine/diagnosis (OOMKilled, crash loops, image pull
 * failures) and add what the pod and metrics show: p95 memory/CPU, how long
 * the crashed instance ran against its liveness probe, and the revision it runs.
 */
import type { K8sResource } from './renderers';
import type { Container, Event, Pod, PodTemplateSpec, Probe } from './types';
import { JSON_PATCH, type WriteRequest } from './workloadActions';
import { parseMem, parseCpu } from './formatting';
import { lastTermination, primaryContainer, probeBudgetSeconds, PROBE_DEFAULTS } from './podFacts';
import { templateDiff, type RevisionEntry } from '../views/detail/RolloutHistory';
import type { UsageResult } from '../views/detail/usePodUsage';

export type FixKind = 'memory' | 'cpu' | 'startup-probe' | 'pull-secret' | 'rollback';

export interface FixTarget {
  kind: string;
  name: string;
  namespace: string;
  apiPath: string;
  /** For RBAC: patch <group>/<plural>. */
  group: string;
  plural: string;
}

export interface DiffLine {
  field: string;
  before: string;
  after: string;
}

export interface GuidedFix {
  id: string;
  kind: FixKind;
  /** "Raise the memory limit to 512Mi on Deployment api". */
  title: string;
  /** "Raise memory limit on Deployment api?" */
  question: string;
  target: FixTarget;
  /** "Deployment api · containers[api].resources". */
  diffHeader: string;
  diff: DiffLine[];
  /** Exactly what is sent (dry run adds ?dryRun=All). */
  request: WriteRequest;
  impact: string;
  undo: string;
  /** Why this value, in a sentence; also seeds "Ask Pulse why". */
  basis: string;
  /** Pods the change restarts (0 when it waits for pods to be recreated). */
  restarts: number;
  /** Whether the result can be watched as a rollout of `target`. */
  watchable: boolean;
  /** Memory requests/limits added per pod, in bytes, for quota headroom. */
  memoryDelta?: { requests: number; limits: number; replicas: number };
}

const WORKLOAD_PLURAL: Record<string, string> = { Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets' };

export function workloadTarget(owner: K8sResource): FixTarget | null {
  const plural = WORKLOAD_PLURAL[owner.kind];
  const ns = owner.metadata.namespace;
  if (!plural || !ns) return null;
  return { kind: owner.kind, name: owner.metadata.name, namespace: ns, apiPath: `/apis/apps/v1/namespaces/${ns}/${plural}/${owner.metadata.name}`, group: 'apps', plural };
}

/** A startup budget longer than this hides hangs; a fix never proposes more. */
export const MAX_STARTUP_SECONDS = 600;
const STARTUP_KILL_FACTOR = 3;

const Mi = 1024 * 1024;
const Gi = 1024 * Mi;

/** A memory quantity rounded up to a tidy step: 64Mi below 2Gi, 256Mi above. */
export function roundMemoryUp(bytes: number): number {
  const step = bytes < 2 * Gi ? 64 * Mi : 256 * Mi;
  return Math.ceil(bytes / step) * step;
}

export function formatMemoryQuantity(bytes: number): string {
  if (bytes >= Gi && bytes % Gi === 0) return `${bytes / Gi}Gi`;
  return `${Math.round(bytes / Mi)}Mi`;
}

function fmtMi(bytes: number): string {
  return bytes >= Gi ? `${(bytes / Gi).toFixed(1)}Gi` : `${Math.round(bytes / Mi)}Mi`;
}

/**
 * New memory limit: p95 working set plus 25% headroom, and at least 1.5× the
 * current limit (an OOM-killed container's usage is capped at its limit, so
 * p95 near the limit says only that it needs more).
 */
export function proposeMemoryLimit(currentLimit: number, p95: number | undefined): { limit: number; basis: string } {
  const fromP95 = p95 !== undefined ? p95 * 1.25 : 0;
  const fromLimit = currentLimit * 1.5;
  const limit = roundMemoryUp(Math.max(fromP95, fromLimit));
  const basis = p95 !== undefined && fromP95 >= fromLimit
    ? `p95 working set ${fmtMi(p95)} over 6h plus 25% headroom, rounded up`
    : p95 !== undefined
      ? `1.5× the current ${formatMemoryQuantity(currentLimit)} limit, rounded up: p95 (${fmtMi(p95)}) is held down by the limit it keeps hitting`
      : `1.5× the current ${formatMemoryQuantity(currentLimit)} limit, rounded up (memory usage is unknown)`;
  return { limit, basis };
}

/** New CPU limit: 1.5× p95, rounded up to 100m. */
export function proposeCpuLimit(p95Cores: number): number {
  return Math.ceil((p95Cores * 1.5 * 1000) / 100) * 100;
}

function templateOf(owner: K8sResource): PodTemplateSpec | undefined {
  return (owner.spec as { template?: PodTemplateSpec } | undefined)?.template;
}

function containerIndex(owner: K8sResource, name: string): number {
  return ((templateOf(owner)?.spec?.containers ?? []) as Container[]).findIndex((c) => c.name === name);
}

function replicasOf(owner: K8sResource): number {
  if (owner.kind === 'DaemonSet') return (owner.status as { desiredNumberScheduled?: number } | undefined)?.desiredNumberScheduled ?? 0;
  return (owner.spec as { replicas?: number } | undefined)?.replicas ?? 1;
}

/** "Rolling restart of 3 pods, one at a time (maxUnavailable 1, maxSurge 25%)". */
export function rolloutImpact(owner: K8sResource): string {
  const n = replicasOf(owner);
  const pods = `${n} pod${n === 1 ? '' : 's'}`;
  const spec = (owner.spec || {}) as { strategy?: { type?: string; rollingUpdate?: { maxUnavailable?: string | number; maxSurge?: string | number } }; updateStrategy?: { type?: string; rollingUpdate?: { maxUnavailable?: string | number } } };
  if (owner.kind === 'Deployment') {
    if (spec.strategy?.type === 'Recreate') return `All ${pods} are stopped, then recreated (strategy Recreate): the app is down meanwhile`;
    const ru = spec.strategy?.rollingUpdate;
    return `Rolling restart of ${pods} (maxUnavailable ${ru?.maxUnavailable ?? '25%'}, maxSurge ${ru?.maxSurge ?? '25%'})`;
  }
  if (owner.kind === 'StatefulSet') {
    if (spec.updateStrategy?.type === 'OnDelete') return `Nothing restarts by itself (updateStrategy OnDelete): each of the ${pods} picks the change up only when you delete it, so Pulse cannot watch whether it held`;
    return `Rolling restart of ${pods}, one at a time from the highest ordinal`;
  }
  return `Rolling restart of ${pods}, one per node (maxUnavailable ${spec.updateStrategy?.rollingUpdate?.maxUnavailable ?? 1})`;
}

function undoText(owner: K8sResource): string {
  const rev = owner.metadata.annotations?.['deployment.kubernetes.io/revision'];
  return owner.kind === 'Deployment' && rev
    ? `Roll back to the revision before this change (revision ${rev}) in Rollout History on ${owner.kind} ${owner.metadata.name}`
    : `Roll back to the revision before this change in Rollout History on ${owner.kind} ${owner.metadata.name}`;
}

/** OnDelete StatefulSets roll nothing out: a template fix only reaches pods that are deleted. */
function rollsOut(owner: K8sResource): boolean {
  return !(owner.kind === 'StatefulSet' && (owner.spec as { updateStrategy?: { type?: string } } | undefined)?.updateStrategy?.type === 'OnDelete');
}

function rvTest(obj: K8sResource): Array<Record<string, unknown>> {
  return obj.metadata.resourceVersion ? [{ op: 'test', path: '/metadata/resourceVersion', value: obj.metadata.resourceVersion }] : [];
}

/** JSON Patch ops that set resources.<tier>.<res> on container i, creating parents as needed. */
function setResourceOps(c: Container, i: number, tier: 'limits' | 'requests', res: 'memory' | 'cpu', value: string): Array<Record<string, unknown>> {
  const base = `/spec/template/spec/containers/${i}`;
  const ops: Array<Record<string, unknown>> = [{ op: 'test', path: `${base}/name`, value: c.name }];
  if (!c.resources) return [...ops, { op: 'add', path: `${base}/resources`, value: { [tier]: { [res]: value } } }];
  if (!c.resources[tier]) return [...ops, { op: 'add', path: `${base}/resources/${tier}`, value: { [res]: value } }];
  return [...ops, { op: 'add', path: `${base}/resources/${tier}/${res}`, value }];
}

export interface FixInputs {
  /** The failing pod (on a Deployment page: its worst pod). */
  pod: K8sResource;
  /** The workload that owns it, as read; null when there is none or the read failed. */
  owner: K8sResource | null;
  usage?: UsageResult;
  /** Deployment revisions (oldest first), for the rollback fix. */
  revisions?: RevisionEntry[];
  events?: Event[];
  /** dockerconfigjson Secrets in the namespace, for the pull secret fix. */
  pullSecrets?: string[];
}

function memoryFix(inp: FixInputs, owner: K8sResource, target: FixTarget): GuidedFix | null {
  const statuses = (inp.pod.status as Pod['status'] | undefined)?.containerStatuses ?? [];
  const oom = statuses.find((s) => s.lastState?.terminated?.reason === 'OOMKilled' || s.state?.terminated?.reason === 'OOMKilled');
  if (!oom) return null;
  const i = containerIndex(owner, oom.name);
  if (i < 0) return null;
  const c = (templateOf(owner)!.spec!.containers as Container[])[i];
  const curLimitQ = c.resources?.limits?.memory;
  if (!curLimitQ) return null; // No container limit: the node ran out, not the container.
  const curLimit = parseMem(curLimitQ);
  const p95 = inp.usage?.state === 'ok' ? inp.usage.memory[oom.name] : undefined;
  const { limit, basis } = proposeMemoryLimit(curLimit, p95);
  const newLimitQ = formatMemoryQuantity(limit);
  const ops = [...rvTest(owner), ...setResourceOps(c, i, 'limits', 'memory', newLimitQ)];
  const diff: DiffLine[] = [{ field: 'limits.memory', before: curLimitQ, after: newLimitQ }];
  const curReqQ = c.resources?.requests?.memory;
  const curReq = curReqQ ? parseMem(curReqQ) : 0;
  let reqDelta = 0;
  if (p95 !== undefined) {
    const wanted = Math.min(roundMemoryUp(p95), limit);
    if (wanted > curReq) {
      const q = formatMemoryQuantity(wanted);
      // The limits op above may have created resources/limits; requests is a sibling.
      ops.push(...setResourceOps({ ...c, resources: { ...(c.resources ?? {}), limits: { memory: newLimitQ } } }, i, 'requests', 'memory', q).slice(1));
      diff.push({ field: 'requests.memory', before: curReqQ ?? 'none', after: q });
      reqDelta = wanted - curReq;
    }
  }
  const replicas = replicasOf(owner);
  return {
    id: `memory:${oom.name}`,
    kind: 'memory',
    title: `Raise the memory limit to ${newLimitQ} on ${owner.kind} ${owner.metadata.name}`,
    question: `Raise memory limit on ${owner.kind} ${owner.metadata.name}?`,
    target,
    diffHeader: `${owner.kind} ${owner.metadata.name} · containers[${oom.name}].resources`,
    diff,
    request: { method: 'PATCH', path: target.apiPath, patchType: JSON_PATCH, body: ops },
    impact: rolloutImpact(owner),
    undo: undoText(owner),
    basis: `Container ${oom.name} was OOMKilled at its ${curLimitQ} limit. ${newLimitQ} is ${basis}.`,
    restarts: replicas,
    watchable: rollsOut(owner),
    memoryDelta: { requests: reqDelta, limits: limit - curLimit, replicas },
  };
}

function cpuFix(inp: FixInputs, owner: K8sResource, target: FixTarget): GuidedFix | null {
  if (inp.usage?.state !== 'ok') return null;
  const statuses = (inp.pod.status as Pod['status'] | undefined)?.containerStatuses ?? [];
  for (const s of statuses) {
    const unhealthy = s.restartCount > 0 || !s.ready;
    const i = containerIndex(owner, s.name);
    if (!unhealthy || i < 0) continue;
    const c = (templateOf(owner)!.spec!.containers as Container[])[i];
    const limQ = c.resources?.limits?.cpu;
    const p95 = inp.usage.cpu[s.name];
    if (!limQ || p95 === undefined || p95 < parseCpu(limQ) * 0.9) continue;
    const newQ = `${proposeCpuLimit(p95)}m`;
    return {
      id: `cpu:${s.name}`,
      kind: 'cpu',
      title: `Raise the CPU limit to ${newQ} on ${owner.kind} ${owner.metadata.name}`,
      question: `Raise CPU limit on ${owner.kind} ${owner.metadata.name}?`,
      target,
      diffHeader: `${owner.kind} ${owner.metadata.name} · containers[${s.name}].resources`,
      diff: [{ field: 'limits.cpu', before: limQ, after: newQ }],
      request: { method: 'PATCH', path: target.apiPath, patchType: JSON_PATCH, body: [...rvTest(owner), ...setResourceOps(c, i, 'limits', 'cpu', newQ)] },
      impact: rolloutImpact(owner),
      undo: undoText(owner),
      basis: `Container ${s.name} used ${Math.round(p95 * 1000)}m CPU at p95 over 6h against a ${limQ} limit, so it is throttled; ${newQ} is 1.5× p95, rounded up.`,
      restarts: replicasOf(owner),
      watchable: rollsOut(owner),
    };
  }
  return null;
}

function livenessKilled(inp: FixInputs, container: string): boolean {
  return (inp.events ?? []).some((e) => {
    const obj = e.involvedObject as { name?: string; fieldPath?: string } | undefined;
    return e.reason === 'Unhealthy' && /Liveness probe failed/i.test(e.message || '')
      && (!obj?.name || obj.name === inp.pod.metadata.name)
      && (!obj?.fieldPath || obj.fieldPath.includes(container));
  });
}

function startupProbeFix(inp: FixInputs, owner: K8sResource, target: FixTarget): GuidedFix | null {
  const statuses = (inp.pod.status as Pod['status'] | undefined)?.containerStatuses ?? [];
  for (const s of statuses) {
    const term = lastTermination(s);
    if (!term || term.reason === 'OOMKilled' || s.restartCount === 0) continue;
    const i = containerIndex(owner, s.name);
    if (i < 0) continue;
    const c = (templateOf(owner)!.spec!.containers as Container[])[i];
    const live = c.livenessProbe;
    if (!live) continue;
    const ranS = term.ranForMs !== null ? term.ranForMs / 1000 : null;
    // Only a container killed while starting: one that ran far longer than
    // the liveness budget (say 4h, then hung) started fine, and a startup
    // probe would only delay noticing the hang.
    const budget = probeBudgetSeconds(live);
    const killedEarly = ranS !== null && ranS <= STARTUP_KILL_FACTOR * budget + 15;
    if (!killedEarly) continue;
    if (!livenessKilled(inp, s.name) && ranS > budget + 15) continue;
    const base = `/spec/template/spec/containers/${i}`;
    const wantS = Math.min(MAX_STARTUP_SECONDS, Math.max(300, ranS * 2));
    const capped = ranS * 2 > MAX_STARTUP_SECONDS;
    const needed = Math.ceil(wantS / 10);
    const ops: Array<Record<string, unknown>> = [...rvTest(owner), { op: 'test', path: `${base}/name`, value: c.name }];
    let diff: DiffLine[];
    let title: string;
    const sp = c.startupProbe;
    if (sp) {
      const period = sp.periodSeconds ?? PROBE_DEFAULTS.periodSeconds;
      const cur = sp.failureThreshold ?? PROBE_DEFAULTS.failureThreshold;
      const next = Math.min(Math.floor(MAX_STARTUP_SECONDS / period), Math.max(cur * 2, Math.ceil((ranS * 2) / period)));
      if (next <= cur) continue; // Already at the 10-minute cap.
      ops.push({ op: 'add', path: `${base}/startupProbe/failureThreshold`, value: next });
      diff = [{ field: 'startupProbe.failureThreshold', before: String(cur), after: `${next} (${next * period}s to start)` }];
      title = `Give ${s.name} ${next * period}s to start (startupProbe) on ${owner.kind} ${owner.metadata.name}`;
    } else {
      const { initialDelaySeconds: _d, periodSeconds: _p, failureThreshold: _f, successThreshold: _s, ...handler } = live as Probe & Record<string, unknown>;
      const probe = { ...handler, periodSeconds: 10, failureThreshold: needed };
      ops.push({ op: 'add', path: `${base}/startupProbe`, value: probe });
      diff = [{ field: 'startupProbe', before: 'none', after: `same check as liveness · every 10s · ${needed} failures (${needed * 10}s to start)` }];
      title = `Add a startup probe giving ${s.name} ${needed * 10}s to start on ${owner.kind} ${owner.metadata.name}`;
    }
    return {
      id: `startup:${s.name}`,
      kind: 'startup-probe',
      title,
      question: `Change the startup probe on ${owner.kind} ${owner.metadata.name}?`,
      target,
      diffHeader: `${owner.kind} ${owner.metadata.name} · containers[${s.name}]`,
      diff,
      request: { method: 'PATCH', path: target.apiPath, patchType: JSON_PATCH, body: ops },
      impact: rolloutImpact(owner),
      undo: undoText(owner),
      basis: `The liveness probe (${budget}s budget) killed ${s.name} after it ran ${Math.round(ranS)}s; a startup probe holds liveness off until the app has started. The start budget is capped at 10 minutes${capped ? ' (twice the observed run would be longer)' : ''}, so a real hang is still caught.`,
      restarts: replicasOf(owner),
      watchable: rollsOut(owner),
    };
  }
  return null;
}

const PULL_AUTH = /unauthorized|authentication required|denied|no basic auth|401|403/i;

function pullSecretFixes(inp: FixInputs): GuidedFix[] {
  const pod = inp.pod;
  const ns = pod.metadata.namespace || '';
  const statuses = (pod.status as Pod['status'] | undefined)?.containerStatuses ?? [];
  const failing = statuses.find((s) => (s.state?.waiting?.reason === 'ImagePullBackOff' || s.state?.waiting?.reason === 'ErrImagePull') && PULL_AUTH.test(s.state.waiting.message || ''));
  if (!failing || !ns) return [];
  const spec = pod.spec as Pod['spec'] & { imagePullSecrets?: Array<{ name: string }> };
  const sa = spec?.serviceAccountName || 'default';
  const attached = new Set((spec?.imagePullSecrets ?? []).map((s) => s.name));
  const why = (secret: string) => `Pulling the image of ${failing.name} is refused by the registry (${(failing.state?.waiting?.message || '').slice(0, 120)}); ${secret} is a registry credential in ${ns} that the pod does not use.`;
  const candidates = (inp.pullSecrets ?? []).filter((n) => !attached.has(n)).slice(0, 3);

  // A pod that lists imagePullSecrets itself never gets its ServiceAccount's
  // (the admission plugin only fills them in when the pod has none), so the
  // secret has to go into the owner's template.
  const owner = inp.owner;
  const target = owner ? workloadTarget(owner) : null;
  const tplSecrets = (templateOf(owner ?? ({} as K8sResource))?.spec as { imagePullSecrets?: Array<{ name: string }> } | undefined)?.imagePullSecrets;
  if (owner && target && tplSecrets && tplSecrets.length > 0) {
    const current = tplSecrets.map((s) => s.name);
    return candidates.map((secret) => ({
      id: `pull-secret:${secret}`,
      kind: 'pull-secret' as const,
      title: `Add pull secret ${secret} to ${owner.kind} ${owner.metadata.name}`,
      question: `Add pull secret ${secret} to ${owner.kind} ${owner.metadata.name}?`,
      target,
      diffHeader: `${owner.kind} ${owner.metadata.name} · spec.template.spec.imagePullSecrets`,
      diff: [{ field: 'imagePullSecrets', before: current.join(', '), after: [...current, secret].join(', ') }],
      request: { method: 'PATCH', path: target.apiPath, patchType: JSON_PATCH, body: [...rvTest(owner), { op: 'add', path: '/spec/template/spec/imagePullSecrets/-', value: { name: secret } }] },
      impact: rolloutImpact(owner),
      undo: undoText(owner),
      basis: `${why(secret)} The template already lists imagePullSecrets, so ServiceAccount ones are not applied to these pods.`,
      restarts: replicasOf(owner),
      watchable: rollsOut(owner),
    }));
  }

  return candidates.map((secret) => ({
    id: `pull-secret:${secret}`,
    kind: 'pull-secret' as const,
    title: `Attach pull secret ${secret} to ServiceAccount ${sa}`,
    question: `Attach pull secret ${secret} to ServiceAccount ${sa}?`,
    target: { kind: 'ServiceAccount', name: sa, namespace: ns, apiPath: `/api/v1/namespaces/${ns}/serviceaccounts/${sa}`, group: '', plural: 'serviceaccounts' },
    diffHeader: `ServiceAccount ${sa} · imagePullSecrets`,
    diff: [{ field: 'imagePullSecrets', before: '(as now)', after: `+ ${secret}` }],
    // Built at review time against the ServiceAccount as read (see withServiceAccount).
    request: { method: 'PATCH', path: `/api/v1/namespaces/${ns}/serviceaccounts/${sa}`, patchType: JSON_PATCH, body: [] },
    impact: 'No pod restarts by itself: pods get the secret when they are created, so restart the workload afterwards',
    undo: `Remove ${secret} from ServiceAccount ${sa}'s imagePullSecrets`,
    basis: why(secret),
    restarts: 0,
    watchable: false,
  }));
}

/** Fill a pull secret fix's patch from the ServiceAccount as read. */
export function withServiceAccount(fix: GuidedFix, sa: K8sResource): GuidedFix {
  const secret = fix.id.slice('pull-secret:'.length);
  const current = ((sa as { imagePullSecrets?: Array<{ name: string }> }).imagePullSecrets ?? []).map((s) => s.name);
  const ops = [...rvTest(sa), current.length
    ? { op: 'add', path: '/imagePullSecrets/-', value: { name: secret } }
    : { op: 'add', path: '/imagePullSecrets', value: [{ name: secret }] }];
  return {
    ...fix,
    diff: [{ field: 'imagePullSecrets', before: current.join(', ') || 'none', after: [...current, secret].join(', ') }],
    request: { ...fix.request, body: ops },
  };
}

function rollbackFix(inp: FixInputs, owner: K8sResource, target: FixTarget): GuidedFix | null {
  if (owner.kind !== 'Deployment' || !inp.revisions?.length) return null;
  const statuses = (inp.pod.status as Pod['status'] | undefined)?.containerStatuses ?? [];
  const failing = statuses.some((s) => s.restartCount > 0 || ['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'CreateContainerConfigError'].includes(s.state?.waiting?.reason || ''));
  if (!failing) return null;
  const current = inp.revisions.find((r) => r.current);
  const prev = [...inp.revisions].filter((r) => current && r.revision < current.revision && r.template).pop();
  if (!current || !prev || !prev.template) return null;
  const template = structuredClone(prev.template);
  if (template.metadata?.labels) {
    delete template.metadata.labels['pod-template-hash'];
    delete template.metadata.labels['controller-revision-hash'];
  }
  const ops: Array<Record<string, unknown>> = [...rvTest(owner), { op: 'replace', path: '/spec/template', value: template }];
  const changes = templateDiff(templateOf(owner), prev.template);
  return {
    id: `rollback:${prev.revision}`,
    kind: 'rollback',
    title: `Roll back Deployment ${owner.metadata.name} to revision ${prev.revision}`,
    question: `Roll back Deployment ${owner.metadata.name} to revision ${prev.revision}?`,
    target,
    diffHeader: `Deployment ${owner.metadata.name} · spec.template (revision ${current.revision} → ${prev.revision})`,
    diff: changes.map((c) => ({ field: c, before: '', after: '' })),
    request: { method: 'PATCH', path: target.apiPath, patchType: JSON_PATCH, body: ops },
    impact: rolloutImpact(owner),
    undo: `Roll back to the revision before this change (revision ${current.revision}) in Rollout History on Deployment ${owner.metadata.name}`,
    basis: `Pods of revision ${current.revision} are failing; revision ${prev.revision}${prev.replicas ? ` last had ${prev.replicas.ready} ready` : ''} is the one before it.`,
    restarts: replicasOf(owner),
    watchable: true,
  };
}

/** Every guided fix for this pod, most specific first. */
export function proposeFixes(inp: FixInputs): GuidedFix[] {
  const fixes: GuidedFix[] = [];
  const owner = inp.owner;
  const target = owner ? workloadTarget(owner) : null;
  if (owner && target) {
    for (const f of [memoryFix(inp, owner, target), startupProbeFix(inp, owner, target), cpuFix(inp, owner, target)]) if (f) fixes.push(f);
  }
  fixes.push(...pullSecretFixes(inp));
  if (owner && target) {
    const rb = rollbackFix(inp, owner, target);
    if (rb) fixes.push(rb);
  }
  return fixes;
}

/** The container a fix is about, for "Ask Pulse" prompts. */
export function fixContainer(pod: K8sResource): string | undefined {
  return primaryContainer(pod as never)?.name;
}

/** Add the change cause (kubectl's annotation) to a workload patch, so Rollout History says why. */
export function withChangeCause(fix: GuidedFix, owner: K8sResource | null, note: string): WriteRequest {
  if (!owner || fix.target.kind === 'ServiceAccount' || !Array.isArray(fix.request.body)) return fix.request;
  const cause = `Pulse: ${fix.title}${note.trim() ? ` (${note.trim()})` : ''}`;
  const op = owner.metadata.annotations
    ? { op: 'add', path: '/metadata/annotations/kubernetes.io~1change-cause', value: cause }
    : { op: 'add', path: '/metadata/annotations', value: { 'kubernetes.io/change-cause': cause } };
  return { ...fix.request, body: [...(fix.request.body as unknown[]), op] };
}

export function dryRunRequest(req: WriteRequest): WriteRequest {
  return { ...req, path: `${req.path}${req.path.includes('?') ? '&' : '?'}dryRun=All` };
}
