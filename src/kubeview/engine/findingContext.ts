/**
 * Which open finding (and which of its investigations) a question is about.
 *
 * A page that shows an open monitor finding sends its ids with the question so
 * the agent starts from the investigation instead of diagnosing from zero
 * (API_CONTRACT `ResourceContext.findingId` / `investigationId`). Only ids
 * travel: the agent reads the report itself and ignores ids that are unknown,
 * stale or about another resource.
 */
import type { ResourceContext } from './agentClient';
import type { Finding, InvestigationReport } from './monitorClient';

export interface FindingRef {
  findingId?: string;
  investigationId?: string;
}

/** The newest completed investigation of `findingId`, or undefined. */
export function latestCompletedInvestigation(investigations: InvestigationReport[], findingId: string): InvestigationReport | undefined {
  let best: InvestigationReport | undefined;
  for (const i of investigations) {
    if (i.findingId !== findingId || i.status !== 'completed') continue;
    if (!best || i.timestamp > best.timestamp) best = i;
  }
  return best;
}

/** The ids for a finding the page shows; undefined without a finding. */
export function findingRefFor(finding: Pick<Finding, 'id'> | null | undefined, investigations: InvestigationReport[]): FindingRef | undefined {
  if (!finding?.id) return undefined;
  const inv = latestCompletedInvestigation(investigations, finding.id);
  return inv ? { findingId: finding.id, investigationId: inv.id } : { findingId: finding.id };
}

/** `context` with the finding's ids attached (only those that are set). */
export function withFindingRef(context: ResourceContext, ref: FindingRef | undefined): ResourceContext {
  if (!ref?.findingId && !ref?.investigationId) return context;
  const out: ResourceContext = { ...context };
  if (ref.findingId) out.findingId = ref.findingId;
  if (ref.investigationId) out.investigationId = ref.investigationId;
  return out;
}
