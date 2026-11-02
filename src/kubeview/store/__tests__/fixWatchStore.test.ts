/** After a fix: watch the rollout and new pods for 10 minutes and say whether it held. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const k8sGet = vi.fn();
const k8sList = vi.fn();
vi.mock('../../engine/query', async (orig) => ({ ...(await orig<object>()), k8sGet: (...a: unknown[]) => k8sGet(...a), k8sList: (...a: unknown[]) => k8sList(...a) }));

import { useFixWatchStore, assessWatch, WATCH_MS, WATCH_POLL_MS } from '../fixWatchStore';

const T0 = Date.parse('2026-11-02T15:00:00Z');
function deploy(status: Record<string, unknown>, generation = 15) {
  return { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'api', namespace: 'payments', generation }, spec: { replicas: 3, selector: { matchLabels: { app: 'api' } } }, status: { observedGeneration: generation, replicas: 3, ...status } };
}
const done = deploy({ updatedReplicas: 3, availableReplicas: 3 });
const rolling = deploy({ updatedReplicas: 1, availableReplicas: 2 });
function newPod(restarts: number, at = T0 + 30_000) {
  return { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'api-new-1', creationTimestamp: new Date(at).toISOString() }, status: { containerStatuses: [{ name: 'api', ready: restarts === 0, restartCount: restarts, lastState: restarts ? { terminated: { reason: 'OOMKilled' } } : {} }] } };
}

describe('assessWatch', () => {
  const w = { startedAt: T0, until: T0 + WATCH_MS, generation: 15, checksOk: 1 };
  it('held: finished rollout and no restarts at the end of the window', () => {
    expect(assessWatch(w, done as never, [newPod(0)] as never, T0 + WATCH_MS).status).toBe('held');
  });
  it('not held: a new pod restarted', () => {
    const a = assessWatch(w, done as never, [newPod(2)] as never, T0 + 60_000);
    expect(a).toEqual({ status: 'not-held', detail: 'Did not hold: pod api-new-1 restarted (OOMKilled) after the fix.' });
  });
  it('restarts of old pods do not count', () => {
    expect(assessWatch(w, rolling as never, [newPod(4, T0 - 3_600_000)] as never, T0 + 60_000).status).toBe('watching');
  });
  it('not held: the rollout did not finish in 10 minutes', () => {
    expect(assessWatch(w, rolling as never, [] as never, T0 + WATCH_MS).detail).toMatch(/did not finish in 10 minutes \(1\/3 updated, 2 available\)/);
  });
  it('not held: progress deadline exceeded', () => {
    const stalled = deploy({ updatedReplicas: 1, conditions: [{ type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded', message: 'ReplicaSet api-x has timed out progressing.' }] });
    expect(assessWatch(w, stalled as never, [] as never, T0 + 60_000).status).toBe('not-held');
  });
  it('an old generation is not a finished rollout', () => {
    expect(assessWatch(w, deploy({ updatedReplicas: 3, availableReplicas: 3, observedGeneration: 14 }) as never, [], T0 + WATCH_MS).status).toBe('not-held');
  });
});

describe('useFixWatchStore', () => {
  const input = { title: 'Raise memory', kind: 'Deployment', name: 'api', namespace: 'payments', apiPath: '/apis/apps/v1/namespaces/payments/deployments/api', clusterId: 'local', generation: 15 };
  const key = 'local|/apis/apps/v1/namespaces/payments/deployments/api';
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); vi.clearAllMocks(); });
  afterEach(() => { useFixWatchStore.getState().dismiss(key); vi.useRealTimers(); });

  async function runFor(ms: number) {
    for (let t = 0; t < ms; t += WATCH_POLL_MS) await vi.advanceTimersByTimeAsync(WATCH_POLL_MS);
  }

  it('says it held after 10 quiet minutes, reading the pinned cluster', async () => {
    k8sGet.mockResolvedValue(done);
    k8sList.mockResolvedValue([newPod(0)]);
    useFixWatchStore.getState().start(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(useFixWatchStore.getState().watches[key].status).toBe('watching');
    await runFor(WATCH_MS);
    expect(useFixWatchStore.getState().watches[key].status).toBe('held');
    expect(k8sGet).toHaveBeenCalledWith(input.apiPath, 'local');
    expect(k8sList).toHaveBeenCalledWith(`/api/v1/namespaces/payments/pods?labelSelector=${encodeURIComponent('app=api')}`, undefined, 'local');
  });

  it('says it did not hold as soon as a new pod restarts, and stops polling', async () => {
    k8sGet.mockResolvedValue(rolling);
    k8sList.mockResolvedValueOnce([newPod(0)]).mockResolvedValue([newPod(1)]);
    useFixWatchStore.getState().start(input);
    await runFor(WATCH_POLL_MS * 2);
    expect(useFixWatchStore.getState().watches[key].status).toBe('not-held');
    const calls = k8sGet.mock.calls.length;
    await runFor(WATCH_POLL_MS * 4);
    expect(k8sGet.mock.calls.length).toBe(calls);
  });

  it('reads that always fail end as unknown, never held', async () => {
    k8sGet.mockRejectedValue(Object.assign(new Error('forbidden'), { statusCode: 403 }));
    useFixWatchStore.getState().start(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(useFixWatchStore.getState().watches[key].checkError).toBe('Permission denied (403)');
    await runFor(WATCH_MS);
    expect(useFixWatchStore.getState().watches[key]).toMatchObject({ status: 'unknown', detail: 'Unknown: the rollout could not be read (Permission denied (403)).' });
  });

  it('an owner selected by matchExpressions ends unknown, never held', async () => {
    const expr = { ...done, spec: { replicas: 3, selector: { matchLabels: { app: 'api' }, matchExpressions: [{ key: 'tier', operator: 'In', values: ['web'] }] } } };
    k8sGet.mockResolvedValue(expr);
    useFixWatchStore.getState().start(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(useFixWatchStore.getState().watches[key].status).toBe('unknown');
    expect(useFixWatchStore.getState().watches[key].detail).toMatch(/no label selector Pulse can list its pods by/);
    expect(k8sList).not.toHaveBeenCalled();
  });
});
