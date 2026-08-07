import { useQuery } from '@tanstack/react-query';
import { Target, Layers, Cable, FileText, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { safeQuery } from '../../engine/safeQuery';
import {
  fetchTopologySummary, fetchPlanTemplates, fetchPostmortemCount,
  fetchFixHistorySummary, fetchFixStrategies, fetchLearningFeed,
} from '../../engine/analyticsApi';
import { StatCard } from './StatCard';

export function OrcaAnalyticsSection() {
  const { data: topology } = useQuery({
    queryKey: ['analytics', 'topology-summary'],
    queryFn: () => safeQuery(() => fetchTopologySummary()),
    staleTime: 60_000,
  });

  const { data: templates } = useQuery({
    queryKey: ['analytics', 'plan-templates'],
    queryFn: async () => (await safeQuery(() => fetchPlanTemplates())) ?? [],
    staleTime: 60_000,
  });

  const { data: postmortemCount } = useQuery({
    queryKey: ['analytics', 'postmortem-count'],
    queryFn: async () => (await safeQuery(() => fetchPostmortemCount())) ?? 0,
    staleTime: 60_000,
  });

  const { data: fixSummary } = useQuery({
    queryKey: ['analytics', 'fix-summary'],
    queryFn: () => safeQuery(() => fetchFixHistorySummary(30)),
    staleTime: 60_000,
  });

  const { data: strategies } = useQuery({
    queryKey: ['analytics', 'fix-strategies'],
    queryFn: async () => (await safeQuery(() => fetchFixStrategies(30))) ?? { strategies: [], days: 30 },
    staleTime: 60_000,
  });

  const { data: learning } = useQuery({
    queryKey: ['analytics', 'learning-feed'],
    queryFn: async () => (await safeQuery(() => fetchLearningFeed(7))) ?? { events: [], days: 7 },
    staleTime: 60_000,
  });

  const hasData = topology || (templates && templates.length > 0) || (postmortemCount && postmortemCount > 0) || fixSummary;
  if (!hasData) return null;

  return (
    <div className="border-t border-slate-800 pt-6 space-y-4">
      <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
        <Target className="w-4 h-4 text-cyan-400" />
        Agent Intelligence
      </h2>
      <p className="text-[11px] text-slate-500 -mt-2">
        Multi-signal skill selection, investigation plans, fix outcomes, and dependency analysis.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {topology && (
          <StatCard
            label="Resources Tracked"
            value={String(topology.nodes)}
            icon={<Layers className="w-4 h-4 text-cyan-400" />}
          />
        )}
        {topology && (
          <StatCard
            label="Dependencies"
            value={String(topology.edges)}
            icon={<Cable className="w-4 h-4 text-cyan-400" />}
          />
        )}
        {templates && (
          <StatCard
            label="Investigation Plans"
            value={String(templates.length)}
            icon={<Target className="w-4 h-4 text-violet-400" />}
          />
        )}
        <StatCard
          label="Postmortems"
          value={String(postmortemCount || 0)}
          icon={<FileText className="w-4 h-4 text-teal-400" />}
        />
      </div>

      {/* Recent Routing Decisions */}
      {learning && learning.events.filter(e => e.type === 'routing_decision').length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-1">Recent Routing Decisions</h3>
          <p className="text-[11px] text-slate-500 mb-3">Why each query was routed to a specific skill — shows which channels fired.</p>
          <div className="space-y-2">
            {learning.events.filter(e => e.type === 'routing_decision').map((evt, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <ArrowRight className="w-3 h-3 text-violet-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-slate-200">{evt.description}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {(evt.data as Record<string, string>)?.channels || 'low signal'}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {learning.events.find(e => e.type === 'selection_summary') && (
            <div className="mt-2 pt-2 border-t border-slate-800 text-[11px] text-slate-400">
              {learning.events.find(e => e.type === 'selection_summary')?.description}
            </div>
          )}
        </div>
      )}

      {/* Fix Outcomes */}
      {fixSummary && fixSummary.total_actions > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-1">Fix Outcomes</h3>
          <p className="text-[11px] text-slate-500 mb-3">How well automated fixes resolve issues (last 30 days).</p>
          <div className="grid grid-cols-4 gap-4 text-center text-xs">
            <div>
              <div className="text-slate-400">Success Rate</div>
              <div className="text-lg font-bold text-emerald-400">{(fixSummary.success_rate * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-slate-400">Verified Fixed</div>
              <div className="text-lg font-bold text-emerald-400">{fixSummary.verification.resolved}</div>
            </div>
            <div>
              <div className="text-slate-400">Still Failing</div>
              <div className="text-lg font-bold text-red-400">{fixSummary.verification.still_failing}</div>
            </div>
            <div>
              <div className="text-slate-400">Rollback Rate</div>
              <div className="text-lg font-bold text-amber-400">{(fixSummary.rollback_rate * 100).toFixed(0)}%</div>
            </div>
          </div>
          {fixSummary.by_category.length > 0 && (
            <div className="mt-3 space-y-1">
              {fixSummary.by_category.slice(0, 5).map((c) => (
                <div key={c.category} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{c.category}</span>
                  <span className="text-slate-400">
                    {c.success_count}/{c.count} fixed
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dependency Graph breakdown */}
      {topology && Object.keys(topology.kinds).length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-1">Dependency Graph</h3>
          <p className="text-[11px] text-slate-500 mb-3">Live resource graph used for blast radius analysis and impact prediction.</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {Object.entries(topology.kinds).sort(([, a], [, b]) => b - a).map(([kind, count]) => (
              <div key={kind} className="text-center">
                <div className="text-lg font-bold text-slate-200">{count}</div>
                <div className="text-[10px] text-slate-500">{kind}s</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fix Strategy Effectiveness */}
      {strategies && strategies.strategies.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-1">Fix Strategy Effectiveness</h3>
          <p className="text-[11px] text-slate-500 mb-3">Which remediation strategies work for which incident types (last 30 days).</p>
          <div className="space-y-2">
            {strategies.strategies.slice(0, 8).map((s) => (
              <div key={`${s.category}:${s.tool}`} className="flex items-center gap-3 text-xs">
                <span className="w-20 text-slate-400 truncate">{s.category}</span>
                <span className="w-32 font-mono text-slate-300 truncate">{s.tool}</span>
                <div className="flex-1 h-3 bg-slate-800 rounded-xs overflow-hidden">
                  <div
                    className={cn('h-full rounded-xs', s.success_rate >= 0.7 ? 'bg-emerald-600/60' : s.success_rate >= 0.4 ? 'bg-amber-600/60' : 'bg-red-600/60')}
                    style={{ width: `${s.success_rate * 100}%` }}
                  />
                </div>
                <span className="w-12 text-right text-slate-400">{Math.round(s.success_rate * 100)}%</span>
                <span className="w-8 text-right text-slate-500">{s.total}x</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Learning Feed */}
      {learning && learning.events.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-1">Agent Learning</h3>
          <p className="text-[11px] text-slate-500 mb-3">What the agent learned this week — weight updates, scaffolded skills, selection patterns.</p>
          <div className="space-y-2">
            {learning.events.map((evt, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={cn(
                  'shrink-0 mt-0.5 w-2 h-2 rounded-full',
                  evt.type === 'weight_update' ? 'bg-violet-400' :
                  evt.type === 'skill_scaffolded' ? 'bg-amber-400' :
                  evt.type === 'postmortems_generated' ? 'bg-teal-400' :
                  'bg-blue-400',
                )} />
                <span className="text-slate-300">{evt.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
