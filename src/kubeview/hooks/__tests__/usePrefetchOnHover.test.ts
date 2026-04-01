// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock k8sList
const k8sListMock = vi.fn();
vi.mock('../../engine/query', () => ({
  k8sList: (...args: any[]) => k8sListMock(...args),
}));

// Mock uiStore
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    function useUIStore(sel: any) { return sel({ selectedNamespace: '*' }); },
    { getState: () => ({ selectedNamespace: 'default' }) },
  ),
}));

import { usePrefetchOnHover } from '../usePrefetchOnHover';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return {
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children),
    qc,
  };
}

describe('usePrefetchOnHover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    k8sListMock.mockReset();
    k8sListMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('returns onMouseEnter, onFocus, and onMouseLeave handlers', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrefetchOnHover('/workloads'), { wrapper });

    expect(typeof result.current.onMouseEnter).toBe('function');
    expect(typeof result.current.onFocus).toBe('function');
    expect(typeof result.current.onMouseLeave).toBe('function');
  });

  it('prefetches data after debounce when onMouseEnter fires', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrefetchOnHover('/compute'), { wrapper });

    act(() => {
      result.current.onMouseEnter();
    });

    // Before debounce, k8sList should not be called
    expect(k8sListMock).not.toHaveBeenCalled();

    // After debounce (150ms)
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // /compute requires /api/v1/nodes and /api/v1/pods
    expect(k8sListMock).toHaveBeenCalledWith('/api/v1/nodes', 'default');
    expect(k8sListMock).toHaveBeenCalledWith('/api/v1/pods', 'default');
  });

  it('cancels prefetch when onMouseLeave fires before debounce', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrefetchOnHover('/compute'), { wrapper });

    act(() => {
      result.current.onMouseEnter();
    });

    // Leave before debounce fires
    act(() => {
      vi.advanceTimersByTime(50);
      result.current.onMouseLeave();
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(k8sListMock).not.toHaveBeenCalled();
  });

  it('handles onFocus the same as onMouseEnter', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrefetchOnHover('/storage'), { wrapper });

    act(() => {
      result.current.onFocus();
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(k8sListMock).toHaveBeenCalledWith('/api/v1/persistentvolumeclaims', 'default');
  });

  it('does not prefetch for unknown paths', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrefetchOnHover('/unknown-view'), { wrapper });

    act(() => {
      result.current.onMouseEnter();
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(k8sListMock).not.toHaveBeenCalled();
  });

  it('handles GVR resource paths like /r/apps~v1~deployments', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrefetchOnHover('/r/apps~v1~deployments'), { wrapper });

    act(() => {
      result.current.onMouseEnter();
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(k8sListMock).toHaveBeenCalledWith('/apis/apps/v1/deployments', 'default');
  });

  it('handles core GVR resource paths like /r/v1~pods', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrefetchOnHover('/r/v1~pods'), { wrapper });

    act(() => {
      result.current.onMouseEnter();
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(k8sListMock).toHaveBeenCalledWith('/api/v1/pods', 'default');
  });

  it('does not prefetch for /alerts (uses Prometheus, not k8sList)', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrefetchOnHover('/alerts'), { wrapper });

    act(() => {
      result.current.onMouseEnter();
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(k8sListMock).not.toHaveBeenCalled();
  });

  it('debounces multiple rapid hovers by resetting timer', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrefetchOnHover('/compute'), { wrapper });

    // Fire multiple hovers rapidly
    act(() => {
      result.current.onMouseEnter();
    });
    act(() => {
      vi.advanceTimersByTime(50);
      result.current.onMouseEnter();
    });
    act(() => {
      vi.advanceTimersByTime(50);
      result.current.onMouseEnter();
    });

    // At this point 100ms have passed since last trigger; advance to 200 past last
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // /compute has 2 API paths — should only be called once per path
    expect(k8sListMock).toHaveBeenCalledTimes(2);
  });
});
