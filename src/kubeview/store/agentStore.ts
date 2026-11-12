import { getActiveClusterId, LOCAL_CLUSTER_ID } from '../engine/clusterConnection';
import { clusterChangedMessage } from '../engine/pendingCluster';
/**
 * Agent Store — manages chat state for the Pulse Agent integration.
 * Messages persist to localStorage so conversation survives navigation.
 * Streaming deltas are batched via requestAnimationFrame to prevent render thrashing.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useTrustStore } from './trustStore';
import { handleAuthError } from '../engine/auth';
import {
  AgentClient,
  type AgentMode,
  type AgentMessage,
  type AgentEvent,
  type ConfirmRequest,
  type ResourceContext,
  type WriteProposal,
  type MultiSkillMeta,
} from '../engine/agentClient';
import { type ComponentSpec, truncateForPersistence } from '../engine/agentComponents';

/** Max messages kept in history (older ones are trimmed) */
const MAX_MESSAGES = 100;

interface AgentState {
  connected: boolean;
  mode: AgentMode;
  messages: AgentMessage[];
  streaming: boolean;
  streamingText: string;
  thinkingText: string;
  activeTools: string[];
  streamingComponents: ComponentSpec[];
  /** Skills running in parallel (empty when single-skill) */
  activeSkills: string[];
  /** Tools that finished during parallel execution (for amber→green transition) */
  completedTools: Set<string>;
  /** Skills that finished (for checkmark display) */
  completedSkills: Set<string>;
  /**
   * The write awaiting approval. `clusterId` is where it will be applied: the
   * agent's own (local) cluster, always. `requestedOnClusterId` is the cluster
   * the user was looking at when it was requested.
   */
  pendingConfirm: (ConfirmRequest & { clusterId?: string; requestedOnClusterId?: string }) | null;
  /**
   * Writes the agent offered instead of running (protected namespaces). Each
   * runs only if the person approves it; they outlive the turn that made
   * them, and go when the session does (the agent holds them per connection).
   */
  pendingProposals: Array<WriteProposal & { clusterId?: string; requestedOnClusterId?: string }>;
  error: string | null;
  /** Brief toast shown when agent acknowledges feedback */
  feedbackToast: string | null;
  /** Pending view spec from agent — user can save as custom dashboard */
  pendingViewSpec: import('../engine/agentComponents').ViewSpec | null;
  /** True when background health polling found an unread insight */
  hasUnreadInsight: boolean;
  /**
   * The resource the page on screen is about (a Pod or Deployment detail page).
   * Typed questions in the dock are sent with it as context. Not persisted:
   * it belongs to the page, which clears it when it unmounts.
   */
  pageContext: ResourceContext | null;
  setPageContext: (context: ResourceContext | null) => void;

  connect: () => void;
  disconnect: () => void;
  sendMessage: (content: string, context?: ResourceContext, fleetMode?: boolean) => void;
  /** Connect (if needed) and send a message — safe replacement for setTimeout race condition */
  connectAndSend: (content: string, context?: ResourceContext) => void;
  switchMode: (mode: AgentMode) => void;
  clearChat: () => void;
  confirmAction: (approved: boolean) => void;
  /** Approve or decline a write proposal. Approving starts the turn in which it runs. */
  answerProposal: (id: string, approved: boolean) => void;
  sendFeedback: (resolved: boolean, messageId?: string) => void;
  cancelQuery: () => void;
  editLastMessage: () => string;
  setUnreadInsight: (value: boolean) => void;
}

let client: AgentClient | null = null;
let unsubscribe: (() => void) | null = null;
let nextId = 1;

function makeId(): string {
  return `msg-${nextId++}`;
}

// --- Batched delta accumulator to prevent render thrashing ---
let pendingTextDelta = '';
let pendingThinkingDelta = '';
let rafScheduled = false;

function flushDeltas(set: (fn: (s: AgentState) => Partial<AgentState>) => void) {
  rafScheduled = false; // Always reset — even if no deltas to flush
  if (!pendingTextDelta && !pendingThinkingDelta) return;
  const text = pendingTextDelta;
  const thinking = pendingThinkingDelta;
  pendingTextDelta = '';
  pendingThinkingDelta = '';
  set((s) => ({
    streamingText: s.streamingText + text,
    thinkingText: s.thinkingText + thinking,
  }));
}

function notifyPlanStore(action: 'complete' | 'fail') {
  import('./actionPlanStore').then(({ useActionPlanStore }) => {
    const ps = useActionPlanStore.getState();
    if (ps.execution?.awaitingCompletion) {
      if (action === 'complete') { ps.completeActiveStep(); } else { ps.failActiveStep(); }
    }
  }).catch(() => {});
}

/** Reset all streaming accumulators — call on any terminal event */
function resetStreamingState() {
  pendingTextDelta = '';
  pendingThinkingDelta = '';
  rafScheduled = false;
}

function scheduleDeltaFlush(set: (fn: (s: AgentState) => Partial<AgentState>) => void) {
  if (rafScheduled) return;
  rafScheduled = true;
  // Throttle to 250ms — streaming renders plain text during stream,
  // markdown parsing only happens on completed messages
  setTimeout(() => flushDeltas(set), 250);
}

function trimMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      connected: false,
      mode: 'auto',
      messages: [],
      streaming: false,
      streamingText: '',
      thinkingText: '',
      activeTools: [],
      streamingComponents: [],
      activeSkills: [],
      completedTools: new Set<string>(),
      completedSkills: new Set<string>(),
      pendingConfirm: null,
      pendingProposals: [],
      error: null,
      feedbackToast: null,
      pendingViewSpec: null,
      hasUnreadInsight: false,
      pageContext: null,

      setUnreadInsight: (value) => set({ hasUnreadInsight: value }),
      setPageContext: (context) => set({ pageContext: context }),

      connectAndSend: (content, context) => {
        const state = get();
        if (state.connected && client) {
          state.sendMessage(content, context);
        } else {
          // Connect first, queue message for delivery on connect
          state.connect();
          let safetyTimeout: ReturnType<typeof setTimeout> | null = null;

          const unsub = useAgentStore.subscribe((s) => {
            if (s.connected) {
              unsub();
              if (safetyTimeout) clearTimeout(safetyTimeout);
              s.sendMessage(content, context);
            }
          });

          safetyTimeout = setTimeout(() => {
            unsub();
            console.warn('Agent connection timed out after 15s — message not sent');
          }, 15000);
        }
      },

      connect: () => {
        // If already connected with correct mode, skip reconnection
        if (client && get().connected && client.connected) return;
        if (unsubscribe) unsubscribe();
        if (client) client.disconnect();
        client = new AgentClient(get().mode);

        unsubscribe = client.on((event: AgentEvent) => {
          switch (event.type) {
            case 'connected':
              set({ connected: true, error: null });
              break;
            case 'disconnected':
              resetStreamingState();
              notifyPlanStore('fail');
              // The agent keeps proposals per connection: a new one cannot approve them.
              set({ pendingProposals: [] });
              // If we were mid-stream, save partial response as a message
              if (get().streaming) {
                const partial = get().streamingText;
                if (partial) {
                  const msg: AgentMessage = {
                    id: makeId(),
                    role: 'assistant',
                    content: partial + '\n\n*(connection lost)*',
                    timestamp: Date.now(),
                  };
                  set((s) => ({
                    connected: false,
                    messages: trimMessages([...s.messages, msg]),
                    streaming: false,
                    streamingText: '',
                    thinkingText: '',
                    activeTools: [],
                    activeSkills: [],
                    streamingComponents: [],
                  }));
                } else {
                  set({
                    connected: false,
                    streaming: false,
                    streamingText: '',
                    thinkingText: '',
                    activeTools: [],
                    activeSkills: [],
                    streamingComponents: [],
                  });
                }
              } else {
                set({ connected: false });
              }
              break;
            case 'text_delta':
              pendingTextDelta += event.text;
              scheduleDeltaFlush(set);
              break;
            case 'thinking_delta':
              pendingThinkingDelta += event.thinking;
              scheduleDeltaFlush(set);
              break;
            case 'tool_use':
              set((s) => ({ activeTools: [...s.activeTools, event.tool] }));
              break;
            case 'component':
              set((s) => ({ streamingComponents: [...s.streamingComponents, event.spec] }));
              break;
            case 'multi_skill_start':
              set({ activeSkills: event.skills, completedTools: new Set(), completedSkills: new Set() });
              break;
            case 'skill_progress':
              if (event.status === 'tool_use' && event.tool) {
                const toolLabel = `${event.skill}:${event.tool}`;
                set((s) => ({ activeTools: [...s.activeTools, toolLabel] }));
              } else if (event.status === 'tool_complete' && event.tool) {
                const toolLabel = `${event.skill}:${event.tool}`;
                set((s) => {
                  const next = new Set(s.completedTools);
                  next.add(toolLabel);
                  return { completedTools: next };
                });
              } else if (event.status === 'complete') {
                set((s) => {
                  const next = new Set(s.completedSkills);
                  next.add(event.skill);
                  return { completedSkills: next };
                });
              }
              break;
            case 'confirm_request':
              // The agent writes to the cluster it runs on, whatever the UI shows.
              set({ pendingConfirm: { tool: event.tool, input: event.input, nonce: event.nonce, preview: event.preview, clusterId: LOCAL_CLUSTER_ID, requestedOnClusterId: getActiveClusterId() } });
              break;
            case 'write_proposal':
              set((s) => ({
                pendingProposals: [
                  ...s.pendingProposals.filter((p) => p.id !== event.id),
                  {
                    id: event.id, tool: event.tool, input: event.input, nonce: event.nonce, preview: event.preview,
                    namespace: event.namespace, expiresAt: event.expiresAt,
                    clusterId: LOCAL_CLUSTER_ID, requestedOnClusterId: getActiveClusterId(),
                  },
                ],
              }));
              break;
            case 'proposal_resolved': {
              set((s) => ({ pendingProposals: s.pendingProposals.filter((p) => p.id !== event.id) }));
              // applied/failed: the turn that checks it is streaming now. rejected: nothing to say.
              // Otherwise nothing ran and no turn follows.
              if (event.status !== 'applied' && event.status !== 'failed' && event.status !== 'rejected') {
                resetStreamingState();
                set({
                  streaming: false,
                  activeTools: [],
                  error: event.message || 'That proposal is no longer open. Nothing ran.',
                });
              }
              break;
            }
            case 'done': {
              // Flush any remaining deltas then reset accumulators
              flushDeltas(set);
              resetStreamingState();
              const components = get().streamingComponents.map(truncateForPersistence);
              const msg: AgentMessage = {
                id: makeId(),
                role: 'assistant',
                content: event.full_response,
                timestamp: Date.now(),
                components: components.length > 0 ? components : undefined,
                skillName: event.skill_name,
                toolCount: event.tool_count,
                durationMs: event.duration_ms,
                inputTokens: event.input_tokens,
                outputTokens: event.output_tokens,
                multiSkill: event.multi_skill,
              };
              set((s) => ({
                messages: trimMessages([...s.messages, msg]),
                streaming: false,
                streamingText: '',
                thinkingText: '',
                activeTools: [],
                activeSkills: [],
                streamingComponents: [],
                pendingConfirm: null,
              }));
              notifyPlanStore('complete');
              break;
            }
            case 'error':
              flushDeltas(set);
              resetStreamingState();
              handleAuthError(event.message);
              set({
                error: event.message,
                streaming: false,
                streamingText: '',
                thinkingText: '',
                activeTools: [],
                activeSkills: [],
                streamingComponents: [],
              });
              notifyPlanStore('fail');
              break;
            case 'feedback_ack': {
              const toast = event.runbookExtracted
                ? `Feedback recorded (score: ${event.score.toFixed(2)}) — runbook extracted!`
                : `Feedback recorded (score: ${event.score.toFixed(2)})`;
              set({ feedbackToast: toast });
              setTimeout(() => set({ feedbackToast: null }), 4000);
              break;
            }
            case 'view_spec':
              set({ pendingViewSpec: event.spec });
              break;
            case 'view_validation_warning': {
              // The agent saves a view that failed validation (so it can be
              // critiqued and fixed) and says so; the UI dropped the message
              // and showed the view as if it were fine.
              const problems = event.errors ?? [];
              if (problems.length > 0) {
                import('../store/uiStore').then(({ useUIStore }) => {
                  useUIStore.getState().addToast({
                    type: 'warning',
                    title: 'The dashboard was saved with problems',
                    detail: problems.slice(0, 3).join(' · ') + (problems.length > 3 ? ` (+${problems.length - 3} more)` : ''),
                    duration: 8000,
                  });
                });
              }
              break;
            }
            case 'view_updated':
              // Agent modified a view — reload views to pick up changes
              import('../store/customViewStore').then(({ useCustomViewStore }) => {
                useCustomViewStore.getState().loadViews();
              });
              break;
            case 'session_expired':
              import('../store/uiStore').then(({ useUIStore }) => {
                useUIStore.getState().addDegradedReason('session_expired');
              });
              break;
            case 'cleared':
              set({ messages: [], streamingText: '', thinkingText: '', activeTools: [], activeSkills: [], streamingComponents: [] });
              break;
          }
        });

        client.connect();
      },

      disconnect: () => {
        resetStreamingState();
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        if (client) { client.disconnect(); client = null; }
        set({ connected: false, streaming: false, streamingText: '', thinkingText: '', activeTools: [], activeSkills: [], streamingComponents: [] });
      },

      sendMessage: (content, context, fleetMode) => {
        if (context && getActiveClusterId() !== 'local') {
          set({ error: 'Resource-context chat is available only for the cluster where this agent is deployed. Switch to Local Cluster to use it.' });
          return;
        }
        if (!client) {
          set({ error: 'Agent not connected — try again in a moment' });
          return;
        }
        resetStreamingState();

        const userMsg: AgentMessage = {
          id: makeId(),
          role: 'user',
          content,
          timestamp: Date.now(),
          context,
        };

        set((s) => ({
          messages: trimMessages([...s.messages, userMsg]),
          streaming: true,
          streamingText: '',
          thinkingText: '',
          activeTools: [],
          activeSkills: [],
          streamingComponents: [],
          error: null,
        }));

        const { communicationStyle } = useTrustStore.getState();
        client.send(content, context, fleetMode, { communicationStyle });
      },

      switchMode: (mode) => {
        resetStreamingState();
        set({ mode, messages: [], streamingText: '', thinkingText: '', activeTools: [], activeSkills: [], streamingComponents: [] });
        if (client) client.switchMode(mode);
      },

      clearChat: () => {
        pendingTextDelta = '';
        resetStreamingState();
        set({ messages: [], streamingText: '', thinkingText: '', activeTools: [], activeSkills: [], streamingComponents: [], error: null, pendingProposals: [] });
        if (client) client.clear();
      },

      confirmAction: (approved) => {
        const pending = get().pendingConfirm;
        const nonce = pending?.nonce;
        // An approval given after switching clusters was made looking at a
        // different cluster than the one the request was shown on: decline.
        const active = getActiveClusterId();
        if (approved && pending?.requestedOnClusterId && pending.requestedOnClusterId !== active) {
          set({ pendingConfirm: null, error: clusterChangedMessage(pending.requestedOnClusterId, active, `${pending.tool}`) });
          if (client) client.confirm(false, nonce);
          return;
        }
        set({ pendingConfirm: null });
        if (client) client.confirm(approved, nonce);
      },

      answerProposal: (id, approved) => {
        const proposal = get().pendingProposals.find((p) => p.id === id);
        if (!proposal || !client) return;
        if (!approved) {
          set((s) => ({ pendingProposals: s.pendingProposals.filter((p) => p.id !== id) }));
          client.rejectProposal(id);
          return;
        }
        // Same rule as a confirmation: an approval given while looking at
        // another cluster was not made about the cluster the write lands on.
        const active = getActiveClusterId();
        if (proposal.requestedOnClusterId && proposal.requestedOnClusterId !== active) {
          set({ error: clusterChangedMessage(proposal.requestedOnClusterId, active, proposal.tool) });
          return;
        }
        if (get().streaming) {
          set({ error: 'Wait for Pulse to finish answering, then approve.' });
          return;
        }
        if (!client.approveProposal(id, proposal.nonce)) {
          set({ error: 'Agent not connected — the proposal could not be approved. Nothing ran.' });
          return;
        }
        resetStreamingState();
        const userMsg: AgentMessage = {
          id: makeId(),
          role: 'user',
          content: `Approved: ${proposal.tool} in ${proposal.namespace}`,
          timestamp: Date.now(),
        };
        set((s) => ({
          pendingProposals: s.pendingProposals.filter((p) => p.id !== id),
          messages: trimMessages([...s.messages, userMsg]),
          streaming: true,
          streamingText: '',
          thinkingText: '',
          activeTools: [],
          activeSkills: [],
          streamingComponents: [],
          error: null,
        }));
      },

      sendFeedback: (resolved: boolean, messageId?: string) => {
        if (client) client.sendFeedback(resolved, messageId);
      },

      cancelQuery: () => {
        resetStreamingState();
        notifyPlanStore('fail');
        if (client) {
          client.disconnect();
        }
        const partial = get().streamingText;
        if (partial) {
          const msg: AgentMessage = {
            id: makeId(),
            role: 'assistant',
            content: partial + '\n\n*(cancelled)*',
            timestamp: Date.now(),
            components: get().streamingComponents.length > 0
              ? get().streamingComponents.map(truncateForPersistence)
              : undefined,
          };
          set((s) => ({
            messages: trimMessages([...s.messages, msg]),
            streaming: false,
            streamingText: '',
            thinkingText: '',
            activeTools: [],
            activeSkills: [],
            streamingComponents: [],
            pendingConfirm: null,
          }));
        } else {
          set({
            streaming: false,
            streamingText: '',
            thinkingText: '',
            activeTools: [],
            activeSkills: [],
            streamingComponents: [],
            pendingConfirm: null,
          });
        }
        get().connect();
      },

      editLastMessage: () => {
        const messages = get().messages;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            const content = messages[i].content;
            set({ messages: messages.slice(0, i) });
            if (client) client.clear();
            return content;
          }
        }
        return '';
      },
    }),
    {
      name: 'openshiftpulse-agent',
      version: 1,
      partialize: (state) => ({
        messages: state.messages.slice(-50), // Only persist last 50 messages
        mode: state.mode,
      }),
      // v0 -> v1: 'sre' and 'security' were removed from the agent's WebSocket
      // API (only /ws/agent and /ws/monitor remain — see pulse-agent#fcce7b0).
      // Browsers that persisted mode: 'sre' before that migration would otherwise
      // reconnect to the now-403'ing endpoint forever ("Pulse AI: Offline").
      migrate: (persistedState) => {
        const state = persistedState as { messages: AgentMessage[]; mode: AgentMode } | undefined;
        if (state && ((state.mode as string) === 'sre' || (state.mode as string) === 'security')) {
          return { ...state, mode: 'auto' as AgentMode };
        }
        return state;
      },
    },
  ),
);
