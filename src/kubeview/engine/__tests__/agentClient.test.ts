// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentClient } from '../agentClient';

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000 });
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);

// Mock fetch for version check
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ protocol: '1', agent: '0.3.0', tools: 54, features: [] }),
}));

describe('AgentClient', () => {
  let client: AgentClient;

  beforeEach(() => {
    client = new AgentClient('sre');
  });

  afterEach(() => {
    client.disconnect();
  });

  it('creates with default mode', () => {
    expect(client.connected).toBe(false);
  });

  it('defaults to auto mode and connects to /ws/agent, not the removed /ws/sre endpoint', async () => {
    // Regression test: the agent's WebSocket API removed /ws/sre and /ws/security
    // (only /ws/agent and /ws/monitor remain). AgentClient must never default to
    // 'sre', or every consumer that omits an explicit mode gets a 403 at connect.
    const defaultClient = new AgentClient();
    defaultClient.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws = (defaultClient as any).ws as MockWebSocket;
    expect(ws.url).toContain('/ws/agent');
    expect(ws.url).not.toContain('/ws/sre');
    defaultClient.disconnect();
  });

  it('connects and emits connected event', async () => {
    const events: string[] = [];
    client.on((e) => events.push(e.type));
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toContain('connected');
    expect(client.connected).toBe(true);
  });

  it('sends messages as JSON', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    client.send('Check cluster health');
    // Access the mock WS
    const ws = (client as any).ws as MockWebSocket;
    expect(ws.sent).toHaveLength(1);
    const parsed = JSON.parse(ws.sent[0]);
    expect(parsed.type).toBe('message');
    expect(parsed.content).toBe('Check cluster health');
  });

  it('sends messages with context', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    client.send('Diagnose', { kind: 'Pod', name: 'nginx-1', namespace: 'default' });
    const ws = (client as any).ws as MockWebSocket;
    const parsed = JSON.parse(ws.sent[0]);
    expect(parsed.context).toEqual({ kind: 'Pod', name: 'nginx-1', namespace: 'default' });
  });

  it('sends confirmation response', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    client.confirm(true);
    const ws = (client as any).ws as MockWebSocket;
    const parsed = JSON.parse(ws.sent[0]);
    expect(parsed.type).toBe('confirm_response');
    expect(parsed.approved).toBe(true);
  });

  it('sends clear command', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    client.clear();
    const ws = (client as any).ws as MockWebSocket;
    const parsed = JSON.parse(ws.sent[0]);
    expect(parsed.type).toBe('clear');
  });

  it('emits events from WebSocket messages', async () => {
    const events: any[] = [];
    client.on((e) => events.push(e));
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    const ws = (client as any).ws as MockWebSocket;
    ws.onmessage?.({ data: JSON.stringify({ type: 'text_delta', text: 'Hello' }) });

    expect(events).toContainEqual({ type: 'text_delta', text: 'Hello' });
  });

  it('emits disconnected on close', async () => {
    const events: string[] = [];
    client.on((e) => events.push(e.type));
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    client.disconnect();
    expect(events).toContain('disconnected');
  });

  it('switchMode reconnects with new mode', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    client.switchMode('security');
    await new Promise((r) => setTimeout(r, 10));

    const ws = (client as any).ws as MockWebSocket;
    expect(ws.url).toContain('/security');
  });

  it('unsubscribe removes handler', async () => {
    const events: string[] = [];
    const unsub = client.on((e) => events.push(e.type));
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    unsub();
    const ws = (client as any).ws as MockWebSocket;
    ws.onmessage?.({ data: JSON.stringify({ type: 'text_delta', text: 'x' }) });

    // Only connected event, no text_delta
    expect(events).toEqual(['connected']);
  });

  it('emits error when sending without connection', () => {
    const events: any[] = [];
    client.on((e) => events.push(e));
    client.send('hello');
    expect(events).toContainEqual({ type: 'error', message: 'Not connected to agent' });
  });
});
