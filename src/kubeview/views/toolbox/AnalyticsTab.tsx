import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Wrench, Database, AlertTriangle, Clock, Bot, Shield, Palette,
  ArrowRight, Puzzle, FileText, DollarSign, CheckCircle, XCircle, Activity, HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useShallow } from 'zustand/react/shallow';
import { useToolUsageStore } from '../../store/toolUsageStore';
import { useVisibilityAwareInterval } from '../../hooks/useVisibilityAwareInterval';
import { safeQuery } from '../../engine/safeQuery';
import {
  fetchIntelligenceSections,
  fetchPromptStats,
  fetchFixHistorySummary,
  fetchScannerCoverage,
  fetchConfidenceCalibration,
  fetchAccuracyStats,
  fetchCostStats,
  fetchRecommendations,
  fetchReadinessSummary,
  type CostStats,
} from '../../engine/analyticsApi';
import { fetchAgentEvalStatus } from '../../engine/evalStatus';
import { METRIC_EXPLANATIONS } from '../../engine/analyticsExplanations';
import { SourceBadge } from './SourceBadge';
import { StatCard } from './StatCard';
import { SessionAnalyticsSection } from './SessionAnalyticsSection';
import { OrcaAnalyticsSection } from './OrcaAnalyticsSection';
import { PromptAuditSection } from './PromptAuditSection';
import { UnusedToolsSection } from './UnusedToolsSection';
import { AgentHealth } from '../mission-control/AgentHealth';
import { AgentAccuracy } from '../mission-control/AgentAccuracy';
import { CapabilityDiscovery } from '../mission-control/CapabilityDiscovery';
import { ScannerDrawer } from '../mission-control/ScannerDrawer';
import { EvalDrawer } from '../mission-control/EvalDrawer';
import { MemoryDrawer } from '../mission-control/MemoryDrawer';

const MODE_ICONS: Record<string, React.ReactNode> = {
  sre: <Bot className="w-4 h-4 text-violet-400" />,
  security: <Shield className="w-4 h-4 text-red-400" />,
  view_designer: <Palette className="w-4 h-4 text-emerald-400" />,
};

export function AnalyticsTab() {
  const { stats, statsLoading, loadStats, chains, chainsLoading, loadChains, tools, loadTools } = useToolUsageStore(useShallow((s) => ({
    stats: s.stats, statsLoading: s.statsLoading, loadStats: s.loadStats,
    chains: s.chains, chainsLoading: s.chainsLoading, loadChains: s.loadChains,
    tools: s.tools, loadTools: s.loadTools,
  })));

  const { data: intelligence } = useQuery({
    queryKey: ['analytics', 'intelligence'],
    queryFn: () => safeQuery(() => fetchIntelligenceSections()),
    staleTime: 60_000,
  });

  const { data: promptAnalytics } = useQuery({
    queryKey: ['analytics', 'prompt'],
    queryFn: () => safeQuery(() => fetchPromptStats()),
    staleTime: 60_000,
  });

  const { data: skillStats, isLoading: skillStatsLoading } = useQuery({
    queryKey: ['admin', 'skill-usage'],
    queryFn: async () => {
      const res = await fetch('/api/agent/skills/usage?days=30');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 30_000,
  });

  // Agent health data (moved from old MissionControlView)
  const [drawerOpen, setDrawerOpen] = useState<'scanner' | 'eval' | 'memory' | null>(null);
  const evalQ = useQuery({ queryKey: ['agent', 'eval-status'], queryFn: fetchAgentEvalStatus, refetchInterval: 60_000 });
  const fixQ = useQuery({ queryKey: ['agent', 'fix-history-summary'], queryFn: () => fetchFixHistorySummary(), staleTime: 60_000 });
  const coverageQ = useQuery({ queryKey: ['agent', 'scanner-coverage'], queryFn: () => fetchScannerCoverage(), staleTime: 60_000 });
  const confidenceQ = useQuery({ queryKey: ['agent', 'confidence'], queryFn: () => fetchConfidenceCalibration(), staleTime: 60_000 });
  const accuracyQ = useQuery({ queryKey: ['agent', 'accuracy'], queryFn: () => fetchAccuracyStats(), staleTime: 60_000 });
  const costQ = useQuery({ queryKey: ['agent', 'cost'], queryFn: () => fetchCostStats(), staleTime: 60_000 });
  const recsQ = useQuery({ queryKey: ['agent', 'recommendations'], queryFn: fetchRecommendations, staleTime: 5 * 60_000 });
  const readinessQ = useQuery({ queryKey: ['agent', 'readiness-summary'], queryFn: () => fetchReadinessSummary(), staleTime: 60_000 });

  useEffect(() => { loadStats(); loadChains(); loadTools(); }, [loadStats, loadChains, loadTools]);
  const refreshAnalytics = useCallback(() => { loadStats(); loadChains(); }, [loadStats, loadChains]);
  useVisibilityAwareInterval(refreshAnalytics, 10000);

  if (statsLoading && !stats) {
    return <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>;
  }

  if (!stats || stats.total_calls === 0) {
    return (
      <div className="space-y-6">
        <OrcaAnalyticsSection />
        <div className="text-center py-8 text-sm text-slate-500">No tool usage data yet. Tool call analytics will appear once the agent handles conversations.</div>

        {/* Agent health sections always render even without tool usage data */}
        <div className="border-t border-slate-800 pt-6">
          <AgentHealth
            evalStatus={evalQ.data ?? null}
            coverage={coverageQ.data ?? null}
            fixSummary={fixQ.data ?? null}
            confidence={confidenceQ.data ?? null}
            costStats={costQ.data ?? null}
            readiness={readinessQ.data ?? null}
            onOpenScannerDrawer={() => setDrawerOpen('scanner')}
            onOpenEvalDrawer={() => setDrawerOpen('eval')}
            onOpenMemoryDrawer={() => setDrawerOpen('memory')}
            memoryPatternCount={accuracyQ.data?.learning?.total_patterns ?? 0}
          />
        </div>
        <AgentAccuracy accuracy={accuracyQ.data ?? null} onOpenMemoryDrawer={() => setDrawerOpen('memory')} />
        {recsQ.data?.recommendations && recsQ.data.recommendations.length > 0 && (
          <CapabilityDiscovery recommendations={recsQ.data.recommendations} />
        )}
        {drawerOpen === 'scanner' && <ScannerDrawer coverage={coverageQ.data ?? null} onClose={() => setDrawerOpen(null)} />}
        {drawerOpen === 'eval' && <EvalDrawer evalStatus={evalQ.data} onClose={() => setDrawerOpen(null)} />}
        {drawerOpen === 'memory' && <MemoryDrawer onClose={() => setDrawerOpen(null)} />}
      </div>
    );
  }

  const byTool = stats.by_tool || [];
  const maxCount = Math.max(...byTool.slice(0, 10).map((t) => t.count), 1);
  const bySource = useMemo(() => {
    const raw = (stats as unknown as { by_source?: Record<string, number> | Array<{ source: string; count: number }> }).by_source;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : Object.entries(raw).map(([source, count]) => ({ source, count }));
  }, [stats]);

  const skills = skillStats?.skills || [];
  const handoffs = skillStats?.handoffs || [];

  return (
    <div className="space-y-6">
      <SessionAnalyticsSection />

      <OrcaAnalyticsSection />

      {/* KPI Dashboard */}
      <KpiSection />

      {/* Cost Breakdown */}
      <CostSection costStats={costQ.data ?? null} />

      {/* Skill Routing → Skills tab, Tool Usage → Tools tab, Unused Tools → Tools tab */}

      {/* Prompt & Token Efficiency */}
      {(promptAnalytics?.stats || intelligence?.token_trending || intelligence?.query_reliability) && (
        <div className="border-t border-slate-800 pt-6">
          <h2 className="text-sm font-semibold text-slate-200 mb-1 flex items-center gap-2">
            <FileText className="w-4 h-4 text-green-400" />
            Prompt & Token Efficiency
          </h2>
          <p className="text-[11px] text-slate-500 mb-4">System prompt performance, token costs, and PromQL query reliability.</p>
        </div>
      )}

      {/* Prompt Analytics */}
      {promptAnalytics?.stats && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">Prompt Size & Cache</h3>
          <div className="text-sm text-slate-200">
            Avg tokens: {promptAnalytics.stats.avg_tokens.toLocaleString()} &middot; Cache hit rate: {(promptAnalytics.stats.cache_hit_rate * 100).toFixed(0)}%
          </div>
          {Object.keys(promptAnalytics.stats.section_avg).length > 0 && (
            <div className="mt-2 space-y-1">
              {Object.entries(promptAnalytics.stats.section_avg).map(([section, avg]) => (
                <div key={section} className="flex items-center gap-2 text-xs">
                  <span className="w-24 text-slate-500 truncate">{section}</span>
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500/60 rounded-full" style={{ width: `${Math.min((avg as number) / 100, 100)}%` }} />
                  </div>
                  <span className="w-12 text-right text-slate-500">{(avg as number).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Token Trending */}
      {intelligence?.token_trending && (intelligence.token_trending.input_delta_pct !== 0 || intelligence.token_trending.output_delta_pct !== 0 || intelligence.token_trending.cache_delta_pct !== 0) && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">Token Trending (week-over-week)</h3>
          <div className="grid grid-cols-3 gap-4 text-center text-xs">
            <div>
              <div className="text-slate-400">Input</div>
              <div className={intelligence.token_trending.input_delta_pct > 0 ? 'text-red-400' : 'text-emerald-400'}>
                {intelligence.token_trending.input_delta_pct > 0 ? '+' : ''}{intelligence.token_trending.input_delta_pct.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-slate-400">Output</div>
              <div className={intelligence.token_trending.output_delta_pct > 0 ? 'text-red-400' : 'text-emerald-400'}>
                {intelligence.token_trending.output_delta_pct > 0 ? '+' : ''}{intelligence.token_trending.output_delta_pct.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-slate-400">Cache</div>
              <div className={intelligence.token_trending.cache_delta_pct > 0 ? 'text-emerald-400' : 'text-red-400'}>
                {intelligence.token_trending.cache_delta_pct > 0 ? '+' : ''}{intelligence.token_trending.cache_delta_pct.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PromQL Reliability */}
      {intelligence?.query_reliability && (intelligence.query_reliability.preferred.length > 0 || intelligence.query_reliability.unreliable.length > 0) && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">PromQL Reliability</h3>
          <div className="text-xs text-slate-400 mb-2">
            {intelligence.query_reliability.preferred.length} reliable &middot; {intelligence.query_reliability.unreliable.length} unreliable
          </div>
          {intelligence.query_reliability.unreliable.map((q) => (
            <div key={q.query} className="text-xs text-red-400/80 truncate">
              {q.query} &mdash; {(q.success_rate * 100).toFixed(0)}% success ({q.total} calls)
            </div>
          ))}
        </div>
      )}

      {/* Prompt Audit */}
      <PromptAuditSection />

      {/* Agent Health (eval gate, scanner coverage, fix outcomes) */}
      <div className="border-t border-slate-800 pt-6">
        <AgentHealth
          evalStatus={evalQ.data ?? null}
          coverage={coverageQ.data ?? null}
          fixSummary={fixQ.data ?? null}
          confidence={confidenceQ.data ?? null}
          costStats={costQ.data ?? null}
          readiness={readinessQ.data ?? null}
          onOpenScannerDrawer={() => setDrawerOpen('scanner')}
          onOpenEvalDrawer={() => setDrawerOpen('eval')}
          onOpenMemoryDrawer={() => setDrawerOpen('memory')}
          memoryPatternCount={accuracyQ.data?.learning?.total_patterns ?? 0}
        />
      </div>

      {/* Agent Accuracy */}
      <AgentAccuracy
        accuracy={accuracyQ.data ?? null}
        onOpenMemoryDrawer={() => setDrawerOpen('memory')}
      />

      {/* Capability Discovery */}
      {recsQ.data?.recommendations && recsQ.data.recommendations.length > 0 && (
        <CapabilityDiscovery recommendations={recsQ.data.recommendations} />
      )}

      {drawerOpen === 'scanner' && <ScannerDrawer coverage={coverageQ.data ?? null} onClose={() => setDrawerOpen(null)} />}
      {drawerOpen === 'eval' && <EvalDrawer evalStatus={evalQ.data} onClose={() => setDrawerOpen(null)} />}
      {drawerOpen === 'memory' && <MemoryDrawer onClose={() => setDrawerOpen(null)} />}
    </div>
  );
}


const KPI_INFO: Record<string, { label: string; explain: string; action: string }> = {
  mttd: { label: 'Detect', explain: 'How quickly issues are found. Target: <60s.', action: 'Decrease scan interval in settings.' },
  mttr: { label: 'Remediate', explain: 'How quickly issues are fixed. Target: <5min.', action: 'Review auto-fix categories.' },
  auto_fix_success: { label: 'Fix Success', explain: 'Auto-fix success rate. Target: >85%.', action: 'Review fix strategies below.' },
  false_positive_rate: { label: 'Noise', explain: 'Findings that were false positives. Target: <2%.', action: 'Check scanner noise thresholds.' },
  selector_recall: { label: 'Routing', explain: 'Correct skill selected. Target: >92%.', action: 'Review ORCA channel weights.' },
  selector_latency_p99: { label: 'Latency p99', explain: 'Routing decision speed. Target: <80ms.', action: 'Check keyword index size.' },
  agent_caused_incidents: { label: 'Agent Incidents', explain: 'Issues caused by auto-fix. Target: 0.', action: 'Review rolled-back actions.' },
  time_to_resolution: { label: 'Resolution', explain: 'End-to-end fix time. Target: <10min.', action: 'Check investigation plan efficiency.' },
  self_heal_rate: { label: 'Self-Heal', explain: 'Issues resolved without agent. Higher = resilient cluster.', action: 'Informational — no action needed.' },
  tokens_per_resolution: { label: 'Tokens/Fix', explain: 'AI tokens per resolution. Lower = more efficient.', action: 'Check prompt audit for bloat.' },
  routing_accuracy: { label: 'Route Accuracy', explain: 'ORCA overall accuracy. Target: >90%.', action: 'Review skill analytics.' },
};

function KpiSection() {
  const { data: kpiData } = useQuery({
    queryKey: ['analytics', 'kpi'],
    queryFn: async () => {
      const res = await fetch('/api/agent/kpi?days=7');
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  if (!kpiData?.kpis) return null;

  const kpis = kpiData.kpis as Record<string, { label: string; value: number | string; unit: string; status: string; sample_count?: number }>;

  return (
    <div className="border-t border-slate-800 pt-6">
      <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
        <Activity className="w-4 h-4 text-blue-400" />
        Operational KPIs (7 days)
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {Object.entries(kpis).map(([key, kpi]) => {
          const info = KPI_INFO[key];
          const noData = kpi.status === 'info' && (kpi.value === 0 || kpi.value === '0');
          const val = noData ? '\u2014' :
            kpi.unit === 'ratio' ? `${Math.round((kpi.value as number) * 100)}%` :
            kpi.unit === 'seconds' ? `${kpi.value}s` :
            kpi.unit === 'ms' ? `${kpi.value}ms` :
            String(kpi.value);

          return (
            <div key={key} className={cn(
              'bg-slate-900 border rounded-lg p-2.5 text-center group relative',
              kpi.status === 'pass' ? 'border-emerald-800/30' :
              kpi.status === 'warn' ? 'border-amber-800/30' :
              kpi.status === 'fail' ? 'border-red-800/30' :
              'border-slate-800',
            )}>
              <div className="flex items-center justify-center gap-1 mb-1">
                {kpi.status === 'pass' ? <CheckCircle className="w-3 h-3 text-emerald-400" /> :
                 kpi.status === 'warn' ? <AlertTriangle className="w-3 h-3 text-amber-400" /> :
                 kpi.status === 'info' ? <Activity className="w-3 h-3 text-slate-500" /> :
                 <XCircle className="w-3 h-3 text-red-400" />}
                <span className="text-[10px] text-slate-500 truncate">{info?.label ?? kpi.label}</span>
              </div>
              <div className={cn('text-sm font-bold', noData ? 'text-slate-500' : kpi.status === 'pass' ? 'text-emerald-400' : kpi.status === 'warn' ? 'text-amber-400' : kpi.status === 'fail' ? 'text-red-400' : 'text-slate-200')}>
                {val}
              </div>
              {noData && <div className="text-[9px] text-slate-600 mt-0.5">No data yet</div>}
              {info && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-left w-48 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 space-y-0.5">
                  <div className="text-slate-300">{info.explain}</div>
                  <div className="text-blue-400">{info.action}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CostSection({ costStats }: { costStats: CostStats | null }) {
  if (!costStats?.cost || costStats.cost.total_usd === 0) return null;

  const { cost, total_incidents = 0, by_mode = [] } = costStats;

  return (
    <div className="border-t border-slate-800 pt-6">
      <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-green-400" />
        Cost Breakdown
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
          <div className="text-[10px] text-slate-500 mb-1">Total Cost</div>
          <div className="text-lg font-bold text-slate-100">${cost.total_usd.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
          <div className="text-[10px] text-slate-500 mb-1">Per Session</div>
          <div className="text-lg font-bold text-slate-100">${cost.avg_per_incident_usd.toFixed(3)}</div>
          <div className="text-[9px] text-slate-600">{total_incidents} sessions</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
          <div className="text-[10px] text-slate-500 mb-1">Cache Savings</div>
          <div className="text-lg font-bold text-emerald-400">${cost.cache_savings_usd.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
          <div className="text-[10px] text-slate-500 mb-1">I/O Split</div>
          <div className="text-xs text-slate-300">
            <span className="text-blue-400">${cost.input_usd.toFixed(2)}</span> in / <span className="text-amber-400">${cost.output_usd.toFixed(2)}</span> out
          </div>
        </div>
      </div>

      {by_mode.length > 0 && (
        <div className="mt-3 bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 mb-2">Cost by Mode</div>
          <div className="space-y-1">
            {by_mode.map((m) => (
              <div key={m.mode} className="flex items-center justify-between text-xs">
                <span className="text-slate-300 capitalize">{m.mode}</span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500">{m.count} sessions</span>
                  <span className="text-slate-200 font-medium">${(m.cost_usd ?? 0).toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
