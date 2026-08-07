import { useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolUsageEntry } from '../../store/toolUsageStore';
import { SourceBadge } from './SourceBadge';

export function UsageRow({ entry: e }: { entry: ToolUsageEntry }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(e.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const handleKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      setExpanded(!expanded);
    }
  };

  return (
    <>
      <tr
        className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
        aria-label={`${e.tool_name} — ${e.status} — ${e.duration_ms}ms`}
      >
        <td className="py-1.5 px-3 text-slate-400">{time}</td>
        <td className="py-1.5 px-3 font-mono text-slate-200">{e.tool_name}</td>
        <td className="py-1.5 px-3"><SourceBadge source={e.tool_source} /></td>
        <td className="py-1.5 px-3">
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-sm',
            e.agent_mode === 'sre' ? 'bg-violet-900/30 text-violet-400' :
            e.agent_mode === 'security' ? 'bg-red-900/30 text-red-400' :
            e.agent_mode === 'view_designer' ? 'bg-emerald-900/30 text-emerald-400' :
            e.agent_mode === 'plan_builder' ? 'bg-cyan-900/30 text-cyan-400' :
            e.agent_mode === 'capacity_planner' ? 'bg-blue-900/30 text-blue-400' :
            e.agent_mode === 'postmortem' ? 'bg-teal-900/30 text-teal-400' :
            e.agent_mode === 'slo_management' ? 'bg-amber-900/30 text-amber-400' :
            'bg-slate-800 text-slate-400',
          )}>
            {e.agent_mode}
          </span>
        </td>
        <td className="py-1.5 px-3">
          {e.status === 'success' ? (
            <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> ok</span>
          ) : e.status === 'denied' ? (
            <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> denied</span>
          ) : (
            <span className="text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> error</span>
          )}
        </td>
        <td className="py-1.5 px-3 text-right text-slate-400">{e.duration_ms}ms</td>
        <td className="py-1.5 px-3 text-right text-slate-500">{e.result_bytes > 0 ? `${(e.result_bytes / 1024).toFixed(1)}KB` : '-'}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-800/50">
          <td colSpan={7} className="px-3 py-2 bg-slate-900/50">
            <div className="space-y-1 text-[11px]">
              {e.query_summary && <div><span className="text-slate-500">Query:</span> <span className="text-slate-300">{e.query_summary}</span></div>}
              {e.input_summary && <div><span className="text-slate-500">Input:</span> <code className="text-slate-400">{JSON.stringify(e.input_summary)}</code></div>}
              {e.error_message && <div><span className="text-slate-500">Error:</span> <span className="text-red-400">{e.error_message}</span></div>}
              <div className="text-slate-600">Session: {e.session_id} | Turn: {e.turn_number} | Category: {e.tool_category || 'none'}</div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
