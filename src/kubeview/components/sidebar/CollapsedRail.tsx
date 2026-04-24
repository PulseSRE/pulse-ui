import { cn } from '@/lib/utils';
import { useAgentStore } from '../../store/agentStore';
import { useUIStore } from '../../store/uiStore';
import { useAgentStatus } from '../../hooks/useAgentStatus';

export function CollapsedRail() {
  const expandAISidebar = useUIStore((s) => s.expandAISidebar);
  const hasUnreadInsight = useAgentStore((s) => s.hasUnreadInsight);
  const status = useAgentStatus();

  const Icon = status.icon;
  const isAnimated = status.type === 'streaming' || status.type === 'investigating';

  const setAISidebarMode = useUIStore((s) => s.setAISidebarMode);

  const handleClick = () => {
    expandAISidebar();
    setAISidebarMode(status.type === 'findings' ? 'dashboard' : 'chat');
  };

  return (
    <button
      onClick={handleClick}
      className="w-12 h-full flex flex-col items-center py-4 gap-3 bg-slate-900 border-l border-slate-800 hover:bg-slate-800/50 transition-colors cursor-pointer shrink-0"
      title="Expand AI Sidebar (Cmd+J)"
    >
      <div className="relative">
        <Icon className={cn('w-4 h-4', status.color, isAnimated && (status.type === 'streaming' ? 'animate-spin' : 'animate-pulse'))} />
        {hasUnreadInsight && (
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-400" />
        )}
      </div>
      <div
        className={cn('text-[10px] font-medium tracking-wider uppercase', status.color)}
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        {status.type === 'findings' ? `${status.findingsCount} finding${status.findingsCount !== 1 ? 's' : ''}` : status.text}
      </div>
    </button>
  );
}
