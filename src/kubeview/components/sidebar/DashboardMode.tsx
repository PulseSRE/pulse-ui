import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Bot, Loader2, AlertTriangle, Search, Brain, XCircle, Activity,
  Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentStore } from '../../store/agentStore';
import { useMonitorStore } from '../../store/monitorStore';
import { useUIStore } from '../../store/uiStore';
import { useSmartPrompts } from '../../hooks/useSmartPrompts';
import { formatRelativeTime } from '../../engine/formatters';

export function DashboardMode() {
  const navigate = useNavigate();
  const setAISidebarMode = useUIStore((s) => s.setAISidebarMode);
  const streaming = useAgentStore((s) => s.streaming);
  const monitorConnected = useMonitorStore((s) => s.connected);
  const findings = useMonitorStore((s) => s.findings);
  const investigations = useMonitorStore((s) => s.investigations);
  const recentActions = useMonitorStore((s) => s.recentActions);
  const activeSkill = useMonitorStore((s) => s.activeSkill);
  const smartPrompts = useSmartPrompts();

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: memorySummary } = useQuery({
    queryKey: ['memory-summary'],
    queryFn: async () => {
      const res = await fetch('/api/agent/memory/summary');
      if (!res.ok) return null;
      return res.json() as Promise<{ incidents_count: number; runbooks_count: number; patterns_count: number; avg_score: number }>;
    },
    staleTime: 60_000,
  });

  const handleSend = () => {
    if (!input.trim()) return;
    const { connectAndSend } = useAgentStore.getState();
    connectAndSend(input.trim());
    setInput('');
    setAISidebarMode('chat');
  };

  const handlePromptClick = (prompt: string) => {
    const { connectAndSend } = useAgentStore.getState();
    connectAndSend(prompt);
    setAISidebarMode('chat');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isInvestigating = !!activeSkill;
  let statusText: string;
  let StatusIcon: React.ElementType;
  let statusColor: string;

  if (streaming) {
    statusText = 'Reasoning...';
    StatusIcon = Loader2;
    statusColor = 'text-violet-400';
  } else if (isInvestigating) {
    statusText = `Investigating: ${activeSkill}`;
    StatusIcon = Search;
    statusColor = 'text-violet-400';
  } else if (findings.length > 0) {
    const critical = findings.filter((f) => f.severity === 'critical').length;
    statusText = critical > 0 ? `${critical} critical, ${findings.length} total` : `${findings.length} active findings`;
    StatusIcon = AlertTriangle;
    statusColor = critical > 0 ? 'text-red-400' : 'text-amber-400';
  } else if (monitorConnected) {
    statusText = 'Scanning... all clear';
    StatusIcon = Bot;
    statusColor = 'text-emerald-400';
  } else {
    statusText = 'Monitor disconnected';
    StatusIcon = Bot;
    statusColor = 'text-slate-500';
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;

  const recentActivity = [...investigations, ...recentActions]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Agent Status */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50">
          <StatusIcon className={cn('w-4 h-4 shrink-0', statusColor, streaming && 'animate-spin', isInvestigating && 'animate-pulse')} />
          <span className={cn('text-xs font-medium', statusColor)}>{statusText}</span>
        </div>

        {/* Quick Prompts */}
        {smartPrompts.length > 0 && (
          <div>
            <h3 className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Suggestions</h3>
            <div className="flex flex-wrap gap-1.5">
              {smartPrompts.slice(0, 4).map((p, i) => (
                <button
                  key={i}
                  onClick={() => handlePromptClick(p.prompt)}
                  className="px-2.5 py-1.5 text-xs bg-violet-600/10 text-violet-300 border border-violet-700/30 rounded-lg hover:bg-violet-600/20 transition-colors text-left"
                >
                  {p.context}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active Findings */}
        {findings.length > 0 && (
          <button
            onClick={() => navigate('/incidents')}
            className="w-full text-left px-3 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 transition-colors"
          >
            <h3 className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1.5">Active Findings</h3>
            <div className="flex items-center gap-3">
              {criticalCount > 0 && (
                <div className="flex items-center gap-1">
                  <XCircle className="w-3 h-3 text-red-400" />
                  <span className="text-xs text-red-400 font-medium">{criticalCount}</span>
                </div>
              )}
              {warningCount > 0 && (
                <div className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  <span className="text-xs text-amber-400 font-medium">{warningCount}</span>
                </div>
              )}
              {infoCount > 0 && (
                <div className="flex items-center gap-1">
                  <Activity className="w-3 h-3 text-blue-400" />
                  <span className="text-xs text-blue-400 font-medium">{infoCount}</span>
                </div>
              )}
            </div>
          </button>
        )}

        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <div>
            <h3 className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Recent Activity</h3>
            <div className="space-y-1.5">
              {recentActivity.map((item) => (
                <div key={item.id} className="px-3 py-2 rounded-lg bg-slate-800/30 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-300 truncate">
                      {'tool' in item ? item.tool : item.category}
                    </span>
                    <span className={cn(
                      'text-[10px] px-1 py-0.5 rounded',
                      'status' in item && item.status === 'completed' ? 'bg-emerald-900/40 text-emerald-300' :
                      'status' in item && item.status === 'failed' ? 'bg-red-900/40 text-red-300' :
                      'bg-slate-800 text-slate-400',
                    )}>
                      {'status' in item ? item.status : 'done'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-600">{formatRelativeTime(item.timestamp)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Memory Highlights */}
        {memorySummary && (
          <button
            onClick={() => navigate('/agent/memory')}
            className="w-full text-left px-3 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 transition-colors"
          >
            <h3 className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1.5 flex items-center gap-1">
              <Brain className="w-3 h-3" />
              Agent Memory
            </h3>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-400">{memorySummary.runbooks_count} runbooks</span>
              <span className="text-slate-400">{memorySummary.patterns_count} patterns</span>
              {memorySummary.avg_score > 0 && (
                <span className="text-slate-400">{(memorySummary.avg_score * 100).toFixed(0)}% confidence</span>
              )}
            </div>
          </button>
        )}
      </div>

      {/* Chat input */}
      <div className="border-t border-slate-800 px-3 py-2.5 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Pulse anything..."
            rows={1}
            className="flex-1 resize-none bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className={cn(
              'p-2 rounded-lg transition-colors shrink-0',
              input.trim()
                ? 'bg-violet-600 hover:bg-violet-500 text-white'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed',
            )}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
