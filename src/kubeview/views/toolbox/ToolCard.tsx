import { cn } from '@/lib/utils';
import type { ToolInfo } from '../../store/toolUsageStore';
import { SourceBadge } from './SourceBadge';

export function ToolCard({ tool, source, mcpServer, onClick }: {
  tool: ToolInfo;
  source?: string;
  mcpServer?: string;
  onClick?: () => void;
}) {
  const skills = tool.skills || [];
  return (
    <button
      onClick={onClick}
      className="bg-slate-900/50 border border-slate-800/50 rounded-md px-3 py-2 space-y-0.5 text-left w-full hover:border-slate-700 hover:bg-slate-900 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-mono text-slate-200">{tool.name}</span>
        {tool.requires_confirmation && (
          <span className="text-[10px] px-1 py-0.5 rounded-sm bg-amber-900/30 text-amber-400 border border-amber-800/30">write</span>
        )}
        <SourceBadge source={source} mcpServer={mcpServer} />
        {skills.map((s) => (
          <span key={s} className={cn(
            'text-[9px] px-1 py-0.5 rounded-sm',
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
      <p className="text-[11px] text-slate-500 line-clamp-1">{tool.description}</p>
    </button>
  );
}
