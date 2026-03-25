/**
 * GVR URL utilities — single source of truth for GVR encoding/decoding
 */

import { kindToPlural } from './renderers/index';
import { getClusterBase } from './clusterConnection';

/**
 * Base URL for K8s API proxy.
 * DEPRECATED: Use getClusterBase(clusterId?) for multi-cluster support.
 * This getter is kept for backward compatibility — returns the active cluster's base.
 */
export const K8S_BASE = '/api/kubernetes';

/** Convert internal GVR key (apps/v1/deployments) to URL segment (apps~v1~deployments) */
export function gvrToUrl(gvrKey: string): string {
  return gvrKey.replace(/\//g, '~');
}

/** Convert URL segment (apps~v1~deployments) to internal GVR key (apps/v1/deployments) */
export function urlToGvr(gvrUrl: string): string {
  return gvrUrl.replace(/~/g, '/');
}

/** Build a detail page URL from a K8sResource */
export function resourceDetailUrl(resource: {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string };
}): string {
  const apiVersion = resource.apiVersion || 'v1';
  const kind = resource.kind || '';
  const [group, version] = apiVersion.includes('/')
    ? apiVersion.split('/')
    : ['', apiVersion];
  const plural = kindToPlural(kind);
  const gvr = group ? `${group}~${version}~${plural}` : `${version}~${plural}`;
  const ns = resource.metadata.namespace;
  return ns ? `/r/${gvr}/${ns}/${resource.metadata.name}` : `/r/${gvr}/_/${resource.metadata.name}`;
}
