import { useEffect, useRef } from 'react';
import {
  X, Radar, Target, Search, Wrench, CheckCircle, FileText,
  Sparkles, Loader2, XCircle, Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { formatRelativeTime } from '../../engine/formatters';
import { fetchConfidenceCalibration } from '../../engine/analyticsApi';
import { verificationStatusLabel } from '../../engine/fixHistory';
import { useIncidentLifecycle } from '../../hooks/useIncidentLifecycle';

type StageStatus = 'complete' | 'in-progress' | 'pending' | 'failed' | 'skipped';

function StageIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case 'complete': return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    case 'in-progress': return <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />;
    case 'pending': return <div className="w-4 h-4 rounded-full border-2 border-slate-600" />;
    case 'failed': return <XCircle className="w-4 h-4 text-red-400" />;
    case 'skipped': return <Minus className="w-4 h-4 text-slate-600" />;
  }
}

interface IncidentLifecycleDrawerProps {
  findingId: string;
  onClose: () => void;
}

export function IncidentLifecycleDrawer({ findingId, onClose }: IncidentLifecycleDrawerProps) {
  const lifecycle = useIncidentLifecycle(findingId);
  const drawerRef = useRef<HTMLDivElement>(null);

  const { data: confidenceStats } = useQuery({
    queryKey: ['confidence-calibration'],
    queryFn: () => fetchConfidenceCalibration(30),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus trap: focus the drawer on mount
  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  const detectionStatus: StageStatus = lifecycle.detection ? 'complete' : 'pending';
  const impactStatus: StageStatus = lifecycle.isLoading ? 'in-progress' : lifecycle.impact ? 'complete' : 'pending';
  const investigationStatus: StageStatus = lifecycle.investigation
    ? lifecycle.investigation.status === 'completed' ? 'complete' : 'failed'
    : lifecycle.detection?.investigationPhases?.some((p) => p.status === 'running') ? 'in-progress' : 'pending';
  // 'expired' is a proposal nobody answered — the fix never ran, so it is
  // neither failed nor still pending. 'skipped' is the honest stage for it,
  // the same mapping 'unverifiable' gets below and for the same reason:
  // reporting it any other way asserts something that never happened.
  const actionStatus: StageStatus = lifecycle.action
    ? lifecycle.action.status === 'completed' ? 'complete'
    : lifecycle.action.status === 'failed' ? 'failed'
    : lifecycle.action.status === 'executing' ? 'in-progress'
    : lifecycle.action.status === 'expired' ? 'skipped'
    : 'pending'
    : 'pending';
  // 'unverifiable' means the health check ran and could not get a clear
  // reading. It is neither a passed nor a failed fix, so it maps to 'skipped'
  // rather than 'failed' — reporting it as a failure asserts something the
  // check never established, the mirror of the absence bug on the agent side.
  // 'verified_then_recurred' maps to 'failed' even though the fix once
  // verified: the verdict was retroactively downgraded because the same
  // condition returned, and a green check here would re-assert the verdict
  // the agent itself withdrew.
  const verificationStatus: StageStatus = lifecycle.verification
    ? lifecycle.verification.status === 'verified' ? 'complete'
    : lifecycle.verification.status === 'unverifiable' ? 'skipped' : 'failed'
    : lifecycle.action?.verificationStatus === 'verified' ? 'complete'
    : lifecycle.action?.verificationStatus === 'unverifiable' ? 'skipped'
    : lifecycle.action?.verificationStatus === 'still_failing' ? 'failed'
    : lifecycle.action?.verificationStatus === 'verified_then_recurred' ? 'failed'
    : 'pending';
  const verificationBadge = lifecycle.verification?.status || lifecycle.action?.verificationStatus;
  const postmortemStatus: StageStatus = lifecycle.postmortem ? 'complete' : 'pending';
  const learningStatus: StageStatus = lifecycle.learning
    ? (lifecycle.learning.scaffolded_skill || lifecycle.learning.learned_runbook || lifecycle.learning.scaffolded_plan) ? 'complete' : 'pending'
    : 'pending';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Incident Lifecycle" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        ref={drawerRef}
        tabIndex={-1}
        className="relative w-[480px] h-full bg-slate-950 border-l border-slate-800 overflow-y-auto focus:outline-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Incident Lifecycle</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stages */}
        <div className="px-6 py-4 space-y-1">
          {/* 1. Detection */}
          <Stage
            icon={Radar}
            title="Detection"
            status={detectionStatus}
          >
            {lifecycle.detection && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded-sm',
                    lifecycle.detection.severity === 'critical' ? 'bg-red-900/50 text-red-300' :
                    lifecycle.detection.severity === 'warning' ? 'bg-amber-900/50 text-amber-300' :
                    'bg-blue-900/50 text-blue-300',
                  )}>
                    {lifecycle.detection.severity}
                  </span>
                  <span className="text-xs text-slate-500">{lifecycle.detection.category}</span>
                  {lifecycle.detection.confidence != null && (
                    <span className="text-xs font-mono text-slate-400">{Math.round(lifecycle.detection.confidence * 100)}%</span>
                  )}
                </div>
                <p className="text-xs text-slate-300">{lifecycle.detection.title}</p>
                <p className="text-xs text-slate-500">{lifecycle.detection.summary}</p>
                <span className="text-xs text-slate-600">{formatRelativeTime(lifecycle.detection.timestamp)}</span>
              </div>
            )}
          </Stage>

          {/* 2. Impact Analysis */}
          <Stage
            icon={Target}
            title="Impact Analysis"
            status={impactStatus}
          >
            {lifecycle.impact && (
              <div className="space-y-2">
                {lifecycle.impact.affected_resource && (
                  <div className="text-xs text-slate-400">
                    {lifecycle.impact.affected_resource.kind}/{lifecycle.impact.affected_resource.name}
                    {lifecycle.impact.affected_resource.namespace && ` (${lifecycle.impact.affected_resource.namespace})`}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded-sm',
                    lifecycle.impact.risk_level === 'high' ? 'bg-red-900/50 text-red-300' :
                    lifecycle.impact.risk_level === 'medium' ? 'bg-amber-900/50 text-amber-300' :
                    'bg-emerald-900/50 text-emerald-300',
                  )}>
                    {lifecycle.impact.risk_level} risk
                  </span>
                  <span className="text-xs text-slate-500">{lifecycle.impact.scope}</span>
                  <span className="text-xs text-slate-500">{lifecycle.impact.affected_pods} pods affected</span>
                </div>
                {lifecycle.impact.blast_radius.length > 0 && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Blast Radius</div>
                    <div className="flex flex-wrap gap-1">
                      {lifecycle.impact.blast_radius.map((r) => (
                        <span key={r.id} className="text-xs font-mono px-1.5 py-0.5 bg-red-900/20 text-red-300 rounded-sm border border-red-800/30">
                          {r.kind}/{r.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {lifecycle.impact.upstream_dependencies.length > 0 && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Dependencies</div>
                    <div className="flex flex-wrap gap-1">
                      {lifecycle.impact.upstream_dependencies.map((r) => (
                        <span key={r.id} className="text-xs font-mono px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm">
                          {r.kind}/{r.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Stage>

          {/* 3. Investigation */}
          <Stage
            icon={Search}
            title="Investigation"
            status={investigationStatus}
          >
            {lifecycle.investigation && (
              <div className="space-y-2">
                {lifecycle.investigation.suspectedCause && (
                  <div className="px-3 py-2 rounded-sm bg-violet-950/40 border border-violet-800/40">
                    <div className="text-[10px] font-medium text-violet-300 mb-0.5">Suspected Cause</div>
                    <p className="text-xs text-slate-200">{lifecycle.investigation.suspectedCause}</p>
                  </div>
                )}
                {lifecycle.investigation.evidence && lifecycle.investigation.evidence.length > 0 && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Evidence</div>
                    <ul className="space-y-0.5">
                      {lifecycle.investigation.evidence.map((e, i) => (
                        <li key={i} className="text-xs text-slate-300 flex gap-1.5">
                          <span className="text-emerald-500 shrink-0">+</span>{e}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {lifecycle.investigation.securityFollowup && (
                  <div className="px-3 py-2 rounded-sm bg-red-950/30 border border-red-800/30">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-medium text-red-300">Security Assessment</span>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-sm',
                        lifecycle.investigation.securityFollowup.riskLevel === 'high' ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/50 text-amber-300',
                      )}>
                        {lifecycle.investigation.securityFollowup.riskLevel}
                      </span>
                    </div>
                    <ul className="space-y-0.5">
                      {lifecycle.investigation.securityFollowup.issues.map((issue, i) => (
                        <li key={i} className="text-xs text-slate-400">- {issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Stage>

          {/* 4. Action */}
          <Stage
            icon={Wrench}
            title="Action"
            status={actionStatus}
          >
            {lifecycle.action && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-200">{lifecycle.action.tool}</span>
                  <span className={cn('text-xs px-1.5 py-0.5 rounded-sm', {
                    'bg-green-900/50 text-green-300': lifecycle.action.status === 'completed',
                    'bg-yellow-900/50 text-yellow-300': lifecycle.action.status === 'executing',
                    'bg-red-900/50 text-red-300': lifecycle.action.status === 'failed',
                    'bg-blue-900/50 text-blue-300': lifecycle.action.status === 'proposed',
                  })}>
                    {lifecycle.action.status}
                  </span>
                </div>
                {lifecycle.action.fixDescription && (
                  <p className="text-xs text-slate-300">{lifecycle.action.fixDescription}</p>
                )}
                {lifecycle.action.reasoning && (
                  <p className="text-xs text-slate-400">{lifecycle.action.reasoning}</p>
                )}
                {lifecycle.action.fixStrategy && (
                  <div className="text-xs text-slate-500">Strategy: {lifecycle.action.fixStrategy}</div>
                )}
              </div>
            )}
          </Stage>

          {/* 5. Verification */}
          <Stage
            icon={CheckCircle}
            title="Verification"
            status={verificationStatus}
          >
            {(lifecycle.verification || lifecycle.action?.verificationStatus) && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded-sm font-medium',
                    verificationBadge === 'verified'
                      ? 'bg-emerald-900/50 text-emerald-300'
                      // Grey, not amber: 'unverifiable' means the check could
                      // not read the cluster, and 'pending' means the probe has
                      // not run yet — neither is the fix having gone wrong.
                      : verificationBadge === 'unverifiable' || verificationBadge === 'pending'
                        ? 'bg-slate-800 text-slate-400'
                        : 'bg-amber-900/50 text-amber-300',
                  )}>
                    {verificationStatusLabel(verificationBadge!)}
                  </span>
                </div>
                {(lifecycle.verification?.evidence || lifecycle.action?.verificationEvidence) && (
                  <p className="text-xs text-slate-400">{lifecycle.verification?.evidence || lifecycle.action?.verificationEvidence}</p>
                )}
                {lifecycle.learning?.confidence_delta && (
                  <div className="text-xs text-slate-400">
                    Confidence: {Math.round(lifecycle.learning.confidence_delta.before * 100)}%
                    {' → '}{Math.round(lifecycle.learning.confidence_delta.after * 100)}%
                    <span className={lifecycle.learning.confidence_delta.delta >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {' '}({lifecycle.learning.confidence_delta.delta >= 0 ? '+' : ''}{Math.round(lifecycle.learning.confidence_delta.delta * 100)}%)
                    </span>
                  </div>
                )}
                {confidenceStats && confidenceStats.total_predictions > 0 && (
                  <div className="mt-2 px-3 py-2 rounded-sm bg-slate-800/50 border border-slate-700/50">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Agent Confidence Trends (30d)</div>
                    <div className="flex items-center gap-3 text-xs">
                      <div>
                        <span className="text-slate-500">Brier: </span>
                        <span className={cn('font-mono', confidenceStats.brier_score <= 0.15 ? 'text-emerald-400' : confidenceStats.brier_score <= 0.25 ? 'text-amber-400' : 'text-red-400')}>
                          {confidenceStats.brier_score.toFixed(3)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Accuracy: </span>
                        <span className="text-slate-300 font-mono">{confidenceStats.accuracy_pct.toFixed(1)}%</span>
                      </div>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-sm',
                        confidenceStats.rating === 'good' ? 'bg-emerald-900/40 text-emerald-300' :
                        confidenceStats.rating === 'fair' ? 'bg-amber-900/40 text-amber-300' :
                        'bg-red-900/40 text-red-300',
                      )}>
                        {confidenceStats.rating}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Stage>

          {/* 6. Postmortem */}
          <Stage
            icon={FileText}
            title="Postmortem"
            status={postmortemStatus}
          >
            {lifecycle.postmortem && (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-300 font-medium">
                  {lifecycle.postmortem.incident_type.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </p>
                {lifecycle.postmortem.root_cause && (
                  <div className="px-3 py-2 rounded-sm bg-slate-800/50 border border-slate-700/50">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Root Cause</div>
                    <p className="text-xs text-slate-300">{lifecycle.postmortem.root_cause}</p>
                  </div>
                )}
                {lifecycle.postmortem.prevention.length > 0 && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Prevention</div>
                    <ul className="space-y-0.5">
                      {lifecycle.postmortem.prevention.map((p, i) => (
                        <li key={i} className="text-xs text-slate-400 flex gap-1.5">
                          <span className="text-violet-400 shrink-0">-</span>{p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Stage>

          {/* 7. Agent Learning */}
          <Stage
            icon={Sparkles}
            title="Agent Learning"
            status={learningStatus}
            last
          >
            {lifecycle.learning && (
              <div className="space-y-2">
                {lifecycle.learning.scaffolded_skill && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-1.5 py-0.5 bg-violet-900/40 text-violet-300 rounded-sm">Skill</span>
                    <span className="text-xs text-slate-300">{lifecycle.learning.scaffolded_skill.name}</span>
                  </div>
                )}
                {lifecycle.learning.scaffolded_plan && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded-sm">Plan</span>
                    <span className="text-xs text-slate-300">{lifecycle.learning.scaffolded_plan.name} ({lifecycle.learning.scaffolded_plan.phases} phases)</span>
                  </div>
                )}
                {lifecycle.learning.scaffolded_eval && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-1.5 py-0.5 bg-emerald-900/40 text-emerald-300 rounded-sm">Eval</span>
                    <span className="text-xs text-slate-300 font-mono">{lifecycle.learning.scaffolded_eval.scenario_id}</span>
                  </div>
                )}
                {lifecycle.learning.learned_runbook && (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded-sm">Runbook</span>
                      <span className="text-xs text-slate-300">{lifecycle.learning.learned_runbook.name}</span>
                      <span className="text-xs text-slate-500">{lifecycle.learning.learned_runbook.success_count} successes</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {lifecycle.learning.learned_runbook.tool_sequence.map((tool, i) => (
                        <span key={i} className="text-xs font-mono px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm">{tool}</span>
                      ))}
                    </div>
                  </div>
                )}
                {lifecycle.learning.detected_patterns.length > 0 && (
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Detected Patterns</div>
                    {lifecycle.learning.detected_patterns.map((p, i) => (
                      <div key={i} className="text-xs text-slate-400 mb-0.5">
                        <span className="text-slate-300">{p.type}</span>: {p.description} (freq: {p.frequency})
                      </div>
                    ))}
                  </div>
                )}
                {lifecycle.learning.weight_impact && (
                  <div className="text-xs text-slate-400">
                    ORCA weight: {lifecycle.learning.weight_impact.channel} {lifecycle.learning.weight_impact.old_weight.toFixed(2)} → {lifecycle.learning.weight_impact.new_weight.toFixed(2)}
                  </div>
                )}
              </div>
            )}
          </Stage>
        </div>
      </div>
    </div>
  );
}

function Stage({
  icon: Icon,
  title,
  status,
  last,
  children,
}: {
  icon: React.ElementType;
  title: string;
  status: StageStatus;
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      {/* Stepper line + icon */}
      <div className="flex flex-col items-center">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-900 border border-slate-700">
          <StageIcon status={status} />
        </div>
        {!last && (
          <div className={cn(
            'w-px flex-1 min-h-[24px]',
            status === 'complete' ? 'bg-emerald-800' : 'bg-slate-800',
          )} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex items-center gap-2 h-8">
          <Icon className="w-3.5 h-3.5 text-slate-500" />
          <span className={cn(
            'text-xs font-medium',
            status === 'complete' ? 'text-slate-200' :
            status === 'in-progress' ? 'text-violet-300' :
            status === 'failed' ? 'text-red-300' :
            'text-slate-500',
          )}>
            {title}
          </span>
        </div>
        {children ? (
          <div className="mt-1">{children}</div>
        ) : status === 'pending' ? (
          <p className="text-xs text-slate-600 mt-1">Not yet triggered</p>
        ) : null}
      </div>
    </div>
  );
}
