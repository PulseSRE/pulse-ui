/**
 * GVR URL utilities — single source of truth for GVR encoding/decoding
 */

import { resolveKind, gvrSegment } from './kindRegistry';
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

/** URL segment (`group~version~plural`) for a kind, resolved against discovery. */
export function gvrUrlForKind(kind: string, apiVersion?: string): string {
  return gvrSegment(resolveKind(kind, apiVersion));
}

/**
 * Build a detail page URL from a K8sResource — the one builder for `/r/` detail
 * links. Group/version/plural/scope come from the discovered API resources
 * (then well-known kinds, then a guess). Cluster-scoped kinds never get a
 * namespace segment, even when the caller passes one (alert labels carry the
 * scraping namespace on Node alerts, for instance).
 */
export function resourceDetailUrl(resource: {
  apiVersion?: string;
  kind: string;
  metadata: { name: string; namespace?: string };
}): string {
  const resolved = resolveKind(resource.kind || '', resource.apiVersion || undefined);
  const ns = resolved.namespaced === false ? undefined : resource.metadata.namespace || undefined;
  const name = resource.metadata.name;
  return `/r/${gvrSegment(resolved)}/${ns ?? '_'}/${name}`;
}
