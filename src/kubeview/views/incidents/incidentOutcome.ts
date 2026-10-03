import type { ActionReport, VerificationReport } from '../../engine/monitorClient';

export type LifecycleStageStatus = 'complete' | 'in-progress' | 'pending' | 'failed' | 'skipped';
export interface IncidentOutcome {
  label: string;
  status: ActionReport['verificationStatus'];
  evidence?: string;
  timestamp?: number;
  verdict: 'unknown' | 'failed' | 'verified';
}

export function actionExecutionStatus(action: ActionReport | null): LifecycleStageStatus {
  switch (action?.status) {
    case 'completed': return 'complete';
    case 'executing': return 'in-progress';
    case 'failed': return 'failed';
    case 'expired': case 'rolled_back': return 'skipped';
    default: return 'pending';
  }
}

export function recoveryStageStatus(outcome: IncidentOutcome): LifecycleStageStatus {
  if (outcome.verdict === 'verified') return 'complete';
  if (outcome.verdict === 'failed') return 'failed';
  return outcome.status === 'unverifiable' ? 'skipped' : 'pending';
}

export function incidentOutcome(action: ActionReport | null, report: VerificationReport | null): IncidentOutcome {
  const matched = report && (!action || report.actionId === action.id) ? report : null;
  const useReport = matched && matched.timestamp >= (action?.verificationTimestamp ?? 0);
  const status = useReport ? matched.status : action?.verificationStatus;
  const evidence = (useReport ? matched.evidence : action?.verificationEvidence)?.trim();
  const timestamp = useReport ? matched.timestamp : action?.verificationTimestamp;
  if (action?.status === 'rolled_back') return { label: 'Recovery not confirmed after rollback', status, evidence, timestamp, verdict: 'unknown' as const };
  if (status === 'verified_then_recurred') return { label: 'Condition returned after verification', status, evidence, timestamp, verdict: 'failed' as const };
  if (status === 'still_failing') return { label: 'Condition still failing', status, evidence, timestamp, verdict: 'failed' as const };
  if (status === 'improved') return { label: 'Improved; recovery not confirmed', status, evidence, timestamp, verdict: 'unknown' as const };
  if (status === 'verified' && evidence && action?.status === 'completed') return { label: 'Recovery verified by agent check', status, evidence, timestamp, verdict: 'verified' as const };
  if (status === 'unverifiable') return { label: 'Recovery check inconclusive', status, evidence, timestamp, verdict: 'unknown' as const };
  if (status === 'pending') return { label: 'Recovery check pending', status, evidence, timestamp, verdict: 'unknown' as const };
  return { label: 'Recovery not confirmed', status, evidence, timestamp, verdict: 'unknown' as const };
}
