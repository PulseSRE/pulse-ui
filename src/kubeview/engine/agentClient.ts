/**
 * Agent WebSocket client — connects to the Pulse Agent API server.
 *
 * Handles streaming text, thinking, tool use events, and confirmation
 * requests over a persistent WebSocket connection.
 */

import type { ComponentSpec } from './agentComponents';

export type AgentMode = 'sre' | 'security';

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Resource context passed from Pulse UI */
  context?: ResourceContext;
  /** Structured UI components from tool results */
  components?: ComponentSpec[];
}

export interface ResourceContext {
  kind: string;
  name: string;
  namespace?: string;
  gvr?: string;
}

export interface ConfirmRequest {
  tool: string;
  input: Record<string, unknown>;
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'tool_use'; tool: string }
  | { type: 'component'; spec: ComponentSpec; tool: string }
  | { type: 'confirm_request'; tool: string; input: Record<string, unknown> }
  | { type: 'done'; full_response: string }
  | { type: 'error'; message: string }
  | { type: 'cleared' }
  | { type: 'connected' }
  | { type: 'disconnected' };

type EventHandler = (event: AgentEvent) => void;

const AGENT_BASE = '/api/agent';
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

export class AgentClient {
  private ws: WebSocket | null = null;
  private mode: AgentMode;
  private handlers: Set<EventHandler> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  constructor(mode: AgentMode = 'sre') {
    this.mode = mode;
  }

  get connected(): boolean {
    return this._connected;
  }

  /** Subscribe to agent events. Returns unsubscribe function. */
  on(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: AgentEvent) {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (e) {
        console.error('Agent event handler error:', e);
      }
    }
  }

  /** Connect to the agent WebSocket. */
  connect() {
    if (this.ws) this.disconnect();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}${AGENT_BASE}/ws/${this.mode}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectAttempts = 0;
      this.emit({ type: 'connected' });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as AgentEvent;
        this.emit(data);
      } catch {
        console.error('Failed to parse agent message:', event.data);
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.emit({ type: 'disconnected' });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY * this.reconnectAttempts + Math.random() * 1000);
  }

  /** Disconnect and stop reconnecting. */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // prevent reconnect
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  /** Send a chat message to the agent. */
  send(content: string, context?: ResourceContext) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit({ type: 'error', message: 'Not connected to agent' });
      return;
    }
    const payload: Record<string, unknown> = { type: 'message', content };
    if (context) payload.context = context;
    this.ws.send(JSON.stringify(payload));
  }

  /** Respond to a confirmation request. */
  confirm(approved: boolean) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'confirm_response', approved }));
  }

  /** Clear conversation history on the server. */
  clear() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'clear' }));
  }

  /** Switch agent mode (reconnects). */
  switchMode(mode: AgentMode) {
    this.mode = mode;
    this.reconnectAttempts = 0;
    this.connect();
  }
}
