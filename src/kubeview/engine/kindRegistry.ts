/**
 * Kind → group/version/plural/scope lookup used to build resource URLs.
 *
 * Order of authority:
 *   1. the discovered API resources of the active cluster (clusterStore pushes
 *      its registry here, so this module stays a leaf with no store imports);
 *   2. a table of well-known kinds, for links built before discovery finishes
 *      and for callers that only know a kind;
 *   3. a guessed English plural, with scope unknown.
 *
 * Hand-built `/r/v1~${kind}s/...` URLs got all three wrong: Deployments in the
 * core group, `ingresss`, and Nodes with a namespace segment.
 */
import type { ResourceRegistry, ResourceType } from './discovery';

export interface ResolvedKind {
  group: string;
  version: string;
  plural: string;
  /** undefined when neither discovery nor the known table knows the kind */
  namespaced: boolean | undefined;
}

let registry: ResourceRegistry | null = null;

/** Called by clusterStore whenever discovery finishes or the cluster changes. */
export function setKindRegistry(next: ResourceRegistry | null): void {
  registry = next;
}

type Known = [group: string, version: string, plural: string, namespaced: boolean];

/** Well-known kinds. Keys are lower-case kinds (plus common short forms). */
const KNOWN: Record<string, Known> = {
  // core
  pod: ['', 'v1', 'pods', true],
  service: ['', 'v1', 'services', true],
  configmap: ['', 'v1', 'configmaps', true],
  secret: ['', 'v1', 'secrets', true],
  serviceaccount: ['', 'v1', 'serviceaccounts', true],
  persistentvolumeclaim: ['', 'v1', 'persistentvolumeclaims', true],
  event: ['', 'v1', 'events', true],
  endpoints: ['', 'v1', 'endpoints', true],
  resourcequota: ['', 'v1', 'resourcequotas', true],
  limitrange: ['', 'v1', 'limitranges', true],
  replicationcontroller: ['', 'v1', 'replicationcontrollers', true],
  node: ['', 'v1', 'nodes', false],
  namespace: ['', 'v1', 'namespaces', false],
  persistentvolume: ['', 'v1', 'persistentvolumes', false],
  // apps / batch / autoscaling / policy
  deployment: ['apps', 'v1', 'deployments', true],
  replicaset: ['apps', 'v1', 'replicasets', true],
  statefulset: ['apps', 'v1', 'statefulsets', true],
  daemonset: ['apps', 'v1', 'daemonsets', true],
  controllerrevision: ['apps', 'v1', 'controllerrevisions', true],
  job: ['batch', 'v1', 'jobs', true],
  cronjob: ['batch', 'v1', 'cronjobs', true],
  horizontalpodautoscaler: ['autoscaling', 'v2', 'horizontalpodautoscalers', true],
  hpa: ['autoscaling', 'v2', 'horizontalpodautoscalers', true],
  poddisruptionbudget: ['policy', 'v1', 'poddisruptionbudgets', true],
  pdb: ['policy', 'v1', 'poddisruptionbudgets', true],
  // networking
  ingress: ['networking.k8s.io', 'v1', 'ingresses', true],
  networkpolicy: ['networking.k8s.io', 'v1', 'networkpolicies', true],
  ingressclass: ['networking.k8s.io', 'v1', 'ingressclasses', false],
  endpointslice: ['discovery.k8s.io', 'v1', 'endpointslices', true],
  route: ['route.openshift.io', 'v1', 'routes', true],
  // storage
  storageclass: ['storage.k8s.io', 'v1', 'storageclasses', false],
  csidriver: ['storage.k8s.io', 'v1', 'csidrivers', false],
  volumeattachment: ['storage.k8s.io', 'v1', 'volumeattachments', false],
  volumesnapshot: ['snapshot.storage.k8s.io', 'v1', 'volumesnapshots', true],
  // rbac
  role: ['rbac.authorization.k8s.io', 'v1', 'roles', true],
  rolebinding: ['rbac.authorization.k8s.io', 'v1', 'rolebindings', true],
  clusterrole: ['rbac.authorization.k8s.io', 'v1', 'clusterroles', false],
  clusterrolebinding: ['rbac.authorization.k8s.io', 'v1', 'clusterrolebindings', false],
  // cluster-scoped API machinery
  customresourcedefinition: ['apiextensions.k8s.io', 'v1', 'customresourcedefinitions', false],
  apiservice: ['apiregistration.k8s.io', 'v1', 'apiservices', false],
  validatingwebhookconfiguration: ['admissionregistration.k8s.io', 'v1', 'validatingwebhookconfigurations', false],
  mutatingwebhookconfiguration: ['admissionregistration.k8s.io', 'v1', 'mutatingwebhookconfigurations', false],
  priorityclass: ['scheduling.k8s.io', 'v1', 'priorityclasses', false],
  // OpenShift
  project: ['project.openshift.io', 'v1', 'projects', false],
  clusteroperator: ['config.openshift.io', 'v1', 'clusteroperators', false],
  clusterversion: ['config.openshift.io', 'v1', 'clusterversions', false],
  infrastructure: ['config.openshift.io', 'v1', 'infrastructures', false],
  ingresscontroller: ['operator.openshift.io', 'v1', 'ingresscontrollers', true],
  machineconfigpool: ['machineconfiguration.openshift.io', 'v1', 'machineconfigpools', false],
  machineconfig: ['machineconfiguration.openshift.io', 'v1', 'machineconfigs', false],
  machine: ['machine.openshift.io', 'v1beta1', 'machines', true],
  machineset: ['machine.openshift.io', 'v1beta1', 'machinesets', true],
  deploymentconfig: ['apps.openshift.io', 'v1', 'deploymentconfigs', true],
  buildconfig: ['build.openshift.io', 'v1', 'buildconfigs', true],
  build: ['build.openshift.io', 'v1', 'builds', true],
  imagestream: ['image.openshift.io', 'v1', 'imagestreams', true],
  securitycontextconstraints: ['security.openshift.io', 'v1', 'securitycontextconstraints', false],
  user: ['user.openshift.io', 'v1', 'users', false],
  group: ['user.openshift.io', 'v1', 'groups', false],
  // OLM / GitOps / monitoring
  subscription: ['operators.coreos.com', 'v1alpha1', 'subscriptions', true],
  clusterserviceversion: ['operators.coreos.com', 'v1alpha1', 'clusterserviceversions', true],
  catalogsource: ['operators.coreos.com', 'v1alpha1', 'catalogsources', true],
  installplan: ['operators.coreos.com', 'v1alpha1', 'installplans', true],
  application: ['argoproj.io', 'v1alpha1', 'applications', true],
  prometheus: ['monitoring.coreos.com', 'v1', 'prometheuses', true],
  prometheusrule: ['monitoring.coreos.com', 'v1', 'prometheusrules', true],
  servicemonitor: ['monitoring.coreos.com', 'v1', 'servicemonitors', true],
  alertmanager: ['monitoring.coreos.com', 'v1', 'alertmanagers', true],
};

/** Guess an English plural for a kind no table knows. */
export function guessPlural(kind: string): string {
  const lower = kind.toLowerCase();
  if (lower.endsWith('ss') || lower.endsWith('sh') || lower.endsWith('ch') || lower.endsWith('x') || lower.endsWith('z')) return lower + 'es';
  if (lower.endsWith('s')) return lower;
  if (lower.endsWith('y') && !['a', 'e', 'i', 'o', 'u'].includes(lower[lower.length - 2])) return lower.slice(0, -1) + 'ies';
  return lower + 's';
}

function splitApiVersion(apiVersion: string | undefined): { group: string; version: string } | null {
  if (!apiVersion) return null;
  const i = apiVersion.lastIndexOf('/');
  return i === -1 ? { group: '', version: apiVersion } : { group: apiVersion.slice(0, i), version: apiVersion.slice(i + 1) };
}

function fromType(t: ResourceType): ResolvedKind {
  return { group: t.group, version: t.version, plural: t.plural, namespaced: t.namespaced };
}

function registryLookup(kind: string, group: string | undefined): ResourceType | undefined {
  if (!registry) return undefined;
  const lower = kind.toLowerCase();
  let anyGroup: ResourceType | undefined;
  for (const t of registry.values()) {
    if (t.kind.toLowerCase() !== lower) continue;
    if (group === undefined || t.group === group) return t;
    anyGroup ??= t;
  }
  return group === '' ? anyGroup : undefined;
}

/**
 * Resolve a kind (optionally with the object's apiVersion) to the GVR and scope
 * the URL needs. A bare `v1` apiVersion on a kind that is not in the core group
 * is treated as "unknown group" — callers used to hardcode `'v1'` for every kind.
 */
export function resolveKind(kind: string, apiVersion?: string): ResolvedKind {
  const av = splitApiVersion(apiVersion);
  const known = KNOWN[kind.toLowerCase()];

  const hit = registryLookup(kind, av?.group);
  if (hit) {
    // Keep the caller's version when discovery has the same group.
    return av && av.group === hit.group ? { ...fromType(hit), version: av.version } : fromType(hit);
  }
  if (!av) {
    const any = registryLookup(kind, '');
    if (any) return fromType(any);
  }

  if (known) {
    const [group, version, plural, namespaced] = known;
    if (!av || (av.group === '' && group !== '')) return { group, version, plural, namespaced };
    if (av.group === group) return { group, version: av.version, plural, namespaced };
  }

  return {
    group: av?.group ?? '',
    version: av?.version ?? 'v1',
    plural: guessPlural(kind),
    namespaced: undefined,
  };
}

/** `group~version~plural` (or `v1~plural`) for a resolved kind. */
export function gvrSegment(r: Pick<ResolvedKind, 'group' | 'version' | 'plural'>): string {
  return r.group ? `${r.group}~${r.version}~${r.plural}` : `${r.version}~${r.plural}`;
}

/** `group/version` (or `v1`) for a resolved kind. */
export function apiVersionOf(r: Pick<ResolvedKind, 'group' | 'version'>): string {
  return r.group ? `${r.group}/${r.version}` : r.version;
}

/** True/false when the scope is known, undefined otherwise. */
export function isNamespacedKind(kind: string, apiVersion?: string): boolean | undefined {
  return resolveKind(kind, apiVersion).namespaced;
}
