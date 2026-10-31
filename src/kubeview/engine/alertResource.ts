/**
 * Which Kubernetes object a Prometheus alert is about, from its labels.
 * Shared by the Alerts page and the timeline so both link to the same object.
 */
import { apiVersionOf, resolveKind } from './kindRegistry';

export interface AlertResource {
  apiVersion: string;
  kind: string;
  name: string;
  /** undefined for cluster-scoped kinds (Node), whatever the alert's namespace label says */
  namespace?: string;
}

/**
 * Most specific object first. `job` is deliberately absent: on almost every
 * alert it is the Prometheus scrape job ("kube-state-metrics"), not a batch
 * Job. kube-state-metrics names a batch Job in `job_name`.
 */
const LABEL_KINDS: ReadonlyArray<[label: string, kind: string]> = [
  ['pod', 'Pod'],
  ['deployment', 'Deployment'],
  ['statefulset', 'StatefulSet'],
  ['daemonset', 'DaemonSet'],
  ['job_name', 'Job'],
  ['node', 'Node'],
];

export function alertResource(labels: Record<string, string | undefined> | undefined): AlertResource | undefined {
  if (!labels) return undefined;
  for (const [label, kind] of LABEL_KINDS) {
    const name = labels[label];
    if (!name) continue;
    const resolved = resolveKind(kind);
    // Node alerts carry the namespace of whatever exported the metric
    // (e.g. openshift-monitoring); a Node has no namespace.
    const namespace = resolved.namespaced === false ? undefined : labels.namespace || undefined;
    return { apiVersion: apiVersionOf(resolved), kind, name, namespace };
  }
  return undefined;
}
