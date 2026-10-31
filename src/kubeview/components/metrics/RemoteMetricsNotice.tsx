import { BarChart3 } from 'lucide-react';
import { EmptyState } from '../primitives/EmptyState';
import { useFleetStore } from '../../store/fleetStore';
import { cn } from '@/lib/utils';

/**
 * Shown in place of Prometheus/Alertmanager data while a remote cluster is
 * active. Pulse reaches only the local cluster's monitoring stack, so drawing
 * those numbers under a remote cluster's name would be wrong, not empty.
 */
export function RemoteMetricsNotice({ what = 'Metrics', compact, className }: { what?: string; compact?: boolean; className?: string }) {
  const name = useFleetStore(s => s.clusters.find(c => c.id === s.activeClusterId)?.name ?? s.activeClusterId);
  const description = `${what} come from the local cluster's Prometheus, which is the only one Pulse can reach. They are hidden for ${name} so they are not mistaken for its own. Switch to Local Cluster to see them.`;
  if (compact) {
    return <p role="note" className={cn('text-xs text-slate-500', className)}>{what} are available for the local cluster only.</p>;
  }
  return <EmptyState icon={<BarChart3 className="h-8 w-8" />} title={`${what} are available for the local cluster only`} description={description} className={className} />;
}
