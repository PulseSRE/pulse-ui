import { CheckCircle2, XCircle, Shield, ChevronRight, Brain, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import type { FixHistorySummary, ScannerCoverage, ConfidenceCalibration, CostStats, ReadinessSummary } from '../../engine/analyticsApi';
import type { AgentEvalStatus } from '../../engine/evalStatus';

function gateColor(passed: boolean | undefined): string {
  if (passed === true) return 'text-emerald-400';
  if (passed === false) return 'text-red-400';
  return 'text-slate-400';
}

interface AgentHealthProps {
  evalStatus: AgentEvalStatus | null | undefined;
  coverage: ScannerCoverage | null;
  fixSummary: FixHistorySummary | null;
  confidence: ConfidenceCalibration | null;
  costStats: CostStats | null;
  readiness: ReadinessSummary | null;
  onOpenScannerDrawer: () => void;
  onOpenEvalDrawer: () => void;
  onOpenMemoryDrawer: () => void;
  memoryPatternCount?: number;
}

export function AgentHealth({
  evalStatus, coverage, fixSummary, confidence, costStats, readiness,
  onOpenScannerDrawer, onOpenEvalDrawer, onOpenMemoryDrawer,
  memoryPatternCount = 0,
}: AgentHealthProps) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-200 mb-3">Agent Health</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <QualityCard evalStatus={evalStatus} confidence={confidence} onClick={onOpenEvalDrawer} />
        <CoverageCard coverage={coverage} onClick={onOpenScannerDrawer} />
        <OutcomesCard
          fixSummary={fixSummary}
          costStats={costStats}
          readiness={readiness}
          memoryPatternCount={memoryPatternCount}
          onMemoryClick={onOpenMemoryDrawer}
        />
      </div>
    </div>
  );
}

function QualityCard({ evalStatus, confidence, onClick }: { evalStatus: AgentEvalStatus | null | undefined; confidence: ConfidenceCalibration | null; onClick: () => void }) {
  const passed = evalStatus?.quality_gate_passed;
  const avgScore = evalStatus?.release?.average_overall;
  const dims = evalStatus?.release?.dimension_averages || {};

  return (
    <Card onClick={onClick} className="group">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Quality Gate</h3>
          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
        </div>

        <div className="flex items-center gap-2">
          {passed === true && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          {passed === false && <XCircle className="w-5 h-5 text-red-400" />}
          <span className={cn('text-2xl font-bold', gateColor(passed))}>
            {avgScore != null ? `${Math.round(avgScore * 100)}%` : '\u2014'}
          </span>
        </div>

        <div className="space-y-1">
          {Object.entries(dims).slice(0, 4).map(([dim, score]) => (
            <DimensionBar key={dim} label={dim} score={score as number} />
          ))}
        </div>

        {confidence && confidence.rating !== 'insufficient_data' && (
          <div className="flex items-center gap-2 text-xs text-slate-400 pt-1 border-t border-slate-800">
            <Shield className="w-3 h-3" />
            <span>Confidence accuracy: {confidence.accuracy_pct}%</span>
            <span className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-medium',
              confidence.rating === 'good' ? 'bg-emerald-500/10 text-emerald-400' :
              confidence.rating === 'fair' ? 'bg-amber-500/10 text-amber-400' :
              'bg-red-500/10 text-red-400',
            )}>
              {confidence.rating}
            </span>
          </div>
        )}

        {evalStatus?.release?.blocker_counts && (
          <div className="text-xs text-slate-500">
            {(evalStatus.release.blocker_counts.policy_violation || 0) + (evalStatus.release.blocker_counts.hallucinated_tool || 0) === 0
              ? '0 policy violations, 0 hallucinated tools'
              : `${evalStatus.release.blocker_counts.policy_violation || 0} violations, ${evalStatus.release.blocker_counts.hallucinated_tool || 0} hallucinated tools`}
          </div>
        )}
      </div>
    </Card>
  );
}

function CoverageCard({ coverage, onClick }: { coverage: ScannerCoverage | null; onClick: () => void }) {
  return (
    <Card onClick={onClick} className="group">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Coverage</h3>
          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-100">
            {coverage?.coverage_pct != null ? `${coverage.coverage_pct}%` : '\u2014'}
          </span>
          <span className="text-xs text-slate-500">
            {coverage ? `${coverage.active_scanners} of ${coverage.total_scanners} scanners` : ''}
          </span>
        </div>

        <div className="space-y-1">
          {(coverage?.categories || []).map((cat) => (
            <div key={cat.name} className="flex items-center gap-2 text-xs">
              <div className={cn('w-1.5 h-1.5 rounded-full', cat.covered ? 'bg-emerald-400' : 'bg-slate-600')} />
              <span className={cn(cat.covered ? 'text-slate-300' : 'text-slate-500')}>
                {cat.name.replace(/_/g, ' ')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function OutcomesCard({
  fixSummary, costStats, readiness, memoryPatternCount, onMemoryClick,
}: {
  fixSummary: FixHistorySummary | null;
  costStats: CostStats | null;
  readiness: ReadinessSummary | null;
  memoryPatternCount: number;
  onMemoryClick: () => void;
}) {
  return (
    <Card>
      <div className="p-4 space-y-3">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Outcomes</h3>

        {fixSummary && (
          <div className="text-sm text-slate-200">
            <span className="font-semibold">{fixSummary.total_actions}</span> findings &middot;{' '}
            <span className="text-emerald-400">{fixSummary.completed} fixed</span> &middot;{' '}
            <span className="text-amber-400">{fixSummary.rolled_back} rolled back</span>
          </div>
        )}

        {fixSummary && fixSummary.total_actions > 0 && (
          <div className="text-xs text-slate-400">
            Auto-fix success: <span className="text-slate-200">{Math.round(fixSummary.success_rate * 100)}%</span>
          </div>
        )}

        {fixSummary && fixSummary.avg_resolution_ms > 0 && (
          <div className="text-xs text-slate-400">
            Avg resolution: <span className="text-slate-200">{(fixSummary.avg_resolution_ms / 60000).toFixed(1)} min</span>
          </div>
        )}

        {costStats && costStats.cost && costStats.cost.total_usd > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-slate-400">
              Cost ({costStats.total_incidents} conversations): <span className="text-slate-200 font-medium">${costStats.cost.total_usd.toFixed(2)}</span>
              {costStats.trend.delta_pct !== 0 && (
                <TrendBadge delta={costStats.trend.delta_pct} invertColor />
              )}
            </div>
            <div className="text-xs text-slate-500">
              ${costStats.cost.avg_per_incident_usd.toFixed(3)}/conversation · input ${costStats.cost.input_usd.toFixed(2)} · output ${costStats.cost.output_usd.toFixed(2)}
              {costStats.cost.cache_savings_usd > 0 && (
                <span className="text-emerald-500"> · saved ${costStats.cost.cache_savings_usd.toFixed(2)} (cache)</span>
              )}
            </div>
          </div>
        )}
        {costStats && (!costStats.cost || costStats.cost.total_usd === 0) && costStats.avg_tokens_per_incident > 0 && (
          <div className="text-xs text-slate-400">
            Avg tokens/incident: <span className="text-slate-200">{(costStats.avg_tokens_per_incident / 1000).toFixed(1)}K</span>
            {costStats.trend.delta_pct !== 0 && (
              <TrendBadge delta={costStats.trend.delta_pct} invertColor />
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <button onClick={onMemoryClick} className="text-xs text-violet-400 hover:text-violet-300">
            <Brain className="w-3 h-3 inline mr-1" />{memoryPatternCount} patterns learned
          </button>
          {readiness && (
            <span className="text-xs text-slate-500">
              Readiness: {readiness.passed}/{readiness.total_gates}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function DimensionBar({ label, score }: { label: string; score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-500 w-20 truncate capitalize">{label.replace(/_/g, ' ')}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div
          className={cn('h-full rounded-full', pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-slate-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

function TrendBadge({ delta, invertColor = false }: { delta: number; invertColor?: boolean }) {
  const positive = invertColor ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  return (
    <span className={cn('inline-flex items-center gap-0.5 ml-1 text-[10px]', positive ? 'text-emerald-400' : 'text-red-400')}>
      <Icon className="w-3 h-3" />{Math.abs(delta).toFixed(1)}%
    </span>
  );
}
