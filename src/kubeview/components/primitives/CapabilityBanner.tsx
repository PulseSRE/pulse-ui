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

  // Two different kinds of degraded, and calling both "not seeing everything"
  // gets one of them wrong. A blind scanner means the picture is incomplete; no
  // notification channel means the picture is fine and nobody will ever be
  // shown it. An operator reading "not seeing everything" about the second
  // would go looking for a broken scanner.
  const reachable = degraded.filter((f) => f.resources?.[0]?.name !== 'notifications');
  const blindOnly = reachable.length === degraded.length;
  const headline = blindOnly
    ? 'Pulse is not seeing everything'
    : reachable.length === 0
      ? 'Pulse cannot reach anyone'
      : 'Pulse is not seeing everything, and cannot reach anyone';

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
            ? headline
            : `${headline} — ${degraded.length} capabilities affected`}
        </div>
        <ul className="mt-1 space-y-0.5">
          {degraded.map((f) => (
            <li key={f.id} className={critical ? 'text-red-300/80' : 'text-amber-300/80'}>
              {f.title}
            </li>
          ))}
        </ul>
        <p className={cn('mt-1', critical ? 'text-red-300/60' : 'text-amber-300/60')}>
          {blindOnly
            ? 'Treat anything these cover as unknown rather than clear.'
            : 'What Pulse knows is not reaching anyone who is not looking at this screen.'}
        </p>
      </div>
    </div>
  );
}
