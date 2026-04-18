import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wrench, Shield, LayoutDashboard, TrendingUp, Puzzle, Bot, Database, Target,
  RefreshCw, Play, ArrowRight, BarChart3, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SkillDetailDrawer } from './SkillDetailDrawer';

const SKILL_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Wrench, Shield, LayoutDashboard, TrendingUp, Puzzle, Bot, Database, Target,
};

function sortSkills(skills: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...skills].sort((a, b) => {
    const aBuiltin = a.builtin !== false;
    const bBuiltin = b.builtin !== false;
    if (aBuiltin !== bBuiltin) return aBuiltin ? -1 : 1;
    return String(a.display_name || a.name).localeCompare(String(b.display_name || b.name));
  });
}

export function SkillsTab() {
  const queryClient = useQueryClient();
  const [testQuery, setTestQuery] = useState('');
  const [testResult, setTestResult] = useState<{ skill: string; description: string; degraded: boolean } | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ['admin', 'skills'],
    queryFn: async () => {
      const res = await fetch('/api/agent/skills');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: skillStats } = useQuery({
    queryKey: ['admin', 'skill-usage-skills-tab'],
    queryFn: async () => {
      const res = await fetch('/api/agent/skills/usage?days=30');
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
  });

  const reloadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/agent/admin/skills/reload', { method: 'POST' });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'skills'] }),
  });

  const testRouting = async () => {
    if (!testQuery.trim()) return;
    try {
      const res = await fetch('/api/agent/admin/skills/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: testQuery }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestResult({ skill: data.skill, description: data.description, degraded: data.degraded });
      } else {
        setTestResult(null);
      }
    } catch {
      setTestResult(null);
    }
  };

  const totalInvocations = (skillStats?.skills ?? []).reduce((sum: number, s: Record<string, unknown>) => sum + Number(s.invocations ?? 0), 0);
  const avgDuration = (skillStats?.skills ?? []).length > 0
    ? Math.round((skillStats?.skills ?? []).reduce((sum: number, s: Record<string, unknown>) => sum + Number(s.avg_duration_ms ?? 0), 0) / (skillStats?.skills ?? []).length)
    : 0;
  const totalHandoffs = (skillStats?.handoffs ?? []).reduce((sum: number, h: { count: number }) => sum + h.count, 0);

  return (
    <div className="space-y-4">
      {/* Overview Stats */}
      {totalInvocations > 0 && (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-slate-100">{totalInvocations}</div>
            <div className="text-[10px] text-slate-500">Total Invocations</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-slate-100">{skills.length}</div>
            <div className="text-[10px] text-slate-500">Skills Active</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-slate-100">{avgDuration}ms</div>
            <div className="text-[10px] text-slate-500">Avg Duration</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-slate-100">{totalHandoffs}</div>
            <div className="text-[10px] text-slate-500">Handoffs</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{skills.length} skills loaded</span>
        <button
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-md disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', reloadMutation.isPending && 'animate-spin')} />
          Reload Skills
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sortSkills(skills).map((skill: Record<string, unknown>) => {
            const SkillIcon = SKILL_ICON_MAP[String(skill.icon)] || Puzzle;
            return (
              <button
                key={String(skill.name)}
                onClick={() => setSelectedSkill(String(skill.name))}
                className={cn(
                  'bg-slate-900 border rounded-lg p-4 space-y-2 text-left transition-colors hover:border-blue-700/50 hover:bg-slate-900/80 cursor-pointer',
                  skill.degraded ? 'border-amber-800/50' : 'border-slate-800',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <SkillIcon className={cn('w-4 h-4 shrink-0', skill.degraded ? 'text-amber-400' : 'text-violet-400')} />
                    <span className="text-sm font-medium text-slate-100 truncate">{String(skill.display_name || skill.name)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded text-slate-500 shrink-0">v{Number(skill.version)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {skill.generated_by === 'auto' && !skill.reviewed && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded border border-amber-700/40">
                        AI-generated · Needs review
                      </span>
                    )}
                    {skill.generated_by === 'auto' && Boolean(skill.reviewed) && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 rounded border border-emerald-800/30">
                        AI-generated · Reviewed
                      </span>
                    )}
                    {!skill.builtin && !skill.generated_by && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-violet-900/30 text-violet-400 rounded border border-violet-800/30">custom</span>
                    )}
                    {Boolean(skill.write_tools) && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-900/30 text-amber-400 rounded border border-amber-800/30">write</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-400">{String(skill.description)}</p>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{(skill.keywords as string[])?.length || 0} keywords</span>
                  <span>{(skill.categories as string[])?.length || 0} categories</span>
                  <span>{Number(skill.prompt_length)} chars</span>
                </div>
                {Boolean(skill.degraded) && (
                  <div className="text-xs text-amber-400">{String(skill.degraded_reason)}</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Routing tester */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-slate-300 mb-2 flex items-center gap-1.5">
          <Play className="w-3.5 h-3.5 text-blue-400" />
          Test Routing
        </h3>
        <div className="flex gap-2">
          <input
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && testRouting()}
            placeholder="Type a query to see which skill handles it..."
            className="flex-1 px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button onClick={testRouting} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md">Test</button>
        </div>
        {testResult && (
          <div className="flex items-center gap-2 mt-2 text-xs">
            <ArrowRight className="w-3 h-3 text-blue-400" />
            <span className={cn('font-medium', testResult.degraded ? 'text-amber-400' : 'text-emerald-400')}>
              {testResult.skill}
            </span>
            <span className="text-slate-500">{testResult.description}</span>
          </div>
        )}
      </div>

      {/* Skill Usage Analytics */}
      {skillStats?.skills && skillStats.skills.length > 0 && (
        <div className="border-t border-slate-800 pt-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-violet-400" />
            Usage Analytics (30 days)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {skillStats.skills.map((skill: Record<string, unknown>) => (
              <SkillStatsCard key={String(skill.name)} skill={skill} onSelect={() => setSelectedSkill(String(skill.name))} />
            ))}
          </div>

          {skillStats.handoffs && skillStats.handoffs.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h3 className="text-xs font-medium text-slate-300 mb-2">Skill Handoffs</h3>
              <div className="space-y-1.5">
                {skillStats.handoffs.map((h: { from: string; to: string; count: number }, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-300">{h.from}</span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                    <span className="text-slate-300">{h.to}</span>
                    <span className="text-slate-500 ml-auto">{h.count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Skill detail drawer */}
      {selectedSkill && (
        <SkillDetailDrawer name={selectedSkill} onClose={() => setSelectedSkill(null)} />
      )}
    </div>
  );
}

function SkillStatsCard({ skill, onSelect }: { skill: Record<string, unknown>; onSelect: () => void }) {
  const { data: trend } = useQuery({
    queryKey: ['skill-trend', String(skill.name)],
    queryFn: async () => {
      const res = await fetch(`/api/agent/skills/usage/${encodeURIComponent(String(skill.name))}/trend?days=30`);
      if (!res.ok) return null;
      return res.json() as Promise<{ sparkline?: number[]; duration_sparkline?: number[]; runs: number; days_active?: number }>;
    },
    staleTime: 60_000,
  });

  const sparkline = trend?.sparkline ?? [];
  const maxVal = Math.max(...sparkline, 1);

  return (
    <button onClick={onSelect} className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2 text-left hover:border-violet-700/50 transition-colors w-full">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-100">{String(skill.name)}</span>
        <span className="text-lg font-bold text-slate-100">{Number(skill.invocations)}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span>avg {Number(skill.avg_tools)} tools</span>
        <span>{Number(skill.avg_duration_ms)}ms avg</span>
        {Number(skill.feedback_positive) > 0 && <span className="text-emerald-400">{Number(skill.feedback_positive)} positive</span>}
        {Number(skill.feedback_negative) > 0 && <span className="text-red-400">{Number(skill.feedback_negative)} negative</span>}
      </div>

      {/* Sparkline */}
      {sparkline.length > 1 && (
        <div className="flex items-end gap-px h-8">
          {sparkline.map((v, i) => (
            <div
              key={i}
              className="flex-1 bg-violet-500/40 rounded-sm min-h-[2px]"
              style={{ height: `${(v / maxVal) * 100}%` }}
              title={`${v} calls`}
            />
          ))}
        </div>
      )}

      {(skill.top_tools as Array<{ name: string; count: number }>)?.length > 0 && (
        <div className="text-[10px] text-slate-600">
          Top: {(skill.top_tools as Array<{ name: string; count: number }>).map((t) => t.name).join(', ')}
        </div>
      )}
    </button>
  );
}
