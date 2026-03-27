/**
 * gitopsExport — exports cluster resources to a Git repo as YAML manifests.
 *
 * Defines resource categories, fetches them from the K8s API, sanitizes
 * runtime fields, and commits each category as a batch via the GitProvider.
 */

import { k8sList } from './query';
import type { K8sResource } from './renderers/index';
import type { GitProvider, GitOpsConfig } from './gitProvider';
import { createGitProvider } from './gitProvider';

// ── System namespace filter ──

const SYSTEM_NS_PREFIXES = ['openshift-', 'kube-'];
const SYSTEM_NS_EXACT = ['default', 'openshift'];

export function isUserNamespace(ns: string): boolean {
  if (SYSTEM_NS_EXACT.includes(ns)) return false;
  return !SYSTEM_NS_PREFIXES.some((p) => ns.startsWith(p));
}

// ── Resource category registry ──

export interface ResourceDef {
  kind: string;
  apiPath: string;
  namespaced: boolean;
}

export interface ResourceCategory {
  id: string;
  label: string;
  description: string;
  resources: ResourceDef[];
}

export const RESOURCE_CATEGORIES: ResourceCategory[] = [
  {
    id: 'workloads',
    label: 'Workloads',
    description: 'Deployments, StatefulSets, DaemonSets, CronJobs',
    resources: [
      { kind: 'Deployment', apiPath: '/apis/apps/v1/deployments', namespaced: true },
      { kind: 'StatefulSet', apiPath: '/apis/apps/v1/statefulsets', namespaced: true },
      { kind: 'DaemonSet', apiPath: '/apis/apps/v1/daemonsets', namespaced: true },
      { kind: 'CronJob', apiPath: '/apis/batch/v1/cronjobs', namespaced: true },
    ],
  },
  {
    id: 'networking',
    label: 'Networking',
    description: 'Services, Ingresses, NetworkPolicies, Routes',
    resources: [
      { kind: 'Service', apiPath: '/api/v1/services', namespaced: true },
      { kind: 'Ingress', apiPath: '/apis/networking.k8s.io/v1/ingresses', namespaced: true },
      { kind: 'NetworkPolicy', apiPath: '/apis/networking.k8s.io/v1/networkpolicies', namespaced: true },
      { kind: 'Route', apiPath: '/apis/route.openshift.io/v1/routes', namespaced: true },
    ],
  },
  {
    id: 'config',
    label: 'Configuration',
    description: 'ConfigMaps, Secrets, ServiceAccounts, RBAC',
    resources: [
      { kind: 'ConfigMap', apiPath: '/api/v1/configmaps', namespaced: true },
      { kind: 'Secret', apiPath: '/api/v1/secrets', namespaced: true },
      { kind: 'ServiceAccount', apiPath: '/api/v1/serviceaccounts', namespaced: true },
      { kind: 'Role', apiPath: '/apis/rbac.authorization.k8s.io/v1/roles', namespaced: true },
      { kind: 'RoleBinding', apiPath: '/apis/rbac.authorization.k8s.io/v1/rolebindings', namespaced: true },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    description: 'PersistentVolumeClaims, StorageClasses',
    resources: [
      { kind: 'PersistentVolumeClaim', apiPath: '/api/v1/persistentvolumeclaims', namespaced: true },
      { kind: 'StorageClass', apiPath: '/apis/storage.k8s.io/v1/storageclasses', namespaced: false },
    ],
  },
];

// ── Sanitization ──

/** Fields to strip from exported resources (runtime/cluster-managed) */
const METADATA_STRIP_FIELDS = [
  'resourceVersion',
  'uid',
  'creationTimestamp',
  'generation',
  'managedFields',
  'selfLink',
  'deletionTimestamp',
  'deletionGracePeriodSeconds',
];

const ANNOTATION_STRIP_PREFIXES = [
  'kubectl.kubernetes.io/',
  'deployment.kubernetes.io/',
  'kubernetes.io/change-cause',
];

export function sanitizeResource(resource: K8sResource): K8sResource {
  const clean = structuredClone(resource);

  // Strip runtime metadata fields
  for (const field of METADATA_STRIP_FIELDS) {
    delete (clean.metadata as Record<string, unknown>)[field];
  }

  // Strip ownerReferences (managed by controllers)
  delete clean.metadata.ownerReferences;

  // Strip runtime annotations
  if (clean.metadata.annotations) {
    for (const key of Object.keys(clean.metadata.annotations)) {
      if (ANNOTATION_STRIP_PREFIXES.some((p) => key.startsWith(p))) {
        delete clean.metadata.annotations[key];
      }
    }
    if (Object.keys(clean.metadata.annotations).length === 0) {
      delete clean.metadata.annotations;
    }
  }

  // Strip status (runtime state)
  delete clean.status;

  return clean;
}

// ── Export progress events ──

export type ExportEvent =
  | { type: 'start'; totalCategories: number }
  | { type: 'category-start'; categoryId: string; label: string }
  | { type: 'category-fetched'; categoryId: string; resourceCount: number }
  | { type: 'category-committed'; categoryId: string }
  | { type: 'category-error'; categoryId: string; error: string }
  | { type: 'complete'; totalResources: number; prUrl?: string }
  | { type: 'error'; error: string };

// ── Export options ──

export interface ExportOptions {
  config: GitOpsConfig;
  clusterName: string;
  categoryIds: string[];
  namespaces: string[];
  exportMode: 'pr' | 'direct';
  branchName?: string;
}

/** Convert a resource to a simple YAML-like string (JSON with 2-space indent for commits) */
function resourceToJson(resource: K8sResource): string {
  return JSON.stringify(resource, null, 2);
}

/**
 * Export selected cluster resources to a Git repository.
 * Yields progress events for UI feedback.
 */
export async function* exportClusterToGit(
  options: ExportOptions,
): AsyncGenerator<ExportEvent> {
  const { config, clusterName, categoryIds, namespaces, exportMode } = options;
  const categories = RESOURCE_CATEGORIES.filter((c) => categoryIds.includes(c.id));

  yield { type: 'start', totalCategories: categories.length };

  let provider: GitProvider;
  try {
    provider = createGitProvider(config);
  } catch (err) {
    yield { type: 'error', error: err instanceof Error ? err.message : 'Failed to create git provider' };
    return;
  }

  const branchName = options.branchName || `cluster-export/${clusterName}/${Date.now()}`;
  const pathPrefix = config.pathPrefix ? config.pathPrefix.replace(/\/$/, '') : '';
  const basePath = pathPrefix ? `${pathPrefix}/${clusterName}` : clusterName;

  // Create branch for PR mode
  if (exportMode === 'pr') {
    try {
      await provider.createBranch(config.baseBranch, branchName);
    } catch (err) {
      yield { type: 'error', error: `Failed to create branch: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }
  }

  const targetBranch = exportMode === 'pr' ? branchName : config.baseBranch;
  let totalResources = 0;

  // If no namespaces selected, auto-discover user namespaces
  let effectiveNamespaces = namespaces;
  if (effectiveNamespaces.length === 0) {
    try {
      const allNs = await k8sList<K8sResource>('/api/v1/namespaces');
      effectiveNamespaces = allNs
        .map((ns) => ns.metadata.name)
        .filter(isUserNamespace);
    } catch {
      effectiveNamespaces = [];
    }
  }

  for (const category of categories) {
    yield { type: 'category-start', categoryId: category.id, label: category.label };

    try {
      let categoryResourceCount = 0;

      for (const resDef of category.resources) {
        const fetchNamespaces = resDef.namespaced ? effectiveNamespaces : ['_cluster_'];

        for (const ns of fetchNamespaces) {
          try {
            const items = await k8sList<K8sResource>(
              resDef.apiPath,
              resDef.namespaced ? ns : undefined,
            );

            const filtered = items.filter((r) => {
              if (!resDef.namespaced) return true;
              return r.metadata.namespace && isUserNamespace(r.metadata.namespace);
            });

            if (filtered.length > 0) {
              const files = filtered.map((resource) => {
                const sanitized = sanitizeResource(resource);
                const nsDir = sanitized.metadata.namespace || '_cluster';
                return {
                  path: `${basePath}/${category.id}/${nsDir}/${resDef.kind}-${sanitized.metadata.name}.json`,
                  content: resourceToJson(sanitized),
                };
              });

              await provider.commitMultipleFiles(
                targetBranch,
                files,
                `Export ${files.length} ${resDef.kind} resources from ${clusterName}`,
              );
              categoryResourceCount += files.length;
            }
          } catch (err) {
            console.warn(`[gitops-export] Failed to export ${resDef.kind} in ${ns}:`, err);
          }
        }
      }

      totalResources += categoryResourceCount;
      yield { type: 'category-fetched', categoryId: category.id, resourceCount: categoryResourceCount };
      yield { type: 'category-committed', categoryId: category.id };
    } catch (err) {
      yield {
        type: 'category-error',
        categoryId: category.id,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Create PR if needed
  let prUrl: string | undefined;
  if (exportMode === 'pr' && totalResources > 0) {
    try {
      const pr = await provider.createPullRequest(
        `Export cluster resources: ${clusterName}`,
        `Exported ${totalResources} resources from cluster \`${clusterName}\` across ${categories.length} categories.\n\nCategories: ${categories.map((c) => c.label).join(', ')}`,
        branchName,
        config.baseBranch,
      );
      prUrl = pr.url;
    } catch (err) {
      yield { type: 'error', error: `Failed to create PR: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }
  }

  yield { type: 'complete', totalResources, prUrl };
}
