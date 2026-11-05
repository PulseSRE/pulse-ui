/**
 * Restarting the consumers of a ConfigMap or Secret, one at a time.
 *
 * The plan: workloads that serve no Service first, traffic-serving ones last;
 * per workload the update strategy, how many pods can be down or extra during
 * the rollout, the PodDisruptionBudgets that select its pods and whether the
 * rollout stays within them, and whether the surge pods fit the namespace's
 * ResourceQuota. A read Pulse could not make is "Could not check", never a
 * pass.
 *
 * The run: each restart is the same template annotation `oc rollout restart`
 * writes (workloadActions.rolloutRestart); Pulse waits for that rollout to
 * finish before starting the next, and stops at the first failure.
 */
import type { K8sResource } from './renderers';
import { labelSelectorMatches } from './upgradeHealth';
import { quantityToBytes } from './workloadActions';
import { podTemplateOf, type Consumer } from './configConsumers';

type IntOrPct = number | string | undefined;

/** Resolve an int-or-percent against `total` (Kubernetes rounds maxSurge up and maxUnavailable down). */
export function resolveIntOrPct(v: IntOrPct, total: number, roundUp: boolean, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'number') return v;
  const m = /^(\d+)%$/.exec(v);
  if (!m) return Number.isFinite(Number(v)) ? Number(v) : fallback;
  const raw = (Number(m[1]) / 100) * total;
  return roundUp ? Math.ceil(raw) : Math.floor(raw);
}

export interface Strategy {
  replicas: number;
  /** "rolling" or "OnDelete" (StatefulSet/DaemonSet) or "Recreate" (Deployment). */
  type: string;
  maxUnavailable: number;
  maxSurge: number;
  text: string;
}

export function strategyOf(w: K8sResource): Strategy {
  const spec = (w.spec ?? {}) as {
    replicas?: number;
    strategy?: { type?: string; rollingUpdate?: { maxUnavailable?: IntOrPct; maxSurge?: IntOrPct } };
    updateStrategy?: { type?: string; rollingUpdate?: { maxUnavailable?: IntOrPct; maxSurge?: IntOrPct; partition?: number } };
  };
  if (w.kind === 'DaemonSet') {
    const desired = (w.status as { desiredNumberScheduled?: number } | undefined)?.desiredNumberScheduled ?? 0;
    const type = spec.updateStrategy?.type ?? 'RollingUpdate';
    const ru = spec.updateStrategy?.rollingUpdate;
    const mu = resolveIntOrPct(ru?.maxUnavailable, desired, false, 1);
    const ms = resolveIntOrPct(ru?.maxSurge, desired, true, 0);
    return type === 'OnDelete'
      ? { replicas: desired, type: 'OnDelete', maxUnavailable: 0, maxSurge: 0, text: `${desired} · OnDelete: pods are replaced only when deleted` }
      : { replicas: desired, type: 'rolling', maxUnavailable: mu, maxSurge: ms, text: `${desired} · rolling node by node, maxUnavailable ${mu}${ms ? `, maxSurge ${ms}` : ''}` };
  }
  const replicas = spec.replicas ?? 1;
  if (w.kind === 'StatefulSet') {
    const type = spec.updateStrategy?.type ?? 'RollingUpdate';
    if (type === 'OnDelete') return { replicas, type: 'OnDelete', maxUnavailable: 0, maxSurge: 0, text: `${replicas} · OnDelete: pods are replaced only when deleted` };
    const ru = spec.updateStrategy?.rollingUpdate;
    const mu = resolveIntOrPct(ru?.maxUnavailable, replicas, false, 1);
    const partition = ru?.partition ? `, partition ${ru.partition} (pods below it are not restarted)` : '';
    return { replicas, type: 'rolling', maxUnavailable: Math.max(1, mu), maxSurge: 0, text: `${replicas} · rolling one ordinal at a time, highest first${partition}` };
  }
  // Deployment
  if (spec.strategy?.type === 'Recreate') {
    return { replicas, type: 'Recreate', maxUnavailable: replicas, maxSurge: 0, text: `${replicas} · Recreate: every pod stops before new ones start (downtime)` };
  }
  const ru = spec.strategy?.rollingUpdate;
  const ms = resolveIntOrPct(ru?.maxSurge ?? '25%', replicas, true, 1);
  let mu = resolveIntOrPct(ru?.maxUnavailable ?? '25%', replicas, false, 0);
  if (mu === 0 && ms === 0) mu = 1; // the API server forbids both zero; mirror its effect
  const how = mu === 0 ? `maxSurge ${ms}: new pod ready before an old one stops` : `maxUnavailable ${mu}, maxSurge ${ms}`;
  return { replicas, type: 'rolling', maxUnavailable: mu, maxSurge: ms, text: `${replicas} · rolling, ${how}` };
}

export interface PdbCheck {
  /** null: could not check. */
  text: string;
  ok: boolean | null;
}

interface Pdb { metadata: { name: string }; spec?: { selector?: { matchLabels?: Record<string, string>; matchExpressions?: Array<{ key: string; operator: string; values?: string[] }> }; minAvailable?: IntOrPct; maxUnavailable?: IntOrPct } }

/**
 * Whether the rollout keeps the pods any PDB requires. A rolling update does
 * not go through the eviction API, so a PDB does not stop it; this says
 * whether the rollout's own maxUnavailable takes more pods down than the
 * budget allows.
 */
export function pdbCheck(w: K8sResource, pdbs: K8sResource[] | null, strategy: Strategy): PdbCheck {
  if (pdbs === null) return { text: 'Could not check', ok: null };
  const labels = podTemplateOf(w)?.metadata?.labels ?? {};
  const matching = (pdbs as unknown as Pdb[]).filter((p) => labelSelectorMatches(p.spec?.selector, labels));
  if (matching.length === 0) return { text: 'none', ok: true };
  const n = strategy.replicas;
  const parts: string[] = [];
  let ok = true;
  for (const p of matching) {
    const min = p.spec?.minAvailable !== undefined
      ? resolveIntOrPct(p.spec.minAvailable, n, true, 0)
      : n - resolveIntOrPct(p.spec?.maxUnavailable, n, true, 0);
    const lowest = n - strategy.maxUnavailable;
    const fits = lowest >= min;
    ok = ok && fits;
    parts.push(`${p.metadata.name} min ${min} · ${fits ? 'compatible' : `the rollout can go down to ${Math.max(0, lowest)} available`}`);
  }
  return { text: parts.join('; '), ok };
}

/** Sum of the containers' requests of one pod (cpu in cores, memory in bytes). */
export function podRequests(w: K8sResource): { cpu: number; memory: number } {
  const containers = (podTemplateOf(w)?.spec as { containers?: Array<{ resources?: { requests?: Record<string, string> } }> } | undefined)?.containers ?? [];
  let cpu = 0;
  let memory = 0;
  for (const c of containers) {
    const r = c.resources?.requests ?? {};
    if (r.cpu) cpu += quantityToBytes(r.cpu) || 0;
    if (r.memory) memory += quantityToBytes(r.memory) || 0;
  }
  return { cpu, memory };
}

export interface QuotaCheck { text: string; ok: boolean | null }

interface Quota { metadata: { name: string }; status?: { hard?: Record<string, string>; used?: Record<string, string> } }

function fmtMem(b: number): string {
  if (b >= 2 ** 30) return `${(b / 2 ** 30).toFixed(1)}Gi`;
  return `${Math.round(b / 2 ** 20)}Mi`;
}
function fmtCpu(c: number): string { return c >= 1 ? `${Number(c.toFixed(2))} cores` : `${Math.round(c * 1000)}m`; }

/**
 * Do the surge pods of the largest rollout fit the quota? Restarts run one at
 * a time, so only one workload surges at once.
 */
export function quotaCheck(items: Array<{ workload: K8sResource; strategy: Strategy }>, quotas: K8sResource[] | null, ns: string): QuotaCheck {
  if (quotas === null) return { text: 'Could not check', ok: null };
  if (quotas.length === 0) return { text: `No ResourceQuota in ${ns}`, ok: true };
  let needCpu = 0;
  let needMem = 0;
  let needPods = 0;
  for (const { workload, strategy } of items) {
    const r = podRequests(workload);
    needCpu = Math.max(needCpu, r.cpu * strategy.maxSurge);
    needMem = Math.max(needMem, r.memory * strategy.maxSurge);
    needPods = Math.max(needPods, strategy.maxSurge);
  }
  if (needPods === 0) return { text: 'No surge pods: nothing extra is scheduled', ok: true };
  const parts: string[] = [];
  let ok = true;
  for (const q of quotas as unknown as Quota[]) {
    const hard = q.status?.hard ?? {};
    const used = q.status?.used ?? {};
    const left = (k: string) => (hard[k] !== undefined ? quantityToBytes(hard[k]) - quantityToBytes(used[k] ?? '0') : null);
    const mem = left('requests.memory') ?? left('memory');
    const cpu = left('requests.cpu') ?? left('cpu');
    const pods = left('pods');
    if (mem !== null && needMem > 0) { const f = needMem <= mem; ok = ok && f; parts.push(`memory requests: surge needs ${fmtMem(needMem)}, ${fmtMem(Math.max(0, mem))} left`); }
    if (cpu !== null && needCpu > 0) { const f = needCpu <= cpu; ok = ok && f; parts.push(`cpu requests: surge needs ${fmtCpu(needCpu)}, ${fmtCpu(Math.max(0, cpu))} left`); }
    if (pods !== null) { const f = needPods <= pods; ok = ok && f; parts.push(`pods: ${needPods} extra, ${Math.max(0, pods)} left`); }
  }
  if (parts.length === 0) return { text: 'The quota does not limit requests or pods', ok: true };
  return { text: `${parts.join('; ')}. ${ok ? 'Fits' : 'Does not fit: the surge pods would be refused'}`, ok };
}

/** Whether any Service selects the workload's pods (null: could not check). */
export function servesTraffic(w: K8sResource, services: K8sResource[] | null): string[] | null {
  if (services === null) return null;
  const labels = podTemplateOf(w)?.metadata?.labels ?? {};
  return services
    .filter((s) => {
      const sel = (s.spec as { selector?: Record<string, string> } | undefined)?.selector;
      return !!sel && Object.keys(sel).length > 0 && labelSelectorMatches({ matchLabels: sel }, labels);
    })
    .map((s) => s.metadata.name);
}

export interface PlanItem {
  workload: K8sResource;
  kind: string;
  name: string;
  strategy: Strategy;
  /** Services that select its pods; null when Services could not be read. */
  services: string[] | null;
  pdb: PdbCheck;
  /** OnDelete: the patch changes the template but replaces no pod, so Pulse leaves it out. */
  skip?: string;
}

export interface RestartPlan {
  items: PlanItem[];
  quota: QuotaCheck;
  /** Services could not be read, so the order is as listed, not by traffic. */
  orderUnknown: boolean;
}

export function buildRestartPlan(consumers: Consumer[], ns: string, services: K8sResource[] | null, pdbs: K8sResource[] | null, quotas: K8sResource[] | null): RestartPlan {
  const items: PlanItem[] = consumers.map((c) => {
    const strategy = strategyOf(c.workload);
    return {
      workload: c.workload, kind: c.kind, name: c.name, strategy,
      services: servesTraffic(c.workload, services),
      pdb: pdbCheck(c.workload, pdbs, strategy),
      skip: strategy.type === 'OnDelete' ? `${c.kind} uses the OnDelete update strategy: a restart annotation replaces no pod. Delete its pods one by one to pick up the change.` : undefined,
    };
  });
  // Stable: non-serving first, traffic-serving last.
  const rank = (i: PlanItem) => (i.services && i.services.length ? 1 : 0);
  items.sort((a, b) => rank(a) - rank(b));
  return { items, quota: quotaCheck(items.filter((i) => !i.skip), quotas, ns), orderUnknown: services === null };
}

export interface RolloutState {
  done: boolean;
  failed: string | null;
  ready: number;
  desired: number;
  text: string;
}

/** Rollout progress of a workload after its template changed (as `oc rollout status`). */
export function rolloutState(w: K8sResource): RolloutState {
  const gen = w.metadata.generation ?? 0;
  const st = (w.status ?? {}) as Record<string, unknown> & { observedGeneration?: number; conditions?: Array<{ type: string; status: string; reason?: string; message?: string }> };
  const observed = (st.observedGeneration ?? 0) >= gen;
  if (w.kind === 'Deployment') {
    const desired = (w.spec as { replicas?: number } | undefined)?.replicas ?? 1;
    const updated = (st.updatedReplicas as number | undefined) ?? 0;
    const available = (st.availableReplicas as number | undefined) ?? 0;
    const total = (st.replicas as number | undefined) ?? 0;
    const stuck = (st.conditions ?? []).find((c) => c.type === 'Progressing' && c.reason === 'ProgressDeadlineExceeded');
    if (observed && stuck) return { done: false, failed: stuck.message || 'ProgressDeadlineExceeded', ready: updated, desired, text: 'Failed: progress deadline exceeded' };
    const done = observed && updated >= desired && total === updated && available >= desired;
    return { done, failed: null, ready: Math.min(updated, available), desired, text: done ? `Done · ${desired}/${desired} ready on new values` : `Rolling · ${updated}/${desired} updated, ${available} available` };
  }
  if (w.kind === 'StatefulSet') {
    const desired = (w.spec as { replicas?: number } | undefined)?.replicas ?? 1;
    const updated = (st.updatedReplicas as number | undefined) ?? 0;
    const ready = (st.readyReplicas as number | undefined) ?? 0;
    const same = st.updateRevision !== undefined && st.updateRevision === st.currentRevision;
    const done = observed && same && updated >= desired && ready >= desired;
    return { done, failed: null, ready: Math.min(updated, ready), desired, text: done ? `Done · ${desired}/${desired} ready on new values` : `Rolling · ${updated}/${desired} updated, ${ready} ready` };
  }
  const desired = (st.desiredNumberScheduled as number | undefined) ?? 0;
  const updated = (st.updatedNumberScheduled as number | undefined) ?? 0;
  const available = (st.numberAvailable as number | undefined) ?? 0;
  const done = observed && updated >= desired && available >= desired;
  return { done, failed: null, ready: Math.min(updated, available), desired, text: done ? `Done · ${desired}/${desired} ready on new values` : `Rolling · ${updated}/${desired} nodes updated, ${available} available` };
}

export type StepStatus = 'waiting' | 'restarting' | 'rolling' | 'done' | 'failed' | 'skipped' | 'not-started';
export interface StepProgress { name: string; kind: string; status: StepStatus; text: string }

export interface RunDeps {
  patch: (item: PlanItem) => Promise<void>;
  get: (item: PlanItem) => Promise<K8sResource>;
  sleep: (ms: number) => Promise<void>;
  onUpdate: (steps: StepProgress[]) => void;
  /** True when the user asked to stop after the current workload. */
  stopRequested: () => boolean;
  /** How long one rollout may take before Pulse calls it failed. */
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
}

/** Restart each item in order; wait for its rollout; stop at the first failure. */
export async function runRestarts(items: PlanItem[], deps: RunDeps): Promise<{ ok: boolean; steps: StepProgress[] }> {
  const now = deps.now ?? Date.now;
  const timeout = deps.timeoutMs ?? 10 * 60_000;
  const poll = deps.pollMs ?? 3000;
  const steps: StepProgress[] = items.map((i) => (i.skip
    ? { name: i.name, kind: i.kind, status: 'skipped', text: 'Not restarted: OnDelete update strategy' }
    : { name: i.name, kind: i.kind, status: 'waiting', text: 'Waiting' }));
  const emit = () => deps.onUpdate(steps.map((s) => ({ ...s })));
  emit();
  const stopRest = (from: number, why: string) => {
    for (let j = from; j < steps.length; j++) if (steps[j].status === 'waiting') steps[j] = { ...steps[j], status: 'not-started', text: why };
  };
  for (let i = 0; i < items.length; i++) {
    if (items[i].skip) continue;
    if (deps.stopRequested()) { stopRest(i, 'Not restarted: you stopped the run'); emit(); return { ok: false, steps }; }
    steps[i] = { ...steps[i], status: 'restarting', text: 'Restarting' };
    emit();
    try {
      await deps.patch(items[i]);
    } catch (err) {
      steps[i] = { ...steps[i], status: 'failed', text: `Restart failed: ${err instanceof Error ? err.message : String(err)}` };
      stopRest(i + 1, 'Not restarted: an earlier restart failed');
      emit();
      return { ok: false, steps };
    }
    const start = now();
    for (;;) {
      await deps.sleep(poll);
      let state: RolloutState;
      try {
        state = rolloutState(await deps.get(items[i]));
      } catch (err) {
        steps[i] = { ...steps[i], status: 'failed', text: `Could not read the rollout: ${err instanceof Error ? err.message : String(err)}` };
        stopRest(i + 1, 'Not restarted: an earlier rollout could not be checked');
        emit();
        return { ok: false, steps };
      }
      if (state.failed) {
        steps[i] = { ...steps[i], status: 'failed', text: `Rollout failed: ${state.failed}` };
        stopRest(i + 1, 'Not restarted: an earlier rollout failed');
        emit();
        return { ok: false, steps };
      }
      if (state.done) { steps[i] = { ...steps[i], status: 'done', text: state.text }; emit(); break; }
      if (now() - start > timeout) {
        steps[i] = { ...steps[i], status: 'failed', text: `Not finished after ${Math.round(timeout / 60_000)} min (${state.text}); Pulse stopped here. The rollout continues on its own.` };
        stopRest(i + 1, 'Not restarted: an earlier rollout did not finish');
        emit();
        return { ok: false, steps };
      }
      steps[i] = { ...steps[i], status: 'rolling', text: state.text };
      emit();
    }
  }
  return { ok: true, steps };
}
