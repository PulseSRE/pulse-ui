/**
 * TanStack Query Hooks for Kubernetes Resources
 * Provides hooks for fetching, creating, updating, and watching K8s resources.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

import { K8S_BASE as BASE } from './gvr';
import { getClusterBase } from './clusterConnection';
import { useUIStore } from '../store/uiStore';
import { parseK8sErrorResponse, wrapNetworkError } from './errors';
import type { K8sResource } from './renderers';


/** Sanitize a value for safe interpolation into PromQL label matchers */
export function sanitizePromQL(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-./]/g, '');
}

/** Sanitize a header value to prevent CRLF injection */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, '');
}

/**
 * Get impersonation headers if impersonation is active.
 */
export function getImpersonationHeaders(): Record<string, string> {
  const { impersonateUser, impersonateGroups } = useUIStore.getState();
  if (!impersonateUser) return {};
  const headers: Record<string, string> = { 'Impersonate-User': sanitizeHeaderValue(impersonateUser) };
  if (impersonateGroups.length > 0) {
    headers['Impersonate-Group'] = impersonateGroups.map(sanitizeHeaderValue).join(',');
  }
  return headers;
}

interface K8sListResponse<T> {
  apiVersion: string;
  kind: string;
  metadata: {
    resourceVersion: string;
    continue?: string;
  };
  items: T[];
}

/**
 * List resources
 */
export async function k8sList<T = K8sResource>(
  apiPath: string,
  namespace?: string,
  clusterId?: string
): Promise<T[]> {
  const base = getClusterBase(clusterId);
  let url = `${base}${apiPath}`;

  // Add namespace to path if specified and not "all"
  if (namespace && namespace !== 'all' && !apiPath.includes('/namespaces/')) {
    const parts = apiPath.split('/');
    const resourceIndex = parts.length - 1;
    parts.splice(resourceIndex, 0, 'namespaces', namespace);
    url = `${base}${parts.join('/')}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers: getImpersonationHeaders() });
  } catch (e) {
    throw wrapNetworkError(e, { operation: 'list', apiPath });
  }

  if (!response.ok) {

    throw await parseK8sErrorResponse(response, { operation: 'list', apiPath });
  }

  const data: K8sListResponse<T> = await response.json();

  // K8s list items often omit apiVersion/kind — stamp from list metadata
  const itemApiVersion = data.apiVersion;
  const itemKind = data.kind?.replace(/List$/, '') || '';
  return data.items.map((item: any) => ({
    ...item,
    apiVersion: item.apiVersion || itemApiVersion,
    kind: item.kind || itemKind,
  }));
}

/**
 * Get a single resource
 */
export async function k8sGet<T = K8sResource>(apiPath: string, clusterId?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getClusterBase(clusterId)}${apiPath}`, { headers: getImpersonationHeaders() });
  } catch (e) {
    throw wrapNetworkError(e, { operation: 'get', apiPath });
  }

  if (!response.ok) {

    throw await parseK8sErrorResponse(response, { operation: 'get', apiPath });
  }

  return response.json();
}

/**
 * Create a resource
 */
export async function k8sCreate<T>(apiPath: string, body: T, clusterId?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getClusterBase(clusterId)}${apiPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getImpersonationHeaders(),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw wrapNetworkError(e, { operation: 'create', apiPath });
  }

  if (!response.ok) {

    throw await parseK8sErrorResponse(response, { operation: 'create', apiPath });
  }

  return response.json();
}

/**
 * Update a resource (full replace)
 */
export async function k8sUpdate<T>(apiPath: string, body: T, clusterId?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getClusterBase(clusterId)}${apiPath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getImpersonationHeaders(),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw wrapNetworkError(e, { operation: 'update', apiPath });
  }

  if (!response.ok) {

    throw await parseK8sErrorResponse(response, { operation: 'update', apiPath });
  }

  return response.json();
}

/**
 * Patch a resource
 */
export async function k8sPatch<T>(
  apiPath: string,
  patch: unknown,
  patchType: string = 'application/strategic-merge-patch+json',
  clusterId?: string
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getClusterBase(clusterId)}${apiPath}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': patchType,
        ...getImpersonationHeaders(),
      },
      body: JSON.stringify(patch),
    });
  } catch (e) {
    throw wrapNetworkError(e, { operation: 'patch', apiPath });
  }

  if (!response.ok) {

    throw await parseK8sErrorResponse(response, { operation: 'patch', apiPath });
  }

  return response.json();
}

/**
 * Delete a resource
 */
export async function k8sDelete(apiPath: string, clusterId?: string): Promise<void> {
  const base = getClusterBase(clusterId);
  // For scalable resources, scale to 0 first so pods terminate cleanly
  // before the resource is deleted. This prevents orphaned pods and
  // makes delete faster (no waiting for GC).
  if (/\/(deployments|statefulsets|replicasets)\/[^/]+$/.test(apiPath)) {
    try {
      await fetch(`${base}${apiPath}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/strategic-merge-patch+json', ...getImpersonationHeaders() },
        body: JSON.stringify({ spec: { replicas: 0 } }),
      });
    } catch {
      // Scale-down is best-effort — continue with delete even if it fails
    }
  }

  let response: Response;
  try {
    response = await fetch(`${base}${apiPath}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...getImpersonationHeaders(),
      },
      body: JSON.stringify({
        kind: 'DeleteOptions',
        apiVersion: 'v1',
        propagationPolicy: 'Background',
      }),
    });
  } catch (e) {
    throw wrapNetworkError(e, { operation: 'delete', apiPath });
  }

  if (!response.ok && response.status !== 404) {

    throw await parseK8sErrorResponse(response, { operation: 'delete', apiPath });
  }
}

/**
 * Hook to list resources
 */
export function useK8sList<T = K8sResource>(
  apiPath: string,
  namespace?: string,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
    clusterId?: string;
  }
) {
  return useQuery<T[], Error>({
    queryKey: ['k8s', 'list', apiPath, namespace, options?.clusterId],
    queryFn: () => k8sList<T>(apiPath, namespace, options?.clusterId),
    enabled: options?.enabled !== false,
    refetchInterval: options?.refetchInterval,
  } as UseQueryOptions<T[], Error>);
}

// Note: useK8sWatch was removed — it had race conditions (stale data, missing list resourceVersion).
// Real-time updates are handled by useClusterHealthData which uses WebSocket watches to invalidate queries.
// useK8sCreate, useK8sUpdate, useK8sPatch, useK8sDelete hooks were also removed
// as they were never adopted. Views use raw k8sCreate/k8sPatch/k8sDelete directly.
// If hooks are needed in the future, wrap the raw functions with useMutation.

/**
 * Get logs from a Pod
 */
export async function k8sLogs(
  namespace: string,
  podName: string,
  containerName?: string,
  options?: {
    follow?: boolean;
    tailLines?: number;
    timestamps?: boolean;
    sinceSeconds?: number;
  },
  clusterId?: string
): Promise<string> {
  let url = `${getClusterBase(clusterId)}/api/v1/namespaces/${namespace}/pods/${podName}/log`;
  const params = new URLSearchParams();

  if (containerName) {
    params.set('container', containerName);
  }
  if (options?.tailLines) {
    params.set('tailLines', options.tailLines.toString());
  }
  if (options?.timestamps) {
    params.set('timestamps', 'true');
  }
  if (options?.sinceSeconds) {
    params.set('sinceSeconds', options.sinceSeconds.toString());
  }

  const queryString = params.toString();
  if (queryString) {
    url += `?${queryString}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers: getImpersonationHeaders() });
  } catch (e) {
    throw wrapNetworkError(e, { operation: 'logs', apiPath: `/api/v1/namespaces/${namespace}/pods/${podName}/log` });
  }

  if (!response.ok) {
    throw await parseK8sErrorResponse(response, { operation: 'logs', apiPath: `/api/v1/namespaces/${namespace}/pods/${podName}/log` });
  }

  return response.text();
}
