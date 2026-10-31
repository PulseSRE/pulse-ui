/**
 * Links into /topology focused on one resource.
 *
 * /topology is the one dependency-graph page. The old `/deps/:gvr/:ns/:name`
 * page (a second, client-built graph) now redirects here, so a resource's
 * "Dependencies" action and any saved /deps link land on the same graph.
 *
 * The agent's dependency graph names nodes `Kind/namespace/name`, with a few
 * short kinds (PVC, HPA). `topologyNodeMatches` accepts either spelling.
 */

const SHORT_KINDS: Record<string, string> = {
  PersistentVolumeClaim: 'PVC',
  HorizontalPodAutoscaler: 'HPA',
  PodDisruptionBudget: 'PDB',
};

/** Path for /topology focused on one resource. */
export function topologyFocusPath(kind: string, namespace: string | undefined, name: string): string {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  params.set('focus', `${kind}/${namespace ?? ''}/${name}`);
  return `/topology?${params.toString()}`;
}

/** Split a `focus` value (`Kind/namespace/name`). */
export function parseTopologyFocus(focus: string | null): { kind: string; namespace: string; name: string } | null {
  if (!focus) return null;
  const parts = focus.split('/');
  if (parts.length !== 3 || !parts[0] || !parts[2]) return null;
  return { kind: parts[0], namespace: parts[1], name: parts[2] };
}

/** True when a graph node is the focused resource. */
export function topologyNodeMatches(
  node: { kind: string; namespace: string; name: string },
  focus: { kind: string; namespace: string; name: string },
): boolean {
  if (node.name !== focus.name || (node.namespace || '') !== (focus.namespace || '')) return false;
  return node.kind === focus.kind || node.kind === SHORT_KINDS[focus.kind] || SHORT_KINDS[node.kind] === focus.kind;
}

/** Kind for a GVR key (`apps/v1/deployments`) when discovery has not answered: Deployment. */
export function kindFromPlural(plural: string): string {
  const special: Record<string, string> = {
    ingresses: 'Ingress',
    networkpolicies: 'NetworkPolicy',
    persistentvolumeclaims: 'PersistentVolumeClaim',
    horizontalpodautoscalers: 'HorizontalPodAutoscaler',
    poddisruptionbudgets: 'PodDisruptionBudget',
    statefulsets: 'StatefulSet',
    daemonsets: 'DaemonSet',
    replicasets: 'ReplicaSet',
    cronjobs: 'CronJob',
    configmaps: 'ConfigMap',
    serviceaccounts: 'ServiceAccount',
  };
  if (special[plural]) return special[plural];
  const singular = plural.endsWith('ies') ? `${plural.slice(0, -3)}y` : plural.replace(/s$/, '');
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}
