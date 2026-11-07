/**
 * ClusterTypeSummary — cluster-type-aware summary card.
 * HyperShift: hosted CP info, NodePool counts, worker totals.
 * Regular: master node health, etcd leader status, platform info.
 */

import { useQuery } from '@tanstack/react-query';
import { Cloud, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import { queryInstant } from '../../components/metrics/prometheus';
import { describeReadError } from '../../engine/readError';
import type { NodePool, Condition } from '../../engine/types';
import type { NodeDetail } from './types';
import { useActiveClusterId } from '../../hooks/useClusterBase';

interface Props {
  isHyperShift: boolean;
  nodeDetails: NodeDetail[];
  nodePools: NodePool[];
  clusterVersion: string | null;
  platform: string | null;
}

/** `reason` (why a value is unknown) is a tooltip for sighted users and read out by screen readers. */
function KV({ label, value, status, reason, muted }: { label: string; value: string; status?: 'ok' | 'warn' | 'error'; reason?: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-faint mb-0.5">{label}</div>
      <div title={reason} className={cn(
        'text-sm font-semibold',
        status === 'error' ? 'text-red-400' : status === 'warn' ? 'text-amber-400' : reason || muted ? 'text-slate-400' : 'text-slate-100',
      )}>{value}{reason && <span className="sr-only">: {reason}</span>}</div>
    </div>
  );
}

export function ClusterTypeSummary({ isHyperShift, nodeDetails, nodePools, clusterVersion, platform }: Props) {
  if (isHyperShift) {
    return <HyperShiftSummary nodePools={nodePools} clusterVersion={clusterVersion} platform={platform} nodeDetails={nodeDetails} />;
  }
  return <RegularSummary nodeDetails={nodeDetails} clusterVersion={clusterVersion} platform={platform} />;
}

function HyperShiftSummary({ nodePools, clusterVersion, platform, nodeDetails }: {
  nodePools: NodePool[]; clusterVersion: string | null; platform: string | null; nodeDetails: NodeDetail[];
}) {
  const nps = nodePools;
  const totalDesired = nps.reduce((s, np) => s + (np.spec?.replicas ?? 0), 0);
  const totalReady = nps.reduce((s, np) => s + (np.status?.replicas ?? 0), 0);
  const unhealthy = nps.filter(np => {
    const conditions = np.status?.conditions || [];
    return conditions.some((c: Condition) => c.type === 'Ready' && c.status !== 'True');
  });
  const workerCount = nodeDetails.filter(nd => nd.roles.includes('worker')).length;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Cloud className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-slate-100">Hosted Control Plane</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KV label="Topology" value="Hosted (External)" />
        <KV label="Platform" value={platform || 'Unknown'} />
        <KV label="Version" value={clusterVersion || '—'} />
        <KV label="NodePools" value={`${nodePools.length}`} status={unhealthy.length > 0 ? 'warn' : 'ok'} />
        <KV label="Workers" value={`${totalReady}/${totalDesired} ready (${workerCount} nodes)`} status={totalReady < totalDesired ? 'warn' : 'ok'} />
      </div>
      <p className="text-[11px] text-faint mt-3">Control plane runs externally on the management cluster. Only worker nodes are visible.</p>
    </Card>
  );
}

function RegularSummary({ nodeDetails, clusterVersion, platform }: {
  nodeDetails: NodeDetail[]; clusterVersion: string | null; platform: string | null;
}) {
  const clusterId = useActiveClusterId();
  const masters = nodeDetails.filter(nd => nd.roles.includes('master') || nd.roles.includes('control-plane'));
  const mastersReady = masters.filter(nd => nd.status.ready).length;
  const allReady = mastersReady === masters.length && masters.length > 0;

  const { data: etcdData, isPending: etcdPending, isError: etcdFailed, error: etcdError } = useQuery({
    queryKey: ['compute', 'etcd-leader', clusterId],
    queryFn: () => queryInstant('max(etcd_server_has_leader)', undefined, clusterId),
    refetchInterval: 30000,
  });
  const etcdHasLeader = Array.isArray(etcdData) && etcdData.length > 0 && Number(etcdData[0]?.value) === 1;
  const etcdUnknown = !Array.isArray(etcdData) || etcdData.length === 0;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-slate-100">Control Plane</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KV label="Topology" value="Self-Managed" />
        <KV label="Platform" value={platform || 'Unknown'} />
        <KV label="Version" value={clusterVersion || '—'} />
        <KV label="Master Nodes" value={masters.length > 0 ? `${mastersReady}/${masters.length} ready` : 'None'} status={!allReady ? 'error' : 'ok'} />
        {/* A failed read is "Could not check", not "No Leader" or a quiet "Unknown". */}
        <KV
          label="etcd Leader"
          value={etcdFailed ? 'Could not check' : etcdPending ? 'Checking…' : etcdUnknown ? 'No data' : etcdHasLeader ? 'Elected' : 'No Leader'}
          reason={etcdFailed ? describeReadError(etcdError).reason : undefined}
          muted={etcdPending || etcdUnknown}
          status={etcdFailed || etcdPending || etcdUnknown ? undefined : etcdHasLeader ? 'ok' : 'error'}
        />
      </div>
    </Card>
  );
}
