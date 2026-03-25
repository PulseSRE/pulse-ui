// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the watch manager before importing the hook
vi.mock('../../engine/watch', () => ({
  watchManager: {
    watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
  },
}));

// Mock k8sList — the core data fetcher
const k8sListMock = vi.fn();
vi.mock('../../engine/query', () => ({
  k8sList: (...args: any[]) => k8sListMock(...args),
}));

// Mock uiStore
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = { setConnectionStatus: vi.fn() };
    return selector(state);
  },
}));

import { useK8sListWatch } from '../useK8sListWatch';
import { watchManager } from '../../engine/watch';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useK8sListWatch', () => {
  beforeEach(() => {
    k8sListMock.mockReset();
    vi.mocked(watchManager.watch).mockReset();
    vi.mocked(watchManager.watch).mockReturnValue({ unsubscribe: vi.fn() });
  });

  afterEach(() => {
    cleanup();
  });

  it('returns data from k8sList', async () => {
    const pods = [
      { metadata: { name: 'pod-1', uid: 'uid-1' }, kind: 'Pod' },
      { metadata: { name: 'pod-2', uid: 'uid-2' }, kind: 'Pod' },
    ];
    k8sListMock.mockResolvedValue(pods);

    const { result } = renderHook(
      () => useK8sListWatch({ apiPath: '/api/v1/pods' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(pods);
    expect(k8sListMock).toHaveBeenCalledWith('/api/v1/pods', undefined, undefined);
  });

  it('passes namespace to k8sList', async () => {
    k8sListMock.mockResolvedValue([]);

    const { result } = renderHook(
      () => useK8sListWatch({ apiPath: '/api/v1/pods', namespace: 'kube-system' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(k8sListMock).toHaveBeenCalledWith('/api/v1/pods', 'kube-system', undefined);
  });

  it('starts in loading state', () => {
    k8sListMock.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(
      () => useK8sListWatch({ apiPath: '/api/v1/pods' }),
      { wrapper: createWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns error when k8sList rejects', async () => {
    k8sListMock.mockRejectedValue(new Error('403 Forbidden'));

    const { result } = renderHook(
      () => useK8sListWatch({ apiPath: '/api/v1/secrets' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe('403 Forbidden');
  });

  it('does not fetch when enabled is false', async () => {
    k8sListMock.mockResolvedValue([]);

    const { result } = renderHook(
      () => useK8sListWatch({ apiPath: '/api/v1/pods', enabled: false }),
      { wrapper: createWrapper() },
    );

    // Give it a tick
    await new Promise((r) => setTimeout(r, 50));
    expect(k8sListMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('opens a watch subscription', async () => {
    k8sListMock.mockResolvedValue([]);

    renderHook(
      () => useK8sListWatch({ apiPath: '/api/v1/pods' }),
      { wrapper: createWrapper() },
    );

    expect(watchManager.watch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(watchManager.watch).mock.calls[0][0]).toBe('/api/v1/pods');
  });

  it('does not open watch when enabled is false', () => {
    k8sListMock.mockResolvedValue([]);

    renderHook(
      () => useK8sListWatch({ apiPath: '/api/v1/pods', enabled: false }),
      { wrapper: createWrapper() },
    );

    expect(watchManager.watch).not.toHaveBeenCalled();
  });

  it('unsubscribes watch on unmount', () => {
    const unsubscribe = vi.fn();
    vi.mocked(watchManager.watch).mockReturnValue({ unsubscribe });
    k8sListMock.mockResolvedValue([]);

    const { unmount } = renderHook(
      () => useK8sListWatch({ apiPath: '/api/v1/pods' }),
      { wrapper: createWrapper() },
    );

    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('constructs namespaced watch path when namespace is provided', () => {
    k8sListMock.mockResolvedValue([]);

    renderHook(
      () => useK8sListWatch({ apiPath: '/api/v1/pods', namespace: 'production' }),
      { wrapper: createWrapper() },
    );

    expect(watchManager.watch).toHaveBeenCalledTimes(1);
    const watchPath = vi.mocked(watchManager.watch).mock.calls[0][0];
    expect(watchPath).toContain('namespaces');
    expect(watchPath).toContain('production');
  });

  it('does not modify watch path for wildcard namespace', () => {
    k8sListMock.mockResolvedValue([]);

    renderHook(
      () => useK8sListWatch({ apiPath: '/api/v1/pods', namespace: '*' }),
      { wrapper: createWrapper() },
    );

    const watchPath = vi.mocked(watchManager.watch).mock.calls[0][0];
    expect(watchPath).toBe('/api/v1/pods');
  });
});
