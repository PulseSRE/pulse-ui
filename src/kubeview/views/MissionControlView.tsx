import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, AlertTriangle, CheckCircle, XCircle, AlertOctagon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchFixHistorySummary,
  fetchScannerCoverage,
  fetchConfidenceCalibration,
  fetchAccuracyStats,
  fetchCostStats,
  fetchRecommendations,
  fetchReadinessSummary,
  fetchCapabilities,
  fetchAgentVersion,
} from '../engine/analyticsApi';
import { fetchAgentEvalStatus } from '../engine/evalStatus';
import { TrustPolicy } from './mission-control/TrustPolicy';
import { AgentHealth } from './mission-control/AgentHealth';
import { AgentAccuracy } from './mission-control/AgentAccuracy';
import { CapabilityDiscovery } from './mission-control/CapabilityDiscovery';
import { ScannerDrawer } from './mission-control/ScannerDrawer';
import { EvalDrawer } from './mission-control/EvalDrawer';
import { MemoryDrawer } from './mission-control/MemoryDrawer';

export default function MissionControlView() {
  const [drawerOpen, setDrawerOpen] = useState<'scanner' | 'eval' | 'memory' | null>(null);

  const evalQ = useQuery({
    queryKey: ['agent', 'eval-status'],
    queryFn: fetchAgentEvalStatus,
    refetchInterval: 60_000,
  });

  const fixQ = useQuery({
    queryKey: ['agent', 'fix-history-summary'],
    queryFn: () => fetchFixHistorySummary(),
    staleTime: 60_000,
  });

  const coverageQ = useQuery({
    queryKey: ['agent', 'scanner-coverage'],
    queryFn: () => fetchScannerCoverage(),
    staleTime: 60_000,
  });

  const confidenceQ = useQuery({
    queryKey: ['agent', 'confidence'],
    queryFn: () => fetchConfidenceCalibration(),
    staleTime: 60_000,
  });

  const accuracyQ = useQuery({
    queryKey: ['agent', 'accuracy'],
    queryFn: () => fetchAccuracyStats(),
    staleTime: 60_000,
  });

  const costQ = useQuery({
    queryKey: ['agent', 'cost'],
    queryFn: () => fetchCostStats(),
    staleTime: 60_000,
  });

  const recsQ = useQuery({
    queryKey: ['agent', 'recommendations'],
    queryFn: fetchRecommendations,
    staleTime: 5 * 60_000,
  });

  const readinessQ = useQuery({
    queryKey: ['agent', 'readiness-summary'],
    queryFn: () => fetchReadinessSummary(),
    staleTime: 60_000,
  });

  const capQ = useQuery({
    queryKey: ['agent', 'capabilities'],
    queryFn: fetchCapabilities,
    staleTime: 60_000,
  });

  const versionQ = useQuery({
    queryKey: ['agent', 'version'],
    queryFn: fetchAgentVersion,
    staleTime: 5 * 60_000,
  });

  const kpiQ = useQuery({
    queryKey: ['agent', 'kpi'],
    queryFn: async () => {
      const res = await fetch('/api/agent/kpi?days=7');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const dataQueries = [evalQ, fixQ, coverageQ, confidenceQ, accuracyQ, costQ, recsQ, readinessQ];
  const anyError = dataQueries.some((q) => q.isError);
  const anyLoading = dataQueries.every((q) => q.isLoading);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Bot className="w-6 h-6 text-violet-400" />
          <h1 className="text-lg font-semibold text-slate-100">Mission Control</h1>
          {versionQ.data && (
            <span className="text-xs text-slate-500">
              v{versionQ.data.agent} &middot; Protocol v{versionQ.data.protocol} &middot; {versionQ.data.tools} tools
            </span>
          )}
        </div>

        {/* KPI Dashboard */}
        {kpiQ.data?.kpis && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {Object.entries(kpiQ.data.kpis as Record<string, { label: string; value: number | string; unit: string; target: number | string; status: string }>).map(([key, kpi]) => (
              <div key={key} className={cn(
                'bg-slate-900 border rounded-lg p-2.5 text-center',
                kpi.status === 'pass' ? 'border-emerald-800/30' :
                kpi.status === 'warn' ? 'border-amber-800/30' :
                kpi.status === 'fail' ? 'border-red-800/30' :
                'border-slate-800',
              )}>
                <div className="flex items-center justify-center gap-1 mb-1">
                  {kpi.status === 'pass' ? <CheckCircle className="w-3 h-3 text-emerald-400" /> :
                   kpi.status === 'warn' ? <AlertTriangle className="w-3 h-3 text-amber-400" /> :
                   <XCircle className="w-3 h-3 text-red-400" />}
                  <span className="text-[10px] text-slate-500 truncate">{kpi.label}</span>
                </div>
                <div className={cn(
                  'text-sm font-bold',
                  kpi.status === 'pass' ? 'text-emerald-400' :
                  kpi.status === 'warn' ? 'text-amber-400' :
                  kpi.status === 'fail' ? 'text-red-400' :
                  'text-slate-200',
                )}>
                  {kpi.unit === 'ratio' ? `${Math.round((kpi.value as number) * 100)}%` :
                   kpi.unit === 'seconds' ? `${kpi.value}s` :
                   kpi.unit === 'ms' ? `${kpi.value}ms` :
                   String(kpi.value)}
                </div>
              </div>
            ))}
          </div>
        )}

        {anyError && (
          <div className="flex items-center gap-2 text-xs text-amber-300/80 bg-amber-500/5 rounded-md px-3 py-2 border border-amber-500/10">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Some analytics data is unavailable. Cards below may show partial information.</span>
          </div>
        )}

        {/* Agent Intelligence Summary */}
        <AgentIntelligenceCard />

        <TrustPolicy
          maxTrustLevel={capQ.data?.max_trust_level ?? 0}
          scannerCount={coverageQ.data?.active_scanners ?? 0}
          fixSummary={fixQ.data ?? null}
        />

        {!anyLoading && (
          <>
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

            <AgentAccuracy
              accuracy={accuracyQ.data ?? null}
              onOpenMemoryDrawer={() => setDrawerOpen('memory')}
            />

            {recsQ.data?.recommendations && (
              <CapabilityDiscovery recommendations={recsQ.data.recommendations} />
            )}
          </>
        )}
      </div>

      {drawerOpen === 'scanner' && <ScannerDrawer coverage={coverageQ.data ?? null} onClose={() => setDrawerOpen(null)} />}
      {drawerOpen === 'eval' && <EvalDrawer evalStatus={evalQ.data} onClose={() => setDrawerOpen(null)} />}
      {drawerOpen === 'memory' && <MemoryDrawer onClose={() => setDrawerOpen(null)} />}
    </div>
  );
}

function AgentIntelligenceCard() {
  const { data: learning } = useQuery({
    queryKey: ['agent', 'learning-mc'],
    queryFn: async () => {
      const res = await fetch('/api/agent/analytics/learning?days=7');
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: fixStrategies } = useQuery({
    queryKey: ['agent', 'fix-strategies-mc'],
    queryFn: async () => {
      const res = await fetch('/api/agent/analytics/fix-strategies?days=30');
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  const events = learning?.events ?? [];
  const strategies = fixStrategies?.strategies ?? [];

  if (events.length === 0 && strategies.length === 0) return null;

  const selectionSummary = events.find((e: Record<string, unknown>) => e.type === 'selection_summary');
  const routingDecisions = events.filter((e: Record<string, unknown>) => e.type === 'routing_decision');
  const postmortemCount = events.find((e: Record<string, unknown>) => e.type === 'postmortems_generated');
  const topStrategy = strategies[0];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-cyan-400" />
          Agent Intelligence
        </h3>
        <a href="/toolbox?tab=analytics" className="text-[10px] text-slate-500 hover:text-slate-300">
          Full analytics →
        </a>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {selectionSummary && (
          <div>
            <div className="text-slate-500 mb-0.5">Routing</div>
            <div className="text-slate-200">{String((selectionSummary as Record<string, unknown>).description).split(',')[0]}</div>
          </div>
        )}
        {postmortemCount && (
          <div>
            <div className="text-slate-500 mb-0.5">Postmortems</div>
            <div className="text-teal-400">{String((postmortemCount as Record<string, unknown>).description)}</div>
          </div>
        )}
        {topStrategy && (
          <div>
            <div className="text-slate-500 mb-0.5">Top Fix Strategy</div>
            <div className="text-slate-200">
              {topStrategy.tool}: {Math.round(topStrategy.success_rate * 100)}%
            </div>
          </div>
        )}
        {routingDecisions.length > 0 && (
          <div>
            <div className="text-slate-500 mb-0.5">Recent Routing</div>
            <div className="text-slate-200">{routingDecisions.length} decisions</div>
          </div>
        )}
      </div>
    </div>
  );
}
