import { useQuery } from '@tanstack/react-query';
import {
  X, Wrench, Shield, Clock, AlertTriangle,
  Database, CheckCircle2, XCircle, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentFetch } from '../../engine/safeQuery';
import type { ToolInfo } from '../../store/toolUsageStore';
import { SourceBadge } from './SourceBadge';

interface ToolDetailDrawerProps {
  tool: ToolInfo & { source?: string; mcp_server?: string; skills?: string[] };
  onClose: () => void;
}

export function ToolDetailDrawer({ tool, onClose }: ToolDetailDrawerProps) {
  const { data: usageData } = useQuery({
    queryKey: ['tool-detail-usage', tool.name],
    queryFn: async () => {
      const res = await agentFetch(`/api/agent/tools/usage?tool_name=${encodeURIComponent(tool.name)}&limit=20`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: statsData } = useQuery({
    queryKey: ['tool-detail-stats'],
    queryFn: async () => {
      const res = await agentFetch('/api/agent/tools/usage/stats');
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  const toolStats = statsData?.by_tool?.find((t: { tool_name: string }) => t.tool_name === tool.name);
  const recentCalls = usageData?.entries ?? usageData?.calls ?? [];
  const skills = tool.skills ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg bg-slate-950 border-l border-slate-800 h-full overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-slate-950 border-b border-slate-800 px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 min-w-0">
            <Wrench className="w-4 h-4 text-fuchsia-400 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-100 truncate font-mono">{tool.name}</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Description */}
          <div>
            <h3 className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Description</h3>
            <p className="text-sm text-slate-300">{tool.description}</p>
          </div>

          {/* Metadata */}
          <div className="flex flex-wrap gap-2">
            {tool.category && (
              <span className="text-[10px] px-2 py-0.5 rounded-sm bg-slate-800 text-slate-400 border border-slate-700">
                {tool.category}
              </span>
            )}
            {tool.requires_confirmation ? (
              <span className="text-[10px] px-2 py-0.5 rounded-sm bg-amber-900/30 text-amber-400 border border-amber-800/30 flex items-center gap-1">
                <Shield className="w-2.5 h-2.5" /> Write (requires confirmation)
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-sm bg-emerald-900/20 text-emerald-400 border border-emerald-800/30 flex items-center gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" /> Read-only
              </span>
            )}
            <SourceBadge source={tool.source} mcpServer={tool.mcp_server} />
          </div>

          {/* Skills */}
          {skills.length > 0 && (
            <div>
              <h3 className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Available in skills</h3>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <span key={s} className={cn(
                    'text-[10px] px-2 py-0.5 rounded-sm',
                    s === 'sre' ? 'bg-violet-900/20 text-violet-400' :
                    s === 'security' ? 'bg-red-900/20 text-red-400' :
                    s === 'view_designer' ? 'bg-emerald-900/20 text-emerald-400' :
                    s === 'capacity_planner' ? 'bg-blue-900/20 text-blue-400' :
                    'bg-slate-800 text-slate-500',
                  )}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Usage Stats */}
          {toolStats && (
            <div>
              <h3 className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">Usage stats</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                  <Database className="w-3.5 h-3.5 text-blue-400 mx-auto mb-1" />
                  <div className="text-lg font-bold text-slate-100">{toolStats.count}</div>
                  <div className="text-[10px] text-slate-500">Calls</div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                  <Clock className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
                  <div className="text-lg font-bold text-slate-100">{toolStats.avg_ms ?? 0}ms</div>
                  <div className="text-[10px] text-slate-500">Avg duration</div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                  {toolStats.error_count > 0 ? (
                    <XCircle className="w-3.5 h-3.5 text-red-400 mx-auto mb-1" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
                  )}
                  <div className={cn('text-lg font-bold', toolStats.error_count > 0 ? 'text-red-400' : 'text-emerald-400')}>
                    {toolStats.error_count}
                  </div>
                  <div className="text-[10px] text-slate-500">Errors</div>
                </div>
              </div>
            </div>
          )}

          {/* Recent Calls */}
          {recentCalls.length > 0 && (
            <div>
              <h3 className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">Recent calls</h3>
              <div className="space-y-1.5 max-h-64 overflow-auto">
                {recentCalls.slice(0, 10).map((call: { id?: string; timestamp?: string; status?: string; duration_ms?: number; error?: string }, i: number) => (
                  <div key={call.id ?? i} className="bg-slate-900 border border-slate-800 rounded-sm px-3 py-2 text-xs flex items-center gap-2">
                    {call.status === 'error' ? (
                      <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                    ) : (
                      <Activity className="w-3 h-3 text-emerald-400 shrink-0" />
                    )}
                    <span className="text-slate-500 shrink-0">
                      {call.timestamp ? new Date(call.timestamp).toLocaleTimeString() : '—'}
                    </span>
                    <span className="text-slate-400">{call.duration_ms ?? 0}ms</span>
                    {call.error && <span className="text-red-400/70 truncate">{call.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!toolStats && recentCalls.length === 0 && (
            <div className="text-center py-8 text-sm text-slate-500">
              No usage data yet for this tool.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
