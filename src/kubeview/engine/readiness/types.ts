/**
 * Readiness Engine — Type definitions for production readiness gates.
 *
 * Gates are individual checks grouped into categories. Each gate produces
 * a GateResult with a status and optional detail. Waivers allow teams to
 * acknowledge and skip specific gates. The ReadinessReport aggregates all
 * gate results into a weighted score.
 */

/** Status a gate can resolve to */
export type GateStatus = 'not_started' | 'checking' | 'passed' | 'needs_attention' | 'failed' | 'waived';

/** Priority determines how heavily a gate failure impacts the score */
export type GatePriority = 'blocking' | 'recommended' | 'optional';

/** Logical grouping of related gates */
export type ReadinessCategory =
  | 'prerequisites'
  | 'security'
  | 'reliability'
  | 'observability'
  | 'operations'
  | 'gitops';

/** Definition of a single readiness gate */
export interface ReadinessGate {
  /** Stable identifier, e.g. "ha-control-plane" */
  id: string;
  /** Human-readable title */
  title: string;
  /** What this gate checks */
  description: string;
  /** Why this gate matters for production readiness */
  whyItMatters: string;
  /** Which category this gate belongs to */
  category: ReadinessCategory;
  /** How heavily a failure weighs on the score */
  priority: GatePriority;
  /** Optional link to the view where this gate can be remediated */
  remediationLink?: string;
  /**
   * Evaluate the gate. Receives a fetcher scoped to /api/kubernetes/.
   * Must return a GateResult.
   */
  evaluate: (ctx: GateContext) => Promise<GateResult>;
}

/** Context passed to every gate's evaluate function */
export interface GateContext {
  /** Fetch JSON from the Kubernetes API proxy. Path is relative to /api/kubernetes/ */
  fetchJson: <T = unknown>(path: string) => Promise<T>;
  /** Fetch JSON from the Pulse Agent API. Path is relative to /api/agent/ */
  fetchAgent: <T = unknown>(path: string) => Promise<T>;
  /** Whether the cluster uses HyperShift hosted control planes */
  isHyperShift: boolean;
}

/** Result produced by evaluating a single gate */
export interface GateResult {
  /** Gate identifier (matches ReadinessGate.id) */
  gateId: string;
  /** Resolved status */
  status: GateStatus;
  /** Human-readable detail string */
  detail: string;
  /** Guidance on how to fix */
  fixGuidance: string;
  /** Optional link to relevant documentation or fix page */
  fixLink?: string;
  /** Optional navigation action for remediation */
  action?: { label: string; path: string };
  /** Timestamp of evaluation (epoch ms) */
  evaluatedAt: number;
}

/** A waiver exempts a gate from failing the overall score */
export interface Waiver {
  /** Gate identifier being waived */
  gateId: string;
  /** Who approved the waiver */
  approvedBy: string;
  /** Reason for the waiver */
  reason: string;
  /** When the waiver was created (epoch ms) */
  createdAt: number;
  /** Optional expiry (epoch ms). Null means permanent. */
  expiresAt: number | null;
}

/** Aggregated readiness report */
export interface ReadinessReport {
  /** Weighted score 0-100 */
  score: number;
  /** Whether the cluster meets the production-ready threshold */
  productionReady: boolean;
  /** All gate results keyed by gate ID */
  results: Record<string, GateResult>;
  /** Active waivers keyed by gate ID */
  waivers: Record<string, Waiver>;
  /** Per-category summary */
  categories: Record<ReadinessCategory, CategorySummary>;
  /** When the report was generated (epoch ms) */
  generatedAt: number;
}

/** Per-category roll-up */
export interface CategorySummary {
  passed: number;
  failed: number;
  needs_attention: number;
  not_started: number;
  total: number;
  /** Category-level weighted score 0-100 */
  score: number;
}
