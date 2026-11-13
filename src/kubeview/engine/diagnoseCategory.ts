/**
 * The kind of problem a page's Diagnose asks about, sent to the agent as the
 * inbox item's `metadata.category_hint` so it runs the monitor's plan template
 * for it (pulse-agent: `inbox_investigation.PLAN_CATEGORY_HINTS`) instead of a
 * freeform investigation.
 *
 * The values are the monitor scanners' finding categories that have a plan
 * template (`sre_agent/plan_templates/*.yaml` `incident_type`):
 *
 *   crashloop  → crashloop-resolution    oom        → oom-investigation
 *   image_pull → image-pull-error        scheduling → scheduling-failure
 *   nodes      → node-pressure
 *
 * When unsure (no signal, or signals that disagree) there is no hint, and the
 * agent runs freeform as before. An agent without hint support ignores it.
 */
import type { Condition, ContainerStatus } from './types';

export const PLAN_CATEGORIES = ['crashloop', 'oom', 'image_pull', 'scheduling', 'nodes'] as const;
export type PlanCategory = (typeof PLAN_CATEGORIES)[number];

export function isPlanCategory(v: unknown): v is PlanCategory {
  return typeof v === 'string' && (PLAN_CATEGORIES as readonly string[]).includes(v);
}

type PodLike = {
  status?: {
    phase?: string;
    conditions?: Condition[];
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
  };
};
type NodeLike = { status?: { conditions?: Condition[] } };

const IMAGE_PULL = new Set(['ImagePullBackOff', 'ErrImagePull']);
const NODE_PRESSURE = new Set(['MemoryPressure', 'DiskPressure', 'PIDPressure']);

/** One container's problem, or undefined when it shows none we can name. */
function containerCategory(cs: ContainerStatus): PlanCategory | undefined {
  const waiting = cs.state?.waiting?.reason ?? '';
  if (IMAGE_PULL.has(waiting)) return 'image_pull';
  // OOM is the more specific reading of a crashloop whose last run was OOM-killed.
  if (cs.state?.terminated?.reason === 'OOMKilled') return 'oom';
  if (waiting === 'CrashLoopBackOff') return cs.lastState?.terminated?.reason === 'OOMKilled' ? 'oom' : 'crashloop';
  return undefined;
}

/** Every problem a pod shows (a pod can show several, e.g. one container per kind). */
function podSignals(pod: PodLike | null | undefined): Set<PlanCategory> {
  const out = new Set<PlanCategory>();
  const status = pod?.status;
  if (!status) return out;
  if (status.phase === 'Pending'
    && (status.conditions ?? []).some((c) => c.type === 'PodScheduled' && c.status === 'False' && c.reason === 'Unschedulable')) {
    out.add('scheduling');
  }
  for (const cs of [...(status.initContainerStatuses ?? []), ...(status.containerStatuses ?? [])]) {
    const c = containerCategory(cs);
    if (c) out.add(c);
  }
  return out;
}

/** The one category the signals agree on; undefined for none or several. */
function only(set: Set<PlanCategory>): PlanCategory | undefined {
  return set.size === 1 ? [...set][0] : undefined;
}

/**
 * The problem a pod shows: ImagePullBackOff/ErrImagePull → image_pull,
 * OOMKilled → oom, CrashLoopBackOff → crashloop, Pending and unschedulable →
 * scheduling. Undefined when it shows none, or its containers disagree.
 */
export function inferPodCategory(pod: PodLike | null | undefined): PlanCategory | undefined {
  return only(podSignals(pod));
}

/** The problem a workload's pods show; undefined when none shows one or they disagree. */
export function inferPodsCategory(pods: Array<PodLike | null | undefined>): PlanCategory | undefined {
  const all = new Set<PlanCategory>();
  for (const p of pods) for (const c of podSignals(p)) all.add(c);
  return only(all);
}

/** Memory, disk or PID pressure on a node → nodes (the node-pressure plan). */
export function inferNodeCategory(node: NodeLike | null | undefined): PlanCategory | undefined {
  return (node?.status?.conditions ?? []).some((c) => NODE_PRESSURE.has(c.type) && c.status === 'True') ? 'nodes' : undefined;
}

/** A monitor finding's category, when it is one a plan exists for. */
export function categoryFromFinding(finding: { category?: string } | null | undefined): PlanCategory | undefined {
  return isPlanCategory(finding?.category) ? finding!.category as PlanCategory : undefined;
}
