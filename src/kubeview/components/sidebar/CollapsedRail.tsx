import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentStore } from '../../store/agentStore';
import { useUIStore } from '../../store/uiStore';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { useNavigateTab } from '../../hooks/useNavigateTab';

/**
 * The collapsed AI sidebar. Clicking it always expands the sidebar, as its
 * title says; it used to go to /inbox instead whenever there were findings.
 * The findings count is its own link to the inbox.
 */
export function CollapsedRail() {
  const expandAISidebar = useUIStore((s) => s.expandAISidebar);
  const hasUnreadInsight = useAgentStore((s) => s.hasUnreadInsight);
  const status = useAgentStatus();
  const go = useNavigateTab();

  const Icon = status.icon;
  const isAnimated = status.type === 'streaming' || status.type === 'investigating';
  const findings = status.type === "findings" ? status.findingsCount : 0;

  return (
    <div className="w-12 h-full flex flex-col bg-slate-900 border-l border-slate-800 shrink-0">
      <button
        onClick={() => expandAISidebar()}
        className="flex-1 w-full flex flex-col items-center py-4 gap-3 hover:bg-slate-800/50 transition-colors cursor-pointer"
        title="Expand AI Sidebar (Cmd+J)"
        aria-label="Expand AI Sidebar"
      >
        <div className="relative">
          <Icon className={cn('w-4 h-4', status.color, isAnimated && (status.type === 'streaming' ? 'animate-spin' : 'animate-pulse'))} />
          {hasUnreadInsight && (
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-400" />
          )}
        </div>
        {status.type !== 'findings' && (
          <div
            className={cn('text-[10px] font-medium tracking-wider uppercase', status.color)}
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
          >
            {status.text}
          </div>
        )}
      </button>
      {status.type === 'findings' && (
        <button
          onClick={() => go('/inbox', 'Inbox')}
          className={cn('w-full flex flex-col items-center gap-2 py-3 border-t border-slate-800 hover:bg-slate-800/50 transition-colors', status.color)}
          title="Open the Inbox"
          aria-label={`Open Inbox: ${findings} finding${findings !== 1 ? 's' : ''}`}
        >
          <Inbox className="w-3.5 h-3.5" />
          <span className="text-[10px] font-medium tracking-wider uppercase" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
            {findings} finding{findings !== 1 ? 's' : ''}
          </span>
        </button>
      )}
    </div>
  );
}
