import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  StopCircle,
  ChevronDown,
  ChevronUp,
  Brain,
  Wrench,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useAgentSession } from '../../hooks/useAgentSession';
import type { AgentMode, ResourceContext } from '../../engine/agentClient';
import { MessageBubble } from './MessageBubble';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AgentComponentRenderer } from './AgentComponentRenderer';
import { ConfirmationCard } from './ConfirmationCard';
import { AIIcon, AIIconStatic, AI_ACCENT, aiGlowClass } from './AIBranding';
import { generateSmartPrompts } from '../../engine/smartPrompts';
import { cn } from '@/lib/utils';

interface InlineAgentProps {
  context: ResourceContext;
  initialPrompt?: string;
  defaultExpanded?: boolean;
  /** Auto-expand when resource is in unhealthy state */
  autoExpandWhenUnhealthy?: boolean;
  /** Whether the resource is currently unhealthy (drives auto-expand + visual emphasis) */
  isUnhealthy?: boolean;
  maxHeight?: string;
  mode?: AgentMode;
  quickPrompts?: string[];
  className?: string;
}

export const InlineAgent: React.FC<InlineAgentProps> = ({
  context,
  initialPrompt,
  defaultExpanded = false,
  autoExpandWhenUnhealthy = false,
  isUnhealthy = false,
  maxHeight = '400px',
  mode = 'sre',
  quickPrompts,
  className,
}) => {
  const shouldAutoExpand = autoExpandWhenUnhealthy && isUnhealthy;
  const [expanded, setExpanded] = useState(defaultExpanded || shouldAutoExpand);
  const [input, setInput] = useState('');
  const [initialSent, setInitialSent] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    connected,
    messages,
    streaming,
    streamingText,
    thinkingText,
    activeTools,
    streamingComponents,
    pendingConfirm,
    error,
    send,
    confirm,
    clear,
    disconnect,
  } = useAgentSession({ context, mode });

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, thinkingText]);

  // Send initial prompt on first expand
  useEffect(() => {
    if (expanded && initialPrompt && !initialSent && connected) {
      send(initialPrompt);
      setInitialSent(true);
    }
  }, [expanded, initialPrompt, initialSent, connected, send]);

  // Focus textarea on expand
  useEffect(() => {
    if (expanded) {
      textareaRef.current?.focus();
    }
  }, [expanded]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    send(trimmed);
    setInput('');
  }, [input, streaming, send]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleQuickPrompt = useCallback(
    (prompt: string) => {
      send(prompt);
    },
    [send],
  );

  const handleStop = useCallback(() => {
    disconnect();
  }, [disconnect]);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  // Generate a smart prompt preview for the collapsed state
  const previewPrompt = generateSmartPrompts({
    resourceKind: context.kind,
    resourceName: context.name,
    resourceNamespace: context.namespace,
  })[0];

  // Collapsed state
  if (!expanded) {
    return (
      <button
        onClick={toggleExpanded}
        className={cn(
          'w-full rounded-lg p-3 border',
          'flex items-center gap-2 hover:bg-slate-750',
          'transition-all cursor-pointer text-sm',
          isUnhealthy
            ? cn('bg-slate-800', AI_ACCENT.border, aiGlowClass, 'animate-pulse')
            : 'bg-slate-800 border-slate-700 hover:border-slate-600',
          className,
        )}
        aria-label={`Ask about this ${context.kind}`}
      >
        <AIIconStatic size={16} className={isUnhealthy ? '' : 'text-slate-400'} />
        <div className="flex-1 text-left">
          <span className={cn('block', isUnhealthy ? AI_ACCENT.text : 'text-slate-300')}>
            Ask about this {context.kind}
          </span>
          {previewPrompt && (
            <span className="block text-xs text-slate-500 mt-0.5 truncate">
              Try: "{previewPrompt.text}"
            </span>
          )}
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
      </button>
    );
  }

  // Expanded state
  return (
    <div
      className={cn(
        'bg-slate-800 border border-slate-700 rounded-lg overflow-hidden',
        className,
      )}
    >
      {/* Header */}
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center gap-2 p-3 text-sm text-slate-300 hover:bg-slate-750 transition-colors cursor-pointer border-b border-slate-700"
      >
        <AIIcon size={16} pulseWhenStreaming />
        <span className="flex-1 text-left font-medium">Ask about this {context.kind}</span>
        {!connected && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
        <ChevronUp className="h-4 w-4 shrink-0" />
      </button>

      {/* Messages area */}
      <div className="overflow-y-auto p-3 space-y-3" style={{ maxHeight }}>
        {/* Quick prompts when no messages */}
        {messages.length === 0 && !streaming && quickPrompts && quickPrompts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => handleQuickPrompt(prompt)}
                className="text-xs px-3 py-1.5 rounded-full bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-slate-200 transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {/* Rendered messages */}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} mode={mode} />
        ))}

        {/* Streaming components */}
        {streamingComponents.map((spec, i) => (
          <AgentComponentRenderer key={`component-${i}`} spec={spec} />
        ))}

        {/* Thinking indicator */}
        {thinkingText && (
          <div className="flex items-start gap-2 text-xs text-slate-400" data-testid="thinking-indicator">
            <Brain className="h-3.5 w-3.5 mt-0.5 text-purple-400 shrink-0" />
            <span className="italic">{thinkingText}</span>
          </div>
        )}

        {/* Active tools indicator */}
        {activeTools.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-400" data-testid="tool-indicator">
            <Wrench className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span>Using {activeTools.join(', ')}</span>
          </div>
        )}

        {/* Streaming text */}
        {streamingText && (
          <div className="text-sm" data-testid="streaming-text">
            <MarkdownRenderer content={streamingText} />
          </div>
        )}

        {/* Pending confirmation */}
        {pendingConfirm && (
          <ConfirmationCard
            confirm={pendingConfirm}
            onConfirm={(approved) => confirm(approved)}
          />
        )}

        {/* Error display */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/30 rounded-md p-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-slate-700 p-2 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connected ? `Ask about this ${context.kind}...` : 'Connecting...'}
          disabled={!connected}
          rows={1}
          className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        {streaming ? (
          <button
            onClick={handleStop}
            className="p-2 rounded-md bg-red-600 hover:bg-red-500 text-white transition-colors"
            aria-label="Stop"
          >
            <StopCircle className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim() || !connected}
            className="p-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};
