/**
 * Shared types for the Health Audit panel used across domain views.
 */

/** A single item (resource or placeholder) in an audit check's passing/failing list. */
export interface AuditItem {
  metadata?: { name?: string; namespace?: string; uid?: string };
  /** Fallback display name when metadata.name is absent (e.g. notes, summaries). */
  name?: string;
  [key: string]: unknown;
}

/** One health-audit check with passing/failing resource lists. */
export interface AuditCheck {
  id: string;
  title: string;
  description: string;
  why: string;
  passing: AuditItem[];
  failing: AuditItem[];
  yamlExample: string;
  /** Custom label shown above the failing list (default: "Missing ({count})"). */
  failingLabel?: string;
  /** Custom label shown above the passing list (default: "Passing ({count})"). */
  passingLabel?: string;
  /** Custom label shown above the YAML block (default: "How to fix:"). */
  fixLabel?: string;
  /**
   * Advice, not a failure: shown with an info icon, never counted against the
   * score (e.g. a Delete reclaim policy, which every OpenShift default uses).
   */
  informational?: boolean;
  /**
   * Whether the check could be answered at all. Leave unset for a normal
   * pass/fail check.
   * - `unknown`: a read it depends on failed or was forbidden. Shown as
   *   "Could not check", never counted as a pass.
   * - `notApplicable`: the read succeeded but nothing qualifies (e.g. no
   *   multi-replica Deployments for the PDB check). Not scored.
   * A scored check with no passing and no failing items is treated as
   * `notApplicable`: an empty check is never a pass.
   */
  state?: AuditCheckState;
  /** Why the check is unknown or not applicable, shown on the row. */
  stateReason?: string;
}

export type AuditCheckState = 'unknown' | 'notApplicable';

/** How a check renders and scores once its read status is taken into account. */
export type AuditOutcome = 'pass' | 'fail' | 'unknown' | 'notApplicable' | 'informational';

export function auditOutcome(check: AuditCheck): AuditOutcome {
  if (check.state === 'unknown') return 'unknown';
  if (check.informational) return 'informational';
  if (check.state === 'notApplicable') return 'notApplicable';
  if (check.failing.length > 0) return 'fail';
  if (check.passing.length === 0) return 'notApplicable';
  return 'pass';
}

/**
 * Reason a check cannot be answered, from the reads it depends on: pass
 * `[label, failed]` pairs; returns `{ state: 'unknown', stateReason }` for the
 * first failed read, or `{}` when every read succeeded. Spread into a check.
 */
export function readsState(...reads: Array<[label: string, failed: boolean]>): Pick<AuditCheck, 'state' | 'stateReason'> {
  const failed = reads.filter(([, f]) => f).map(([label]) => label);
  if (failed.length === 0) return {};
  return { state: 'unknown', stateReason: `${failed.join(' and ')} could not be read` };
}

/** Props accepted by HealthAuditPanel. */
export interface HealthAuditPanelProps {
  /** The audit checks to render. */
  checks: AuditCheck[];
  /** Title shown in the card header (e.g. "Workload Health Audit"). */
  title: string;
  /** Icon color class for the Activity icon (default: "text-blue-400"). */
  iconColorClass?: string;
  /** Called when a failing item is clicked. Return null to disable the link. */
  onNavigateItem?: (check: AuditCheck, item: AuditItem, index: number) => void;
  /** Label for the navigate action on failing items (default: "View"). */
  navigateLabel?: (check: AuditCheck, item: AuditItem) => string;
  /** Custom render for extra badges next to a failing item name. */
  renderItemBadges?: (check: AuditCheck, item: AuditItem) => React.ReactNode;
  /** Max number of failing items shown before "more" (default: 10). */
  maxFailingItems?: number;
}
