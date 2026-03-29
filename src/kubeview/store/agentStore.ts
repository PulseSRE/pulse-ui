/**
 * Agent Store — manages chat state for the Pulse Agent integration.
 * Messages persist to localStorage so conversation survives navigation.
 * Streaming deltas are batched via requestAnimationFrame to prevent render thrashing.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  AgentClient,
  type AgentMode,
  type AgentMessage,
  type AgentEvent,
  type ConfirmRequest,
  type ResourceContext,
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
  pendingConfirm: ConfirmRequest | null;
  error: string | null;
  /** True when background health polling found an unread insight */
  hasUnreadInsight: boolean;

  connect: () => void;
  disconnect: () => void;
  sendMessage: (content: string, context?: ResourceContext, fleetMode?: boolean) => void;
  /** Connect (if needed) and send a message — safe replacement for setTimeout race condition */
  connectAndSend: (content: string, context?: ResourceContext) => void;
  switchMode: (mode: AgentMode) => void;
  clearChat: () => void;
  confirmAction: (approved: boolean) => void;
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
      pendingConfirm: null,
      error: null,
      hasUnreadInsight: false,

      setUnreadInsight: (value) => set({ hasUnreadInsight: value }),

      connectAndSend: (content, context) => {
        const state = get();
        if (state.connected && client) {
          state.sendMessage(content, context);
        } else {
          // Connect first, then send once connected
          state.connect();
          const checkInterval = setInterval(() => {
            if (get().connected && client) {
              clearInterval(checkInterval);
              get().sendMessage(content, context);
            }
          }, 50);
          // Safety timeout — don't poll forever
          setTimeout(() => clearInterval(checkInterval), 5000);
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
                    streamingComponents: [],
                  }));
                } else {
                  set({
                    connected: false,
                    streaming: false,
                    streamingText: '',
                    thinkingText: '',
                    activeTools: [],
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
            case 'confirm_request':
              set({ pendingConfirm: { tool: event.tool, input: event.input, nonce: event.nonce } });
              break;
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
              };
              set((s) => ({
                messages: trimMessages([...s.messages, msg]),
                streaming: false,
                streamingText: '',
                thinkingText: '',
                activeTools: [],
                streamingComponents: [],
                pendingConfirm: null,
              }));
              break;
            }
            case 'error':
              flushDeltas(set);
              resetStreamingState();
              set({
                error: event.message,
                streaming: false,
                streamingText: '',
                thinkingText: '',
                activeTools: [],
                streamingComponents: [],
              });
              break;
            case 'cleared':
              set({ messages: [], streamingText: '', thinkingText: '', activeTools: [], streamingComponents: [] });
              break;
          }
        });

        client.connect();
      },

      disconnect: () => {
        resetStreamingState();
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        if (client) { client.disconnect(); client = null; }
        set({ connected: false, streaming: false, streamingText: '', thinkingText: '', activeTools: [], streamingComponents: [] });
      },

      sendMessage: (content, context, fleetMode) => {
        if (!client) return;
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
          streamingComponents: [],
          error: null,
        }));

        client.send(content, context, fleetMode);
      },

      switchMode: (mode) => {
        resetStreamingState();
        set({ mode, messages: [], streamingText: '', thinkingText: '', activeTools: [], streamingComponents: [] });
        if (client) client.switchMode(mode);
      },

      clearChat: () => {
        pendingTextDelta = '';
        resetStreamingState();
        set({ messages: [], streamingText: '', thinkingText: '', activeTools: [], streamingComponents: [], error: null });
        if (client) client.clear();
      },

      confirmAction: (approved) => {
        const nonce = get().pendingConfirm?.nonce;
        set({ pendingConfirm: null });
        if (client) client.confirm(approved, nonce);
      },

      cancelQuery: () => {
        resetStreamingState();
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
            streamingComponents: [],
            pendingConfirm: null,
          }));
        } else {
          set({
            streaming: false,
            streamingText: '',
            thinkingText: '',
            activeTools: [],
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
      partialize: (state) => ({
        messages: state.messages.slice(-50), // Only persist last 50 messages
        mode: state.mode,
      }),
    },
  ),
);
