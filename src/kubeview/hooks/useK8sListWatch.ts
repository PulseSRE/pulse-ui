/**
 * useK8sListWatch — List + Watch hook for Kubernetes resources.
 *
 * Fetches the initial list via REST, then opens a WebSocket watch
 * for real-time updates. On ADDED/MODIFIED/DELETED events, updates
 * the query cache directly (no refetch needed).
 *
 * Falls back to polling if WebSocket fails (e.g. proxy doesn't support WS).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { k8sList } from '../engine/query';
import { watchManager, type WatchEvent } from '../engine/watch';
import type { K8sResource } from '../engine/renderers';
import { useUIStore } from '../store/uiStore';

const FALLBACK_POLL_INTERVAL = 60_000; // Only poll as safety net

interface UseK8sListWatchOptions {
  /** Full API path without BASE, e.g. "/api/v1/pods" or "/apis/apps/v1/deployments" */
  apiPath: string;
  /** Namespace to filter by (passed to k8sList) */
  namespace?: string;
  /** Whether the query is enabled */
  enabled?: boolean;
}

export function useK8sListWatch<T extends K8sResource = K8sResource>({
  apiPath,
  namespace,
  enabled = true,
}: UseK8sListWatchOptions) {
  const queryClient = useQueryClient();
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus);
  const watchFailed = useRef(false);

  const queryKey = ['k8s', 'list', apiPath, namespace];

  const query = useQuery<T[]>({
    queryKey,
    queryFn: () => k8sList<T>(apiPath, namespace),
    enabled,
    // Only poll as fallback if watch connection failed
    refetchInterval: watchFailed.current ? FALLBACK_POLL_INTERVAL : false,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!enabled || !apiPath) return;

    // Build the watch path (with namespace if needed)
    let watchPath = apiPath;
    if (namespace && namespace !== '*' && !apiPath.includes('/namespaces/')) {
      const parts = apiPath.split('/');
      const resourceIndex = parts.length - 1;
      const newParts = [...parts];
      newParts.splice(resourceIndex, 0, 'namespaces', namespace);
      watchPath = newParts.join('/');
    }

    let subscription: { unsubscribe: () => void } | null = null;

    try {
      subscription = watchManager.watch<T>(
        watchPath,
        (event: WatchEvent<T>) => {
          if (event.type === 'ADDED' || event.type === 'MODIFIED' || event.type === 'DELETED') {
            // Update cache directly for instant UI feedback
            queryClient.setQueryData<T[]>(queryKey, (old) => {
              if (!old) return old;

              const uid = (event.object as any).metadata?.uid;
              if (!uid) return old;

              if (event.type === 'DELETED') {
                return old.filter((item) => item.metadata.uid !== uid);
              }

              const idx = old.findIndex((item) => item.metadata.uid === uid);
              if (event.type === 'ADDED' && idx === -1) {
                return [...old, event.object];
              }
              if (event.type === 'MODIFIED' && idx !== -1) {
                const updated = [...old];
                updated[idx] = event.object;
                return updated;
              }
              if (event.type === 'MODIFIED' && idx === -1) {
                return [...old, event.object];
              }
              return old;
            });

            setConnectionStatus('connected');
          }
        },
      );

      watchFailed.current = false;
    } catch {
      // WebSocket not available — fall back to polling
      watchFailed.current = true;
    }

    return () => {
      subscription?.unsubscribe();
    };
  }, [apiPath, namespace, enabled, queryClient, setConnectionStatus]);

  return query;
}
