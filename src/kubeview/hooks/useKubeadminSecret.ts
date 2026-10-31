import { useQuery } from '@tanstack/react-query';
import { readK8s } from '../engine/readResult';
import { useActiveClusterId } from './useClusterBase';

/**
 * Whether the kubeadmin login still exists.
 *
 * kubeadmin is the `kube-system/kubeadmin` Secret; there is no User object for
 * it, so looking for one always reported "removed". Only a 404 proves it is
 * gone — a 403 or failed read is unknown.
 */
export type KubeadminStatus = { state: 'present' } | { state: 'absent' } | { state: 'unknown'; reason: string };

/** Prefix of the query key; invalidating it refreshes the check on every cluster. */
export const KUBEADMIN_SECRET_QUERY_KEY = ['users', 'kubeadmin-secret'] as const;

export function useKubeadminSecret() {
  const clusterId = useActiveClusterId();
  return useQuery<KubeadminStatus>({
    queryKey: [...KUBEADMIN_SECRET_QUERY_KEY, clusterId],
    queryFn: async () => {
      const r = await readK8s('/api/v1/namespaces/kube-system/secrets/kubeadmin', clusterId);
      if (r.state === 'ok') return { state: 'present' };
      if (r.state === 'absent') return { state: 'absent' };
      return { state: 'unknown', reason: r.reason };
    },
    staleTime: 60000,
  });
}
