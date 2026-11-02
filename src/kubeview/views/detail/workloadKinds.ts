/**
 * Kinds whose page shows the pods they run (with logs and events). Jobs and
 * CronJobs are included: a failed run is a pod with a log, like a crashing
 * Deployment's.
 */
const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob']);

export function isWorkloadKind(kind: string | undefined): boolean {
  return !!kind && WORKLOAD_KINDS.has(kind);
}

/** Workloads with replicas, a rollout strategy and a pod template at spec.template. */
export function isReplicatedWorkload(kind: string | undefined): boolean {
  return kind === 'Deployment' || kind === 'StatefulSet' || kind === 'DaemonSet';
}
