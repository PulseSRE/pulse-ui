/**
 * Links for a resource's subpages (Logs, Metrics, YAML, Create, Node logs):
 * the domain page it belongs to, its list, its detail page.
 *
 * Paths carry no cluster: every page reads the active cluster from the fleet
 * store, so a link from a subpage opens the parent on the cluster the subpage
 * is showing. The detail page is the one builder `/r/<gvr>/<ns|_>/<name>`.
 */

/** The domain page a resource kind lives under, by API plural. */
const DOMAIN_BY_PLURAL: Record<string, { label: string; path: string }> = {};
const DOMAINS: Array<[{ label: string; path: string }, string[]]> = [
  [{ label: 'Workloads', path: '/workloads' }, [
    'pods', 'deployments', 'statefulsets', 'daemonsets', 'replicasets', 'jobs', 'cronjobs',
    'deploymentconfigs', 'builds', 'buildconfigs', 'horizontalpodautoscalers',
  ]],
  [{ label: 'Networking', path: '/networking' }, [
    'services', 'routes', 'ingresses', 'networkpolicies', 'endpoints', 'endpointslices',
  ]],
  [{ label: 'Compute', path: '/compute' }, ['nodes', 'machines', 'machinesets']],
  [{ label: 'Storage', path: '/storage' }, [
    'persistentvolumeclaims', 'persistentvolumes', 'storageclasses', 'volumesnapshots',
  ]],
];
for (const [domain, plurals] of DOMAINS) for (const p of plurals) DOMAIN_BY_PLURAL[p] = domain;

/** `apps~v1~deployments` → `deployments`. */
export function pluralOfGvrUrl(gvrUrl: string): string {
  const parts = gvrUrl.split('~');
  return parts[parts.length - 1] ?? '';
}

export function domainForGvrUrl(gvrUrl: string): { label: string; path: string } | undefined {
  return DOMAIN_BY_PLURAL[pluralOfGvrUrl(gvrUrl)];
}

/** The resource's detail page. Cluster-scoped objects use `_` for the namespace. */
export function detailPath(gvrUrl: string, namespace: string | undefined, name: string): string {
  return `/r/${gvrUrl}/${namespace || '_'}/${name}`;
}

/** The kind's list, filtered to the namespace when there is one. */
export function listPath(gvrUrl: string, namespace?: string): string {
  return namespace ? `/r/${gvrUrl}?ns=${encodeURIComponent(namespace)}` : `/r/${gvrUrl}`;
}

/** `Deployment` → `Deployments`, `NetworkPolicy` → `NetworkPolicies`, `Ingress` → `Ingresses`. */
export function pluralLabel(kind: string): string {
  if (/[^aeiou]y$/.test(kind)) return `${kind.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/.test(kind)) return `${kind}es`;
  return `${kind}s`;
}

/**
 * The kind as it reads in a sentence: a one-word kind in lower case ("pod",
 * "deployment"); a compound kind keeps its spelling ("ConfigMap").
 */
export function kindInSentence(kind: string): string {
  return /^[A-Z][a-z]+$/.test(kind) ? kind.toLowerCase() : kind;
}
