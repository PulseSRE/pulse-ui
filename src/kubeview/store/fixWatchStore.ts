/**
 * After a fix is applied from a pod or workload page, watch the rollout and
 * the new pods' restarts for 10 minutes and say whether it held.
 *
 * Held means: the rollout finished (every replica updated and available for
 * the generation the fix produced) and no new pod restarted. A restart, or a
 * rollout that stalls or does not finish in the window, means it did not hold.
 * Reads that fail are reported, and if no check succeeded the outcome is
 * unknown — never "held".
 *
 * Kept in a store, not the page: the pod the fix was applied from is replaced
 * by the rollout, so its page goes away while the watch must go on (the
 * owner's page shows the same watch).
 */
import { create } from 'zustand';
import { k8sGet, k8sList } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import type { Pod } from '../engine/types';
import { errorReason } from '../engine/readResult';

export const WATCH_MS = 10 * 60 * 1000;
export const WATCH_POLL_MS = 15 * 1000;

export type WatchStatus = 'watching' | 'held' | 'not-held' | 'unknown';

export interface FixWatch {
  key: string;
  title: string;
  kind: string;
  name: string;
  namespace: string;
  apiPath: string;
  clusterId: string;
  startedAt: number;
  until: number;
  /** metadata.generation the patch produced. */
  generation?: number;
  status: WatchStatus;
  detail: string;
  /** Last read failure, if the last check failed. */
  checkError?: string;
  checksOk: number;
}

interface Assessment { status: WatchStatus; detail: string }

/** Whether the rollout of `owner` is finished for `generation`, or why not. */
export function rolloutState(owner: K8sResource, generation?: number): { done: boolean; stalled?: string; progress: string } {
  const st = (owner.status || {}) as Record<string, unknown> & { conditions?: Array<{ type: string; status: string; reason?: string; message?: string }> };
  const observed = (st.observedGeneration as number | undefined) ?? 0;
  const gen = generation ?? owner.metadata.generation ?? 0;
  const seen = observed >= gen;
  const stalled = st.conditions?.find((c) => c.type === 'Progressing' && c.reason === 'ProgressDeadlineExceeded');
  if (owner.kind === 'DaemonSet') {
    const desired = (st.desiredNumberScheduled as number) ?? 0;
    const updated = (st.updatedNumberScheduled as number) ?? 0;
    const avail = (st.numberAvailable as number) ?? 0;
    return { done: seen && updated === desired && avail === desired, progress: `${updated}/${desired} updated, ${avail} available` };
  }
  const want = ((owner.spec as { replicas?: number } | undefined)?.replicas) ?? 1;
  const updated = (st.updatedReplicas as number) ?? 0;
  const avail = ((owner.kind === 'StatefulSet' ? st.readyReplicas : st.availableReplicas) as number | undefined) ?? 0;
  const total = (st.replicas as number) ?? 0;
  const sameRev = owner.kind !== 'StatefulSet' || st.currentRevision === st.updateRevision;
  return {
    done: seen && updated === want && avail === want && total === want && sameRev,
    stalled: stalled ? (stalled.message || 'progress deadline exceeded') : undefined,
    progress: `${updated}/${want} updated, ${avail} available`,
  };
}

/** Restarts among pods created after `since` (the pods the fix produced). */
export function newPodRestarts(pods: K8sResource[], since: number): { pod: string; restarts: number; reason?: string } | null {
  for (const p of pods) {
    const created = new Date(p.metadata.creationTimestamp || 0).getTime();
    if (created < since - 5000) continue;
    for (const cs of (p.status as Pod['status'] | undefined)?.containerStatuses ?? []) {
      if ((cs.restartCount ?? 0) > 0) return { pod: p.metadata.name, restarts: cs.restartCount, reason: cs.lastState?.terminated?.reason };
    }
  }
  return null;
}

export function assessWatch(w: Pick<FixWatch, 'startedAt' | 'until' | 'generation' | 'checksOk'>, owner: K8sResource, pods: K8sResource[], now: number): Assessment {
  const restart = newPodRestarts(pods, w.startedAt);
  if (restart) {
    return { status: 'not-held', detail: `Did not hold: pod ${restart.pod} restarted${restart.reason ? ` (${restart.reason})` : ''} after the fix.` };
  }
  const r = rolloutState(owner, w.generation);
  if (r.stalled) return { status: 'not-held', detail: `Did not hold: the rollout stalled (${r.stalled}).` };
  if (now >= w.until) {
    return r.done
      ? { status: 'held', detail: 'Held: the rollout finished and no new pod restarted in 10 minutes.' }
      : { status: 'not-held', detail: `Did not hold: the rollout did not finish in 10 minutes (${r.progress}).` };
  }
  const left = Math.max(0, Math.ceil((w.until - now) / 60000));
  return { status: 'watching', detail: `${r.done ? 'Rollout finished' : `Rolling out: ${r.progress}`}; no restarts so far. ${left} min left.` };
}

interface FixWatchState {
  watches: Record<string, FixWatch>;
  start: (w: Omit<FixWatch, 'key' | 'startedAt' | 'until' | 'status' | 'detail' | 'checksOk'>) => void;
  check: (key: string) => Promise<void>;
  dismiss: (key: string) => void;
}

const timers = new Map<string, ReturnType<typeof setInterval>>();

function selectorPath(owner: K8sResource): string | null {
  const labels = (owner.spec as { selector?: { matchLabels?: Record<string, string> } } | undefined)?.selector?.matchLabels;
  if (!labels || !owner.metadata.namespace) return null;
  const sel = Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(',');
  return `/api/v1/namespaces/${owner.metadata.namespace}/pods?labelSelector=${encodeURIComponent(sel)}`;
}

export const useFixWatchStore = create<FixWatchState>()((set, get) => ({
  watches: {},
  start: (input) => {
    const key = `${input.clusterId}|${input.apiPath}`;
    const now = Date.now();
    const w: FixWatch = { ...input, key, startedAt: now, until: now + WATCH_MS, status: 'watching', detail: 'Watching the rollout and the new pods for 10 minutes.', checksOk: 0 };
    const old = timers.get(key);
    if (old) clearInterval(old);
    set((s) => ({ watches: { ...s.watches, [key]: w } }));
    timers.set(key, setInterval(() => { void get().check(key); }, WATCH_POLL_MS));
    void get().check(key);
  },
  check: async (key) => {
    const w = get().watches[key];
    if (!w || w.status !== 'watching') return;
    const now = Date.now();
    let next: Partial<FixWatch>;
    try {
      const owner = await k8sGet<K8sResource>(w.apiPath, w.clusterId);
      const path = selectorPath(owner);
      const pods = path ? await k8sList<K8sResource>(path, undefined, w.clusterId) : [];
      const a = assessWatch(w, owner, pods, now);
      next = { ...a, checkError: undefined, checksOk: w.checksOk + 1 };
    } catch (e) {
      const reason = errorReason(e);
      next = now >= w.until
        ? (w.checksOk === 0
          ? { status: 'unknown', detail: `Unknown: the rollout could not be read (${reason}).`, checkError: reason }
          : { status: 'unknown', detail: `Unknown: the last check could not read the rollout (${reason}).`, checkError: reason })
        : { checkError: reason };
    }
    set((s) => (s.watches[key] ? { watches: { ...s.watches, [key]: { ...s.watches[key], ...next } } } : s));
    const after = get().watches[key];
    if (after && after.status !== 'watching') {
      const t = timers.get(key);
      if (t) clearInterval(t);
      timers.delete(key);
    }
  },
  dismiss: (key) => {
    const t = timers.get(key);
    if (t) clearInterval(t);
    timers.delete(key);
    set((s) => {
      const { [key]: _gone, ...rest } = s.watches;
      return { watches: rest };
    });
  },
}));
