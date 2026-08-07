import { useState } from 'react';
import { TrendingUp, AlertCircle, BookOpen, UserX, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import { useTrustStore } from '../../store/trustStore';
import type { AccuracyStats } from '../../engine/analyticsApi';

interface AgentAccuracyProps {
  accuracy: AccuracyStats | null;
  onOpenMemoryDrawer: () => void;
}

export function AgentAccuracy({ accuracy, onOpenMemoryDrawer }: AgentAccuracyProps) {
  const trustLevel = useTrustStore((s) => s.trustLevel);
  const [expanded, setExpanded] = useState(trustLevel <= 2);

  if (!accuracy) return null;

  const hasAntiPatterns = accuracy.anti_patterns.length > 0;

  return (
    <Card>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 text-left"
      >
        <h2 className="text-sm font-semibold text-slate-200">Agent Accuracy</h2>
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-slate-800 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Improvement Trend */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Quality Score</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-slate-100">
                  {(accuracy.avg_quality_score * 100).toFixed(0)}%
                </span>
                {accuracy.quality_trend.delta !== 0 && (
                  <span className={cn('text-xs', accuracy.quality_trend.delta > 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {accuracy.quality_trend.delta > 0 ? '+' : ''}{(accuracy.quality_trend.delta * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>

            {/* Override Rate */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <UserX className="w-3.5 h-3.5" />
                <span>Override Rate</span>
              </div>
              <div className="text-lg font-bold text-slate-100">
                {accuracy.override_rate.total_proposed > 0
                  ? `${(accuracy.override_rate.rate * 100).toFixed(0)}%`
                  : '\u2014'}
              </div>
              {accuracy.override_rate.total_proposed > 0 && (
                <div className="text-xs text-slate-500">
                  {accuracy.override_rate.overrides} of {accuracy.override_rate.total_proposed} actions overridden
                </div>
              )}
            </div>
          </div>

          {/* Recurring Mistakes */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Recurring Issues</span>
            </div>
            {hasAntiPatterns ? (
              <div className="space-y-1">
                {accuracy.anti_patterns.map((ap) => (
                  <div key={`${ap.error_type}-${ap.namespace}`} className="text-xs text-amber-300/80 bg-amber-500/5 rounded-sm px-3 py-1.5 border border-amber-500/10">
                    {ap.description} &mdash; {ap.count} incidents this month
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> No recurring issues detected
              </div>
            )}
          </div>

          {/* Learning Activity */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Learning</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-300">
              <span>{accuracy.learning.total_runbooks} runbooks ({accuracy.learning.new_this_month} new)</span>
              <span>&middot;</span>
              <span>Success rate: {(accuracy.learning.runbook_success_rate * 100).toFixed(0)}%</span>
              <span>&middot;</span>
              <span>{accuracy.learning.total_patterns} patterns</span>
            </div>
            <button onClick={onOpenMemoryDrawer} className="text-xs text-violet-400 hover:text-violet-300">
              View learned patterns &rarr;
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
