// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCanI } from '../useCanI';
import { registerCluster, resetConnections } from '../../engine/clusterConnection';
import { useFleetStore } from '../../store/fleetStore';
import { useUIStore } from '../../store/uiStore';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useCanI', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    resetConnections();
    registerCluster({ id: 'prod', name: 'Production', connectionType: 'acm-proxy', target: 'prod' });
    useFleetStore.setState({ activeClusterId: 'prod' });
    useUIStore.setState({ impersonateUser: 'alice', impersonateGroups: ['devs'] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useUIStore.setState({ impersonateUser: '', impersonateGroups: [] });
  });

  it('asks the active cluster, as the impersonated user', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: { allowed: true } }) });
    const { result } = renderHook(() => useCanI('delete', 'apps', 'deployments', 'shop'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/prod/proxy/apis/authorization.k8s.io/v1/selfsubjectaccessreviews');
    expect(init.method).toBe('POST');
    expect(init.headers['Impersonate-User']).toBe('alice');
    expect(init.headers['Impersonate-Group']).toBe('devs');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body).spec.resourceAttributes).toEqual({ verb: 'delete', group: 'apps', resource: 'deployments', namespace: 'shop' });
    expect(result.current.allowed).toBe(true);
  });

  it('denies a write when the review is refused (403)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) });
    const { result } = renderHook(() => useCanI('delete', 'apps', 'deployments', 'shop'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(false);
  });

  it('denies a write on a network error but leaves reads open', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    const write = renderHook(() => useCanI('patch', '', 'pods'), { wrapper });
    await waitFor(() => expect(write.result.current.isLoading).toBe(false));
    expect(write.result.current.allowed).toBe(false);

    const read = renderHook(() => useCanI('list', '', 'pods'), { wrapper });
    await waitFor(() => expect(read.result.current.isLoading).toBe(false));
    expect(read.result.current.allowed).toBe(true);
  });
});
