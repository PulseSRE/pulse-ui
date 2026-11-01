/**
 * The one rule for "platform" namespaces that best-practice audits leave out.
 *
 * Routes TLS, NodePort, NetworkPolicy coverage, Workloads and Security audits
 * each had their own exclusion list (some dropped `default`, some kept
 * `openshift-*`), so the same cluster passed one audit and failed another for
 * the same object. Every audit uses this now.
 *
 * Platform = `openshift`, `openshift-*`, `kube-*` (kube-system, kube-public,
 * kube-node-lease): managed by the cluster, not by the people reading the
 * audit. `default` is a user namespace.
 */
export function isPlatformNamespace(ns: string | undefined | null): boolean {
  if (!ns) return false;
  return ns === 'openshift' || ns.startsWith('openshift-') || ns.startsWith('kube-');
}

/** Objects in user (non-platform) namespaces. Cluster-scoped objects are kept. */
export function inUserNamespaces<T extends { metadata?: { namespace?: string } }>(items: readonly T[]): T[] {
  return items.filter((i) => !isPlatformNamespace(i.metadata?.namespace));
}
