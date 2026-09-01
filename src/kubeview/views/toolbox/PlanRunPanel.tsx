import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Loader2, CheckCircle2, XCircle, UserCheck, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentFetch } from '../../engine/safeQuery';

interface RunProgress {
  current_phase: string;
  awaiting_approval: string;
  phases: Record<string, { status: string | null; confidence: number }>;
}

interface RunState {
  workflow_id: string;
  status: string;
  progress?: RunProgress;
  result?: { status: string; phase_outputs: Record<string, { status: string }> };
}

/**
 * Trigger and follow a durable plan run.
 *
 * Durable runs execute on Temporal: they survive agent restarts, and phases
 * marked approval_required genuinely wait here for a human verdict instead of
 * being skipped as needs_escalation the way in-process runs record them.
 */
export function PlanRunPanel({ incidentType }: { incidentType: string }) {
  const queryClient = useQueryClient();
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const { data: run } = useQuery<RunState>({
    queryKey: ['workflow-run', workflowId],
    enabled: !!workflowId,
    // Poll while running; stop once the run reaches a terminal state.
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'RUNNING' ? false : 2500),
    queryFn: async () => {
      const res = await agentFetch(`/api/agent/workflow-runs/${encodeURIComponent(workflowId!)}`);
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
  });

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const res = await agentFetch(`/api/agent/plan-templates/${encodeURIComponent(incidentType)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident: {} }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setWorkflowId(data.workflow_id);
      } else {
        // 503 carries the "set PULSE_AGENT_TEMPORAL_HOST" explanation; 400
        // names the unsupported plan features. Both are worth showing verbatim.
        setError(data.detail || `Failed to start run (${res.status})`);
      }
    } catch {
      setError('Network error — could not reach agent');
    } finally {
      setStarting(false);
    }
  };

  const approve = async (phaseId: string, approved: boolean) => {
    try {
      await agentFetch(`/api/agent/workflow-runs/${encodeURIComponent(workflowId!)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: phaseId, approved }),
      });
      queryClient.invalidateQueries({ queryKey: ['workflow-run', workflowId] });
    } catch { /* surfaced by the next poll */ }
  };

  const awaiting = run?.status === 'RUNNING' ? run.progress?.awaiting_approval : '';
  const phases = run?.progress?.phases ?? run?.result?.phase_outputs ?? {};

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={start}
          disabled={starting || run?.status === 'RUNNING'}
          className="px-2 py-1 text-xs bg-cyan-600/20 hover:bg-cyan-600/40 disabled:opacity-40 text-cyan-300 rounded-sm border border-cyan-800/30 flex items-center gap-1 transition-colors"
        >
          {starting || run?.status === 'RUNNING' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {run?.status === 'RUNNING' ? 'Running…' : 'Run durably'}
        </button>
        {run && (
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-sm border',
            run.status === 'COMPLETED' ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40' :
            run.status === 'RUNNING' ? 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40' :
            'bg-red-900/40 text-red-300 border-red-700/40',
          )}>
            {run.status}{run.result ? ` · ${run.result.status}` : ''}
          </span>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 text-xs rounded-md border bg-amber-950/40 border-amber-900/40 text-amber-300">
          {error}
        </div>
      )}

      {Object.keys(phases).length > 0 && (
        <div className="bg-slate-950/40 border border-slate-800 rounded-md p-2 space-y-1">
          {Object.entries(phases).map(([pid, ph]) => (
            <div key={pid} className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400 flex items-center gap-1">
                {ph.status === 'complete' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> :
                 ph.status === 'failed' ? <XCircle className="w-3 h-3 text-red-400" /> :
                 pid === run?.progress?.current_phase ? <Loader2 className="w-3 h-3 animate-spin text-cyan-400" /> :
                 <Clock className="w-3 h-3 text-slate-600" />}
                {pid}
              </span>
              <span className="text-slate-500">{ph.status ?? 'pending'}</span>
            </div>
          ))}
          {awaiting && (
            <div className="flex items-center justify-between pt-1 border-t border-slate-800">
              <span className="text-[10px] text-amber-300 flex items-center gap-1">
                <UserCheck className="w-3 h-3" />
                Phase “{awaiting}” is waiting for your approval
              </span>
              <div className="flex gap-1">
                <button onClick={() => approve(awaiting, true)} className="px-1.5 py-0.5 text-[10px] bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 rounded-sm border border-emerald-800/30">Approve</button>
                <button onClick={() => approve(awaiting, false)} className="px-1.5 py-0.5 text-[10px] bg-red-600/20 hover:bg-red-600/40 text-red-300 rounded-sm border border-red-800/30">Deny</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
