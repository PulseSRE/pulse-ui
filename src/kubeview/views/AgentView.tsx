import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Shield, Send, Trash2, Loader2, Wrench, Brain, AlertTriangle, Wifi, WifiOff, Square, Globe } from 'lucide-react';
import { useAgentStore } from '../store/agentStore';
import { useUIStore } from '../store/uiStore';
import { useFleetStore } from '../store/fleetStore';
import type { AgentMode, ResourceContext } from '../engine/agentClient';
import { AgentComponentRenderer } from '../components/agent/AgentComponentRenderer';
import { MarkdownRenderer } from '../components/agent/MarkdownRenderer';
import { MessageBubble } from '../components/agent/MessageBubble';
import { ConfirmationCard } from '../components/agent/ConfirmationCard';
import { TrustUpgradeNudge } from '../components/agent/TrustUpgradeNudge';
import { useTrustStore, TRUST_LABELS } from '../store/trustStore';
import { cn } from '@/lib/utils';

const MODE_CONFIG: Record<AgentMode, { label: string; icon: typeof Bot; color: string; description: string }> = {
  sre: {
    label: 'SRE Agent',
    icon: Bot,
    color: 'blue',
    description: 'Diagnose issues, check health, scale workloads, and triage incidents',
  },
  security: {
    label: 'Security Scanner',
    icon: Shield,
    color: 'red',
    description: 'Scan pods, RBAC, network policies, SCCs, images, and secrets',
  },
};

export default function AgentView() {
  const {
    connected, mode, messages, streaming, streamingText, thinkingText,
    activeTools, streamingComponents, pendingConfirm, error,
    connect, disconnect, sendMessage, switchMode, clearChat, confirmAction,
    cancelQuery, editLastMessage,
  } = useAgentStore();

  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const fleetMode = useFleetStore((s) => s.fleetMode);
  const clusters = useFleetStore((s) => s.clusters);
  const [fleetQueryMode, setFleetQueryMode] = useState(false);
  const [input, setInput] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialPromptSent = useRef(false);

  // Build namespace-aware quick prompts
  const nsLabel = selectedNamespace && selectedNamespace !== 'All Namespaces' ? selectedNamespace : '';
  const quickPrompts: Record<AgentMode, string[]> = {
    sre: [
      'Check cluster health',
      nsLabel ? `Show warning events in ${nsLabel}` : 'Show warning events across all namespaces',
      nsLabel ? `List pods not running in ${nsLabel}` : 'List pods not in Running state',
      'What changed in the last hour?',
      'Show top pods by restart count',
    ],
    security: [
      'Run a full security audit',
      nsLabel ? `Scan for privileged pods in ${nsLabel}` : 'Scan for privileged pods',
      'Check RBAC risks',
      'Find namespaces without network policies',
      'Audit SCC usage',
    ],
  };

  const trustLevel = useTrustStore((s) => s.trustLevel);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);

  // Handle URL params for context-aware invocation
  useEffect(() => {
    if (!connected || initialPromptSent.current) return;
    const prompt = searchParams.get('prompt');
    const contextParam = searchParams.get('context');
    if (prompt) {
      initialPromptSent.current = true;
      let context: ResourceContext | undefined;
      if (contextParam) {
        try { context = JSON.parse(contextParam); } catch { /* ignore */ }
      }
      sendMessage(decodeURIComponent(prompt), context);
      setSearchParams({}, { replace: true });
    }
  }, [connected]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, thinkingText]);

  // Focus input after streaming
  useEffect(() => {
    if (!streaming) inputRef.current?.focus();
  }, [streaming]);

  // Escape to cancel streaming
  useEffect(() => {
    if (!streaming) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); cancelQuery(); }
    }
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [streaming]);


  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming || !connected) return;
    sendMessage(text, undefined, fleetQueryMode);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const cfg = MODE_CONFIG[mode];
  const Icon = cfg.icon;

  return (
    <div className="flex h-full flex-col" role="main" aria-label="AI Agent Chat">
      {/* Header */}
      <div className="border-b border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon className={cn('h-6 w-6', mode === 'sre' ? 'text-blue-400' : 'text-red-400')} aria-hidden="true" />
            <div>
              <h1 className="text-lg font-semibold">{cfg.label}</h1>
              <p className="text-xs text-slate-400">{cfg.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={cn('flex items-center gap-1.5 text-xs', connected ? 'text-green-400' : 'text-red-400')} aria-live="polite">
              {connected ? <Wifi className="h-3.5 w-3.5" aria-hidden="true" /> : <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />}
              {connected ? 'Connected' : 'Disconnected'}
            </div>

            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded border',
              trustLevel >= 3 ? 'border-green-700 text-green-400' :
              trustLevel >= 2 ? 'border-amber-700 text-amber-400' :
              'border-slate-700 text-slate-400'
            )} title={`Trust Level ${trustLevel}: ${TRUST_LABELS[trustLevel]}`}>
              L{trustLevel}
            </span>

            {fleetMode === 'multi' && (
              <button
                onClick={() => setFleetQueryMode(!fleetQueryMode)}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
                  fleetQueryMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                )}
                title={fleetQueryMode ? 'Fleet queries ON — querying all clusters' : 'Enable fleet-wide queries'}
              >
                <Globe className="h-3.5 w-3.5" />
                Fleet
              </button>
            )}

            <div className="flex rounded-lg border border-slate-700 overflow-hidden" role="radiogroup" aria-label="Agent mode">
              {(['sre', 'security'] as AgentMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  role="radio"
                  aria-checked={mode === m}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors',
                    mode === m
                      ? m === 'sre' ? 'bg-blue-600 text-white' : 'bg-red-600 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700',
                  )}
                >
                  {MODE_CONFIG[m].label}
                </button>
              ))}
            </div>

            <button
              onClick={clearChat}
              className="p-1.5 text-slate-400 hover:text-white rounded transition-colors"
              title="Clear chat"
              aria-label="Clear chat history"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-auto px-6 py-4 space-y-4" role="log" aria-label="Chat messages" aria-live="polite">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Icon className={cn('h-16 w-16 mb-4 opacity-20', mode === 'sre' ? 'text-blue-400' : 'text-red-400')} aria-hidden="true" />
            <h2 className="text-lg font-medium text-slate-300 mb-2">Start a conversation</h2>
            <p className="text-sm text-slate-500 mb-6 max-w-md">
              Ask the {cfg.label.toLowerCase()} about your cluster. It has direct access to your Kubernetes API.
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {quickPrompts[mode].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  disabled={!connected}
                  className="px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-full text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} mode={mode} />
        ))}

        {/* Streaming indicator */}
        {streaming && (
          <div className="space-y-2" aria-label="Agent is responding">
            {thinkingText && (
              <div className="flex gap-3 items-start">
                <Brain className="h-4 w-4 text-purple-400 mt-1 shrink-0" aria-hidden="true" />
                <div className="text-xs text-purple-300/70 italic max-w-2xl whitespace-pre-wrap">
                  {thinkingText.slice(-500)}
                </div>
              </div>
            )}

            {activeTools.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-cyan-400">
                <Wrench className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>Calling {activeTools[activeTools.length - 1]}...</span>
              </div>
            )}

            {/* Streaming components from tools */}
            {streamingComponents.length > 0 && (
              <div className="max-w-3xl">
                {streamingComponents.map((spec, i) => (
                  <AgentComponentRenderer key={i} spec={spec} />
                ))}
              </div>
            )}

            {streamingText && (
              <div className="flex gap-3 items-start">
                <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', mode === 'sre' ? 'text-blue-400' : 'text-red-400')} aria-hidden="true" />
                <MarkdownRenderer content={streamingText} className="max-w-3xl" />
              </div>
            )}

            {!streamingText && !thinkingText && activeTools.length === 0 && streamingComponents.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Thinking...
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-950/30 border border-red-900 rounded-lg px-4 py-2" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        {/* Confirmation dialog */}
        {pendingConfirm && (
          <ConfirmationCard confirm={pendingConfirm} onConfirm={confirmAction} />
        )}

        <TrustUpgradeNudge />

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-slate-700 px-6 py-3">
        <div className="flex items-end gap-2">
          {/* Edit last message button */}
          {!streaming && messages.length > 0 && (
            <button
              onClick={() => {
                const lastContent = editLastMessage();
                if (lastContent) setInput(lastContent);
              }}
              className="p-2.5 text-slate-500 hover:text-slate-300 rounded-lg transition-colors shrink-0"
              aria-label="Edit last message"
              title="Edit last message"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={connected ? `Ask the ${cfg.label.toLowerCase()}... (Shift+Enter for newline)` : 'Connecting to agent...'}
            disabled={streaming || !connected}
            rows={1}
            aria-label="Message to agent"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 resize-none min-h-[40px] max-h-[120px]"
            style={{ height: input.includes('\n') ? 'auto' : '40px' }}
          />
          {streaming ? (
            <button
              onClick={cancelQuery}
              aria-label="Stop generation"
              title="Stop (Esc)"
              className="p-2.5 rounded-lg bg-red-700 hover:bg-red-600 text-white transition-colors shrink-0"
            >
              <Square className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !connected}
              aria-label="Send message"
              className={cn(
                'p-2.5 rounded-lg transition-colors shrink-0',
                input.trim() && connected
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed',
              )}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
