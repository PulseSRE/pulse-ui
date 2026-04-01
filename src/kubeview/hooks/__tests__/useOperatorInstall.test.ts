// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock k8sCreate and k8sGet
const k8sCreateMock = vi.fn();
const k8sGetMock = vi.fn();
vi.mock('../../engine/query', () => ({
  k8sCreate: (...args: any[]) => k8sCreateMock(...args),
  k8sGet: (...args: any[]) => k8sGetMock(...args),
}));

import { useOperatorInstall } from '../useOperatorInstall';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const defaultOpts = {
  packageName: 'my-operator',
  channel: 'stable',
  source: 'redhat-operators',
  sourceNamespace: 'openshift-marketplace',
  targetNamespace: 'my-ns',
};

describe('useOperatorInstall', () => {
  beforeEach(() => {
    k8sCreateMock.mockReset();
    k8sGetMock.mockReset();
    k8sCreateMock.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it('starts with idle phase, no error, no csvName', () => {
    const { result } = renderHook(() => useOperatorInstall(), { wrapper: createWrapper() });

    expect(result.current.phase).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.csvName).toBeNull();
    expect(typeof result.current.install).toBe('function');
    expect(typeof result.current.reset).toBe('function');
  });

  it('creates namespace, operator group, and subscription on install', async () => {
    const { result } = renderHook(() => useOperatorInstall(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.install(defaultOpts);
    });

    // Namespace creation
    expect(k8sCreateMock).toHaveBeenCalledWith(
      '/api/v1/namespaces',
      expect.objectContaining({ kind: 'Namespace', metadata: { name: 'my-ns' } }),
    );

    // OperatorGroup creation
    expect(k8sCreateMock).toHaveBeenCalledWith(
      expect.stringContaining('operatorgroups'),
      expect.objectContaining({ kind: 'OperatorGroup' }),
    );

    // Subscription creation
    expect(k8sCreateMock).toHaveBeenCalledWith(
      expect.stringContaining('subscriptions'),
      expect.objectContaining({
        kind: 'Subscription',
        spec: expect.objectContaining({
          channel: 'stable',
          name: 'my-operator',
          source: 'redhat-operators',
        }),
      }),
    );
  });

  it('skips namespace and operator group for openshift-operators', async () => {
    const { result } = renderHook(() => useOperatorInstall(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.install({ ...defaultOpts, targetNamespace: 'openshift-operators' });
    });

    // Should only call k8sCreate for the subscription (not namespace or operator group)
    expect(k8sCreateMock).toHaveBeenCalledTimes(1);
    expect(k8sCreateMock).toHaveBeenCalledWith(
      expect.stringContaining('subscriptions'),
      expect.objectContaining({ kind: 'Subscription' }),
    );
  });

  it('skips operator group for openshift-operators-redhat', async () => {
    const { result } = renderHook(() => useOperatorInstall(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.install({ ...defaultOpts, targetNamespace: 'openshift-operators-redhat' });
    });

    // Namespace create + subscription (no operator group)
    const calls = k8sCreateMock.mock.calls;
    const ogCalls = calls.filter((c: any[]) => c[0].includes('operatorgroups'));
    expect(ogCalls).toHaveLength(0);
  });

  it('sets phase to failed when subscription creation fails', async () => {
    k8sCreateMock.mockImplementation((path: string) => {
      if (path.includes('subscriptions')) return Promise.reject(new Error('forbidden'));
      return Promise.resolve({});
    });

    const { result } = renderHook(() => useOperatorInstall(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.install(defaultOpts);
    });

    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('forbidden');
  });

  it('sets phase to creating after successful install (awaiting subscription poll)', async () => {
    const { result } = renderHook(() => useOperatorInstall(), { wrapper: createWrapper() });

    // Before install
    expect(result.current.phase).toBe('idle');

    await act(async () => {
      await result.current.install(defaultOpts);
    });

    // After install, the effect runs and sees no subscription data yet → 'creating'
    await waitFor(() => {
      expect(result.current.phase).toBe('creating');
    });
  });

  it('reset returns to idle state', async () => {
    k8sCreateMock.mockImplementation((path: string) => {
      if (path.includes('subscriptions')) return Promise.reject(new Error('fail'));
      return Promise.resolve({});
    });

    const { result } = renderHook(() => useOperatorInstall(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.install(defaultOpts);
    });

    expect(result.current.phase).toBe('failed');

    act(() => {
      result.current.reset();
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('handles namespace already exists gracefully', async () => {
    k8sCreateMock.mockImplementation((path: string) => {
      if (path === '/api/v1/namespaces') return Promise.reject(new Error('already exists'));
      return Promise.resolve({});
    });

    const { result } = renderHook(() => useOperatorInstall(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.install(defaultOpts);
    });

    // Should still succeed (namespace error is caught), phase is 'creating' awaiting poll
    await waitFor(() => {
      expect(result.current.phase).toBe('creating');
    });
  });

  it('subscription spec includes installPlanApproval Automatic', async () => {
    const { result } = renderHook(() => useOperatorInstall(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.install(defaultOpts);
    });

    const subCall = k8sCreateMock.mock.calls.find((c: any[]) => c[0].includes('subscriptions'));
    expect(subCall).toBeDefined();
    expect(subCall![1].spec.installPlanApproval).toBe('Automatic');
  });

  it('csvName is null before subscription status is available', async () => {
    const { result } = renderHook(() => useOperatorInstall(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.install(defaultOpts);
    });

    expect(result.current.csvName).toBeNull();
  });
});
