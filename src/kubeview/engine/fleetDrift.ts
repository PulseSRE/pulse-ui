/**
 * Fleet Drift Detection — cross-cluster resource comparison engine.
 * Fetches the same resource from multiple clusters and reports field-level differences.
 */

import { k8sGet } from './query';
import { errorReason, isNotFound } from './readResult';
import { getAllConnections } from './clusterConnection';

export interface ResourceDiff {
  field: string;           // dot-notation path e.g. "spec.replicas"
  values: Record<string, unknown>; // clusterId -> value
  drifted: boolean;
}

export interface DriftResult {
  resource: { apiPath: string; name: string; namespace?: string };
  /** Clusters whose copy was read and compared. */
  clusters: string[];
  /** How many clusters were asked. */
  totalClusters: number;
  /** Clusters where the resource does not exist (404): that is drift. */
  absentClusters: string[];
  /** Clusters that could not be read (403, 5xx, network): not compared. */
  failedClusters: Array<{ id: string; reason: string }>;
  diffs: ResourceDiff[];
  identicalFields: number;
  driftedFields: number;
}

/** Fields to ignore in comparison (metadata noise) */
const IGNORED_FIELDS = new Set([
  'metadata.uid',
  'metadata.resourceVersion',
  'metadata.creationTimestamp',
  'metadata.managedFields',
  'metadata.generation',
  'metadata.selfLink',
  'metadata.annotations.kubectl.kubernetes.io/last-applied-configuration',
  'status',
]);

/** Check if a field path starts with any ignored prefix */
function isIgnored(path: string): boolean {
  for (const ignored of IGNORED_FIELDS) {
    if (path === ignored || path.startsWith(ignored + '.')) return true;
  }
  return false;
}

/**
 * Flatten a nested object to dot-notation paths.
 * Arrays are serialized as leaf values (not iterated index-by-index).
 */
export function flattenObject(obj: unknown, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) result[prefix] = obj;
    return result;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = record[key];

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, path));
    } else {
      result[path] = value;
    }
  }

  return result;
}

/**
 * Compare a resource across multiple clusters, returning field-level drift.
 *
 * @param apiPath - Base API path, e.g. "/apis/apps/v1/deployments"
 * @param name - Resource name
 * @param namespace - Optional namespace (for namespaced resources)
 * @param clusterIds - Optional subset of clusters to compare (defaults to all connected)
 */
export async function fleetCompareResource(
  apiPath: string,
  name: string,
  namespace?: string,
  clusterIds?: string[],
): Promise<DriftResult> {
  const allClusters = getAllConnections().filter(c => c.status === 'connected');
  const clusters = clusterIds
    ? allClusters.filter(c => clusterIds.includes(c.id))
    : allClusters;

  // Build full path: insert namespace if provided
  let fullPath = apiPath;
  if (namespace) {
    const parts = apiPath.split('/');
    const resourceIndex = parts.length - 1;
    parts.splice(resourceIndex, 0, 'namespaces', namespace);
    fullPath = parts.join('/');
  }
  fullPath = `${fullPath}/${name}`;

  // Fan out requests
  const results = await Promise.allSettled(
    clusters.map(c => k8sGet<Record<string, unknown>>(fullPath, c.id)),
  );

  // Collect successful responses keyed by cluster ID
  const clusterData: Record<string, Record<string, unknown>> = {};
  const succeededClusters: string[] = [];
  const absentClusters: string[] = [];
  const failedClusters: Array<{ id: string; reason: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      const flat = flattenObject(result.value);
      // Filter ignored fields
      const filtered: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(flat)) {
        if (!isIgnored(key)) filtered[key] = val;
      }
      clusterData[clusters[i].id] = filtered;
      succeededClusters.push(clusters[i].id);
    } else if (isNotFound(result.reason)) {
      absentClusters.push(clusters[i].id);
    } else {
      failedClusters.push({ id: clusters[i].id, reason: errorReason(result.reason) });
    }
  }

  if (succeededClusters.length === 0 && absentClusters.length === 0) {
    throw new Error(`Failed to fetch resource from any cluster${failedClusters.length ? `: ${failedClusters.map(f => `${f.id}: ${f.reason}`).join('; ')}` : ''}`);
  }

  // Collect all unique field paths
  const allFields = new Set<string>();
  for (const fields of Object.values(clusterData)) {
    for (const key of Object.keys(fields)) {
      allFields.add(key);
    }
  }

  // Compare each field across clusters
  const diffs: ResourceDiff[] = [];
  let identicalFields = 0;
  let driftedFields = 0;

  for (const field of Array.from(allFields).sort()) {
    const values: Record<string, unknown> = {};
    for (const cid of succeededClusters) {
      values[cid] = clusterData[cid][field];
    }

    const serialized = succeededClusters.map(cid => JSON.stringify(values[cid]));
    const drifted = serialized.some(s => s !== serialized[0]);

    if (drifted) {
      driftedFields++;
    } else {
      identicalFields++;
    }

    diffs.push({ field, values, drifted });
  }

  // Sort: drifted fields first, then identical
  diffs.sort((a, b) => {
    if (a.drifted && !b.drifted) return -1;
    if (!a.drifted && b.drifted) return 1;
    return a.field.localeCompare(b.field);
  });

  return {
    resource: { apiPath, name, namespace },
    clusters: succeededClusters,
    totalClusters: clusters.length,
    absentClusters,
    failedClusters,
    diffs,
    identicalFields,
    driftedFields,
  };
}
