import { useState, useCallback, memo, useMemo } from 'react';
import { Clock, Copy, Check, Maximize2, Minimize2, ThumbsUp, ThumbsDown, Puzzle, Wrench, MessageCircleQuestion } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import type { AgentMode, AgentMessage } from '../../engine/agentClient';
import type { ComponentSpec } from '../../engine/agentComponents';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AgentComponentRenderer } from './AgentComponentRenderer';
import { cn } from '@/lib/utils';
import { Bot, Shield } from 'lucide-react';

const MODE_ICON: Record<AgentMode, typeof Bot> = {
  sre: Bot,
  security: Shield,
  monitor: Shield,
  auto: Bot,
};

/** Describe a write tool in plain English for confirmation dialogs */
export function describeToolAction(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'scale_deployment':
      return `Scale deployment ${input.namespace}/${input.name} to ${input.replicas} replicas`;
    case 'restart_deployment':
      return `Trigger rolling restart of deployment ${input.namespace}/${input.name}`;
    case 'cordon_node':
      return `Mark node ${input.node_name} as unschedulable (cordon)`;
    case 'uncordon_node':
      return `Mark node ${input.node_name} as schedulable (uncordon)`;
    case 'delete_pod':
      return `Delete pod ${input.namespace}/${input.pod_name} (grace period: ${input.grace_period_seconds || 30}s)`;
    case 'apply_yaml':
      return `${input.dry_run ? 'Dry-run validate' : 'Apply'} YAML to ${input.namespace || 'default'}`;
    case 'create_network_policy':
      return `Create ${input.policy_type} NetworkPolicy "${input.name}" in ${input.namespace}`;
    case 'rollback_deployment':
      return `Rollback deployment ${input.namespace}/${input.name} to revision ${input.revision || 'previous'}`;
    case 'drain_node':
      return `Drain node ${input.node_name} (cordon + evict all pods, respecting PDBs)`;
    default:
      return `Execute ${tool}`;
  }
}

/** Return risk assessment for an agent tool action */
export function riskLevel(tool: string, input: Record<string, unknown>): { level: string; color: string } {
  if (tool === 'delete_pod') return { level: 'MEDIUM', color: 'text-amber-400' };
  if (tool === 'apply_yaml' && !input.dry_run) return { level: 'HIGH', color: 'text-red-400' };
  if (tool === 'scale_deployment') {
    const replicas = Number(input.replicas ?? -1);
    if (replicas === 0) return { level: 'HIGH', color: 'text-red-400' };
    return { level: 'MEDIUM', color: 'text-amber-400' };
  }
  if (tool === 'restart_deployment') return { level: 'MEDIUM', color: 'text-amber-400' };
  if (tool === 'cordon_node') return { level: 'MEDIUM', color: 'text-amber-400' };
  if (tool === 'create_network_policy') return { level: 'MEDIUM', color: 'text-amber-400' };
  if (tool === 'rollback_deployment') return { level: 'HIGH', color: 'text-red-400' };
  if (tool === 'drain_node') return { level: 'HIGH', color: 'text-red-400' };
  // Default to MEDIUM for unknown tools — safer than LOW
  return { level: 'MEDIUM', color: 'text-amber-400' };
}

/**
 * Split a trailing question from the agent's response.
 * Returns [bodyContent, questionText] if the last paragraph ends with '?'.
 */
function splitTrailingQuestion(content: string): [string, string | null] {
  // Don't split very short messages or messages that are entirely a question
  if (content.length < 80) return [content, null];

  // Split on double newline to find paragraphs
  const trimmed = content.trimEnd();
  const lastBreak = trimmed.lastIndexOf('\n\n');
  if (lastBreak === -1) return [content, null];

  const lastParagraph = trimmed.slice(lastBreak + 2).trim();

  // Must end with ? and be a reasonable length (not a code block or list)
  if (!lastParagraph.endsWith('?')) return [content, null];
  if (lastParagraph.length > 300) return [content, null];
  if (lastParagraph.startsWith('```') || lastParagraph.startsWith('|') || lastParagraph.startsWith('-')) return [content, null];

  return [trimmed.slice(0, lastBreak).trim(), lastParagraph];
}

/** Detect HTML documents in content and render them in a sandboxed iframe */
export function RichContent({ content, components, onAddToView }: { content: string; components?: ComponentSpec[]; onAddToView?: (spec: ComponentSpec) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showComponents, setShowComponents] = useState(false);
  const [body, trailingQuestion] = useMemo(() => splitTrailingQuestion(content), [content]);

  const htmlMatch = content.match(/<!DOCTYPE html[\s\S]*<\/html>/i)
    || content.match(/```html\s*\n(<!DOCTYPE html[\s\S]*?<\/html>)\s*\n```/i);

  if (htmlMatch) {
    const htmlContent = htmlMatch[1] || htmlMatch[0];
    const fullMatch = htmlMatch[0];
    const beforeHtml = content.slice(0, content.indexOf(fullMatch)).trim();
    const afterHtml = content.slice(content.indexOf(fullMatch) + fullMatch.length).trim();

    return (
      <>
        {beforeHtml && <MarkdownRenderer content={beforeHtml} />}
        <div className={cn(
          'my-2 border border-slate-600 rounded-lg overflow-hidden transition-all',
          expanded ? 'fixed inset-4 z-50 bg-slate-900' : 'relative',
        )}>
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 border-b border-slate-700">
            <span className="text-xs text-slate-400">Generated Dashboard</span>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-slate-400 hover:text-white p-0.5"
              aria-label={expanded ? 'Minimize' : 'Maximize'}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>
          <iframe
            srcDoc={htmlContent}
            sandbox="allow-scripts"
            className={cn('w-full border-0', expanded ? 'h-[calc(100%-32px)]' : 'h-[500px]')}
            title="Agent generated view"
          />
        </div>
        {afterHtml && <MarkdownRenderer content={afterHtml} />}
      </>
    );
  }

  return (
    <>
      <MarkdownRenderer content={trailingQuestion ? body : content} />
      {trailingQuestion && (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-violet-500/10 border border-violet-500/25 px-3.5 py-2.5">
          <MessageCircleQuestion className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
          <span className="text-sm text-violet-200">{trailingQuestion}</span>
        </div>
      )}
      {components && components.length > 0 && (
        <>
          <button
            onClick={() => setShowComponents(!showComponents)}
            className="mt-2 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
          >
            {showComponents ? '▾ Hide details' : `▸ Show details (${components.length} component${components.length > 1 ? 's' : ''})`}
          </button>
          {showComponents && (
            <div className="mt-1 space-y-1">
              {components.map((spec, i) => (
                <AgentComponentRenderer key={i} spec={spec} onAddToView={onAddToView} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

export const MessageBubble = memo(function MessageBubble({ message, mode, onAddToView }: { message: AgentMessage; mode: AgentMode; onAddToView?: (spec: ComponentSpec) => void }) {
  const isUser = message.role === 'user';
  const Icon = isUser ? undefined : MODE_ICON[mode];
  const [copied, setCopied] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<'up' | 'down' | null>(null);
  const sendFeedback = useAgentStore((s) => s.sendFeedback);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [message.content]);

  const timeStr = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={cn(
      'flex gap-3 items-start group',
      isUser && 'flex-row-reverse',
      isUser ? 'animate-[kv-msg-in-right_0.2s_ease-out_both]' : 'animate-[kv-msg-in-left_0.2s_ease-out_both]',
    )} role="article" aria-label={`${isUser ? 'You' : 'Agent'} at ${timeStr}`}>
      {isUser ? (
        <div className="h-7 w-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0" aria-hidden="true">
          <span className="text-xs font-medium">You</span>
        </div>
      ) : (
        Icon && <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', mode === 'sre' ? 'text-blue-400' : 'text-red-400')} aria-hidden="true" />
      )}
      <div className={cn(
        'max-w-3xl min-w-0 rounded-lg px-4 py-2.5 text-sm relative overflow-x-auto',
        isUser
          ? 'bg-blue-600/20 border border-blue-500/30 text-slate-100'
          : 'bg-slate-800 border border-slate-700 text-slate-200',
      )}>
        {message.context && (
          <div className="text-xs text-slate-500 mb-1">
            Context: {message.context.kind} {message.context.namespace}/{message.context.name}
          </div>
        )}
        {isUser ? (
          <pre className="whitespace-pre-wrap font-sans">{message.content}</pre>
        ) : (
          <RichContent content={message.content} components={message.components} onAddToView={onAddToView} />
        )}
        {message.role === 'assistant' && message.skillName && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-800/50 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <Puzzle className="w-3 h-3" />
              {message.skillName}
            </span>
            {(message.toolCount ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <Wrench className="w-3 h-3" />
                {message.toolCount} tools
              </span>
            )}
            {(message.durationMs ?? 0) > 0 && (
              <span>{(message.durationMs! / 1000).toFixed(1)}s</span>
            )}
            {(message.inputTokens ?? 0) > 0 && (
              <span>{Math.round((message.inputTokens! + (message.outputTokens || 0)) / 1000)}K tokens</span>
            )}
          </div>
        )}
        <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-slate-700/50">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" aria-hidden="true" />
            {timeStr}
          </span>
          <div className="flex items-center gap-1">
            {!isUser && (
              <>
                <button
                  onClick={() => { sendFeedback(true, message.id); setFeedbackGiven('up'); }}
                  disabled={feedbackGiven !== null}
                  className={cn(
                    'p-1 rounded transition-colors',
                    feedbackGiven === 'up' ? 'text-green-400 bg-green-950/40' : 'text-slate-500 hover:text-green-400 hover:bg-green-950/30',
                    feedbackGiven === 'down' && 'hidden',
                  )}
                  aria-label="This helped"
                  title="This helped — agent will learn from this"
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { sendFeedback(false, message.id); setFeedbackGiven('down'); }}
                  disabled={feedbackGiven !== null}
                  className={cn(
                    'p-1 rounded transition-colors',
                    feedbackGiven === 'down' ? 'text-red-400 bg-red-950/40' : 'text-slate-500 hover:text-red-400 hover:bg-red-950/30',
                    feedbackGiven === 'up' && 'hidden',
                  )}
                  aria-label="This didn't help"
                  title="This didn't help — agent will adjust"
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              onClick={handleCopy}
              className="text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
              aria-label="Copy message"
              title="Copy to clipboard"
            >
              {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
