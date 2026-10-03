// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
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
  useUIStore: Object.assign((selector: any) => {
    const state = {
      setConnectionStatus: vi.fn(),
      setLastSyncTime: vi.fn(),
      addDegradedReason: vi.fn(),
      removeDegradedReason: vi.fn(),
    };
    return selector(state);
  }, { setState: vi.fn() }),
}));

import { useK8sListWatch } from '../useK8sListWatch';
import { watchManager } from '../../engine/watch';
import { useFleetStore } from '../../store/fleetStore';
import { registerCluster, unregisterCluster } from '../../engine/clusterConnection';

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
    expect(k8sListMock).toHaveBeenCalledWith('/api/v1/pods', undefined, 'local');
  });

  it('passes namespace to k8sList', async () => {
    k8sListMock.mockResolvedValue([]);

    const { result } = renderHook(
      () => useK8sListWatch({ apiPath: '/api/v1/pods', namespace: 'kube-system' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(k8sListMock).toHaveBeenCalledWith('/api/v1/pods', 'kube-system', 'local');
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


it('switches A watch to B and ignores late A events for the visible same-name object', async () => {
  const local = { kind: 'Deployment', metadata: { name: 'web', namespace: 'prod', uid: 'a-web' }, spec: { replicas: 3 } };
  const remote = { kind: 'Deployment', metadata: { name: 'web', namespace: 'prod', uid: 'b-web' }, spec: { replicas: 5 } };
  const unsubscribeA = vi.fn();
  const unsubscribeB = vi.fn();
  vi.mocked(watchManager.watch).mockReset();
  vi.mocked(watchManager.watch).mockReturnValueOnce({ unsubscribe: unsubscribeA }).mockReturnValueOnce({ unsubscribe: unsubscribeB });
  k8sListMock.mockImplementation((_path, _namespace, cluster) => Promise.resolve([cluster === 'b' ? remote : local]));
  registerCluster({ id: 'b', name: 'B', connectionType: 'acm-proxy', target: 'b' });
  useFleetStore.getState().setActiveCluster('local');
  const { result, unmount } = renderHook(() => useK8sListWatch({ apiPath: '/apis/apps/v1/deployments', namespace: 'prod' }), { wrapper: createWrapper() });
  await waitFor(() => expect(result.current.data?.[0].metadata.uid).toBe('a-web'));
  const lateA = vi.mocked(watchManager.watch).mock.calls[0][1];
  act(() => useFleetStore.getState().setActiveCluster('b'));
  await waitFor(() => expect(result.current.data?.[0].metadata.uid).toBe('b-web'));
  expect(unsubscribeA).toHaveBeenCalledTimes(1);
  expect(k8sListMock).toHaveBeenLastCalledWith('/apis/apps/v1/deployments', 'prod', 'b');
  expect(vi.mocked(watchManager.watch).mock.calls.at(-1)?.[3]).toBe('b');
  act(() => lateA({ type: 'MODIFIED', object: { ...local, spec: { replicas: 99 } } }));
  expect(result.current.data?.[0]).toEqual(remote);
  unmount();
  expect(unsubscribeB).toHaveBeenCalledTimes(1);
  useFleetStore.getState().setActiveCluster('local');
  unregisterCluster('b');
});
