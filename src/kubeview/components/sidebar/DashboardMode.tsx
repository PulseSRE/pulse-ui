import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentStore } from '../../store/agentStore';
import { useUIStore } from '../../store/uiStore';
import { useSmartPrompts } from '../../hooks/useSmartPrompts';
import { useAgentStatus } from '../../hooks/useAgentStatus';

export function DashboardMode() {
  const navigate = useNavigate();
  const setAISidebarMode = useUIStore((s) => s.setAISidebarMode);
  const status = useAgentStatus();
  const smartPrompts = useSmartPrompts();

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const StatusIcon = status.icon;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Agent Status — clickable to Incident Center when findings exist */}
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50',
            status.findingsCount > 0 && 'cursor-pointer hover:bg-slate-800 transition-colors',
          )}
          onClick={status.findingsCount > 0 ? () => navigate('/inbox') : undefined}
          role={status.findingsCount > 0 ? 'button' : undefined}
        >
          <StatusIcon className={cn(
            'w-4 h-4 shrink-0', status.color,
            status.type === 'streaming' && 'animate-spin',
            status.type === 'investigating' && 'animate-pulse',
          )} />
          <span className={cn('text-xs font-medium', status.color)}>{status.text}</span>
        </div>

        {/* Quick Prompts — max 3, deduplicated */}
        {smartPrompts.length > 0 && (
          <div>
            <h3 className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Suggestions</h3>
            <div className="flex flex-wrap gap-1.5">
              {smartPrompts.slice(0, 3).map((p, i) => (
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
            className="flex-1 resize-none bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-hidden focus:ring-1 focus:ring-violet-500"
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
