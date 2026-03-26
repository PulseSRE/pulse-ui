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
