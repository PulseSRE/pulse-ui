/**
 * useK8sListWatch — List + Watch hook for Kubernetes resources.
 *
 * Fetches the initial list via REST, then opens a WebSocket watch
 * for real-time updates. On ADDED/MODIFIED/DELETED events, updates
 * the query cache directly (no refetch needed).
 *
 * Always does a background safety refetch every 60s in case events
 * are missed. WebSocket provides instant updates on top.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { k8sList } from '../engine/query';
import { watchManager, type WatchEvent } from '../engine/watch';
import type { K8sResource } from '../engine/renderers';
import { useUIStore } from '../store/uiStore';

const SAFETY_POLL_INTERVAL = 60_000;

interface UseK8sListWatchOptions {
  apiPath: string;
  namespace?: string;
  enabled?: boolean;
  clusterId?: string;
}

export function useK8sListWatch<T extends K8sResource = K8sResource>({
  apiPath,
  namespace,
  enabled = true,
  clusterId,
}: UseK8sListWatchOptions) {
  const queryClient = useQueryClient();
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus);

  const queryKey = ['k8s', 'list', apiPath, namespace, clusterId];

  const query = useQuery<T[]>({
    queryKey,
    queryFn: () => k8sList<T>(apiPath, namespace, clusterId),
    enabled,
    // Always poll as safety net (WebSocket provides instant updates on top)
    refetchInterval: SAFETY_POLL_INTERVAL,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!enabled || !apiPath) return;

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
            queryClient.setQueryData<T[]>(queryKey, (old) => {
              if (!old) return old;

              const uid = event.object.metadata?.uid;
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
        undefined, // resourceVersion
        clusterId,
      );
    } catch {
      // WebSocket not available — polling is always on as safety net
    }

    return () => {
      subscription?.unsubscribe();
    };
  }, [apiPath, namespace, enabled, clusterId, queryClient, setConnectionStatus]);

  return query;
}
