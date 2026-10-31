import type { ReactNode } from 'react';
import { AlertTriangle, ArrowRight, HelpCircle, Shield } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The one banner the landing view uses to say "here is the state of the
 * cluster, and here is where to look".
 *
 * There used to be two, stacked on top of each other, built independently:
 * the open-incident banner used a full tinted border, a 5-unit icon, py-3, an
 * uppercase eyebrow and a right-aligned Investigate affordance on a
 * whole-banner button; the health strip used a left accent bar over a grey
 * border, a 4-unit icon, py-2, inline text and an underlined link mid-
 * sentence. Same job, same screen, no shared vocabulary — and a reader
 * reasonably asks why two alerts about their cluster look like they came from
 * two products.
 *
 * Geometry and the click affordance live here so the two cannot drift again.
 * Only colour varies, and only by severity.
 */

export type SeverityLevel = 'unknown' | 'green' | 'yellow' | 'red';

const container: Record<SeverityLevel, string> = {
  unknown: 'border-slate-500/30 bg-slate-500/10',
  green: 'border-emerald-500/30 bg-emerald-500/10',
  yellow: 'border-amber-500/30 bg-amber-500/10',
  red: 'border-red-500/30 bg-red-500/10',
};

const hover: Record<SeverityLevel, string> = {
  unknown: 'hover:bg-slate-500/15',
  green: 'hover:bg-emerald-500/15',
  yellow: 'hover:bg-amber-500/15',
  red: 'hover:bg-red-500/15',
};

const iconTint: Record<SeverityLevel, string> = {
  unknown: 'text-slate-400',
  green: 'text-emerald-400',
  yellow: 'text-amber-400',
  red: 'text-red-400',
};

const eyebrowTint: Record<SeverityLevel, string> = {
  unknown: 'text-slate-400',
  green: 'text-emerald-400',
  yellow: 'text-amber-400',
  red: 'text-red-400',
};

const actionTint: Record<SeverityLevel, string> = {
  unknown: 'text-slate-300 group-hover:text-slate-200',
  green: 'text-emerald-300 group-hover:text-emerald-200',
  yellow: 'text-amber-300 group-hover:text-amber-200',
  red: 'text-red-300 group-hover:text-red-200',
};

const defaultIcon: Record<SeverityLevel, LucideIcon> = {
  unknown: HelpCircle,
  green: Shield,
  yellow: AlertTriangle,
  red: AlertTriangle,
};

export interface SeverityBannerProps {
  level: SeverityLevel;
  /** Small uppercase label above the headline, e.g. "Open incident". */
  eyebrow?: string;
  /** The headline. */
  children: ReactNode;
  /** Secondary row: durations, counts, anything subordinate to the headline. */
  meta?: ReactNode;
  /**
   * Whole-banner action. When present the banner becomes a button, which is
   * the larger target and the clearer affordance — an inline underlined link
   * inside a coloured strip reads as decoration.
   */
  action?: { label: string; onClick: () => void };
  icon?: LucideIcon;
  className?: string;
}

export function SeverityBanner({
  level,
  eyebrow,
  children,
  meta,
  action,
  icon,
  className,
}: SeverityBannerProps) {
  const Icon = icon ?? defaultIcon[level];

  const body = (
    <>
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconTint[level])} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {eyebrow && (
            <span
              className={cn(
                'text-[10px] font-semibold uppercase tracking-wider',
                eyebrowTint[level],
              )}
            >
              {eyebrow}
            </span>
          )}
          <span className="min-w-0 truncate text-sm text-slate-100">{children}</span>
        </div>
        {meta && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            {meta}
          </div>
        )}
      </div>
      {action && (
        <span
          className={cn('mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs', actionTint[level])}
        >
          {action.label}
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      )}
    </>
  );

  const shared = cn(
    'flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left',
    container[level],
    className,
  );

  if (!action) {
    return <div className={shared}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={action.onClick}
      className={cn('group transition-colors', shared, hover[level])}
    >
      {body}
    </button>
  );
}
