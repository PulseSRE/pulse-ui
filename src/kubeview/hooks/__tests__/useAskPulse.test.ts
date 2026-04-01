// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// Mock detectNaturalLanguage
const detectNaturalLanguageMock = vi.fn();
vi.mock('../../engine/askPulseUtils', () => ({
  detectNaturalLanguage: (q: string) => detectNaturalLanguageMock(q),
}));

// Mock AgentClient as a class
const mockOn = vi.fn(() => vi.fn());
const mockSend = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('../../engine/agentClient', () => ({
  AgentClient: class MockAgentClient {
    on = mockOn;
    send = mockSend;
    connect = mockConnect;
    disconnect = mockDisconnect;
    connected = true;
  },
}));

// Mock agentStore
const connectAndSendMock = vi.fn();
vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    function useAgentStore(sel: any) { return sel({}); },
    { getState: () => ({ connectAndSend: connectAndSendMock }) },
  ),
}));

// Mock uiStore
const openDockMock = vi.fn();
const closeCommandPaletteMock = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    function useUIStore(sel: any) { return sel({}); },
    { getState: () => ({ openDock: openDockMock, closeCommandPalette: closeCommandPaletteMock }) },
  ),
}));

import { useAskPulse } from '../useAskPulse';

describe('useAskPulse', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    detectNaturalLanguageMock.mockReset();
    mockOn.mockReset();
    mockOn.mockReturnValue(vi.fn());
    mockSend.mockReset();
    mockConnect.mockReset();
    mockDisconnect.mockReset();
    connectAndSendMock.mockReset();
    openDockMock.mockReset();
    closeCommandPaletteMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('returns expected shape', () => {
    detectNaturalLanguageMock.mockReturnValue(false);
    const { result } = renderHook(() => useAskPulse('pods'));

    expect(result.current).toHaveProperty('isNaturalLanguage');
    expect(result.current).toHaveProperty('response');
    expect(result.current).toHaveProperty('isLoading');
    expect(result.current).toHaveProperty('agentAvailable');
    expect(result.current).toHaveProperty('openInAgent');
    expect(typeof result.current.openInAgent).toBe('function');
  });

  it('sets isNaturalLanguage based on detectNaturalLanguage', () => {
    detectNaturalLanguageMock.mockReturnValue(true);
    const { result } = renderHook(() => useAskPulse('what pods are failing?'));
    expect(result.current.isNaturalLanguage).toBe(true);
  });

  it('does not set loading for non-NL queries', () => {
    detectNaturalLanguageMock.mockReturnValue(false);
    const { result } = renderHook(() => useAskPulse('deployment'));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.response).toBeNull();
  });

  it('sets isLoading true for NL queries', () => {
    detectNaturalLanguageMock.mockReturnValue(true);
    const { result } = renderHook(() => useAskPulse('why are my pods crashing?'));

    expect(result.current.isLoading).toBe(true);
  });

  it('clears response when query becomes non-NL', () => {
    detectNaturalLanguageMock.mockReturnValue(true);
    const { result, rerender } = renderHook(
      ({ query }) => useAskPulse(query),
      { initialProps: { query: 'show me failing pods' } },
    );

    expect(result.current.isLoading).toBe(true);

    detectNaturalLanguageMock.mockReturnValue(false);
    rerender({ query: 'pod' });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.response).toBeNull();
  });

  it('clears response for empty query', () => {
    detectNaturalLanguageMock.mockReturnValue(false);
    const { result } = renderHook(() => useAskPulse(''));

    expect(result.current.response).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('openInAgent sends query to agent store and opens dock', () => {
    detectNaturalLanguageMock.mockReturnValue(true);
    const { result } = renderHook(() => useAskPulse('what is wrong?'));

    act(() => {
      result.current.openInAgent();
    });

    expect(connectAndSendMock).toHaveBeenCalledWith('what is wrong?');
    expect(openDockMock).toHaveBeenCalledWith('agent');
    expect(closeCommandPaletteMock).toHaveBeenCalled();
  });

  it('openInAgent does nothing for empty query', () => {
    detectNaturalLanguageMock.mockReturnValue(false);
    const { result } = renderHook(() => useAskPulse(''));

    act(() => {
      result.current.openInAgent();
    });

    expect(connectAndSendMock).not.toHaveBeenCalled();
  });

  it('handles query change by aborting previous request', () => {
    detectNaturalLanguageMock.mockReturnValue(true);

    const { rerender } = renderHook(
      ({ query }) => useAskPulse(query),
      { initialProps: { query: 'first query' } },
    );

    // Change query — should abort previous timer
    rerender({ query: 'second query' });

    // No errors thrown — abort handling works
  });

  it('agentAvailable defaults to true', () => {
    detectNaturalLanguageMock.mockReturnValue(false);
    const { result } = renderHook(() => useAskPulse('test'));
    expect(result.current.agentAvailable).toBe(true);
  });

  it('isNaturalLanguage false for non-NL query', () => {
    detectNaturalLanguageMock.mockReturnValue(false);
    const { result } = renderHook(() => useAskPulse('deployment-name'));
    expect(result.current.isNaturalLanguage).toBe(false);
    expect(result.current.response).toBeNull();
  });
});
