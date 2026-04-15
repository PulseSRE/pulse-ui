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
import { safeQuery } from '../../engine/safeQuery';
import type { K8sResource } from '../../engine/renderers';
import type { NodePool, Condition } from '../../engine/types';
import type { NodeDetail } from './types';

interface Props {
  isHyperShift: boolean;
  nodeDetails: NodeDetail[];
  nodePools: K8sResource[];
  clusterVersion: string | null;
  platform: string | null;
}

function KV({ label, value, status }: { label: string; value: string; status?: 'ok' | 'warn' | 'error' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
      <div className={cn(
        'text-sm font-semibold',
        status === 'error' ? 'text-red-400' : status === 'warn' ? 'text-amber-400' : 'text-slate-100',
      )}>{value}</div>
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
  nodePools: K8sResource[]; clusterVersion: string | null; platform: string | null; nodeDetails: NodeDetail[];
}) {
  const nps = nodePools as unknown as NodePool[];
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
        <Cloud className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-semibold text-slate-100">Hosted Control Plane</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KV label="Topology" value="Hosted (External)" />
        <KV label="Platform" value={platform || 'Unknown'} />
        <KV label="Version" value={clusterVersion || '—'} />
        <KV label="NodePools" value={`${nodePools.length}`} status={unhealthy.length > 0 ? 'warn' : 'ok'} />
        <KV label="Workers" value={`${totalReady}/${totalDesired} ready (${workerCount} nodes)`} status={totalReady < totalDesired ? 'warn' : 'ok'} />
      </div>
      <p className="text-[11px] text-slate-500 mt-3">Control plane runs externally on the management cluster. Only worker nodes are visible.</p>
    </Card>
  );
}

function RegularSummary({ nodeDetails, clusterVersion, platform }: {
  nodeDetails: NodeDetail[]; clusterVersion: string | null; platform: string | null;
}) {
  const masters = nodeDetails.filter(nd => nd.roles.includes('master') || nd.roles.includes('control-plane'));
  const mastersReady = masters.filter(nd => nd.status.ready).length;
  const allReady = mastersReady === masters.length && masters.length > 0;

  const { data: etcdData } = useQuery({
    queryKey: ['compute', 'etcd-leader'],
    queryFn: async () => (await safeQuery(() => queryInstant('max(etcd_server_has_leader)'))) ?? [],
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
        <KV label="etcd Leader" value={etcdUnknown ? 'Unknown' : etcdHasLeader ? 'Elected' : 'No Leader'} status={etcdUnknown ? undefined : etcdHasLeader ? 'ok' : 'error'} />
      </div>
    </Card>
  );
}
