/**
 * Guards for one-click writes from tables and detail pages.
 *
 * Both of these were found acting on a stale or misleading picture:
 * scaling computed the new count from cached replicas and wrote it
 * unconditionally, and "Restart" on a pod deleted it with no question asked,
 * which for a pod nothing owns is a permanent delete, not a restart.
 */
import type { K8sResource } from './renderers';

/**
 * A replicas patch that only applies to the version of the object it was
 * computed from. If anything changed it since (another click, an HPA, a
 * deploy), the API server answers 409 instead of applying a count based on
 * a number that is no longer true.
 */
export function scalePatch(resource: K8sResource, replicas: number): Record<string, unknown> {
  const resourceVersion = resource.metadata?.resourceVersion;
  return {
    ...(resourceVersion ? { metadata: { resourceVersion } } : {}),
    spec: { replicas: Math.max(0, replicas) },
  };
}

export interface PodRestartPlan {
  /** Whether a controller will create a replacement. */
  replaced: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant: 'warning' | 'danger';
}

/** What "restart" will actually do to this pod, in words for the confirmation. */
export function describePodRestart(pod: K8sResource): PodRestartPlan {
  const name = pod.metadata?.name ?? 'this pod';
  const ns = pod.metadata?.namespace;
  const where = ns ? ` in ${ns}` : '';
  const owner = (pod.metadata?.ownerReferences ?? []).find((o) => o.controller);
  if (owner) {
    return {
      replaced: true,
      title: 'Restart pod',
      description:
        `Pod "${name}"${where} will be deleted. Its ${owner.kind} "${owner.name}" will create a replacement; ` +
        'the new pod gets a new name, and in-flight requests to this one are dropped.',
      confirmLabel: 'Restart',
      variant: 'warning',
    };
  }
  return {
    replaced: false,
    title: 'Delete unmanaged pod',
    description:
      `Pod "${name}"${where} has no controller, so nothing will recreate it. ` +
      '"Restart" here would delete it permanently. Delete it anyway?',
    confirmLabel: 'Delete pod',
    variant: 'danger',
  };
}
