import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InvestigationReport } from '../../../engine/monitorClient';

export function InvestigationCard({
  report,
  onClickFinding,
}: {
  report: InvestigationReport;
  onClickFinding?: (findingId: string) => void;
}) {
  const [altExpanded, setAltExpanded] = useState(false);
  const hasAlternatives = report.alternativesConsidered && report.alternativesConsidered.length > 0;
  const clickable = !!onClickFinding && !!report.findingId;

  return (
    <div
      className={cn('px-4 py-3', clickable && 'cursor-pointer hover:bg-slate-800/30 transition-colors')}
      onClick={clickable ? () => onClickFinding(report.findingId) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClickFinding(report.findingId); } } : undefined}
    >
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
        <span className={cn('px-1.5 py-0.5 rounded-sm', report.status === 'completed' ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300')}>
          {report.status}
        </span>
        <span>{report.category}</span>
        {report.confidence != null && report.confidence > 0 && (
          <span
            className={cn(
              'font-mono',
              report.confidence >= 0.8 ? 'text-green-400' : report.confidence >= 0.5 ? 'text-amber-400' : 'text-red-400',
            )}
            title={`Agent confidence in this diagnosis: ${Math.round(report.confidence * 100)}%`}
            aria-label={`Agent confidence: ${Math.round(report.confidence * 100)}%`}
          >
            {Math.round(report.confidence * 100)}% confidence
          </span>
        )}
        <span>-</span>
        <span>{new Date(report.timestamp).toLocaleTimeString()}</span>
      </div>
      <div className="text-sm text-slate-200">{report.summary || 'Investigation completed'}</div>

      {report.suspectedCause && (
        <div className="mt-2 px-3 py-2 rounded-sm bg-violet-950/40 border border-violet-800/40">
          <div className="text-xs font-medium text-violet-300 mb-0.5">Suspected Cause</div>
          <div className="text-sm text-slate-200">{report.suspectedCause}</div>
        </div>
      )}

      {report.evidence && report.evidence.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-medium text-slate-400 mb-1">Evidence</div>
          <ul className="space-y-0.5 pl-1">
            {report.evidence.map((e, i) => (
              <li key={i} className="text-xs text-slate-300 flex gap-1.5">
                <span className="text-emerald-500 shrink-0 mt-px">+</span>
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.recommendedFix && (
        <div className="text-xs text-slate-400 mt-2">Suggested fix: {report.recommendedFix}</div>
      )}

      {report.securityFollowup && (
        <div className="mt-2 px-3 py-2 rounded-sm bg-red-950/30 border border-red-800/30">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-red-300">Security Assessment</span>
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded-sm',
              report.securityFollowup.riskLevel === 'high' ? 'bg-red-900/50 text-red-300' :
              report.securityFollowup.riskLevel === 'medium' ? 'bg-amber-900/50 text-amber-300' :
              'bg-slate-800 text-slate-400',
            )}>
              {report.securityFollowup.riskLevel}
            </span>
          </div>
          <ul className="space-y-0.5">
            {report.securityFollowup.issues.map((issue, i) => (
              <li key={i} className="text-xs text-slate-400 flex gap-1.5">
                <span className="text-red-500 shrink-0 mt-px">!</span>
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasAlternatives && (
        <button
          onClick={(e) => { e.stopPropagation(); setAltExpanded(!altExpanded); }}
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2 transition-colors"
        >
          {altExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Alternatives ruled out ({report.alternativesConsidered!.length})
        </button>
      )}
      {altExpanded && report.alternativesConsidered && (
        <div className="mt-1 pl-3 border-l-2 border-slate-700">
          <ul className="space-y-0.5">
            {report.alternativesConsidered.map((a, i) => (
              <li key={i} className="text-xs text-slate-500 flex gap-1.5">
                <span className="text-slate-600 shrink-0">-</span>
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
