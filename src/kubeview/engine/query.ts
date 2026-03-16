/**
 * TanStack Query Hooks for Kubernetes Resources
 * Provides hooks for fetching, creating, updating, and watching K8s resources.
 */

import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { useEffect, useState, useMemo } from 'react';
import { watchManager, type WatchEvent } from './watch';

const BASE = '/api/kubernetes';

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

  const response = await fetch(url);

  if (!response.ok) {
    const error: K8sError = await response.json();
    throw new Error(error.message || `Failed to list resources: ${response.statusText}`);
  }

  const data: K8sListResponse<T> = await response.json();
  return data.items;
}

/**
 * Get a single resource
 */
export async function k8sGet<T>(apiPath: string): Promise<T> {
  const response = await fetch(`${BASE}${apiPath}`);

  if (!response.ok) {
    const error: K8sError = await response.json();
    throw new Error(error.message || `Failed to get resource: ${response.statusText}`);
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
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error: K8sError = await response.json();
    throw new Error(error.message || `Failed to create resource: ${response.statusText}`);
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
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error: K8sError = await response.json();
    throw new Error(error.message || `Failed to update resource: ${response.statusText}`);
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
    },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    const error: K8sError = await response.json();
    throw new Error(error.message || `Failed to patch resource: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Delete a resource
 */
export async function k8sDelete(apiPath: string): Promise<void> {
  const response = await fetch(`${BASE}${apiPath}`, {
    method: 'DELETE',
  });

  if (!response.ok && response.status !== 404) {
    const error: K8sError = await response.json();
    throw new Error(error.message || `Failed to delete resource: ${response.statusText}`);
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

/**
 * Hook to watch resources with real-time updates
 * Combines initial list fetch with WebSocket watch for live updates
 */
export function useK8sWatch<T extends { metadata: { uid: string; resourceVersion?: string } }>(
  apiPath: string,
  namespace?: string
) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['k8s', 'list', apiPath, namespace], [apiPath, namespace]);

  // Initial fetch
  const { data: initialData, isLoading, error } = useK8sList<T>(apiPath, namespace, {
    refetchInterval: false, // Don't poll, we'll use watch
  });

  const [data, setData] = useState<T[]>(initialData || []);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
    }
  }, [initialData]);

  useEffect(() => {
    if (!initialData) {
      return;
    }

    // Build watch path
    let watchPath = apiPath;
    if (namespace && namespace !== 'all' && !apiPath.includes('/namespaces/')) {
      const parts = apiPath.split('/');
      const resourceIndex = parts.length - 1;
      parts.splice(resourceIndex, 0, 'namespaces', namespace);
      watchPath = parts.join('/');
    }

    // Get latest resource version from initial data
    const resourceVersion = initialData.length > 0
      ? initialData[0].metadata.resourceVersion
      : undefined;

    // Start watching
    const subscription = watchManager.watch<T>(
      watchPath,
      (event: WatchEvent<T>) => {
        setData((current) => {
          const updated = [...current];
          const uid = event.object.metadata.uid;
          const index = updated.findIndex((item) => item.metadata.uid === uid);

          if (event.type === 'ADDED') {
            if (index === -1) {
              updated.push(event.object);
            }
          } else if (event.type === 'MODIFIED') {
            if (index !== -1) {
              updated[index] = event.object;
            } else {
              updated.push(event.object);
            }
          } else if (event.type === 'DELETED') {
            if (index !== -1) {
              updated.splice(index, 1);
            }
          }

          // Update the query cache
          queryClient.setQueryData(queryKey, updated);

          return updated;
        });
      },
      resourceVersion
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [apiPath, namespace, initialData, queryClient, queryKey]);

  return {
    data,
    isLoading,
    error,
  };
}

/**
 * Hook to create a resource
 */
export function useK8sCreate<T>(apiPath: string) {
  const queryClient = useQueryClient();

  return useMutation<T, Error, T>({
    mutationFn: (body: T) => k8sCreate(apiPath, body),
    onSuccess: () => {
      // Invalidate list queries for this resource type
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list', apiPath] });
    },
  });
}

/**
 * Hook to update a resource
 */
export function useK8sUpdate<T>(apiPath: string) {
  const queryClient = useQueryClient();

  return useMutation<T, Error, T>({
    mutationFn: (body: T) => k8sUpdate(apiPath, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['k8s', 'get', apiPath] });
      // Also invalidate list queries
      const basePath = apiPath.split('/').slice(0, -1).join('/');
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list', basePath] });
    },
  });
}

/**
 * Hook to patch a resource
 */
export function useK8sPatch(apiPath: string) {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, { patch: unknown; patchType?: string }>({
    mutationFn: ({ patch, patchType }) => k8sPatch(apiPath, patch, patchType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['k8s', 'get', apiPath] });
      // Also invalidate list queries
      const basePath = apiPath.split('/').slice(0, -1).join('/');
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list', basePath] });
    },
  });
}

/**
 * Hook to delete a resource
 */
export function useK8sDelete(apiPath: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, void>({
    mutationFn: () => k8sDelete(apiPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['k8s', 'get', apiPath] });
      // Also invalidate list queries
      const basePath = apiPath.split('/').slice(0, -1).join('/');
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list', basePath] });
    },
  });
}

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

  if (body && method !== 'GET') {
    options.headers = {
      'Content-Type': 'application/json',
    };
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error: K8sError = await response.json();
    throw new Error(error.message || `Failed to execute ${subresource}: ${response.statusText}`);
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

  const response = await fetch(url);

  if (!response.ok) {
    const error: K8sError = await response.json();
    throw new Error(error.message || `Failed to get logs: ${response.statusText}`);
  }

  return response.text();
}
