import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DrawerShell } from '../../components/primitives/DrawerShell';
import type { AgentEvalStatus, EvalSuiteSummary } from '../../engine/evalStatus';

interface EvalHistoryRun {
  suite: string;
  score: number;
  gate_passed: boolean;
  scenario_count: number;
  passed_count: number;
  timestamp: string;
}

interface EvalDrawerProps {
  evalStatus: AgentEvalStatus | null | undefined;
  onClose: () => void;
}

const SUITES = ['release', 'safety', 'integration', 'view_designer'] as const;

const SUITE_DESCRIPTIONS: Record<string, { short: string; detail: string; negative?: boolean }> = {
  release: {
    short: 'Release gate — must pass before shipping',
    detail: 'End-to-end SRE and security scenarios covering crash loops, pending pods, RBAC, network policies, alerts, GitOps, and resource quotas. If any scenario fails, the release is blocked.',
  },
  safety: {
    short: 'Negative tests — low scores are expected',
    detail: 'Verifies the agent correctly DETECTS safety violations: missing write confirmations, hallucinated tools, and policy violations. Blockers shown here are the violations being tested, not real problems. PASS means the detection works.',
    negative: true,
  },
  integration: {
    short: 'Cross-tool workflows and error recovery',
    detail: 'Tests multi-step workflows: transient API recovery, partial data handling, timeouts, post-fix verification, and component generation across tool calls.',
  },
  view_designer: {
    short: 'Dashboard generation quality',
    detail: 'Validates that the agent selects the right tools and components when creating dashboards: namespace views, cluster overviews, incident triage, widget additions.',
  },
};

const PROMPT_SECTION_DESCRIPTIONS: Record<string, string> = {
  base_prompt: 'Core system prompt — security rules, diagnostic workflow, few-shot examples',
  runbooks: 'Built-in SRE runbooks injected for common scenarios (crash loops, OOM, node pressure)',
  cluster_context: 'Live cluster info — node count, namespaces, OCP version. Refreshed per turn',
  chain_hints: 'Tool sequence patterns learned from usage (e.g., after list_pods → describe_pod)',
  intelligence_context: 'Analytics feedback — query reliability, error hotspots, token efficiency',
  component_hint_all: 'UI component schemas guiding the agent on chart, table, and metric card formats',
};

function formatEvalTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function EvalDrawer({ evalStatus, onClose }: EvalDrawerProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: history } = useQuery({
    queryKey: ['eval-history', 'release'],
    queryFn: async () => {
      const res = await fetch('/api/agent/eval/history?suite=release&days=30');
      if (!res.ok) return null;
      return res.json() as Promise<{ runs: EvalHistoryRun[] }>;
    },
    staleTime: 60_000,
  });

  const toggle = (suite: string) => setExpanded((prev) => (prev === suite ? null : suite));

  return (
    <DrawerShell title="Quality Gate Details" onClose={onClose}>
      <div className="space-y-3 text-sm text-slate-300">
        {evalStatus === undefined && (
          <div className="text-slate-500">Loading eval data...</div>
        )}
        {evalStatus === null && (
          <div className="text-slate-500">Eval data unavailable. The agent may not have run evals yet.</div>
        )}

        {evalStatus && SUITES.map((suite) => {
          const s = evalStatus[suite];
          if (!s) return null;
          const isExpanded = expanded === suite;
          return (
            <SuiteCard
              key={suite}
              name={suite}
              suite={s}
              expanded={isExpanded}
              onToggle={() => toggle(suite)}
            />
          );
        })}

        {/* Prompt Audit */}
        {evalStatus?.prompt_audit && Object.keys(evalStatus.prompt_audit).length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Prompt Token Audit</h3>
            <p className="text-[11px] text-slate-500 mb-3">
              Token cost breakdown of the system prompt sent to Claude per mode. Lower is cheaper. Sections at 0% are inactive (no data yet). Use ablation testing to identify sections that can be trimmed without impacting quality.
            </p>
            {Object.entries(evalStatus.prompt_audit).map(([mode, audit]) => (
              <div key={mode} className="bg-slate-900 rounded-lg border border-slate-800 p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-slate-200 capitalize">{mode.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-slate-500">~{audit.estimated_tokens.toLocaleString()} tokens</span>
                </div>
                <div className="space-y-1.5">
                  {audit.sections.map((section: { name: string; pct: number }) => (
                    <div key={section.name} className="group flex items-center gap-2">
                      <span className="text-[11px] text-slate-500 w-28 truncate" title={PROMPT_SECTION_DESCRIPTIONS[section.name] || section.name}>{section.name}</span>
                      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500/60 rounded-full"
                          style={{ width: `${Math.min(section.pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-slate-500 w-10 text-right">{section.pct.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Outcomes */}
        {evalStatus?.outcomes && (
          <div className="mt-4">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Outcome Tracking</h3>
            <p className="text-[11px] text-slate-500 mb-2">
              Compares auto-fix actions from the last 7 days against the previous 7 days. Detects regressions in success rate, rollback rate, and action duration.
            </p>
            <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-200">Actions</span>
                <span className={evalStatus.outcomes.gate_passed ? 'text-emerald-400 text-xs' : 'text-red-400 text-xs'}>
                  {evalStatus.outcomes.gate_passed ? 'PASS' : 'FAIL'}
                </span>
              </div>
              {evalStatus.outcomes.current_actions === 0 && evalStatus.outcomes.baseline_actions === 0 ? (
                <div className="text-xs text-slate-500">
                  No auto-fix actions recorded yet. The monitor will track actions once it starts applying fixes at trust level 3+.
                </div>
              ) : (
                <div className="text-xs text-slate-400">
                  Current window: {evalStatus.outcomes.current_actions} actions &middot; Baseline: {evalStatus.outcomes.baseline_actions} actions
                </div>
              )}
            </div>
          </div>
        )}

        {/* Eval History Timeline */}
        {history?.runs && history.runs.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Release Gate History (last 30 days)</h3>
            <p className="text-[11px] text-slate-500 mb-3">
              Score trend for the release eval suite. Each row is one eval run.
            </p>
            <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
              <div className="space-y-2">
                {history.runs.map((run, i) => {
                  const pct = Math.round(run.score * 100);
                  return (
                    <div key={i} className="flex items-center gap-3 text-xs">
                      {run.gate_passed
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                      <span className={cn(
                        'font-mono font-semibold w-12',
                        run.gate_passed ? 'text-emerald-400' : 'text-red-400',
                      )}>
                        {pct.toFixed(1)}%
                      </span>
                      <span className="text-slate-500 w-36">{formatEvalTimestamp(run.timestamp)}</span>
                      <span className="text-slate-500">
                        {run.passed_count}/{run.scenario_count} pass
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </DrawerShell>
  );
}

function SuiteCard({ name, suite, expanded, onToggle }: {
  name: string;
  suite: EvalSuiteSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const dims = suite.dimension_averages || {};
  const blockers = suite.blocker_counts || {};
  const hasBlockers = Object.values(blockers).some((v) => v > 0);

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded
            ? <ChevronDown className="w-4 h-4 text-slate-500" />
            : <ChevronRight className="w-4 h-4 text-slate-500" />}
          <div>
            <h3 className="font-medium text-slate-200 capitalize">{name.replace(/_/g, ' ')}</h3>
            <div className="text-xs text-slate-400 mt-0.5">
              {SUITE_DESCRIPTIONS[name]?.short || `${suite.scenario_count} scenarios`}
              {' · '}avg {Math.round((suite.average_overall || 0) * 100)}%
              {suite.passed_count != null && ` · ${suite.passed_count} passed`}
            </div>
          </div>
        </div>
        <span className={suite.gate_passed ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
          {suite.gate_passed ? 'PASS' : 'FAIL'}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-800 space-y-3">
          {/* Suite description */}
          {SUITE_DESCRIPTIONS[name] && (
            <div className="text-xs text-slate-400 leading-relaxed">
              {SUITE_DESCRIPTIONS[name].detail}
            </div>
          )}

          {/* Negative test banner */}
          {SUITE_DESCRIPTIONS[name]?.negative && (
            <div className="flex items-start gap-2 rounded bg-blue-950/30 border border-blue-800/30 px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
              <span className="text-[11px] text-blue-300/80">
                These are intentional safety violations used as test inputs. Low dimension scores confirm the detection system is working. Blockers below are the violations being caught.
              </span>
            </div>
          )}

          {/* Dimension breakdown */}
          {Object.keys(dims).length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs text-slate-500 font-medium">Dimensions</div>
              {Object.entries(dims).map(([dim, score]) => {
                const pct = Math.round(score * 100);
                return (
                  <div key={dim} className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 w-28 truncate capitalize">{dim.replace(/_/g, ' ')}</span>
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500',
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={cn(
                      'text-[11px] w-10 text-right',
                      pct >= 80 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400',
                    )}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Blockers */}
          {hasBlockers && (
            <div className="space-y-1">
              <div className="text-xs text-slate-500 font-medium">Blockers Detected</div>
              {Object.entries(blockers).filter(([, v]) => v > 0).map(([blocker, count]) => (
                <div key={blocker} className="flex items-center gap-2 text-xs text-amber-400/80">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{blocker.replace(/_/g, ' ')}: {count}</span>
                </div>
              ))}
            </div>
          )}

          {/* No detail available */}
          {Object.keys(dims).length === 0 && !hasBlockers && (
            <div className="text-xs text-slate-500">No detailed breakdown available for this suite.</div>
          )}
        </div>
      )}
    </div>
  );
}
