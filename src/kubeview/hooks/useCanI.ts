/**
 * useCanI — RBAC permission check hook.
 *
 * Uses the SelfSubjectAccessReview API to check if the current user
 * can perform a specific action on a resource. Caches results for 5 minutes.
 */

import { useQuery } from '@tanstack/react-query';
import { k8sFetch } from '../engine/query';
import { useFleetStore } from '../store/fleetStore';
import { useUIStore } from '../store/uiStore';

interface AccessReviewSpec {
  verb: string;       // "get", "list", "create", "update", "delete", "patch"
  group: string;      // "" for core, "apps" etc
  resource: string;   // "pods", "deployments" etc
  namespace?: string; // optional — omit for cluster-scoped check
  subresource?: string; // e.g. "approval" for certificatesigningrequests/approval
  name?: string;      // one object, for roles scoped by resourceNames
}

const WRITE_VERBS = new Set(['create', 'update', 'patch', 'delete', 'deletecollection']);

// When the review itself fails (network error, non-2xx), write verbs fail
// closed — a button stays disabled rather than offering a write the user may
// not have. Read verbs fail open: hiding a view because the review endpoint
// hiccupped would be worse, and the read itself is still enforced by the API
// server, which returns its own 403.

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
          ...(spec.subresource ? { subresource: spec.subresource } : {}),
          ...(spec.name ? { name: spec.name } : {}),
        },
      },
    };

    // Through k8sFetch, like every other request: the review must ask the
    // cluster being acted on, as the user being impersonated, or the answer
    // describes someone else's permissions.
    const res = await k8sFetch(clusterId, '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) return failOpen;
    const data = await res.json();
    return data.status?.allowed === true;
  } catch {
    return failOpen;
  }
}

export function useCanI(verb: string, group: string, resource: string, namespace?: string, subresource?: string, opts: { enabled?: boolean; clusterId?: string; name?: string } = {}) {
  // A pinned dialog asks about the cluster it was opened on, not whichever is active now.
  const activeClusterId = useFleetStore((s) => s.activeClusterId);
  const clusterId = opts.clusterId ?? activeClusterId;
  // The answer is about whoever the request runs as, so impersonation is part
  // of the cache key: an admin's "allowed" must not be reused after they start
  // impersonating someone else.
  const impersonateUser = useUIStore((s) => s.impersonateUser);
  // Joined in the selector so the key is a stable string (and partial store
  // mocks without groups still work).
  const impersonateGroups = useUIStore((s) => (s.impersonateGroups ?? []).join(','));
  const failOpen = !WRITE_VERBS.has(verb);
  const enabled = opts.enabled ?? true;
  const { data: allowed = failOpen, isLoading } = useQuery({
    queryKey: ['rbac', 'can-i', verb, group, resource, namespace, subresource, clusterId, impersonateUser ?? '', impersonateGroups, ...(opts.name ? [opts.name] : [])],
    queryFn: () => checkAccess({ verb, group, resource, namespace, subresource, name: opts.name }, clusterId),
    enabled,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000,
  });

  return { allowed: enabled ? allowed : false, isLoading: enabled && isLoading };
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
