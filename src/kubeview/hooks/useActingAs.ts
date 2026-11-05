/**
 * Who a write runs as, for confirmations: "acting as <user>". The impersonated
 * user when impersonation is on; otherwise the signed-in user from
 * user.openshift.io/users/~. A failed lookup says so rather than guessing.
 */
import { useQuery } from '@tanstack/react-query';
import { k8sFetch } from '../engine/query';
import { useUIStore } from '../store/uiStore';

export function useActingAs(clusterId: string): string {
  const impersonateUser = useUIStore((s) => s.impersonateUser);
  const q = useQuery({
    queryKey: ['acting-as', clusterId],
    enabled: !impersonateUser,
    staleTime: 300_000,
    retry: false,
    queryFn: async () => {
      const res = await k8sFetch(clusterId, '/apis/user.openshift.io/v1/users/~');
      if (!res.ok) throw new Error(String(res.status));
      return ((await res.json())?.metadata?.name as string | undefined) ?? '';
    },
  });
  if (impersonateUser) return `acting as ${impersonateUser} (impersonated)`;
  if (q.isLoading) return 'acting as …';
  return q.data ? `acting as ${q.data}` : 'acting as your signed-in user (name could not be read)';
}
