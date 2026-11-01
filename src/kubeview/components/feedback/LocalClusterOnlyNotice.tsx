import { Network } from 'lucide-react';
import { EmptyState } from '../primitives/EmptyState';
import { useFleetStore } from '../../store/fleetStore';

/**
 * For pages whose data comes from the Pulse agent, which watches the cluster
 * it runs on (the local cluster) only. With a remote cluster active they
 * would show the local cluster's resources as if they were the remote one's,
 * so they show this instead. Same wording as RemoteMetricsNotice.
 */
export function LocalClusterOnlyNotice({ what, className }: { what: string; className?: string }) {
  const name = useFleetStore((s) => s.clusters.find((c) => c.id === s.activeClusterId)?.name ?? s.activeClusterId);
  return (
    <EmptyState
      icon={<Network className="h-8 w-8" />}
      title={`${what} is available for the local cluster only`}
      description={`${what} comes from the Pulse agent, which watches the local cluster only. It is hidden for ${name} so the local cluster's resources are not mistaken for its own. Switch to Local Cluster to see it.`}
      className={className}
    />
  );
}
