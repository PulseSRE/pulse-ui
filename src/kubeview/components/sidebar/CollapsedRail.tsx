import { Bot, Loader2, AlertTriangle, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentStore } from '../../store/agentStore';
import { useMonitorStore } from '../../store/monitorStore';
import { useUIStore } from '../../store/uiStore';

export function CollapsedRail() {
  const expandAISidebar = useUIStore((s) => s.expandAISidebar);
  const streaming = useAgentStore((s) => s.streaming);
  const hasUnreadInsight = useAgentStore((s) => s.hasUnreadInsight);
  const connected = useMonitorStore((s) => s.connected);
  const findingsCount = useMonitorStore((s) => s.findings.length);
  const activeSkill = useMonitorStore((s) => s.activeSkill);

  const isInvestigating = !!activeSkill;

  let statusIcon: React.ReactNode;
  let statusText: string;
  let statusColor: string;

  if (streaming) {
    statusIcon = <Loader2 className="w-4 h-4 animate-spin text-violet-400" />;
    statusText = 'Thinking';
    statusColor = 'text-violet-400';
  } else if (isInvestigating) {
    statusIcon = <Search className="w-4 h-4 animate-pulse text-violet-400" />;
    statusText = 'Investigating';
    statusColor = 'text-violet-400';
  } else if (findingsCount > 0) {
    statusIcon = <AlertTriangle className="w-4 h-4 text-amber-400" />;
    statusText = `${findingsCount} finding${findingsCount === 1 ? '' : 's'}`;
    statusColor = 'text-amber-400';
  } else if (connected) {
    statusIcon = <Bot className="w-4 h-4 text-blue-400" />;
    statusText = 'All clear';
    statusColor = 'text-blue-400';
  } else {
    statusIcon = <Bot className="w-4 h-4 text-slate-500" />;
    statusText = 'Offline';
    statusColor = 'text-slate-500';
  }

  return (
    <button
      onClick={expandAISidebar}
      className="w-12 h-full flex flex-col items-center py-4 gap-3 bg-slate-900 border-l border-slate-800 hover:bg-slate-800/50 transition-colors cursor-pointer shrink-0"
      title="Expand AI Sidebar (Cmd+J)"
    >
      <div className="relative">
        {statusIcon}
        {hasUnreadInsight && (
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-400" />
        )}
      </div>
      <div
        className={cn('text-[10px] font-medium tracking-wider uppercase', statusColor)}
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        {statusText}
      </div>
    </button>
  );
}
