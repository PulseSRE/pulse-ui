import { cn } from '@/lib/utils';
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import type { ConfidenceBadgeSpec } from '../../engine/agentComponents';

export function AgentConfidenceBadge({ spec }: { spec: ConfidenceBadgeSpec }) {
  const pct = Math.round(spec.score * 100);
  const isHigh = spec.score > 0.8;
  const isMed = spec.score >= 0.5;

  const color = isHigh
    ? 'text-emerald-400'
    : isMed
      ? 'text-amber-400'
      : 'text-red-400';

  const bgColor = isHigh
    ? 'bg-emerald-900/30 border-emerald-800/50'
    : isMed
      ? 'bg-amber-900/30 border-amber-800/50'
      : 'bg-red-900/30 border-red-800/50';

  const Icon = isHigh ? ShieldCheck : isMed ? ShieldAlert : ShieldQuestion;
  const verdict = isHigh ? 'High confidence' : isMed ? 'Moderate confidence' : 'Low confidence';
  const hint = isHigh
    ? 'The agent is confident in this diagnosis'
    : isMed
      ? 'The agent found supporting evidence but recommends verification'
      : 'Limited evidence — manual investigation recommended';

  // When rendered as a standalone widget (has title), show full card layout
  if (spec.title) {
    return (
      <div className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', bgColor)}>
        <Icon className={cn('w-5 h-5 shrink-0', color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-semibold', color)}>{pct}%</span>
            <span className="text-xs text-slate-400">{verdict}</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>
        </div>
      </div>
    );
  }

  // Inline badge (original compact form)
  const badgeColor = isHigh
    ? 'bg-emerald-900/40 text-emerald-400 border-emerald-800'
    : isMed
      ? 'bg-amber-900/40 text-amber-400 border-amber-800'
      : 'bg-red-900/40 text-red-400 border-red-800';

  return (
    <span
      className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', badgeColor)}
      role="status"
      aria-label={`Confidence: ${pct}%`}
    >
      {spec.label && <span className="text-slate-400 mr-0.5">{spec.label}:</span>}
      {pct}%
    </span>
  );
}
