// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock AgentClient as a class
let lastMockHandlers: Set<(e: any) => void> | null = null;
vi.mock('../../engine/agentClient', () => {
  return {
    AgentClient: class MockAgentClient {
      mode: string;
      connected = false;
      private handlers = new Set<(e: any) => void>();

      constructor(mode: string) {
        this.mode = mode;
        lastMockHandlers = this.handlers;
      }

      on(handler: (e: any) => void) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
      }

      connect() {
        this.connected = true;
        for (const h of this.handlers) h({ type: 'connected' });
      }

      disconnect() {
        this.connected = false;
      }

      send() {}
      confirm() {}
      clear() {}

      switchMode(mode: string) {
        this.mode = mode;
      }
    },
  };
});

function simulateAgentEvent(event: any) {
  if (lastMockHandlers) for (const h of lastMockHandlers) h(event);
}

import { useAgentStore } from '../agentStore';
import { useUIStore } from '../uiStore';

describe('agentStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    const { disconnect } = useAgentStore.getState();
    disconnect();
    useAgentStore.setState({
      mode: 'sre',
      messages: [],
      streaming: false,
      streamingText: '',
      thinkingText: '',
      activeTools: [],
      pendingConfirm: null,
      error: null,
    });
    useUIStore.getState().removeDegradedReason('session_expired');
    lastMockHandlers = null;
  });

  it('migrates a stale persisted "sre" mode to "auto" (removed /ws/sre endpoint)', () => {
    // Regression test: browsers that persisted mode: 'sre' before the agent
    // removed /ws/sre and /ws/security must be healed on load, or the agent
    // panel silently reconnects to a 403'ing endpoint forever ("Offline").
    const migrate = useAgentStore.persist.getOptions().migrate;
    expect(migrate).toBeTypeOf('function');
    expect(migrate!({ mode: 'sre', messages: [] }, 0)).toEqual({ mode: 'auto', messages: [] });
    expect(migrate!({ mode: 'security', messages: [] }, 0)).toEqual({ mode: 'auto', messages: [] });
    // Already-healthy state should pass through unchanged
    expect(migrate!({ mode: 'auto', messages: [] }, 1)).toEqual({ mode: 'auto', messages: [] });
  });

  it('initializes with default state', () => {
    const state = useAgentStore.getState();
    expect(state.mode).toBe('sre');
    expect(state.messages).toEqual([]);
    expect(state.streaming).toBe(false);
    expect(state.connected).toBe(false);
  });

  it('sendMessage adds user message and sets streaming', () => {
    const store = useAgentStore.getState();
    store.connect();
    store.sendMessage('Check health');

    const state = useAgentStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[0].content).toBe('Check health');
    expect(state.streaming).toBe(true);
  });

  it('sendMessage with context includes resource context', () => {
    const store = useAgentStore.getState();
    store.connect();
    store.sendMessage('Diagnose', { kind: 'Pod', name: 'nginx', namespace: 'default' });

    const state = useAgentStore.getState();
    expect(state.messages[0].context).toEqual({ kind: 'Pod', name: 'nginx', namespace: 'default' });
  });

  it('switchMode updates mode and clears messages', () => {
    const store = useAgentStore.getState();
    store.connect();
    store.sendMessage('test');
    store.switchMode('security');

    const state = useAgentStore.getState();
    expect(state.mode).toBe('security');
    expect(state.messages).toEqual([]);
  });

  it('clearChat resets messages', () => {
    const store = useAgentStore.getState();
    store.connect();
    store.sendMessage('test');
    store.clearChat();

    const state = useAgentStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.error).toBeNull();
  });

  it('triggers session_expired on 4001 auth error', () => {
    const store = useAgentStore.getState();
    store.connect();
    expect(useUIStore.getState().degradedReasons.has('session_expired')).toBe(false);

    simulateAgentEvent({
      type: 'error',
      message: 'Agent authentication failed (code 4001). The WebSocket token may not be configured correctly.',
    });

    expect(useUIStore.getState().degradedReasons.has('session_expired')).toBe(true);
    expect(useAgentStore.getState().error).toContain('4001');
  });

  it('does not trigger session_expired on non-auth errors', () => {
    const store = useAgentStore.getState();
    store.connect();

    simulateAgentEvent({
      type: 'error',
      message: 'Tool execution failed: timeout after 30s',
    });

    expect(useUIStore.getState().degradedReasons.has('session_expired')).toBe(false);
    expect(useAgentStore.getState().error).toContain('timeout');
  });
});
