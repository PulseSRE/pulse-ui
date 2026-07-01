// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentSession } from '../useAgentSession';

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockSend = vi.fn();
const mockConfirm = vi.fn();
const mockClear = vi.fn();

vi.mock('../../engine/agentClient', () => ({
  AgentClient: class MockAgentClient {
    on(handler: (event: any) => void) {
      (globalThis as any).__agentTestHandler = handler;
      return () => { (globalThis as any).__agentTestHandler = null; };
    }
    connect() { mockConnect(); }
    disconnect() { mockDisconnect(); }
    send(content: string, context?: unknown) { mockSend(content, context); }
    confirm(approved: boolean, nonce?: string) { mockConfirm(approved, nonce); }
    clear() { mockClear(); }
    get connected() { return true; }
  },
}));

function emit(event: any) {
  (globalThis as any).__agentTestHandler?.(event);
}

describe('useAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__agentTestHandler = null;
  });

  it('auto-connects on mount', () => {
    renderHook(() => useAgentSession());
    expect(mockConnect).toHaveBeenCalledOnce();
  });

  it('does not connect when autoConnect=false', () => {
    renderHook(() => useAgentSession({ autoConnect: false }));
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useAgentSession());
    unmount();
    expect(mockDisconnect).toHaveBeenCalledOnce();
  });

  it('tracks connected state', () => {
    const { result } = renderHook(() => useAgentSession());
    expect(result.current.connected).toBe(false);

    act(() => emit({ type: 'connected' }));
    expect(result.current.connected).toBe(true);

    act(() => emit({ type: 'disconnected' }));
    expect(result.current.connected).toBe(false);
  });

  it('sends message and tracks user message', () => {
    const { result } = renderHook(() => useAgentSession());
    act(() => emit({ type: 'connected' }));

    act(() => result.current.send('Hello'));
    expect(mockSend).toHaveBeenCalledWith('Hello', undefined);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.messages[0].content).toBe('Hello');
    expect(result.current.streaming).toBe(true);
  });

  it('sends message with context', () => {
    const context = { kind: 'Pod', name: 'test-pod', namespace: 'default' };
    const { result } = renderHook(() => useAgentSession({ context }));
    act(() => emit({ type: 'connected' }));

    act(() => result.current.send('Check this pod'));
    expect(mockSend).toHaveBeenCalledWith('Check this pod', context);
    expect(result.current.messages[0].context).toEqual(context);
  });

  it('handles done event and creates assistant message', () => {
    const { result } = renderHook(() => useAgentSession());
    act(() => emit({ type: 'connected' }));
    act(() => result.current.send('Hello'));

    act(() => emit({ type: 'done', full_response: 'Agent response' }));
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].role).toBe('assistant');
    expect(result.current.messages[1].content).toBe('Agent response');
    expect(result.current.streaming).toBe(false);
  });

  it('handles error event', () => {
    const { result } = renderHook(() => useAgentSession());
    act(() => emit({ type: 'connected' }));
    act(() => result.current.send('Hello'));

    act(() => emit({ type: 'error', message: 'Connection failed' }));
    expect(result.current.error).toBe('Connection failed');
    expect(result.current.streaming).toBe(false);
  });

  it('handles tool_use event', () => {
    const { result } = renderHook(() => useAgentSession());
    act(() => emit({ type: 'connected' }));
    act(() => result.current.send('Hello'));

    act(() => emit({ type: 'tool_use', tool: 'list_pods' }));
    expect(result.current.activeTools).toContain('list_pods');
  });

  it('handles confirm_request event', () => {
    const { result } = renderHook(() => useAgentSession());
    act(() => emit({ type: 'connected' }));
    act(() => result.current.send('Scale it'));

    act(() => emit({ type: 'confirm_request', tool: 'scale_deployment', input: { name: 'app', replicas: 3 }, nonce: 'abc123' }));
    expect(result.current.pendingConfirm).toEqual({ tool: 'scale_deployment', input: { name: 'app', replicas: 3 }, nonce: 'abc123' });
  });

  it('confirm sends response via client', () => {
    const { result } = renderHook(() => useAgentSession());
    act(() => result.current.confirm(true));
    expect(mockConfirm).toHaveBeenCalledWith(true, undefined);
  });

  it('confirm forwards the pending nonce to the client', () => {
    // Regression: confirm() must round-trip the server-issued nonce, or the
    // backend rejects the response as unauthorized/replay even when the
    // user approved the action.
    const { result } = renderHook(() => useAgentSession());
    act(() => emit({ type: 'connected' }));
    act(() => result.current.send('Scale it'));
    act(() => emit({ type: 'confirm_request', tool: 'scale_deployment', input: {}, nonce: 'nonce-xyz' }));

    act(() => result.current.confirm(true));
    expect(mockConfirm).toHaveBeenCalledWith(true, 'nonce-xyz');
  });

  it('confirm(false) still forwards the pending nonce on denial', () => {
    const { result } = renderHook(() => useAgentSession());
    act(() => emit({ type: 'connected' }));
    act(() => result.current.send('Scale it'));
    act(() => emit({ type: 'confirm_request', tool: 'scale_deployment', input: {}, nonce: 'nonce-deny' }));

    act(() => result.current.confirm(false));
    expect(mockConfirm).toHaveBeenCalledWith(false, 'nonce-deny');
  });

  it('clear resets state and sends clear to client', () => {
    const { result } = renderHook(() => useAgentSession());
    act(() => emit({ type: 'connected' }));
    act(() => result.current.send('Hello'));
    act(() => emit({ type: 'done', full_response: 'Response' }));

    act(() => result.current.clear());
    expect(mockClear).toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it('handles component event', () => {
    const { result } = renderHook(() => useAgentSession());
    act(() => emit({ type: 'connected' }));
    act(() => result.current.send('Hello'));

    const spec = { type: 'key_value' as const, pairs: [{ key: 'test', value: 'val' }] };
    act(() => emit({ type: 'component', spec, tool: 'test_tool' }));
    expect(result.current.streamingComponents).toHaveLength(1);
  });
});
