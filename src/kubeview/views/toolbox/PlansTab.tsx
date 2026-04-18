import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, ArrowRight, Save, Trash2, BarChart3, CheckCircle2, XCircle, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { DrawerShell } from '../../components/primitives/DrawerShell';

interface PlanTemplate {
  id: string;
  name: string;
  incident_type: string;
  phases: number;
  max_duration: number;
}

interface PlanPhaseDetail {
  id: string;
  skill_name: string;
  required: boolean;
  depends_on: string[];
  timeout_seconds: number;
  produces: string[];
  branch_on: string | null;
  branches: Record<string, string[]>;
  parallel_with: string[] | null;
  approval_required: boolean;
  runs: string;
}

interface PlanDetail {
  id: string;
  name: string;
  incident_type: string;
  max_total_duration: number;
  phases: PlanPhaseDetail[];
}

export function PlansTab() {
  const queryClient = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editPhases, setEditPhases] = useState<PlanPhaseDetail[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['plan-templates'],
    queryFn: async () => {
      const res = await fetch('/api/agent/plan-templates');
      if (!res.ok) return { templates: [] };
      return res.json() as Promise<{ templates: PlanTemplate[] }>;
    },
  });

  const { data: planDetail } = useQuery({
    queryKey: ['plan-template-detail', selectedPlan],
    queryFn: async () => {
      if (!selectedPlan) return null;
      const res = await fetch(`/api/agent/plan-templates/${encodeURIComponent(selectedPlan)}`);
      if (!res.ok) return null;
      return res.json() as Promise<PlanDetail>;
    },
    enabled: !!selectedPlan,
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['plan-analytics'],
    queryFn: async () => {
      const res = await fetch('/api/agent/analytics/plans?days=30');
      if (!res.ok) return null;
      return res.json() as Promise<{
        templates: Array<{
          template_name: string;
          incident_type: string;
          total_runs: number;
          by_status: Record<string, number>;
          avg_duration_ms: number;
          avg_completion_rate: number;
          avg_confidence: number;
          phases?: Array<{ phase_id: string; status: string; count: number; avg_confidence: number }>;
        }>;
        total_executions: number;
        days: number;
      }>;
    },
    staleTime: 60_000,
  });

  const templates = data?.templates ?? [];
  const planStats = analyticsData?.templates ?? [];
  const totalExecutions = analyticsData?.total_executions ?? 0;

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Investigation plans define multi-phase incident resolution. The agent matches findings to plans and executes phases in order.
        New plans are auto-generated when the agent resolves novel incidents.
      </p>

      {templates.length === 0 ? (
        <div className="text-center py-12 text-sm text-slate-500">No investigation plans loaded.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedPlan(selectedPlan === t.incident_type ? null : t.incident_type)}
              className={cn(
                'bg-slate-900 border rounded-lg p-4 text-left transition-colors hover:border-cyan-700/50',
                selectedPlan === t.incident_type ? 'border-cyan-600' : 'border-slate-800',
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-slate-200">{t.name}</span>
                <div className="flex items-center gap-1.5">
                  {t.id.startsWith('auto-') && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded border border-amber-700/40">AI-generated</span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 bg-cyan-900/30 text-cyan-400 rounded border border-cyan-800/30">
                    {t.phases} phases
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>Trigger: {t.incident_type}</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {Math.round(t.max_duration / 60)}m max
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Plan Execution Analytics */}
      {totalExecutions > 0 && (
        <div className="border-t border-slate-800 pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
              Execution Analytics
            </h2>
            <span className="text-[10px] text-slate-500">{totalExecutions} total executions &middot; last 30 days</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {planStats.map((ps) => {
              const successCount = ps.by_status?.complete ?? ps.by_status?.completed ?? 0;
              const failedCount = ps.by_status?.failed ?? 0;
              const partialCount = ps.by_status?.partial ?? 0;
              const successRate = ps.total_runs > 0 ? Math.round((successCount / ps.total_runs) * 100) : 0;

              return (
                <div key={ps.template_name} className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-200">{ps.template_name}</span>
                    <span className="text-xs text-slate-500">{ps.total_runs} runs</span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div>
                      <div className={cn('text-lg font-bold', successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-amber-400' : 'text-red-400')}>
                        {successRate}%
                      </div>
                      <div className="text-slate-500">Success</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-slate-200">
                        {ps.avg_duration_ms >= 60000 ? `${Math.round(ps.avg_duration_ms / 60000)}m` : `${Math.round(ps.avg_duration_ms / 1000)}s`}
                      </div>
                      <div className="text-slate-500">Avg time</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-slate-200">{Math.round(ps.avg_completion_rate * 100)}%</div>
                      <div className="text-slate-500">Phases done</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-blue-400">{Math.round(ps.avg_confidence * 100)}%</div>
                      <div className="text-slate-500">Confidence</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-2.5 h-2.5" />{successCount} complete</span>
                    {partialCount > 0 && <span className="flex items-center gap-1 text-amber-400"><Activity className="w-2.5 h-2.5" />{partialCount} partial</span>}
                    {failedCount > 0 && <span className="flex items-center gap-1 text-red-400"><XCircle className="w-2.5 h-2.5" />{failedCount} failed</span>}
                  </div>

                  {/* Phase-level breakdown */}
                  {ps.phases && ps.phases.length > 0 && (
                    <div className="border-t border-slate-800 pt-2 space-y-1">
                      <div className="text-[10px] text-slate-500">Phase breakdown</div>
                      {ps.phases.map((ph) => (
                        <div key={`${ph.phase_id}-${ph.status}`} className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-400">{ph.phase_id}</span>
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              ph.status === 'complete' || ph.status === 'completed' ? 'text-emerald-400' :
                              ph.status === 'failed' ? 'text-red-400' :
                              'text-amber-400',
                            )}>
                              {ph.count}x {ph.status}
                            </span>
                            <span className="text-slate-600">{Math.round(ph.avg_confidence * 100)}% conf</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {totalExecutions === 0 && templates.length > 0 && (
        <div className="border-t border-slate-800 pt-6">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-slate-600" />
            <h2 className="text-sm font-semibold text-slate-500">Execution Analytics</h2>
          </div>
          <p className="text-xs text-slate-600">No plan executions yet. Analytics will appear once the agent runs investigation plans.</p>
        </div>
      )}

      {/* Plan detail drawer */}
      {selectedPlan && planDetail && (
        <DrawerShell title={planDetail.name} onClose={() => { setSelectedPlan(null); setEditing(false); }}>
          <div className="space-y-4">
            {/* Actions */}
            <div className="flex items-center gap-2">
              {editing ? (
                <button
                  onClick={async () => {
                    try {
                      await fetch(`/api/agent/plan-templates/${encodeURIComponent(selectedPlan!)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phases: editPhases }),
                      });
                      queryClient.invalidateQueries({ queryKey: ['plan-templates'] });
                      queryClient.invalidateQueries({ queryKey: ['plan-template-detail', selectedPlan] });
                    } catch { /* ignore */ }
                    setEditing(false);
                  }}
                  className="px-2 py-1 text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 rounded border border-emerald-800/30 flex items-center gap-1 transition-colors"
                >
                  <Save className="w-3 h-3" />
                  Save
                </button>
              ) : (
                <button
                  onClick={() => { setEditing(true); setEditPhases(planDetail.phases); }}
                  className="px-2 py-1 text-xs bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded border border-blue-800/30 flex items-center gap-1 transition-colors"
                >
                  Edit
                </button>
              )}
              {planDetail.id.startsWith('auto-') && (
                <button
                  onClick={() => setConfirmDelete(selectedPlan)}
                  className="px-2 py-1 text-xs bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded border border-red-800/30 flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              )}
            </div>

            {/* Metadata */}
            <div className="flex flex-wrap gap-3 text-xs text-slate-500">
              <span>Trigger: <span className="text-slate-300">{planDetail.incident_type}</span></span>
              <span>Phases: <span className="text-slate-300">{planDetail.phases.length}</span></span>
              {planDetail.id.startsWith('auto-') && (
                <span className="text-[10px] px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded border border-amber-700/40">AI-generated</span>
              )}
            </div>

            {/* Phase flow visualization */}
            <div className="flex items-center gap-1 flex-wrap">
              {planDetail.phases.map((phase, idx) => (
                <div key={phase.id} className="flex items-center gap-1">
                  <div className={cn(
                    'px-2.5 py-1 rounded text-xs font-medium border',
                    phase.required ? 'bg-cyan-900/30 text-cyan-300 border-cyan-800/40' : 'bg-slate-800 text-slate-400 border-slate-700',
                  )}>
                    {phase.id}
                  </div>
                  {idx < planDetail.phases.length - 1 && (
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                  )}
                </div>
              ))}
            </div>

            {/* Phase details */}
            <div className="space-y-2">
              {(editing ? editPhases : planDetail.phases).map((phase, phaseIdx) => (
                <div key={phase.id} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-200">{phase.id}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-500">{phase.skill_name}</span>
                      {editing ? (
                        <button
                          onClick={() => { const p = [...editPhases]; p[phaseIdx] = { ...p[phaseIdx], required: !p[phaseIdx].required }; setEditPhases(p); }}
                          className={cn('text-[10px] px-1 py-0.5 rounded cursor-pointer', phase.required ? 'bg-red-900/30 text-red-400' : 'bg-slate-700 text-slate-500')}
                        >
                          {phase.required ? 'required' : 'optional'}
                        </button>
                      ) : (
                        <>
                          {phase.required && <span className="text-[10px] px-1 py-0.5 bg-red-900/30 text-red-400 rounded">required</span>}
                        </>
                      )}
                      {phase.approval_required && <span className="text-[10px] px-1 py-0.5 bg-amber-900/30 text-amber-400 rounded">approval</span>}
                      {phase.runs === 'always' && <span className="text-[10px] px-1 py-0.5 bg-blue-900/30 text-blue-400 rounded">always runs</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
                    {editing ? (
                      <span className="flex items-center gap-1">
                        Timeout:
                        <input
                          type="number"
                          value={phase.timeout_seconds}
                          onChange={(e) => { const p = [...editPhases]; p[phaseIdx] = { ...p[phaseIdx], timeout_seconds: parseInt(e.target.value) || 120 }; setEditPhases(p); }}
                          className="w-16 px-1 py-0.5 text-[11px] bg-slate-700 border border-slate-600 rounded text-slate-200"
                        />s
                      </span>
                    ) : (
                      <span>Timeout: {phase.timeout_seconds}s</span>
                    )}
                    {phase.depends_on.length > 0 && <span>After: {phase.depends_on.join(', ')}</span>}
                    {phase.produces.length > 0 && <span>Produces: {phase.produces.join(', ')}</span>}
                    {phase.branch_on && <span>Branches on: {phase.branch_on}</span>}
                    {phase.parallel_with && <span>Parallel: {phase.parallel_with.join(', ')}</span>}
                  </div>
                  {phase.branches && Object.keys(phase.branches).length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {Object.entries(phase.branches).map(([val, skills]) => (
                        <div key={val} className="text-[11px] text-slate-400">
                          if {phase.branch_on} = <span className="text-cyan-400">{val}</span> → {skills.join(', ')}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </DrawerShell>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete Plan Template"
        description="Delete this auto-generated investigation plan? This cannot be undone. Built-in plans cannot be deleted."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!confirmDelete) return;
          try {
            const res = await fetch(`/api/agent/plan-templates/${encodeURIComponent(confirmDelete)}`, { method: 'DELETE' });
            if (res.ok) {
              queryClient.invalidateQueries({ queryKey: ['plan-templates'] });
              setSelectedPlan(null);
            }
          } catch { /* ignore */ }
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
