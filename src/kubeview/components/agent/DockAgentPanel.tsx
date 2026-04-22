import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, StopCircle, Bot, Loader2, AlertTriangle, Trash2, Shield, Download, History, MessageSquare, Plus, X } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import type { ComponentSpec } from '../../engine/agentComponents';
import type { AgentVersionInfo } from '../../hooks/useCapabilityDetection';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '../../store/agentStore';
import { useCustomViewStore } from '../../store/customViewStore';
import { useUIStore } from '../../store/uiStore';
import { useTrustStore } from '../../store/trustStore';
import { useSmartPrompts } from '../../hooks/useSmartPrompts';
import { useMonitorStore } from '../../store/monitorStore';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ConfirmationCard } from './ConfirmationCard';
import { ConfirmDialog } from '../feedback/ConfirmDialog';
import { PromptPill } from './AIBranding';
import { ActionPlanTracker } from './ActionPlanTracker';
import { useActionPlanStore } from '../../store/actionPlanStore';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '../../engine/formatters';

/* ---- Chat History Types ---- */
interface ChatSession {
  id: string;
  title: string;
  agent_mode: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface ChatSessionMessage {
  role: 'user' | 'assistant';
  content: string;
  components?: ComponentSpec[];
  timestamp: string;
}

const AGENT_BASE = '/api/agent';

async function fetchSessions(): Promise<ChatSession[]> {
  const res = await fetch(`${AGENT_BASE}/chat/sessions`);
  if (!res.ok) throw new Error('Failed to fetch sessions');
  const data = await res.json();
  return data.sessions ?? [];
}

async function fetchSessionMessages(sessionId: string): Promise<ChatSessionMessage[]> {
  const res = await fetch(`${AGENT_BASE}/chat/sessions/${sessionId}/messages`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  const data = await res.json();
  return data.messages ?? [];
}

async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${AGENT_BASE}/chat/sessions/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete session');
}



/* ---- Follow-Up Suggestions ---- */

const FOLLOW_UP_MAP: Record<string, string[]> = {
  diagnose: ['Build me a dashboard for this', 'Check if this happened before', 'What metrics should I monitor?'],
  security: ['Build a security findings dashboard', 'Check RBAC for this namespace', 'Are there network policies?'],
  dashboard_requested: ['Show me the production namespace', 'What metrics should I include?', 'Add CPU and memory charts'],
  general: ['Create a dashboard for this namespace', 'Build an investigation plan', 'What skills do you have?'],
};

const METRIC_FAMILIES: Record<string, string[]> = {
  cpu: ['cpu', 'processor', 'cores', 'utilization'],
  memory: ['memory', 'mem', 'ram', 'rss', 'heap'],
  network: ['network', 'traffic', 'bandwidth', 'packets', 'bytes_transmitted'],
  disk: ['disk', 'storage', 'filesystem', 'iops', 'volume'],
  latency: ['latency', 'response time', 'duration', 'p99', 'p95'],
  errors: ['error', 'failure', '5xx', '4xx', 'error rate'],
};

function deriveDashboardSuggestions(components: ComponentSpec[]): string[] {
  const titles = components
    .map((c) => ('title' in c && c.title ? c.title.toLowerCase() : ''))
    .filter(Boolean);
  const allText = titles.join(' ');

  const present = new Set<string>();
  for (const [family, keywords] of Object.entries(METRIC_FAMILIES)) {
    if (keywords.some((kw) => allText.includes(kw))) present.add(family);
  }

  const additions: string[] = [];
  if (!present.has('cpu')) additions.push('Add CPU utilization');
  if (!present.has('memory')) additions.push('Add memory usage');
  if (!present.has('network')) additions.push('Add network traffic');
  if (!present.has('latency')) additions.push('Add request latency');
  if (!present.has('errors')) additions.push('Add error rate');
  if (!present.has('disk')) additions.push('Add disk I/O');

  const suggestions: string[] = [];
  if (additions.length > 0) suggestions.push(additions[0]);
  suggestions.push('Save as custom dashboard');
  if (additions.length > 1) suggestions.push(additions[1]);

  return suggestions.slice(0, 3);
}

function FollowUpSuggestions({
  messages,
  onSend,
  smartPrompts,
}: {
  messages: Array<{ role: string; content: string; components?: ComponentSpec[] }>;
  onSend: (msg: string) => void;
  smartPrompts: Array<{ prompt: string }>;
}) {
  // Determine context from last assistant message
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) return null;

  const text = lastAssistant.content.toLowerCase();
  const hasComponents = Array.isArray(lastAssistant.components) && lastAssistant.components.length > 0;
  let suggestions: string[];

  const charts = hasComponents ? lastAssistant.components!.filter((c) => c.kind === 'chart') : [];
  const isDashboard = charts.length >= 2 || text.includes('dashboard created') || text.includes('successfully created') || text.includes('here\'s your dashboard');
  const dashboardRequested = !isDashboard && (text.includes('dashboard') || text.includes('create_dashboard'));

  if (isDashboard && hasComponents) {
    suggestions = deriveDashboardSuggestions(lastAssistant.components!);
  } else if (isDashboard) {
    suggestions = ['Add another chart', 'Save as custom dashboard', 'Share this dashboard'];
  } else if (dashboardRequested) {
    suggestions = FOLLOW_UP_MAP.dashboard_requested;
  } else if (text.includes('security') || text.includes('rbac') || text.includes('scan')) {
    suggestions = FOLLOW_UP_MAP.security;
  } else if (text.includes('crash') || text.includes('error') || text.includes('restart') || text.includes('oom')) {
    suggestions = FOLLOW_UP_MAP.diagnose;
  } else {
    suggestions = FOLLOW_UP_MAP.general;
  }

  // Mix in a context-aware smart prompt if available
  if (smartPrompts.length > 0) {
    const sp = smartPrompts[0];
    if (!suggestions.includes(sp.prompt)) {
      suggestions = [...suggestions.slice(0, 2), sp.prompt];
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 px-1 py-2">
      {suggestions.slice(0, 3).map((s, i) => (
        <PromptPill key={i} onClick={() => onSend(s)}>
          {s}
        </PromptPill>
      ))}
    </div>
  );
}

/* ---- Chat History Panel ---- */

function ChatHistoryPanel({
  onLoadSession,
  onNewChat,
  onClose,
  activeSessionId,
}: {
  onLoadSession: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
  activeSessionId: string | null;
}) {
  const queryClient = useQueryClient();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['chat', 'sessions'],
    queryFn: fetchSessions,
    staleTime: 15_000,
  });

  const handleDelete = async (id: string) => {
    await deleteSession(id);
    queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
    setPendingDeleteId(null);
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingDeleteId) {
          setPendingDeleteId(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pendingDeleteId]);

  return (
    <div
      ref={panelRef}
      className="absolute left-0 top-0 bottom-0 w-[280px] bg-slate-900 border-r border-slate-700 z-20 flex flex-col animate-in slide-in-from-left duration-200"
      data-testid="chat-history-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <span className="text-xs font-medium text-slate-300">Chat History</span>
        <button
          onClick={onClose}
          className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
          aria-label="Close history panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* New chat button */}
      <button
        onClick={() => { onNewChat(); onClose(); }}
        className="flex items-center gap-2 mx-2 mt-2 mb-1 px-3 py-1.5 text-xs text-blue-400 bg-blue-950/30 border border-blue-800/40 rounded hover:bg-blue-900/40 transition-colors"
      >
        <Plus className="h-3 w-3" />
        New Chat
      </button>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
            Loading...
          </div>
        )}
        {!isLoading && sessions.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-8">No saved sessions</div>
        )}
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => { onLoadSession(session.id); onClose(); }}
            className={cn(
              'group w-full flex items-start gap-2 px-2 py-1.5 rounded text-left transition-colors',
              activeSessionId === session.id
                ? 'bg-blue-950/40 border border-blue-800/50'
                : 'hover:bg-slate-800/60 border border-transparent',
            )}
          >
            <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-slate-500" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-slate-300 truncate">{session.title || 'Untitled'}</div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                <span>{formatRelativeTime(new Date(session.updated_at).getTime())}</span>
                <span className="bg-slate-800 px-1.5 py-0.5 rounded-full">{session.message_count} msg{session.message_count !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setPendingDeleteId(session.id); }}
              className="p-0.5 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all"
              aria-label={`Delete session ${session.title}`}
            >
              <X className="h-3 w-3" />
            </button>
          </button>
        ))}
      </div>

      <ConfirmDialog
        open={!!pendingDeleteId}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={() => pendingDeleteId && handleDelete(pendingDeleteId)}
        title="Delete Session"
        description="Delete this chat session? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}

/**
 * DockAgentPanel — compact agent conversation for the dock panel.
 * Shares state via useAgentStore.
 */
export function DockAgentPanel() {
  const {
    connected, mode, messages, streaming, streamingText, thinkingText,
    activeTools, activeSkills, completedTools, completedSkills,
    streamingComponents, pendingConfirm, error, feedbackToast,
    connect, sendMessage, confirmAction, cancelQuery, clearChat,
  } = useAgentStore(useShallow((s) => ({
    connected: s.connected, mode: s.mode, messages: s.messages,
    streaming: s.streaming, streamingText: s.streamingText, thinkingText: s.thinkingText,
    activeTools: s.activeTools, activeSkills: s.activeSkills,
    completedTools: s.completedTools, completedSkills: s.completedSkills,
    streamingComponents: s.streamingComponents,
    pendingConfirm: s.pendingConfirm, error: s.error, feedbackToast: s.feedbackToast,
    connect: s.connect, sendMessage: s.sendMessage, confirmAction: s.confirmAction,
    cancelQuery: s.cancelQuery, clearChat: s.clearChat,
  })));

  const trustLevel = useTrustStore((s) => s.trustLevel);
  const smartPrompts = useSmartPrompts();

  // Fetch agent version info for welcome message
  const { data: agentVersionInfo } = useQuery<AgentVersionInfo>({
    queryKey: ['agent', 'version'],
    queryFn: async () => {
      const res = await fetch(`${AGENT_BASE}/version`);
      if (!res.ok) throw new Error('Agent version fetch failed');
      return res.json();
    },
    staleTime: 300_000,
  });
  const monitorConnected = useMonitorStore((s) => s.connected);
  const monitorFindings = useMonitorStore((s) => s.findings);
  const monitorCritical = monitorFindings.filter((f) => f.severity === 'critical').length;
  const navigate = useNavigate();
  const go = useNavigateTab();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Invalidate sessions list when messages change (new messages sent)
  const messageCount = messages.length;
  const prevMessageCount = useRef(messageCount);
  useEffect(() => {
    if (messageCount > prevMessageCount.current) {
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
    }
    prevMessageCount.current = messageCount;
  }, [messageCount, queryClient]);

  const handleLoadSession = useCallback(async (sessionId: string) => {
    setLoadError(null);
    try {
      const msgs = await fetchSessionMessages(sessionId);
      const agentMessages = msgs.map((m, i) => ({
        id: `hist-${i}`,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.timestamp).getTime(),
        components: m.components,
      }));
      // Replace current messages via store
      useAgentStore.setState({ messages: agentMessages, error: null });
      setActiveSessionId(sessionId);
    } catch (e) {
      console.error('chat session load failed:', e);
      setLoadError('Failed to load session. Please try again.');
    }
  }, []);

  const handleNewChat = useCallback(() => {
    clearChat();
    useActionPlanStore.getState().clearExecution();
    setActiveSessionId(null);
  }, [clearChat]);

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

    // Track agent query with page context
    import('../../../kubeview/engine/sessionTracker').then(({ trackAgentQuery }) => {
      trackAgentQuery(location.pathname, text);
    }).catch(() => {});

    // Inject a one-time welcome message on first interaction (skip if session was loaded from history)
    if (messages.length === 0 && agentVersionInfo && !activeSessionId) {
      const tools = agentVersionInfo.tools ?? 0;
      const skills = agentVersionInfo.skills ?? 0;
      const parts: string[] = [];
      if (skills > 0) parts.push(`${skills} skill${skills !== 1 ? 's' : ''}`);
      parts.push(`${tools} tool${tools !== 1 ? 's' : ''}`);

      const welcomeMsg = {
        id: 'welcome-system',
        role: 'assistant' as const,
        content: `I'm your SRE agent with ${parts.join(' and ')}. Ask "what can you do?" to explore my capabilities.`,
        timestamp: Date.now() - 1, // ensure it sorts before user message
      };
      useAgentStore.setState((s) => ({ messages: [welcomeMsg, ...s.messages] }));
    }

    useActionPlanStore.getState().clearAwaitingCompletion();

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
    <div className="flex flex-col h-full relative">
      {/* Chat history panel */}
      {showHistory && (
        <ChatHistoryPanel
          onLoadSession={handleLoadSession}
          onNewChat={handleNewChat}
          onClose={() => setShowHistory(false)}
          activeSessionId={activeSessionId}
        />
      )}

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

      <ActionPlanTracker />

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

        {/* Streaming indicator — Neural Pulse */}
        {streaming && (
          <ThinkingIndicator
            thinkingText={thinkingText}
            streamingText={streamingText}
            activeTools={activeTools}
            activeSkills={activeSkills}
            completedTools={completedTools}
            completedSkills={completedSkills}
          />
        )}

        {loadError && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/30 border border-red-900 rounded px-3 py-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {loadError}
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

        {/* Follow-up suggestions after conversation */}
        {messages.length > 0 && !streaming && !pendingConfirm && (
          <FollowUpSuggestions
            messages={messages}
            onSend={sendMessage}
            smartPrompts={smartPrompts}
          />
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
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={cn(
            'p-1 transition-colors',
            showHistory ? 'text-blue-400 hover:text-blue-300' : 'text-slate-500 hover:text-slate-300',
          )}
          title="Chat history"
          aria-label="Toggle chat history"
          data-testid="chat-history-toggle"
        >
          <History className="h-3 w-3" />
        </button>
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
        onConfirm={() => {
          clearChat();
          useActionPlanStore.getState().clearExecution();
          setConfirmClear(false);
        }}
        title="Clear Conversation"
        description="Clear the conversation? The agent will lose context about the current incident."
        confirmLabel="Clear"
        variant="warning"
      />
    </div>
  );
}
