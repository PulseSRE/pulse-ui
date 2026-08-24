// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WatchManager, type WatchEvent } from '../watch';

// Measured live on the dev cluster: the pods/deployments/PVC watches
// reconnected every ~0.5s for hours, each upgrade succeeding (HTTP 101) and
// dying immediately, always resending the same expired resourceVersion. Two
// bugs compounded: the API server reports an expired version as an ERROR
// *event* (Status code 410) followed by a normal close — not close code 1008,
// which is all onclose checked — so the stale version was never cleared; and
// onopen reset the backoff counter, so the always-successful upgrade kept the
// retry delay pinned at 1s forever.

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: '' });
  }

  open() {
    this.onopen?.();
  }

  receive(event: WatchEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

function lastSocket(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

function connectionOf(manager: WatchManager) {
  const connections = (manager as unknown as { connections: Map<string, unknown> }).connections;
  return [...connections.values()][0] as {
    resourceVersion: string;
    reconnectAttempt: number;
  };
}

describe('WatchManager 410 handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clears the stale resourceVersion on a 410 ERROR event and reconnects without it', () => {
    const manager = new WatchManager();
    const events: WatchEvent[] = [];
    manager.watch('/api/v1/pods', (e) => events.push(e), '421076897');

    const ws = lastSocket();
    expect(ws.url).toContain('resourceVersion=421076897');
    ws.open();
    ws.receive({
      type: 'ERROR',
      object: { kind: 'Status', code: 410, message: 'too old resource version: 421076897' },
    });

    // The Status object is not a resource — callbacks must not see it.
    expect(events).toEqual([]);
    expect(connectionOf(manager).resourceVersion).toBe('');

    // The reconnect must not resend the expired version.
    vi.advanceTimersByTime(1100);
    expect(lastSocket()).not.toBe(ws);
    expect(lastSocket().url).not.toContain('resourceVersion=');
  });

  it('backs off exponentially when connections open but die before any event', () => {
    const manager = new WatchManager();
    manager.watch('/api/v1/pods', () => {}, 'stale');

    // Cycle: upgrade succeeds, connection dies eventless. Backoff must grow —
    // resetting it on open is what produced the twice-a-second storm.
    for (let i = 0; i < 3; i++) {
      const ws = lastSocket();
      ws.open();
      ws.close();
      vi.advanceTimersByTime(1000 * Math.pow(2, i) + 50);
    }
    expect(connectionOf(manager).reconnectAttempt).toBe(3);
  });

  it('resets backoff only after a genuine event arrives', () => {
    const manager = new WatchManager();
    manager.watch('/api/v1/pods', () => {}, '');

    const first = lastSocket();
    first.open();
    first.close();
    vi.advanceTimersByTime(1100);

    const second = lastSocket();
    second.open();
    expect(connectionOf(manager).reconnectAttempt).toBe(1); // open alone proves nothing
    second.receive({
      type: 'ADDED',
      object: { metadata: { resourceVersion: '5' } },
    });
    expect(connectionOf(manager).reconnectAttempt).toBe(0);
    expect(connectionOf(manager).resourceVersion).toBe('5');
  });
});
