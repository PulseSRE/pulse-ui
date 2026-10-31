/**
 * Node and pod actions shared by the node table, the node hex map and the
 * node detail page.
 *
 * "Drain" used to cordon the node and stop: the toast said "Drain started"
 * while every pod stayed where it was. A drain here does what `oc adm drain`
 * does for the pods it can move: cordon, then evict each pod through the
 * Eviction API so PodDisruptionBudgets are honoured. DaemonSet pods (their
 * controller would put them straight back) and mirror pods (owned by the
 * kubelet, not the API) are skipped. A 429 means a PDB blocked the eviction;
 * the pod is reported as blocked with the budget that blocked it, and the
 * caller can retry just those pods or stop.
 */
import { k8sCreate, k8sGet, k8sList, k8sPatch } from './query';
import { PulseError } from './errors';
import { terminalTargets, defaultTerminalTarget } from './terminalTargets';
import { useUIStore } from '../store/uiStore';
import type { Pod } from './types';

export const nodePath = (name: string) => `/api/v1/nodes/${encodeURIComponent(name)}`;

/** Cordon (true) or uncordon (false) a node. */
export function setNodeSchedulable(name: string, schedulable: boolean, clusterId?: string) {
  return k8sPatch(nodePath(name), { spec: { unschedulable: !schedulable } }, 'application/strategic-merge-patch+json', clusterId);
}

interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: Array<{ key: string; operator: string; values?: string[] }>;
}

interface PodDisruptionBudget {
  metadata: { name: string; namespace?: string };
  spec?: { selector?: LabelSelector };
  status?: { disruptionsAllowed?: number; currentHealthy?: number; desiredHealthy?: number };
}

/** True when a label selector matches a set of labels (empty selector matches all). */
export function selectorMatches(selector: LabelSelector | undefined, labels: Record<string, string> = {}): boolean {
  if (!selector) return false;
  for (const [k, v] of Object.entries(selector.matchLabels ?? {})) {
    if (labels[k] !== v) return false;
  }
  for (const e of selector.matchExpressions ?? []) {
    const has = Object.prototype.hasOwnProperty.call(labels, e.key);
    const values = e.values ?? [];
    switch (e.operator) {
      case 'In': if (!has || !values.includes(labels[e.key])) return false; break;
      case 'NotIn': if (has && values.includes(labels[e.key])) return false; break;
      case 'Exists': if (!has) return false; break;
      case 'DoesNotExist': if (has) return false; break;
      default: return false;
    }
  }
  return true;
}


export interface DrainPodState {
  namespace: string;
  name: string;
  uid?: string;
  /**
   * `terminating`: the eviction was accepted but the pod still exists.
   * `evicted`: the pod is gone.
   */
  status: 'pending' | 'evicting' | 'terminating' | 'evicted' | 'blocked' | 'failed' | 'skipped';
  /** Why the pod was skipped, blocked or failed. */
  reason?: string;
  /** For a blocked pod: the PodDisruptionBudget(s) that blocked it. */
  pdbs?: string[];
  /** Pod no controller owns: evicting it deletes it for good. */
  unmanaged?: boolean;
  /** Pod with emptyDir volumes: evicting it loses their data. */
  emptyDir?: boolean;
}

export interface DrainOptions {
  /** Also evict pods no controller owns (like `oc adm drain --force`). */
  force?: boolean;
  /** Also evict pods with emptyDir volumes (like `--delete-emptydir-data`). */
  deleteEmptyDirData?: boolean;
}

export interface DrainResult {
  node: string;
  cordoned: boolean;
  pods: DrainPodState[];
  evicted: number;
  terminating: number;
  blocked: number;
  failed: number;
  skipped: number;
}

function isMirrorPod(pod: Pod): boolean {
  return !!pod.metadata.annotations?.['kubernetes.io/config.mirror'];
}

function isDaemonSetPod(pod: Pod): boolean {
  return (pod.metadata.ownerReferences ?? []).some((o) => o.kind === 'DaemonSet' && o.controller !== false);
}

function isUnmanagedPod(pod: Pod): boolean {
  return (pod.metadata.ownerReferences ?? []).length === 0;
}

function hasEmptyDir(pod: Pod): boolean {
  const volumes = (pod.spec as { volumes?: Array<{ emptyDir?: unknown }> } | undefined)?.volumes ?? [];
  return volumes.some((v) => v.emptyDir !== undefined && v.emptyDir !== null);
}

/**
 * Split a node's pods into the ones a drain evicts and the ones it leaves.
 * Like `oc adm drain`, a pod no controller owns (it would not come back) and a
 * pod with emptyDir data (the data would be lost) are left in place unless
 * the caller opts in.
 */
export function classifyPodsForDrain(pods: Pod[], opts: DrainOptions = {}): DrainPodState[] {
  return pods.map((pod) => {
    const base = { namespace: pod.metadata.namespace || 'default', name: pod.metadata.name, uid: pod.metadata.uid };
    if (isMirrorPod(pod)) return { ...base, status: 'skipped', reason: 'Mirror (static) pod, managed by the kubelet' };
    if (isDaemonSetPod(pod)) return { ...base, status: 'skipped', reason: 'DaemonSet pod; its controller would recreate it on this node' };
    const unmanaged = isUnmanagedPod(pod);
    const emptyDir = hasEmptyDir(pod);
    const flags = { ...(unmanaged ? { unmanaged } : {}), ...(emptyDir ? { emptyDir } : {}) };
    if (unmanaged && !opts.force) {
      return { ...base, ...flags, status: 'skipped', reason: 'Not managed by a controller: evicting deletes it for good' };
    }
    if (emptyDir && !opts.deleteEmptyDirData) {
      return { ...base, ...flags, status: 'skipped', reason: 'Uses emptyDir volumes: their data would be lost' };
    }
    return { ...base, ...flags, status: 'pending' };
  });
}

/** Fetch the pods scheduled on a node. */
export function listNodePods(node: string, clusterId?: string) {
  return k8sList<Pod>(`/api/v1/pods?fieldSelector=${encodeURIComponent(`spec.nodeName=${node}`)}`, undefined, clusterId);
}

async function blockingPdbs(pod: { namespace: string; name: string }, clusterId?: string): Promise<string[]> {
  try {
    const [full, pdbs] = await Promise.all([
      k8sGet<Pod>(`/api/v1/namespaces/${pod.namespace}/pods/${pod.name}`, clusterId),
      k8sList<PodDisruptionBudget>(`/apis/policy/v1/namespaces/${pod.namespace}/poddisruptionbudgets`, undefined, clusterId),
    ]);
    const labels = (full.metadata.labels ?? {}) as Record<string, string>;
    return pdbs.filter((p) => selectorMatches(p.spec?.selector, labels)).map((p) => p.metadata.name);
  } catch {
    return [];
  }
}

/**
 * Evict one pod. Resolves to its new state; never throws. An accepted
 * eviction is `terminating`, not `evicted`: the pod still exists until its
 * grace period and finalizers are done.
 */
export async function evictPod(pod: { namespace: string; name: string; uid?: string }, clusterId?: string): Promise<DrainPodState> {
  const base = { namespace: pod.namespace, name: pod.name, uid: pod.uid };
  try {
    await k8sCreate(`/api/v1/namespaces/${pod.namespace}/pods/${pod.name}/eviction`, {
      apiVersion: 'policy/v1',
      kind: 'Eviction',
      metadata: { name: pod.name, namespace: pod.namespace },
    }, clusterId);
    return { ...base, status: 'terminating' };
  } catch (err) {
    const status = err instanceof PulseError ? err.statusCode : 0;
    // Already gone: nothing left to move.
    if (status === 404) return { ...base, status: 'evicted', reason: 'Already deleted' };
    if (status === 429) {
      const pdbs = await blockingPdbs(pod, clusterId);
      const reason = pdbs.length
        ? `Blocked by PodDisruptionBudget ${pdbs.join(', ')}`
        : (err instanceof Error ? err.message : 'Blocked by a PodDisruptionBudget');
      return { ...base, status: 'blocked', reason, pdbs };
    }
    return { ...base, status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

/** True once the pod is gone (404, or the name now belongs to a new pod). */
async function podGone(pod: DrainPodState, clusterId?: string): Promise<boolean> {
  try {
    const current = await k8sGet<Pod>(`/api/v1/namespaces/${pod.namespace}/pods/${pod.name}`, clusterId);
    return !!pod.uid && !!current?.metadata?.uid && current.metadata.uid !== pod.uid;
  } catch (err) {
    return err instanceof PulseError && err.statusCode === 404;
  }
}

export function summarize(node: string, cordoned: boolean, pods: DrainPodState[]): DrainResult {
  const count = (s: DrainPodState['status']) => pods.filter((p) => p.status === s).length;
  return {
    node, cordoned, pods,
    evicted: count('evicted'), terminating: count('terminating'),
    blocked: count('blocked'), failed: count('failed'), skipped: count('skipped'),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cordon a node and evict its pods, then wait (up to `timeoutMs`, cancellable)
 * until each evicted pod is actually gone. `onProgress` gets the full pod list
 * after each change. Pass `only` to retry a subset (e.g. the pods a PDB
 * blocked). Cordoning failing stops the drain: evicting from a node that still
 * takes new pods would just move them back.
 */
export async function drainNode(
  node: string,
  clusterId: string | undefined,
  opts: DrainOptions & {
    onProgress?: (pods: DrainPodState[]) => void;
    only?: Array<{ namespace: string; name: string; uid?: string }>;
    signal?: { cancelled: boolean };
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<DrainResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const pollMs = opts.pollMs ?? 2000;
  await setNodeSchedulable(node, false, clusterId);

  let pods: DrainPodState[];
  if (opts.only) {
    pods = opts.only.map((p) => ({ namespace: p.namespace, name: p.name, uid: p.uid, status: 'pending' as const }));
  } else {
    pods = classifyPodsForDrain(await listNodePods(node, clusterId), opts);
  }
  const update = (i: number, next: DrainPodState) => {
    pods = pods.map((p, j) => (j === i ? next : p));
    opts.onProgress?.(pods);
  };
  opts.onProgress?.(pods);

  for (let i = 0; i < pods.length; i++) {
    if (pods[i].status !== 'pending') continue;
    if (opts.signal?.cancelled) break;
    update(i, { ...pods[i], status: 'evicting' });
    update(i, { ...pods[i], ...(await evictPod(pods[i], clusterId)) });
  }

  // An accepted eviction is not a moved pod. Wait for each to disappear.
  const deadline = Date.now() + timeoutMs;
  while (pods.some((p) => p.status === 'terminating') && !opts.signal?.cancelled && Date.now() < deadline) {
    for (let i = 0; i < pods.length; i++) {
      if (pods[i].status !== 'terminating') continue;
      if (await podGone(pods[i], clusterId)) update(i, { ...pods[i], status: 'evicted' });
    }
    if (pods.some((p) => p.status === 'terminating')) await sleep(pollMs);
  }
  return summarize(node, true, pods);
}

/** One-line outcome of a drain, for a toast. Never claims pods moved when none did. */
export function describeDrain(r: DrainResult): { type: 'success' | 'warning' | 'error'; title: string; detail: string } {
  const parts: string[] = [];
  if (r.evicted) parts.push(`${r.evicted} evicted`);
  if (r.terminating) parts.push(`${r.terminating} still terminating`);
  if (r.blocked) parts.push(`${r.blocked} blocked by a PodDisruptionBudget`);
  if (r.failed) parts.push(`${r.failed} failed`);
  if (r.skipped) parts.push(`${r.skipped} left on the node`);
  const pending = r.pods.filter((p) => p.status === 'pending').length;
  if (pending) parts.push(`${pending} not attempted`);
  const detail = parts.length ? parts.join(', ') : 'No pods needed to be evicted.';
  if (r.blocked || r.failed || pending) {
    return { type: 'warning', title: `Node "${r.node}" cordoned; drain incomplete`, detail };
  }
  if (r.terminating) {
    return { type: 'warning', title: `Node "${r.node}" cordoned; evictions accepted, ${r.terminating} pod${r.terminating === 1 ? '' : 's'} still terminating`, detail };
  }
  if (r.evicted === 0) return { type: 'success', title: `Node "${r.node}" cordoned; nothing to evict`, detail };
  return { type: 'success', title: `Node "${r.node}" drained`, detail };
}

/**
 * Open a terminal on a node. A node has no shell of its own: this attaches to
 * the node's running debug pod (created by Debug on the node page), or says
 * there is none.
 */
export async function openNodeTerminal(node: string, clusterId: string | undefined): Promise<boolean> {
  const { addToast, openTerminal } = useUIStore.getState();
  const pods = await k8sList<Pod>(
    `/api/v1/namespaces/default/pods?labelSelector=${encodeURIComponent(`openshiftpulse/debug-node=${node}`)}`,
    undefined,
    clusterId,
  );
  const live = pods.find((p) => p.status?.phase === 'Running');
  if (!live) {
    addToast({
      type: 'warning',
      title: 'No debug pod on this node',
      detail: 'Use Debug on the node page to start a privileged debug pod on the node, then open the terminal.',
    });
    return false;
  }
  openTerminal({ clusterId, namespace: 'default', podName: live.metadata.name, containerName: 'debug', isNode: true });
  return true;
}

/** Open a terminal in a pod, choosing its default container. */
export async function openPodTerminal(namespace: string, name: string, clusterId: string | undefined): Promise<void> {
  const pod = await k8sGet<Pod>(`/api/v1/namespaces/${namespace}/pods/${name}`, clusterId);
  const targets = terminalTargets(pod);
  useUIStore.getState().openTerminal({
    clusterId,
    namespace,
    podName: name,
    containerName: defaultTerminalTarget(targets),
    containers: targets,
  });
}
