/**
 * What the fix-history summary's success figures mean, by agent version.
 *
 * From pulse-agent#258 (`applied_rate` present) `success_rate` and
 * `by_category[].success_count` count fixes verification saw *hold*, and
 * `completed` / `applied_count` count fixes *applied* (the write was accepted,
 * held or not). Older agents report `success_rate` as completed / total, which
 * is "applied", not "held"; for them the figure is shown under that name.
 */
import type { FixHistorySummary } from './analyticsApi';

export interface FixOutcomeFigures {
  /** True when the agent reports whether fixes held (pulse-agent#258 and later). */
  reportsHeld: boolean;
  /** "Fixes that held" or, for older agents, "Fixes applied". */
  label: string;
  /** Fixes whose write went through (`completed`). */
  applied: number;
  /** Applied fixes verification saw hold; null when the agent does not report it. */
  held: number | null;
  /** Fixes verification saw not hold (still failing, or verified then recurred); null when not reported. */
  notHeld: number | null;
  /** Fixes whose write did not go through. */
  failed: number;
  /** All fix actions in the window (`total_actions`). */
  total: number;
  /** held / applied (new agents) or the old success_rate (applied / total); null with nothing to divide by. */
  pct: number | null;
  /** The sentence under the figure: "3 of 10 applied" or "10 of 12 fix actions". */
  basis: string;
}

export function fixOutcomeFigures(summary: FixHistorySummary): FixOutcomeFigures {
  const applied = summary.completed ?? 0;
  const failed = summary.failed ?? 0;
  const total = summary.total_actions ?? 0;
  const reportsHeld = summary.applied_rate !== undefined;
  if (!reportsHeld) {
    return {
      reportsHeld,
      label: 'Fixes applied',
      applied,
      held: null,
      notHeld: null,
      failed,
      total,
      pct: total > 0 && typeof summary.success_rate === 'number' ? Math.round(summary.success_rate * 100) : null,
      basis: `${applied} of ${total} fix action${total === 1 ? '' : 's'} applied; this agent does not report whether they held`,
    };
  }
  const v = summary.verification;
  const held = typeof v?.resolved === 'number' ? v.resolved : null;
  const notHeld = v ? (v.still_failing ?? 0) + (v.recurred ?? 0) : null;
  return {
    reportsHeld,
    label: 'Fixes that held',
    applied,
    held,
    notHeld,
    failed,
    total,
    pct: held !== null && applied > 0 ? Math.round((held / applied) * 100) : null,
    basis: held !== null ? `${held} of ${applied} applied` : `${applied} applied; whether they held is not reported`,
  };
}

/** One category's "held of applied" (new agents) or "applied of total" (older agents). */
export function categoryOutcome(
  cat: FixHistorySummary['by_category'][number],
  reportsHeld: boolean,
): string {
  if (reportsHeld) return `${cat.success_count} held of ${cat.applied_count ?? cat.count} applied`;
  return `${cat.success_count}/${cat.count} applied`;
}

/** Inbox › Activity filtered to fixes with this status. */
export const fixActivityLink = (status?: 'failed' | 'rolled_back' | 'completed') =>
  status ? `/inbox?tab=activity&fixStatus=${status}` : '/inbox?tab=activity';

/** Who raises the "auto-fix stopped" items (pulse-agent fix breaker / fix escalation). */
export const FIX_ESCALATION_CREATOR = 'system:fix-breaker';
