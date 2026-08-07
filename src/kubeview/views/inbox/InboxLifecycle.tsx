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

  return (
    <div className="inline-flex items-center gap-px rounded-md bg-slate-800/80 border border-slate-700/50 px-1 py-0.5">
      {isCleared && (
        <span className="px-1.5 py-0.5 text-[10px] leading-none rounded-xs text-emerald-400 font-medium">
          Cleared ✓
        </span>
      )}
      {!isCleared && steps.map((step, idx) => {
        const isCurrent = step.key === mappedStatus;
        const isPast = idx < currentIdx;
        const isLast = idx === steps.length - 1;
        const isProcessing = status === 'agent_reviewing';

        return (
          <div key={step.key} className="flex items-center">
            <span
              className={cn(
                'px-1.5 py-0.5 text-[10px] leading-none rounded-xs',
                isCurrent && isProcessing && 'bg-violet-600 text-white font-medium animate-pulse',
                isCurrent && !isProcessing && 'bg-violet-600 text-white font-medium',
                isPast && 'text-emerald-400',
                !isCurrent && !isPast && 'text-slate-600',
              )}
            >
              {step.label}
            </span>
            {!isLast && (
              <span className={cn('text-[8px]', isPast ? 'text-emerald-600' : 'text-slate-700')}>›</span>
            )}
          </div>
        );
      })}
    </div>
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
