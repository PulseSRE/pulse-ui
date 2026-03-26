import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, StopCircle, Bot, Loader2, Wrench, Brain, AlertTriangle, Trash2 } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { useTrustStore, TRUST_LABELS } from '../../store/trustStore';
import { useSmartPrompts } from '../../hooks/useSmartPrompts';
import { MessageBubble } from './MessageBubble';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AgentComponentRenderer } from './AgentComponentRenderer';
import { ConfirmationCard } from './ConfirmationCard';
import { PromptPill } from './AIBranding';
import { cn } from '@/lib/utils';

/**
 * DockAgentPanel — compact agent conversation for the dock panel.
 * Shares state via useAgentStore.
 */
export function DockAgentPanel() {
  const {
    connected, mode, messages, streaming, streamingText, thinkingText,
    activeTools, streamingComponents, pendingConfirm, error,
    connect, sendMessage, confirmAction, cancelQuery, clearChat,
  } = useAgentStore();

  const trustLevel = useTrustStore((s) => s.trustLevel);
  const smartPrompts = useSmartPrompts();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Connect on mount if not already connected
  useEffect(() => {
    if (!connected) connect();
  }, []);

  // Auto-scroll — debounced during streaming to prevent layout thrashing
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }, streaming ? 200 : 0);
  }, [messages, streamingText, thinkingText, streaming]);

  // Focus input after streaming
  useEffect(() => {
    if (!streaming) inputRef.current?.focus();
  }, [streaming]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming || !connected) return;
    sendMessage(text);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-auto px-3 py-2 space-y-3" role="log" aria-label="Agent messages">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Bot className="h-4 w-4" />
              Ask the {mode} agent...
            </div>
            {smartPrompts.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 px-2">
                {smartPrompts.slice(0, 4).map((sp, i) => (
                  <PromptPill key={i} onClick={() => { sendMessage(sp.prompt); }}>
                    {sp.prompt}
                  </PromptPill>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} mode={mode} />
        ))}

        {/* Streaming indicators */}
        {streaming && (
          <div className="space-y-1">
            {thinkingText && (
              <div className="flex items-start gap-2 text-xs text-purple-300/70 italic">
                <Brain className="h-3.5 w-3.5 mt-0.5 shrink-0 text-purple-400" />
                {thinkingText.slice(-300)}
              </div>
            )}
            {activeTools.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-cyan-400">
                <Wrench className="h-3.5 w-3.5 animate-spin" />
                Calling {activeTools[activeTools.length - 1]}...
              </div>
            )}
            {streamingComponents.length > 0 && (
              <div className="max-w-full">
                {streamingComponents.map((spec, i) => (
                  <AgentComponentRenderer key={i} spec={spec} />
                ))}
              </div>
            )}
            {streamingText && (
              <MarkdownRenderer content={streamingText} className="text-sm" />
            )}
            {!streamingText && !thinkingText && activeTools.length === 0 && streamingComponents.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking...
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/30 border border-red-900 rounded px-3 py-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {pendingConfirm && (
          <ConfirmationCard confirm={pendingConfirm} onConfirm={confirmAction} />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-700 px-3 py-2 flex items-end gap-2">
        <div className={cn(
          'flex items-center gap-1 text-xs px-1.5 py-0.5 rounded',
          connected ? 'text-green-400 bg-green-950/30' : 'text-red-400 bg-red-950/30',
        )}>
          {mode.toUpperCase()} · L{trustLevel}
        </div>
        {messages.length > 0 && !streaming && (
          <button
            onClick={clearChat}
            className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
            title="Clear chat"
            aria-label="Clear agent chat"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connected ? 'Ask the agent...' : 'Connecting...'}
          disabled={streaming || !connected}
          rows={1}
          className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 resize-none"
        />
        {streaming ? (
          <button
            onClick={cancelQuery}
            className="p-1.5 rounded bg-red-700 hover:bg-red-600 text-white transition-colors shrink-0"
            aria-label="Stop"
          >
            <StopCircle className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim() || !connected}
            className={cn(
              'p-1.5 rounded transition-colors shrink-0',
              input.trim() && connected
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed',
            )}
            aria-label="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
