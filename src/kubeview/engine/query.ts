/**
 * TanStack Query Hooks for Kubernetes Resources
 * Provides hooks for fetching, creating, updating, and watching K8s resources.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

import { K8S_BASE as BASE } from './gvr';
import { useUIStore } from '../store/uiStore';

/** Sanitize a value for safe interpolation into PromQL label matchers */
export function sanitizePromQL(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-./]/g, '');
}

/**
 * Get impersonation headers if impersonation is active.
 */
function getImpersonationHeaders(): Record<string, string> {
  const { impersonateUser, impersonateGroups } = useUIStore.getState();
  if (!impersonateUser) return {};
  const headers: Record<string, string> = { 'Impersonate-User': impersonateUser };
  if (impersonateGroups.length > 0) {
    headers['Impersonate-Group'] = impersonateGroups.join(',');
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

interface K8sError {
  kind: string;
  apiVersion: string;
  message: string;
  reason: string;
  code: number;
}

/**
 * List resources
 */
export async function k8sList<T>(
  apiPath: string,
  namespace?: string
): Promise<T[]> {
  let url = `${BASE}${apiPath}`;

  // Add namespace to path if specified and not "all"
  if (namespace && namespace !== 'all' && !apiPath.includes('/namespaces/')) {
    const parts = apiPath.split('/');
    const resourceIndex = parts.length - 1;
    parts.splice(resourceIndex, 0, 'namespaces', namespace);
    url = `${BASE}${parts.join('/')}`;
  }

  const response = await fetch(url, { headers: getImpersonationHeaders() });

  if (!response.ok) {
    let message = `Failed to list resources: ${response.statusText}`;
    try { const error: K8sError = await response.json(); message = error.message || message; } catch {}
    throw new Error(message);
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
export async function k8sGet<T>(apiPath: string): Promise<T> {
  const response = await fetch(`${BASE}${apiPath}`, { headers: getImpersonationHeaders() });

  if (!response.ok) {
    let message = `Failed to get resource: ${response.statusText}`;
    try { const error: K8sError = await response.json(); message = error.message || message; } catch {}
    throw new Error(message);
  }

  return response.json();
}

/**
 * Create a resource
 */
export async function k8sCreate<T>(apiPath: string, body: T): Promise<T> {
  const response = await fetch(`${BASE}${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getImpersonationHeaders(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Failed to create resource: ${response.statusText}`;
    try { const error: K8sError = await response.json(); message = error.message || message; } catch {}
    throw new Error(message);
  }

  return response.json();
}

/**
 * Update a resource (full replace)
 */
export async function k8sUpdate<T>(apiPath: string, body: T): Promise<T> {
  const response = await fetch(`${BASE}${apiPath}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getImpersonationHeaders(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Failed to update resource: ${response.statusText}`;
    try { const error: K8sError = await response.json(); message = error.message || message; } catch {}
    throw new Error(message);
  }

  return response.json();
}

/**
 * Patch a resource
 */
export async function k8sPatch<T>(
  apiPath: string,
  patch: unknown,
  patchType: string = 'application/strategic-merge-patch+json'
): Promise<T> {
  const response = await fetch(`${BASE}${apiPath}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': patchType,
      ...getImpersonationHeaders(),
    },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    let message = `Failed to patch resource: ${response.statusText}`;
    try { const error: K8sError = await response.json(); message = error.message || message; } catch {}
    throw new Error(message);
  }

  return response.json();
}

/**
 * Delete a resource
 */
export async function k8sDelete(apiPath: string): Promise<void> {
  // For scalable resources, scale to 0 first so pods terminate cleanly
  // before the resource is deleted. This prevents orphaned pods and
  // makes delete faster (no waiting for GC).
  if (/\/(deployments|statefulsets|replicasets)\/[^/]+$/.test(apiPath)) {
    try {
      await fetch(`${BASE}${apiPath}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/strategic-merge-patch+json', ...getImpersonationHeaders() },
        body: JSON.stringify({ spec: { replicas: 0 } }),
      });
    } catch {
      // Scale-down is best-effort — continue with delete even if it fails
    }
  }

  const response = await fetch(`${BASE}${apiPath}`, {
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

  if (!response.ok && response.status !== 404) {
    let message = `Failed to delete resource: ${response.statusText}`;
    try { const error: K8sError = await response.json(); message = error.message || message; } catch {}
    throw new Error(message);
  }
}

/**
 * Hook to list resources
 */
export function useK8sList<T>(
  apiPath: string,
  namespace?: string,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
  }
) {
  return useQuery<T[], Error>({
    queryKey: ['k8s', 'list', apiPath, namespace],
    queryFn: () => k8sList<T>(apiPath, namespace),
    enabled: options?.enabled !== false,
    refetchInterval: options?.refetchInterval,
  } as UseQueryOptions<T[], Error>);
}

/**
 * Hook to get a single resource
 */
export function useK8sGet<T>(
  apiPath: string,
  options?: {
    enabled?: boolean;
  }
) {
  return useQuery<T, Error>({
    queryKey: ['k8s', 'get', apiPath],
    queryFn: () => k8sGet<T>(apiPath),
    enabled: options?.enabled !== false,
  } as UseQueryOptions<T, Error>);
}

// Note: useK8sWatch was removed — it had race conditions (stale data, missing list resourceVersion).
// Real-time updates are handled by useClusterHealthData which uses WebSocket watches to invalidate queries.
// useK8sCreate, useK8sUpdate, useK8sPatch, useK8sDelete hooks were also removed
// as they were never adopted. Views use raw k8sCreate/k8sPatch/k8sDelete directly.
// If hooks are needed in the future, wrap the raw functions with useMutation.

/**
 * Execute a subresource action (e.g., /scale, /status, /eviction)
 */
export async function k8sSubresource<T>(
  apiPath: string,
  subresource: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET',
  body?: unknown
): Promise<T> {
  const url = `${BASE}${apiPath}/${subresource}`;
  const options: RequestInit = {
    method,
  };

  options.headers = {
    ...getImpersonationHeaders(),
  };

  if (body && method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    let message = `Failed to execute ${subresource}: ${response.statusText}`;
    try { const error: K8sError = await response.json(); message = error.message || message; } catch {}
    throw new Error(message);
  }

  return response.json();
}

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
  }
): Promise<string> {
  let url = `${BASE}/api/v1/namespaces/${namespace}/pods/${podName}/log`;
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

  const response = await fetch(url, {
    headers: getImpersonationHeaders(),
  });

  if (!response.ok) {
    let message = `Failed to get logs: ${response.statusText}`;
    try { const error: K8sError = await response.json(); message = error.message || message; } catch {}
    throw new Error(message);
  }

  return response.text();
}
