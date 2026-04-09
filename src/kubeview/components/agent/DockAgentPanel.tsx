import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, StopCircle, Bot, Loader2, Wrench, Brain, AlertTriangle, Trash2, Shield, Download } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import type { ComponentSpec } from '../../engine/agentComponents';
import { useAgentStore } from '../../store/agentStore';
import { useCustomViewStore } from '../../store/customViewStore';
import { useUIStore } from '../../store/uiStore';
import { useTrustStore } from '../../store/trustStore';
import { useSmartPrompts } from '../../hooks/useSmartPrompts';
import { useMonitorStore } from '../../store/monitorStore';
import { MessageBubble } from './MessageBubble';
import { AgentComponentRenderer } from './AgentComponentRenderer';
import { ConfirmationCard } from './ConfirmationCard';
import { ConfirmDialog } from '../feedback/ConfirmDialog';
import { PromptPill } from './AIBranding';
import { cn } from '@/lib/utils';

/**
 * DockAgentPanel — compact agent conversation for the dock panel.
 * Shares state via useAgentStore.
 */
export function DockAgentPanel() {
  const {
    connected, mode, messages, streaming, streamingText, thinkingText,
    activeTools, streamingComponents, pendingConfirm, error, feedbackToast,
    connect, sendMessage, confirmAction, cancelQuery, clearChat,
  } = useAgentStore();

  const trustLevel = useTrustStore((s) => s.trustLevel);
  const smartPrompts = useSmartPrompts();
  const monitorConnected = useMonitorStore((s) => s.connected);
  const monitorFindings = useMonitorStore((s) => s.findings);
  const monitorCritical = monitorFindings.filter((f) => f.severity === 'critical').length;
  const navigate = useNavigate();
  const go = useNavigateTab();
  const [input, setInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleAddToView = useCallback(async (spec: ComponentSpec) => {
    const viewId = await useCustomViewStore.getState().createAndAddWidget(spec);
    if (viewId) {
      useUIStore.getState().enterViewBuilder(viewId);
      useCustomViewStore.getState().setActiveBuilderId(viewId);
      navigate(`/custom/${viewId}`);
    }
  }, [navigate]);

  // Connect on mount if not already connected
  useEffect(() => {
    if (!connected) connect();
  }, []);

  // Auto-scroll — debounced during streaming to prevent layout thrashing
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }, streaming ? 200 : 0);
    return () => clearTimeout(scrollTimer.current);
  }, [messages, streamingText, thinkingText, streaming]);

  // Focus input after streaming
  useEffect(() => {
    if (!streaming) inputRef.current?.focus();
  }, [streaming]);

  // Detect custom view context from URL
  const location = useLocation();
  const viewMatch = location.pathname.match(/^\/custom\/([a-z0-9-]+)/);
  const currentViewId = viewMatch ? viewMatch[1] : undefined;

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming || !connected) return;
    const ctx = currentViewId ? { kind: 'custom_view', name: '', viewId: currentViewId } : undefined;
    sendMessage(text, ctx);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Monitor status bar */}
      <button
        onClick={() => go('/incidents', 'Incidents')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1 text-xs border-b border-slate-800 transition-colors hover:bg-slate-800/50 w-full text-left',
          monitorConnected
            ? monitorFindings.length > 0
              ? monitorCritical > 0 ? 'text-red-400' : 'text-amber-400'
              : 'text-green-400'
            : 'text-slate-500',
        )}
      >
        <Shield className="h-3 w-3 shrink-0" />
        {monitorConnected
          ? monitorFindings.length > 0
            ? `Monitoring: ${monitorFindings.length} finding${monitorFindings.length !== 1 ? 's' : ''}`
            : 'Monitoring: All clear'
          : 'Monitoring: Disconnected'}
      </button>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 space-y-3" role="log" aria-label="Agent messages">
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
          <MessageBubble key={msg.id} message={msg} mode={mode} onAddToView={handleAddToView} />
        ))}

        {/* Streaming indicators */}
        {streaming && (
          <div className="space-y-1">
            {/* Compact status line showing what the agent is doing */}
            {(thinkingText || activeTools.length > 0) && !streamingText && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                {activeTools.length > 0 ? (
                  <span className="text-cyan-400">Using {activeTools[activeTools.length - 1]}...</span>
                ) : (
                  <span>Thinking...</span>
                )}
              </div>
            )}
            {/* Show streaming text as it arrives */}
            {streamingText && (
              <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans">{streamingText}</pre>
            )}
            {/* Components will be visible in the final message via "Show details" */}
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

      {/* Feedback toast */}
      {feedbackToast && (
        <div role="status" aria-live="polite" className="mx-3 mb-1 px-3 py-1.5 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded animate-in fade-in">
          {feedbackToast}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-slate-700 px-3 py-2 flex items-end gap-2">
        <div className={cn(
          'flex items-center gap-1 text-xs px-1.5 py-0.5 rounded',
          connected ? 'text-green-400 bg-green-950/30' : 'text-red-400 bg-red-950/30',
        )}>
          {mode.toUpperCase()} · L{trustLevel}
        </div>
        {messages.length > 0 && !streaming && (
          <>
            <button
              onClick={() => {
                const md = messages.map((m) => `### ${m.role === 'user' ? 'You' : 'Agent'} (${new Date(m.timestamp).toLocaleTimeString()})\n\n${m.content}\n`).join('\n---\n\n');
                const blob = new Blob([md], { type: 'text/markdown' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `pulse-chat-${new Date().toISOString().slice(0, 10)}.md`;
                a.click();
              }}
              className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
              title="Export conversation"
              aria-label="Export agent conversation"
            >
              <Download className="h-3 w-3" />
            </button>
            <button
              onClick={() => setConfirmClear(true)}
              className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
              title="Clear chat"
              aria-label="Clear agent chat"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={streaming ? 'Agent is thinking... press Stop to interrupt' : connected ? 'Ask the agent...' : 'Connecting...'}
            disabled={streaming || !connected}
            rows={1}
            className={cn(
              'w-full bg-slate-900 border rounded px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none resize-none overflow-y-auto',
              streaming ? 'border-blue-500/50 opacity-60 cursor-not-allowed' : 'border-slate-700 focus:border-blue-500',
              !connected && 'opacity-40',
            )}
          />
          {streaming && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
            </div>
          )}
        </div>
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

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => { clearChat(); setConfirmClear(false); }}
        title="Clear Conversation"
        description="Clear the conversation? The agent will lose context about the current incident."
        confirmLabel="Clear"
        variant="warning"
      />
    </div>
  );
}
