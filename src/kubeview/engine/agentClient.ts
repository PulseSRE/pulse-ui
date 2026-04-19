/**
 * Agent WebSocket client — connects to the Pulse Agent API server.
 *
 * Supported Protocol Versions: 1, 2 (see API_CONTRACT.md for full specification)
 *
 * Handles streaming text, thinking, tool use events, and confirmation
 * requests over a persistent WebSocket connection.
 */

import type { ComponentSpec } from './agentComponents';

export type AgentMode = 'sre' | 'security' | 'monitor' | 'auto';

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Resource context passed from Pulse UI */
  context?: ResourceContext;
  /** Structured UI components from tool results */
  components?: ComponentSpec[];
  /** Skill that handled this message (from done event) */
  skillName?: string;
  /** Number of tools invoked during this response */
  toolCount?: number;
  /** Total response time in milliseconds */
  durationMs?: number;
  /** Input tokens consumed */
  inputTokens?: number;
  /** Output tokens generated */
  outputTokens?: number;
  /** Multi-skill metadata when parallel skills ran */
  multiSkill?: MultiSkillMeta;
}

export interface ResourceContext {
  kind: string;
  name: string;
  namespace?: string;
  gvr?: string;
  viewId?: string;
}

export interface ConfirmRequest {
  tool: string;
  input: Record<string, unknown>;
  nonce: string;
}

export interface SkillConflict {
  topic: string;
  skill_a: string;
  position_a: string;
  skill_b: string;
  position_b: string;
}

export interface MultiSkillMeta {
  skills: string[];
  conflicts: SkillConflict[];
  empty_skill?: string;
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'tool_use'; tool: string }
  | { type: 'component'; spec: ComponentSpec; tool: string }
  | { type: 'confirm_request'; tool: string; input: Record<string, unknown>; nonce: string }
  | { type: 'done'; full_response: string; skill_name?: string; tool_count?: number; duration_ms?: number; input_tokens?: number; output_tokens?: number; multi_skill?: MultiSkillMeta }
  | { type: 'error'; message: string }
  | { type: 'multi_skill_start'; skills: string[] }
  | { type: 'skill_progress'; skill: string; status: string; tool?: string }
  | { type: 'feedback_ack'; resolved: boolean; score: number; runbookExtracted: boolean }
  | { type: 'view_spec'; spec: import('./agentComponents').ViewSpec }
  | { type: 'view_updated'; viewId: string }
  | { type: 'cleared' }
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'finding'; id: string; severity: string; category: string; title: string; summary: string; resources: Array<{ kind: string; name: string; namespace?: string }>; autoFixable: boolean; runbookId?: string; timestamp: number }
  | { type: 'action_report'; id: string; findingId: string; tool: string; status: string; beforeState?: string; afterState?: string; error?: string; timestamp: number }
  | { type: 'prediction'; id: string; category: string; title: string; detail: string; eta: string; confidence: number; resources: Array<{ kind: string; name: string; namespace?: string }>; recommendedAction?: string; timestamp: number }
  | { type: 'monitor_status'; activeWatches: string[]; lastScan: number; findingsCount: number; nextScan: number };

type EventHandler = (event: AgentEvent) => void;

const AGENT_BASE = '/api/agent';
const SUPPORTED_PROTOCOLS = ['1', '2'];
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

  /** Check agent version compatibility before connecting. */
  async checkVersion(): Promise<{ compatible: boolean; protocol?: string; error?: string }> {
    try {
      const res = await fetch(`${AGENT_BASE}/version`);
      if (!res.ok) return { compatible: true, protocol: '1' }; // Old agent without /version — allow
      const data = await res.json();
      const protocol = String(data.protocol);
      if (!SUPPORTED_PROTOCOLS.includes(protocol)) {
        return { compatible: false, error: `Agent protocol v${protocol} is not supported by this UI (supported: v${SUPPORTED_PROTOCOLS.join(', v')}). Redeploy the agent.` };
      }
      return { compatible: true, protocol };
    } catch {
      return { compatible: false, error: 'Cannot reach agent API. Is the pulse-agent pod running?' };
    }
  }

  /** Connect to the agent WebSocket. */
  connect() {
    if (this.ws) this.disconnect();

    // Check version first (non-blocking — connects anyway but warns)
    this.checkVersion().then(({ compatible, error }) => {
      if (!compatible && error) {
        this.emit({ type: 'error', message: error });
      }
    });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPath = this.mode === 'auto' ? 'agent' : this.mode;
    const url = `${protocol}//${window.location.host}${AGENT_BASE}/ws/${wsPath}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectAttempts = 0;
      this.emit({ type: 'connected' });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data || typeof data !== 'object' || !('type' in data) || typeof data.type !== 'string') {
          console.warn('Invalid agent event:', data);
          return;
        }
        this.emit(data as AgentEvent);
      } catch {
        console.error('Failed to parse agent message:', event.data);
      }
    };

    this.ws.onclose = (event) => {
      this._connected = false;
      if (event.code === 4001) {
        // Auth failure — token mismatch or missing
        this.emit({ type: 'error', message: 'Agent authentication failed (code 4001). The WebSocket token may not be configured correctly. Try redeploying.' });
      }
      this.emit({ type: 'disconnected' });
      if (event.code !== 4001) {
        this.scheduleReconnect();
      }
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
  send(content: string, context?: ResourceContext, fleetMode?: boolean, preferences?: { communicationStyle?: string }) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit({ type: 'error', message: 'Not connected to agent' });
      return;
    }
    const payload: Record<string, unknown> = { type: 'message', content };
    if (context) payload.context = context;
    if (fleetMode) payload.fleet = true;
    if (preferences) payload.preferences = preferences;
    this.ws.send(JSON.stringify(payload));
  }

  /** Respond to a confirmation request. Nonce must match the confirm_request. */
  confirm(approved: boolean, nonce?: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: Record<string, unknown> = { type: 'confirm_response', approved };
    if (nonce) msg.nonce = nonce;
    this.ws.send(JSON.stringify(msg));
  }

  /** Clear conversation history on the server. */
  clear() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'clear' }));
  }

  /** Send feedback on a response (thumbs up/down). Triggers memory learning. */
  sendFeedback(resolved: boolean, messageId?: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload: Record<string, unknown> = { type: 'feedback', resolved };
    if (messageId) payload.messageId = messageId;
    this.ws.send(JSON.stringify(payload));
  }

  /** Switch agent mode (reconnects). */
  switchMode(mode: AgentMode) {
    this.mode = mode;
    this.reconnectAttempts = 0;
    this.connect();
  }
}
