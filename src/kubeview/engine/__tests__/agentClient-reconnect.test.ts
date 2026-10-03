// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AgentClient } from '../agentClient';

class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = Socket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: unknown = null;
  onerror: unknown = null;
  constructor(public url: string) { Socket.instances.push(this); }
  close() { this.readyState = Socket.CLOSED; this.onclose?.({ code: 1000 }); }
  fail() { this.readyState = Socket.CLOSED; this.onclose?.({ code: 1006 }); }
}

describe('chat failed-handshake retries', () => {
  let client: AgentClient;
  beforeEach(() => {
    vi.useFakeTimers();
    Socket.instances = [];
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ protocol: 2 }) }));
    client = new AgentClient();
  });
  afterEach(() => { client.disconnect(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('retries five failed handshakes, then stops', async () => {
    client.connect();
    for (let i = 0; i < 5; i++) {
      Socket.instances.at(-1)!.fail();
      await vi.advanceTimersByTimeAsync(16_000);
      expect(Socket.instances).toHaveLength(i + 2);
    }
    Socket.instances.at(-1)!.fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(Socket.instances).toHaveLength(6);
  });

  it('explicit disconnect cancels a scheduled retry', async () => {
    client.connect();
    Socket.instances[0].fail();
    client.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(Socket.instances).toHaveLength(1);
    expect(client.connected).toBe(false);
  });

  it('late version failure does not emit errors after explicit disconnect', async () => {
    let reject!: (reason: Error) => void;
    vi.stubGlobal('fetch', () => new Promise((_, rejectFn) => { reject = rejectFn; }));
    const events: string[] = [];
    client.on(event => events.push(event.type));
    client.connect();
    client.disconnect();
    reject(new Error('offline'));
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['disconnected']);
  });
});
