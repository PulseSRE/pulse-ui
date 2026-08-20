import { AlertTriangle, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMonitorStore } from '../../store/monitorStore';

/**
 * Surfaces the agent's own broken parts above the content they should be filling.
 *
 * The agent raises findings in the `degraded` category when one of its scanners
 * has failed several runs in a row, or when investigations stop coming back.
 * Those would otherwise land in the inbox as ordinary rows — which is how the
 * problem stays invisible: on the reference cluster 1,155 of 1,177
 * investigations had failed and the only visible effect was an empty panel,
 * which reads as "nothing worth investigating".
 *
 * A banner rather than a row, because the point is that what you are looking at
 * is incomplete. That has to be visible without scrolling a queue.
 */
export function CapabilityBanner({ className }: { className?: string }) {
  const findings = useMonitorStore((s) => s.findings);
  const degraded = findings.filter((f) => f.category === 'degraded');

  if (degraded.length === 0) return null;

  const critical = degraded.some((f) => f.severity === 'critical');

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 border px-3 py-2 text-xs',
        critical
          ? 'border-red-500/25 bg-red-500/10 text-red-300'
          : 'border-amber-500/20 bg-amber-500/10 text-amber-300',
        className,
      )}
    >
      {critical ? (
        <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
      ) : (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      )}
      <div className="min-w-0 flex-1">
        <div className={cn('font-medium', critical ? 'text-red-200' : 'text-amber-200')}>
          {degraded.length === 1
            ? 'Pulse is not seeing everything'
            : `Pulse is not seeing everything — ${degraded.length} capabilities affected`}
        </div>
        <ul className="mt-1 space-y-0.5">
          {degraded.map((f) => (
            <li key={f.id} className={critical ? 'text-red-300/80' : 'text-amber-300/80'}>
              {f.title}
            </li>
          ))}
        </ul>
        <p className={cn('mt-1', critical ? 'text-red-300/60' : 'text-amber-300/60')}>
          Treat anything these cover as unknown rather than clear.
        </p>
      </div>
    </div>
  );
}
