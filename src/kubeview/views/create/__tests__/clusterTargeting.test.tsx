// @vitest-environment jsdom
/**
 * Quick Deploy built its URLs from the local cluster's base, so with a remote
 * cluster active the screen showed one cluster and created the app in another.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../components/DeployProgress', () => ({ default: () => null }));
vi.mock('../../../engine/errorToast', () => ({ showErrorToast: vi.fn() }));

import { QuickDeployTab } from '../QuickDeployTab';
import { registerCluster, resetConnections, setActiveClusterId } from '../../../engine/clusterConnection';
import { useFleetStore } from '../../../store/fleetStore';

const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 201 })));

describe('Quick Deploy', () => {
  beforeEach(() => {
    resetConnections();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
  });
  afterEach(() => {
    cleanup();
    resetConnections();
    vi.unstubAllGlobals();
    useFleetStore.setState({ activeClusterId: 'local' });
  });

  it('creates the app in the cluster on screen', async () => {
    registerCluster({ id: 'prod', name: 'Prod', connectionType: 'acm-proxy', target: 'prod' });
    setActiveClusterId('prod');
    useFleetStore.setState({ activeClusterId: 'prod' });

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><QuickDeployTab /></MemoryRouter></QueryClientProvider>);
    fireEvent.change(screen.getByPlaceholderText('my-app'), { target: { value: 'web' } });
    fireEvent.change(screen.getByPlaceholderText('nginx:latest or quay.io/org/image:tag'), { target: { value: 'nginx:1' } });
    // All-namespaces mode: the target is chosen, never defaulted.
    fireEvent.change(await screen.findByLabelText('Namespace'), { target: { value: 'shop' } });
    fireEvent.click(screen.getByText('Deploy'));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST')).toBe(true));
    const [url, init] = fetchMock.mock.calls.find((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST') as unknown as [string, RequestInit];
    expect(url).toContain('/managedclusters/prod/proxy/apis/apps/v1/namespaces/');
    expect(url).toMatch(/\/deployments$/);
    expect(init.method).toBe('POST');
  });
});
