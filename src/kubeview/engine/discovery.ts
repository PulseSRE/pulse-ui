/**
 * API Discovery Engine
 * Discovers and caches all available Kubernetes resource types from the API server.
 */

import { K8S_BASE as BASE } from './gvr';
import { getClusterBase } from './clusterConnection';

export interface ResourceType {
  group: string;      // "" for core, "apps" etc
  version: string;    // "v1"
  kind: string;       // "Deployment"
  plural: string;     // "deployments"
  singularName: string;
  namespaced: boolean;
  verbs: string[];    // ["get","list","create","update","delete","watch"]
  shortNames: string[];
  categories: string[];
  storageVersionHash?: string;
}

export interface APIGroup {
  name: string;        // "apps", "batch", "" for core
  displayName: string; // "Apps", "Batch", "Core"
  versions: string[];
  resources: ResourceType[];
}

export type ResourceRegistry = Map<string, ResourceType>;

interface APIResourceList {
  kind: string;
  apiVersion: string;
  groupVersion: string;
  resources: Array<{
    name: string;
    singularName: string;
    namespaced: boolean;
    kind: string;
    verbs: string[];
    shortNames?: string[];
    categories?: string[];
    storageVersionHash?: string;
  }>;
}

interface APIGroupList {
  kind: string;
  apiVersion: string;
  groups: Array<{
    name: string;
    versions: Array<{
      groupVersion: string;
      version: string;
    }>;
    preferredVersion: {
      groupVersion: string;
      version: string;
    };
  }>;
}

interface CoreAPIVersions {
  kind: string;
  versions: string[];
  serverAddressByClientCIDRs: Array<{
    clientCIDR: string;
    serverAddress: string;
  }>;
}

const cachedRegistries = new Map<string, ResourceRegistry>();
const cacheTimestamps = new Map<string, number>();
// Legacy single-cluster aliases for backward compatibility
let cachedRegistry: ResourceRegistry | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a GVR (Group-Version-Resource) key
 */
export function gvrKey(group: string, version: string, plural: string): string {
  if (group === '') {
    return `core/${version}/${plural}`;
  }
  return `${group}/${version}/${plural}`;
}

/**
 * Invalidate the discovery cache (e.g., after operator install)
 */
export function invalidateDiscoveryCache(clusterId?: string): void {
  const cacheKey = clusterId || 'local';
  cachedRegistries.delete(cacheKey);
  cacheTimestamps.delete(cacheKey);
  // Also clear legacy aliases
  cachedRegistry = null;
  cacheTimestamp = 0;
}

/**
 * Discover all available resource types from the API server
 */
export async function discoverResources(clusterId?: string): Promise<ResourceRegistry> {
  const cacheKey = clusterId || 'local';
  const cached = cachedRegistries.get(cacheKey);
  const ts = cacheTimestamps.get(cacheKey) || 0;

  if (cached && (Date.now() - ts) < CACHE_TTL) {
    return cached;
  }

  const base = getClusterBase(clusterId);
  const registry: ResourceRegistry = new Map();

  try {
    // Discover core API resources (v1)
    await discoverCoreAPI(registry, base);

    // Discover API groups
    await discoverAPIGroups(registry, base);

    cachedRegistries.set(cacheKey, registry);
    cacheTimestamps.set(cacheKey, Date.now());
    // Update legacy aliases for backward compat
    cachedRegistry = registry;
    cacheTimestamp = Date.now();
    return registry;
  } catch (error) {
    console.error('Failed to discover API resources:', error);
    throw error;
  }
}

/**
 * Discover core API resources (/api/v1)
 */
async function discoverCoreAPI(registry: ResourceRegistry, base: string = BASE): Promise<void> {
  try {
    const response = await fetch(`${base}/api/v1`);
    if (!response.ok) {
      throw new Error(`Failed to fetch core API: ${response.statusText}`);
    }

    const data: APIResourceList = await response.json();

    for (const resource of data.resources) {
      // Skip subresources (e.g., "pods/log", "pods/status")
      if (resource.name.includes('/')) {
        continue;
      }

      const resourceType: ResourceType = {
        group: '',
        version: 'v1',
        kind: resource.kind,
        plural: resource.name,
        singularName: resource.singularName || resource.name,
        namespaced: resource.namespaced,
        verbs: resource.verbs,
        shortNames: resource.shortNames || [],
        categories: resource.categories || [],
        storageVersionHash: resource.storageVersionHash,
      };

      registry.set(gvrKey('', 'v1', resource.name), resourceType);
    }
  } catch (error) {
    console.error('Failed to discover core API:', error);
  }
}

/**
 * Discover API groups and their resources
 */
async function discoverAPIGroups(registry: ResourceRegistry, base: string = BASE): Promise<void> {
  try {
    const response = await fetch(`${base}/apis`);
    if (!response.ok) {
      throw new Error(`Failed to fetch API groups: ${response.statusText}`);
    }

    const data: APIGroupList = await response.json();

    // Fetch resources for preferred version only (reduces requests by 50-70%)
    const promises = data.groups.map(group =>
      discoverGroupVersion(registry, group.name, group.preferredVersion.version, base)
    );

    await Promise.allSettled(promises);
  } catch (error) {
    console.error('Failed to discover API groups:', error);
  }
}

/**
 * Discover resources for a specific API group version
 */
async function discoverGroupVersion(
  registry: ResourceRegistry,
  group: string,
  version: string,
  base: string = BASE
): Promise<void> {
  try {
    const response = await fetch(`${base}/apis/${group}/${version}`);
    if (!response.ok) {
      return; // Skip if version is not available
    }

    const data: APIResourceList = await response.json();

    for (const resource of data.resources) {
      // Skip subresources
      if (resource.name.includes('/')) {
        continue;
      }

      const resourceType: ResourceType = {
        group,
        version,
        kind: resource.kind,
        plural: resource.name,
        singularName: resource.singularName || resource.name,
        namespaced: resource.namespaced,
        verbs: resource.verbs,
        shortNames: resource.shortNames || [],
        categories: resource.categories || [],
        storageVersionHash: resource.storageVersionHash,
      };

      registry.set(gvrKey(group, version, resource.name), resourceType);
    }
  } catch (error) {
    console.error(`Failed to discover ${group}/${version}:`, error);
  }
}

/**
 * Group resources by API group for browsing
 */
export function groupResources(registry: ResourceRegistry): APIGroup[] {
  const groups = new Map<string, APIGroup>();

  for (const [, resourceType] of registry) {
    const groupName = resourceType.group || '';

    if (!groups.has(groupName)) {
      groups.set(groupName, {
        name: groupName,
        displayName: formatGroupName(groupName),
        versions: [],
        resources: [],
      });
    }

    const group = groups.get(groupName)!;

    // Add version if not already present
    if (!group.versions.includes(resourceType.version)) {
      group.versions.push(resourceType.version);
    }

    group.resources.push(resourceType);
  }

  // Sort groups and their resources
  return Array.from(groups.values())
    .sort((a, b) => {
      // Core group first
      if (a.name === '') return -1;
      if (b.name === '') return 1;
      return a.name.localeCompare(b.name);
    })
    .map(group => ({
      ...group,
      versions: group.versions.sort(),
      resources: group.resources.sort((a, b) => a.kind.localeCompare(b.kind)),
    }));
}

/**
 * Format API group name for display
 */
function formatGroupName(group: string): string {
  if (group === '') {
    return 'Core';
  }

  // Remove .k8s.io suffix for cleaner display
  const cleaned = group.replace(/\.k8s\.io$/, '');

  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Find a resource by kind, plural, shortName, or GVR key
 * Examples: "Deployment", "deployments", "deploy", "apps/v1/deployments"
 */
export function findResource(
  registry: ResourceRegistry,
  query: string
): ResourceType | undefined {
  const normalized = query.toLowerCase().trim();

  // Try exact GVR key match first
  for (const [key, resource] of registry) {
    if (key.toLowerCase() === normalized) {
      return resource;
    }
  }

  // Try kind match (case-insensitive)
  for (const [, resource] of registry) {
    if (resource.kind.toLowerCase() === normalized) {
      return resource;
    }
  }

  // Try plural match
  for (const [, resource] of registry) {
    if (resource.plural.toLowerCase() === normalized) {
      return resource;
    }
  }

  // Try singular name match
  for (const [, resource] of registry) {
    if (resource.singularName.toLowerCase() === normalized) {
      return resource;
    }
  }

  // Try short name match
  for (const [, resource] of registry) {
    for (const shortName of resource.shortNames) {
      if (shortName.toLowerCase() === normalized) {
        return resource;
      }
    }
  }

  return undefined;
}

/**
 * Clear the cached registry (useful for testing or forcing refresh)
 */
export function clearDiscoveryCache(clusterId?: string): void {
  if (clusterId) {
    cachedRegistries.delete(clusterId);
    cacheTimestamps.delete(clusterId);
  } else {
    cachedRegistries.clear();
    cacheTimestamps.clear();
  }
  cachedRegistry = null;
}

/**
 * Get API path for a resource type
 */
export function getAPIPath(resourceType: ResourceType, namespace?: string): string {
  let path = '';

  if (resourceType.group === '') {
    path = `/api/${resourceType.version}`;
  } else {
    path = `/apis/${resourceType.group}/${resourceType.version}`;
  }

  if (resourceType.namespaced && namespace) {
    path += `/namespaces/${namespace}`;
  }

  path += `/${resourceType.plural}`;

  return path;
}

/**
 * Check if a resource type supports a specific verb
 */
export function supportsVerb(resourceType: ResourceType, verb: string): boolean {
  return resourceType.verbs.includes(verb);
}
