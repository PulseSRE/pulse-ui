import { cn } from '@/lib/utils';
import type { InboxItemType, InboxStatus } from '../../engine/inboxApi';

const UNIVERSAL_LIFECYCLE: Array<{ key: string; label: string }> = [
  { key: 'new', label: 'New' },
  { key: 'triaged', label: 'Triaged' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'resolved', label: 'Resolved' },
];

const STATUS_MAP: Record<string, string> = {
  new: 'new',
  agent_reviewing: 'new',
  agent_review_failed: 'new',
  triaged: 'triaged',
  claimed: 'claimed',
  in_progress: 'in_progress',
  resolved: 'resolved',
  archived: 'resolved',
  agent_cleared: 'resolved',
};

/**
 * Where this item is, not the whole ladder.
 *
 * This used to render all five stages inline — `New › Triaged › Claimed › In
 * Progress › Resolved` — on every row. Read down a real inbox and that is the
 * same five words twenty times over, taking more width than the finding's own
 * title. Measured on the reference cluster: 32 open items, and the phrase that
 * dominated the screen was identical on every one of them.
 *
 * A list answers "where is each of these"; one item's full progression is the
 * detail view's job, which is what InboxLifecycleStepper already does in the
 * drawer. So the badge keeps the position — five dots, filled to here — and
 * spends its words on the one stage that differs between rows. The full ladder
 * stays available on hover for anyone who wants it.
 */
export function InboxLifecycleBadge({
  itemType,
  status,
}: {
  itemType: InboxItemType;
  status: InboxStatus;
}) {
  const steps = UNIVERSAL_LIFECYCLE;
  const isCleared = status === 'agent_cleared';
  const mappedStatus = STATUS_MAP[status] || status;
  const currentIdx = isCleared ? steps.length : steps.findIndex((s) => s.key === mappedStatus);
  const isProcessing = status === 'agent_reviewing';
  const current = steps[currentIdx];

  const ladder = steps.map((s, i) => (i === currentIdx ? `${s.label} ←` : s.label)).join(' › ');

  if (isCleared) {
    return (
      <span
        className="inline-flex items-center rounded-md bg-slate-800/80 border border-slate-700/50 px-1.5 py-0.5 text-[10px] leading-none text-emerald-400 font-medium"
        title={`Cleared by the agent — ${ladder}`}
      >
        Cleared ✓
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md bg-slate-800/80 border border-slate-700/50 px-1.5 py-0.5"
      title={ladder}
    >
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {steps.map((step, idx) => (
          <span
            key={step.key}
            className={cn(
              'w-1 h-1 rounded-full',
              idx < currentIdx && 'bg-emerald-500',
              idx === currentIdx && (isProcessing ? 'bg-violet-400 animate-pulse' : 'bg-violet-400'),
              idx > currentIdx && 'bg-slate-600',
            )}
          />
        ))}
      </span>
      <span
        className={cn(
          'text-[10px] leading-none font-medium',
          isProcessing ? 'text-violet-300 animate-pulse' : 'text-slate-300',
        )}
      >
        {current?.label ?? mappedStatus}
      </span>
    </span>
  );
}

export function InboxLifecycleStepper({
  itemType,
  status,
}: {
  itemType: InboxItemType;
  status: InboxStatus;
}) {
  const steps = UNIVERSAL_LIFECYCLE;
  const isCleared = status === 'agent_cleared';
  const mappedStatus = STATUS_MAP[status] || status;
  const currentIdx = isCleared ? steps.length : steps.findIndex((s) => s.key === mappedStatus);

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, idx) => {
        const isCurrent = !isCleared && step.key === mappedStatus;
        const isPast = isCleared || idx < currentIdx;
        const isLast = idx === steps.length - 1;

        return (
          <div key={step.key} className="flex items-center gap-1">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-2.5 h-2.5 rounded-full border-2 transition-colors',
                  isCurrent && 'bg-violet-500 border-violet-500',
                  isPast && 'bg-emerald-500 border-emerald-500',
                  !isCurrent && !isPast && 'bg-transparent border-slate-600',
                )}
              />
              <span
                className={cn(
                  'text-[10px] mt-1 whitespace-nowrap',
                  isCurrent && 'text-violet-400 font-medium',
                  isPast && 'text-emerald-400',
                  !isCurrent && !isPast && 'text-slate-600',
                )}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={cn(
                  'w-4 h-0.5 rounded-full mb-3',
                  isPast ? 'bg-emerald-500' : 'bg-slate-700',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
