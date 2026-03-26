/**
 * usePrefetchOnHover — Prefetch K8s data on hover/focus so navigation feels instant.
 *
 * Returns { onMouseEnter, onFocus } handlers. When fired, waits 150ms (debounce)
 * then prefetches the TanStack Query cache entries the target view will need.
 * Uses the same query keys as useK8sListWatch so prefetched data is reused.
 */

import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { k8sList } from '../engine/query';
import { useUIStore } from '../store/uiStore';

const DEBOUNCE_MS = 150;
const PREFETCH_STALE_TIME = 30_000;

/**
 * Map of view paths to the K8s API paths they fetch on mount.
 * These must match the apiPath values used by each view's useK8sListWatch calls.
 */
const VIEW_DATA_REQUIREMENTS: Record<string, string[]> = {
  '/workloads': [
    '/apis/apps/v1/deployments',
    '/api/v1/pods',
    '/apis/apps/v1/statefulsets',
    '/apis/apps/v1/daemonsets',
    '/apis/batch/v1/jobs',
    '/apis/batch/v1/cronjobs',
    '/apis/apps/v1/replicasets',
    '/apis/policy/v1/poddisruptionbudgets',
  ],
  '/compute': [
    '/api/v1/nodes',
    '/api/v1/pods',
  ],
  '/storage': [
    '/api/v1/persistentvolumeclaims',
    '/api/v1/persistentvolumes',
    '/api/v1/resourcequotas',
  ],
  '/networking': [
    '/api/v1/services',
    '/apis/networking.k8s.io/v1/ingresses',
    '/apis/route.openshift.io/v1/routes',
    '/apis/networking.k8s.io/v1/networkpolicies',
  ],
  '/alerts': [],  // Alerts use Prometheus endpoints, not k8sList
  '/security': [
    '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings',
    '/apis/networking.k8s.io/v1/networkpolicies',
    '/api/v1/namespaces',
  ],
  '/access-control': [
    '/apis/rbac.authorization.k8s.io/v1/clusterroles',
    '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings',
    '/apis/rbac.authorization.k8s.io/v1/roles',
    '/apis/rbac.authorization.k8s.io/v1/rolebindings',
    '/api/v1/serviceaccounts',
    '/api/v1/namespaces',
  ],
  '/pulse': [
    '/api/v1/nodes',
    '/api/v1/pods',
    '/apis/apps/v1/deployments',
    '/api/v1/persistentvolumeclaims',
    '/apis/config.openshift.io/v1/clusteroperators',
  ],
  '/builds': [
    '/apis/build.openshift.io/v1/builds',
    '/apis/build.openshift.io/v1/buildconfigs',
    '/apis/image.openshift.io/v1/imagestreams',
  ],
  '/users': [
    '/apis/user.openshift.io/v1/users',
    '/api/v1/serviceaccounts',
  ],
};

/**
 * Convert a GVR URL segment (e.g. "apps~v1~deployments") to an API path.
 * Mirrors the logic in TableView and buildApiPath.
 */
function gvrUrlToApiPath(gvrSegment: string): string {
  const parts = gvrSegment.replace(/~/g, '/').split('/');
  if (parts.length === 2) {
    // Core: v1/pods -> /api/v1/pods
    return `/api/${parts[0]}/${parts[1]}`;
  }
  if (parts.length === 3) {
    // Group: apps/v1/deployments -> /apis/apps/v1/deployments
    return `/apis/${parts[0]}/${parts[1]}/${parts[2]}`;
  }
  return '';
}

/**
 * Resolve a navigation path to the list of API paths to prefetch.
 */
function getApiPathsForRoute(path: string): string[] {
  // Direct match for known views
  const direct = VIEW_DATA_REQUIREMENTS[path];
  if (direct) return direct;

  // Resource list paths: /r/{gvr}
  const resourceMatch = path.match(/^\/r\/([^/]+)$/);
  if (resourceMatch) {
    const apiPath = gvrUrlToApiPath(resourceMatch[1]);
    return apiPath ? [apiPath] : [];
  }

  return [];
}

/**
 * Hook that returns onMouseEnter and onFocus handlers which prefetch
 * the K8s data a target view will need, with 150ms debounce.
 */
export function usePrefetchOnHover(path: string) {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerPrefetch = useCallback(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      const apiPaths = getApiPathsForRoute(path);
      // Read namespace from store (same as views do)
      const namespace = useUIStore.getState().selectedNamespace;

      for (const apiPath of apiPaths) {
        // Use the same query key pattern as useK8sListWatch:
        // ['k8s', 'list', apiPath, namespace, clusterId]
        queryClient.prefetchQuery({
          queryKey: ['k8s', 'list', apiPath, namespace, undefined],
          queryFn: () => k8sList(apiPath, namespace),
          staleTime: PREFETCH_STALE_TIME,
        });
      }
    }, DEBOUNCE_MS);
  }, [path, queryClient]);

  const cancelPrefetch = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    onMouseEnter: triggerPrefetch,
    onFocus: triggerPrefetch,
    onMouseLeave: cancelPrefetch,
  };
}
