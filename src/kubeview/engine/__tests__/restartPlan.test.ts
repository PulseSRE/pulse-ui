/**
 * Restart plan: order (non-serving first), strategy, PDB and quota checks
 * (unknown reads are "Could not check", never a pass), and the sequential run
 * that stops at the first failure.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildRestartPlan, pdbCheck, quotaCheck, resolveIntOrPct, rolloutState, runRestarts, strategyOf, type PlanItem } from '../restartPlan';
import { findConsumers } from '../configConsumers';
import type { K8sResource } from '../renderers';

const dep = (name: string, replicas: number, extra: object = {}, mem = '256Mi') => ({
  apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name, namespace: 'payments', generation: 2 },
  spec: {
    replicas,
    selector: { matchLabels: { app: name } },
    template: { metadata: { labels: { app: name } }, spec: { containers: [{ name, resources: { requests: { memory: mem, cpu: '100m' } }, envFrom: [{ configMapRef: { name: 'api-cfg' } }] }] } },
    ...extra,
  },
}) as unknown as K8sResource;

const sts = (name: string, type?: string) => ({
  apiVersion: 'apps/v1', kind: 'StatefulSet', metadata: { name, namespace: 'payments' },
  spec: { replicas: 2, updateStrategy: type ? { type } : undefined, template: { metadata: { labels: { app: name } }, spec: { containers: [{ name, envFrom: [{ configMapRef: { name: 'api-cfg' } }] }] } } },
}) as unknown as K8sResource;

const svc = (name: string, app: string) => ({ kind: 'Service', metadata: { name }, spec: { selector: { app } } }) as unknown as K8sResource;
const pdb = (name: string, app: string, minAvailable: number | string) => ({ kind: 'PodDisruptionBudget', metadata: { name }, spec: { selector: { matchLabels: { app } }, minAvailable } }) as unknown as K8sResource;

describe('resolveIntOrPct', () => {
  it('rounds maxSurge up and maxUnavailable down, like the controller', () => {
    expect(resolveIntOrPct('25%', 3, true, 0)).toBe(1);
    expect(resolveIntOrPct('25%', 3, false, 0)).toBe(0);
    expect(resolveIntOrPct(2, 3, false, 0)).toBe(2);
    expect(resolveIntOrPct(undefined, 3, false, 7)).toBe(7);
  });
});

describe('strategyOf', () => {
  it('Deployment defaults (25%/25%), Recreate, StatefulSet OnDelete', () => {
    expect(strategyOf(dep('api', 4))).toMatchObject({ type: 'rolling', maxUnavailable: 1, maxSurge: 1 });
    expect(strategyOf(dep('api', 3, { strategy: { type: 'Recreate' } }))).toMatchObject({ type: 'Recreate', maxUnavailable: 3 });
    expect(strategyOf(sts('db', 'OnDelete')).type).toBe('OnDelete');
    expect(strategyOf(sts('db')).text).toMatch(/one ordinal at a time/);
  });
});

describe('pdbCheck', () => {
  it('compatible when the rollout keeps the budget; flagged when it can go below it; unknown when unreadable', () => {
    const api = dep('api', 3, { strategy: { rollingUpdate: { maxUnavailable: 1, maxSurge: 1 } } });
    const s = strategyOf(api);
    expect(pdbCheck(api, [pdb('api-pdb', 'api', 2)], s)).toEqual({ text: 'api-pdb min 2 · compatible', ok: true });
    expect(pdbCheck(api, [pdb('api-pdb', 'api', 3)], s).ok).toBe(false);
    expect(pdbCheck(api, [], s)).toEqual({ text: 'none', ok: true });
    expect(pdbCheck(api, null, s)).toEqual({ text: 'Could not check', ok: null });
  });
});

describe('quotaCheck', () => {
  const quota = (hardMem: string, usedMem: string) => ({ metadata: { name: 'q' }, status: { hard: { 'requests.memory': hardMem }, used: { 'requests.memory': usedMem } } }) as unknown as K8sResource;
  it('fits, does not fit, none, could not check', () => {
    const items = [{ workload: dep('api', 4, {}, '320Mi'), strategy: strategyOf(dep('api', 4)) }];
    expect(quotaCheck(items, [quota('2Gi', '1328Mi')], 'payments')).toMatchObject({ ok: true });
    expect(quotaCheck(items, [quota('2Gi', '1900Mi')], 'payments')).toMatchObject({ ok: false });
    expect(quotaCheck(items, [], 'payments')).toEqual({ text: 'No ResourceQuota in payments', ok: true });
    expect(quotaCheck(items, null, 'payments')).toEqual({ text: 'Could not check', ok: null });
  });
});

describe('buildRestartPlan', () => {
  it('non-serving first, traffic-serving last; OnDelete StatefulSets are left out with the reason', () => {
    const consumers = findConsumers('ConfigMap', 'api-cfg', [dep('api', 3), dep('worker', 2), sts('db', 'OnDelete')]);
    const plan = buildRestartPlan(consumers, 'payments', [svc('api', 'api')], [], []);
    expect(plan.items.map((i) => i.name)).toEqual(['worker', 'db', 'api']);
    expect(plan.items.find((i) => i.name === 'api')!.services).toEqual(['api']);
    expect(plan.items.find((i) => i.name === 'db')!.skip).toMatch(/OnDelete/);
    expect(plan.orderUnknown).toBe(false);
  });

  it('says the order is unknown when Services could not be read', () => {
    const plan = buildRestartPlan(findConsumers('ConfigMap', 'api-cfg', [dep('api', 3)]), 'payments', null, null, null);
    expect(plan.orderUnknown).toBe(true);
    expect(plan.items[0].services).toBeNull();
    expect(plan.items[0].pdb.text).toBe('Could not check');
    expect(plan.quota.text).toBe('Could not check');
  });
});

describe('rolloutState', () => {
  const at = (status: object, generation = 2) => ({ ...dep('api', 2), metadata: { name: 'api', generation }, status }) as unknown as K8sResource;
  it('done only when the new generation is observed and every replica is updated and available', () => {
    expect(rolloutState(at({ observedGeneration: 1, updatedReplicas: 2, availableReplicas: 2, replicas: 2 })).done).toBe(false);
    expect(rolloutState(at({ observedGeneration: 2, updatedReplicas: 1, availableReplicas: 2, replicas: 3 })).done).toBe(false);
    expect(rolloutState(at({ observedGeneration: 2, updatedReplicas: 2, availableReplicas: 2, replicas: 2 })).done).toBe(true);
    expect(rolloutState(at({ observedGeneration: 2, conditions: [{ type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded', message: 'timed out' }] })).failed).toBe('timed out');
  });
});

describe('runRestarts', () => {
  const item = (name: string, skip?: string) => ({ workload: dep(name, 1), kind: 'Deployment', name, skip } as unknown as PlanItem);
  const done = { observedGeneration: 2, updatedReplicas: 1, availableReplicas: 1, replicas: 1 };
  const base = { sleep: async () => {}, stopRequested: () => false, onUpdate: () => {} };

  it('restarts in order, waiting for each rollout, and skips OnDelete', async () => {
    const order: string[] = [];
    const res = await runRestarts([item('worker'), item('db', 'OnDelete'), item('api')], {
      ...base,
      patch: async (i) => { order.push(`patch ${i.name}`); },
      get: async (i) => { order.push(`get ${i.name}`); return { ...i.workload, status: done } as K8sResource; },
    });
    expect(res.ok).toBe(true);
    expect(order).toEqual(['patch worker', 'get worker', 'patch api', 'get api']);
    expect(res.steps.map((s) => s.status)).toEqual(['done', 'skipped', 'done']);
  });

  it('stops at the first failed write; the rest are not started', async () => {
    const patch = vi.fn(async (i: PlanItem) => { if (i.name === 'worker') throw new Error('Permission denied'); });
    const res = await runRestarts([item('worker'), item('api')], { ...base, patch, get: async (i) => ({ ...i.workload, status: done }) as K8sResource });
    expect(res.ok).toBe(false);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(res.steps[0]).toMatchObject({ status: 'failed', text: 'Restart failed: Permission denied' });
    expect(res.steps[1]).toMatchObject({ status: 'not-started' });
  });

  it('stops when a rollout fails or times out, and when the user asks to stop', async () => {
    const stuck = { observedGeneration: 2, conditions: [{ type: 'Progressing', reason: 'ProgressDeadlineExceeded', message: 'deadline' }] };
    const failed = await runRestarts([item('worker'), item('api')], { ...base, patch: async () => {}, get: async (i) => ({ ...i.workload, status: stuck }) as K8sResource });
    expect(failed.steps.map((s) => s.status)).toEqual(['failed', 'not-started']);

    let t = 0;
    const slow = await runRestarts([item('worker')], { ...base, patch: async () => {}, now: () => (t += 60_000), timeoutMs: 120_000, get: async (i) => ({ ...i.workload, status: { observedGeneration: 2 } }) as K8sResource });
    expect(slow.steps[0].status).toBe('failed');
    expect(slow.steps[0].text).toMatch(/Not finished after 2 min/);

    let stop = false;
    const patch = vi.fn(async () => { stop = true; });
    const stopped = await runRestarts([item('worker'), item('api')], { ...base, stopRequested: () => stop, patch, get: async (i) => ({ ...i.workload, status: done }) as K8sResource });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(stopped.steps.map((s) => s.status)).toEqual(['done', 'not-started']);
  });
});

describe('review follow-ups', () => {
  it('a StatefulSet with a partition is done once the pods at and above it are updated', () => {
    const s = { kind: 'StatefulSet', metadata: { name: 'db', generation: 4 }, spec: { replicas: 5, updateStrategy: { rollingUpdate: { partition: 3 } } },
      status: { observedGeneration: 4, updatedReplicas: 2, readyReplicas: 5, currentRevision: 'a', updateRevision: 'b' } } as unknown as K8sResource;
    expect(rolloutState(s)).toMatchObject({ done: true, desired: 2 });
    expect(rolloutState({ ...s, status: { ...(s.status as object), updatedReplicas: 1 } } as K8sResource).done).toBe(false);
  });

  it('a paused Deployment is left out with the reason', () => {
    const paused = dep('api', 2, { paused: true });
    const plan = buildRestartPlan(findConsumers('ConfigMap', 'api-cfg', [paused]), 'payments', [], [], []);
    expect(plan.items[0].skip).toMatch(/paused/);
  });

  it('limits.* quotas are counted', () => {
    const w = dep('api', 4);
    ((w.spec as any).template.spec.containers[0].resources).limits = { memory: '1Gi' };
    const q = { metadata: { name: 'q' }, status: { hard: { 'limits.memory': '2Gi' }, used: { 'limits.memory': '1536Mi' } } } as unknown as K8sResource;
    const res = quotaCheck([{ workload: w, strategy: strategyOf(w) }], [q], 'payments');
    expect(res.ok).toBe(false);
    expect(res.text).toMatch(/memory limits: surge needs 1\.0Gi, 512Mi left/);
  });

  it('aborted (dialog closed) stops mid-rollout and starts nothing else', async () => {
    let gone = false;
    const patch = vi.fn(async () => {});
    const res = await runRestarts([
      { workload: dep('worker', 1), kind: 'Deployment', name: 'worker' } as unknown as PlanItem,
      { workload: dep('api', 1), kind: 'Deployment', name: 'api' } as unknown as PlanItem,
    ], {
      patch, sleep: async () => { gone = true; }, stopRequested: () => false, aborted: () => gone, onUpdate: () => {},
      get: async (i) => ({ ...i.workload, status: { observedGeneration: 2 } }) as K8sResource,
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(res.steps.map((s) => s.status)).toEqual(['failed', 'not-started']);
    expect(res.steps[0].text).toMatch(/stopped watching/);
  });
});
