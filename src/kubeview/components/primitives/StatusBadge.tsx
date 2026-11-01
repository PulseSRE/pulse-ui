import { cn } from '@/lib/utils';
import { statusClasses } from '../../engine/statusColors';
import { detectResourceStatus } from '../../engine/renderers/statusUtils';
import type { K8sResource } from '../../engine/renderers';

export function StatusBadge({ resource }: { resource: K8sResource }) {
  const { status, reason } = detectResourceStatus(resource);

  if (status === 'unknown') return null;

  const colorClass = statusClasses(status).chip;

  return (
    <span className={cn('px-2 py-1 text-xs rounded-sm', colorClass)}>
      {reason}
    </span>
  );
}
