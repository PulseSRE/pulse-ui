/**
 * useCanI — RBAC permission check hook.
 *
 * Uses the SelfSubjectAccessReview API to check if the current user
 * can perform a specific action on a resource. Caches results for 5 minutes.
 */

import { useQuery } from '@tanstack/react-query';
import { getClusterBase } from '../engine/clusterConnection';
import { getImpersonationHeaders } from '../engine/query';
import { useFleetStore } from '../store/fleetStore';

interface AccessReviewSpec {
  verb: string;       // "get", "list", "create", "update", "delete", "patch"
  group: string;      // "" for core, "apps" etc
  resource: string;   // "pods", "deployments" etc
  namespace?: string; // optional — omit for cluster-scoped check
}

const WRITE_VERBS = new Set(['create', 'update', 'patch', 'delete', 'deletecollection']);

async function checkAccess(spec: AccessReviewSpec, clusterId: string): Promise<boolean> {
  const failOpen = !WRITE_VERBS.has(spec.verb);
  try {
    const body = {
      apiVersion: 'authorization.k8s.io/v1',
      kind: 'SelfSubjectAccessReview',
      spec: {
        resourceAttributes: {
          verb: spec.verb,
          group: spec.group,
          resource: spec.resource,
          ...(spec.namespace ? { namespace: spec.namespace } : {}),
        },
      },
    };

    const res = await fetch(`${getClusterBase(clusterId)}/apis/authorization.k8s.io/v1/selfsubjectaccessreviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getImpersonationHeaders() },
      body: JSON.stringify(body),
    });

    if (!res.ok) return failOpen;
    const data = await res.json();
    return data.status?.allowed === true;
  } catch {
    return failOpen;
  }
}

export function useCanI(verb: string, group: string, resource: string, namespace?: string) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const failOpen = !WRITE_VERBS.has(verb);
  const { data: allowed = failOpen, isLoading } = useQuery({
    queryKey: ['rbac', 'can-i', verb, group, resource, namespace, clusterId],
    queryFn: () => checkAccess({ verb, group, resource, namespace }, clusterId),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000,
  });

  return { allowed, isLoading };
}

/**
 * Common permission checks
 */
export function useCanDelete(group: string, resource: string, namespace?: string) {
  return useCanI('delete', group, resource, namespace);
}

export function useCanCreate(group: string, resource: string, namespace?: string) {
  return useCanI('create', group, resource, namespace);
}

export function useCanUpdate(group: string, resource: string, namespace?: string) {
  return useCanI('update', group, resource, namespace);
}
