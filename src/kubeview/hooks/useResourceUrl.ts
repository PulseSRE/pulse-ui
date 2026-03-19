import { useUIStore } from '../store/uiStore';
import { kindToPlural } from '../engine/renderers/index';

/**
 * Builds an API path from a GVR key (Group/Version/Resource).
 *
 * Examples:
 * - "v1/pods" with namespace "default" -> "/api/v1/namespaces/default/pods"
 * - "apps/v1/deployments" with namespace "default" -> "/apis/apps/v1/namespaces/default/deployments"
 * - "v1/nodes" (cluster-scoped) -> "/api/v1/nodes"
 * - "apps/v1/deployments" with namespace "default" and name "nginx" -> "/apis/apps/v1/namespaces/default/deployments/nginx"
 */
function sanitizePathSegment(s: string): string {
  return encodeURIComponent(s).replace(/%2F/gi, '');
}

export function buildApiPath(gvrKey: string, namespace?: string, name?: string): string {
  const parts = gvrKey.split('/');

  let group: string;
  let version: string;
  let resource: string;

  if (parts.length === 2) {
    // Core API: "v1/pods"
    [version, resource] = parts;
    group = '';
  } else if (parts.length === 3) {
    // Named group: "apps/v1/deployments"
    [group, version, resource] = parts;
  } else {
    throw new Error(`Invalid GVR key format: ${gvrKey}. Expected "v1/resource" or "group/v1/resource"`);
  }

  // Build the base path
  let path: string;
  if (group === '') {
    // Core API
    path = `/api/${version}`;
  } else {
    // Named group
    path = `/apis/${group}/${version}`;
  }

  // Add namespace segment if provided ("_" means cluster-scoped, no namespace)
  if (namespace && namespace !== '_') {
    path += `/namespaces/${sanitizePathSegment(namespace)}`;
  }

  // Add resource
  path += `/${resource}`;

  // Add name if provided
  if (name) {
    path += `/${sanitizePathSegment(name)}`;
  }

  return path;
}

/**
 * Build an API path from a K8s resource object (apiVersion + kind + metadata).
 * Works for any resource returned by the API — no GVR key needed.
 */
export function buildApiPathFromResource(resource: {
  apiVersion?: string;
  kind?: string;
  metadata: { name: string; namespace?: string };
}): string {
  const apiVersion = resource.apiVersion || 'v1';
  const kind = resource.kind || 'Unknown';
  const metadata = resource.metadata;
  const [group, version] = apiVersion.includes('/')
    ? apiVersion.split('/')
    : ['', apiVersion];
  const plural = kindToPlural(kind);

  let path = group ? `/apis/${apiVersion}` : `/api/${version}`;
  if (metadata.namespace) path += `/namespaces/${sanitizePathSegment(metadata.namespace)}`;
  path += `/${plural}/${sanitizePathSegment(metadata.name)}`;
  return path;
}

/**
 * Hook that provides API URLs for a resource.
 * Uses the currently selected namespace from the UI store.
 */
export function useResourceUrl(gvrKey: string, name?: string) {
  const namespace = useUIStore((s) => s.selectedNamespace);

  // For namespaced resources, build with namespace
  // For cluster-scoped resources, namespace will be ignored by the API
  const listUrl = buildApiPath(gvrKey, namespace);
  const getUrl = name ? buildApiPath(gvrKey, namespace, name) : null;

  // Also provide the base API path without namespace for cluster-scoped resources
  const apiPath = buildApiPath(gvrKey);

  return {
    listUrl,    // Full URL for listing resources in current namespace
    getUrl,     // Full URL for getting a specific resource by name
    apiPath,    // Base API path without namespace/name
    namespace,  // Current namespace
  };
}

/**
 * Hook that provides API URLs for a resource with explicit namespace.
 * Useful when you need to override the global namespace selection.
 */
export function useResourceUrlWithNamespace(gvrKey: string, namespace?: string, name?: string) {
  const listUrl = namespace ? buildApiPath(gvrKey, namespace) : buildApiPath(gvrKey);
  const getUrl = name ? buildApiPath(gvrKey, namespace, name) : null;
  const apiPath = buildApiPath(gvrKey);

  return {
    listUrl,
    getUrl,
    apiPath,
    namespace,
  };
}
