import { cn } from '@/lib/utils';
import { detectResourceStatus } from '../../engine/renderers/statusUtils';
import type { K8sResource } from '../../engine/renderers';

export function StatusBadge({ resource }: { resource: K8sResource }) {
  const { status, reason } = detectResourceStatus(resource);

  if (status === 'unknown') return null;

  const colorMap: Record<string, string> = {
    healthy: 'bg-green-900/50 text-green-300 border-green-700',
    warning: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
    error: 'bg-red-900/50 text-red-300 border-red-700',
    pending: 'bg-blue-900/50 text-blue-300 border-blue-700',
    terminating: 'bg-orange-900/50 text-orange-300 border-orange-700',
  };

  const colorClass = colorMap[status] || 'bg-slate-900/50 text-slate-400 border-slate-700';

  return (
    <span className={cn('px-2 py-1 text-xs rounded border', colorClass)}>
      {reason}
    </span>
  );
}
