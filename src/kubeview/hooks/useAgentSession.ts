import { useEffect, useRef, useReducer, useCallback } from 'react';
import { AgentClient } from '../engine/agentClient';
import type { AgentMode, AgentMessage, AgentEvent, ResourceContext, ConfirmRequest } from '../engine/agentClient';
import type { ComponentSpec } from '../engine/agentComponents';

export interface UseAgentSessionOptions {
  mode?: AgentMode;
  autoConnect?: boolean;
  maxMessages?: number;
  context?: ResourceContext;
}

export interface AgentSession {
  connected: boolean;
  messages: AgentMessage[];
  streaming: boolean;
  streamingText: string;
  thinkingText: string;
  activeTools: string[];
  streamingComponents: ComponentSpec[];
  pendingConfirm: ConfirmRequest | null;
  error: string | null;
  send: (content: string) => void;
  confirm: (approved: boolean) => void;
  clear: () => void;
  disconnect: () => void;
}

interface SessionState {
  connected: boolean;
  messages: AgentMessage[];
  streaming: boolean;
  streamingText: string;
  thinkingText: string;
  activeTools: string[];
  streamingComponents: ComponentSpec[];
  pendingConfirm: ConfirmRequest | null;
  error: string | null;
}

type SessionAction =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'user_message'; message: AgentMessage }
  | { type: 'stream_start' }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'tool_use'; tool: string }
  | { type: 'component'; spec: ComponentSpec }
  | { type: 'confirm_request'; tool: string; input: Record<string, unknown>; nonce: string }
  | { type: 'done'; full_response: string; components: ComponentSpec[] }
  | { type: 'error'; message: string }
  | { type: 'clear' };

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'connected':
      return { ...state, connected: true, error: null };
    case 'disconnected':
      return { ...state, connected: false };
    case 'user_message':
      return { ...state, messages: [...state.messages, action.message], streaming: true, streamingText: '', thinkingText: '', activeTools: [], streamingComponents: [], error: null };
    case 'stream_start':
      return { ...state, streaming: true, streamingText: '', thinkingText: '', activeTools: [], streamingComponents: [], error: null };
    case 'text_delta':
      return { ...state, streamingText: state.streamingText + action.text };
    case 'thinking_delta':
      return { ...state, thinkingText: state.thinkingText + action.thinking };
    case 'tool_use':
      return { ...state, activeTools: [...state.activeTools, action.tool] };
    case 'component':
      return { ...state, streamingComponents: [...state.streamingComponents, action.spec] };
    case 'confirm_request':
      return { ...state, pendingConfirm: { tool: action.tool, input: action.input, nonce: action.nonce } };
    case 'done': {
      const assistantMsg: AgentMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: action.full_response,
        timestamp: Date.now(),
        components: action.components.length > 0 ? action.components : undefined,
      };
      const messages = [...state.messages, assistantMsg].slice(-(50));
      return { ...state, messages, streaming: false, streamingText: '', thinkingText: '', activeTools: [], streamingComponents: [], pendingConfirm: null };
    }
    case 'error':
      return { ...state, error: action.message, streaming: false, streamingText: '', thinkingText: '', activeTools: [], streamingComponents: [] };
    case 'clear':
      return { ...initialState, connected: state.connected };
    default:
      return state;
  }
}

const initialState: SessionState = {
  connected: false,
  messages: [],
  streaming: false,
  streamingText: '',
  thinkingText: '',
  activeTools: [],
  streamingComponents: [],
  pendingConfirm: null,
  error: null,
};

/**
 * Scoped agent session hook — each instance creates its own AgentClient
 * and WebSocket connection, independent from the global agentStore.
 *
 * Used by InlineAgent and AmbientInsight for isolated conversations.
 */
export function useAgentSession(options: UseAgentSessionOptions = {}): AgentSession {
  const { mode = 'sre', autoConnect = true, context } = options;
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  const clientRef = useRef<AgentClient | null>(null);

  // RAF batching for text deltas
  const pendingTextRef = useRef('');
  const pendingThinkingRef = useRef('');
  const rafRef = useRef<number | null>(null);
  // Track streaming components for the done handler
  const streamingComponentsRef = useRef<ComponentSpec[]>([]);

  const flushDeltas = useCallback(() => {
    if (pendingTextRef.current) {
      dispatch({ type: 'text_delta', text: pendingTextRef.current });
      pendingTextRef.current = '';
    }
    if (pendingThinkingRef.current) {
      dispatch({ type: 'thinking_delta', thinking: pendingThinkingRef.current });
      pendingThinkingRef.current = '';
    }
    rafRef.current = null;
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flushDeltas);
    }
  }, [flushDeltas]);

  // Create client and subscribe to events
  useEffect(() => {
    const client = new AgentClient(mode);
    clientRef.current = client;

    const unsub = client.on((event: AgentEvent) => {
      switch (event.type) {
        case 'connected':
          dispatch({ type: 'connected' });
          break;
        case 'disconnected':
          dispatch({ type: 'disconnected' });
          break;
        case 'text_delta':
          pendingTextRef.current += event.text;
          scheduleFlush();
          break;
        case 'thinking_delta':
          pendingThinkingRef.current += event.thinking;
          scheduleFlush();
          break;
        case 'tool_use':
          dispatch({ type: 'tool_use', tool: event.tool });
          break;
        case 'component':
          streamingComponentsRef.current = [...streamingComponentsRef.current, event.spec];
          dispatch({ type: 'component', spec: event.spec });
          break;
        case 'confirm_request':
          dispatch({ type: 'confirm_request', tool: event.tool, input: event.input, nonce: event.nonce });
          break;
        case 'done':
          // Flush any remaining deltas
          if (pendingTextRef.current || pendingThinkingRef.current) {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            flushDeltas();
          }
          dispatch({ type: 'done', full_response: event.full_response, components: streamingComponentsRef.current });
          streamingComponentsRef.current = [];
          break;
        case 'error':
          dispatch({ type: 'error', message: event.message });
          break;
        case 'cleared':
          dispatch({ type: 'clear' });
          break;
      }
    });

    if (autoConnect) client.connect();

    return () => {
      unsub();
      client.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [mode, autoConnect, flushDeltas, scheduleFlush]);

  const send = useCallback((content: string) => {
    const client = clientRef.current;
    if (!client) return;

    const userMsg: AgentMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
      context,
    };
    dispatch({ type: 'user_message', message: userMsg });
    streamingComponentsRef.current = [];
    client.send(content, context);
  }, [context]);

  const confirm = useCallback((approved: boolean) => {
    // Nonce must round-trip back to the server -- confirm_response without it
    // (or with a stale one) is rejected as unauthorized/replay by the backend.
    clientRef.current?.confirm(approved, state.pendingConfirm?.nonce);
    if (!approved) {
      dispatch({ type: 'done', full_response: 'Action denied by user.', components: [] });
    }
  }, [state.pendingConfirm]);

  const clear = useCallback(() => {
    clientRef.current?.clear();
    dispatch({ type: 'clear' });
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  return {
    ...state,
    send,
    confirm,
    clear,
    disconnect,
  };
}
