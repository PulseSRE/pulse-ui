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

const fetchMock = vi.fn((url: string) => Promise.resolve(url.endsWith('/selfsubjectaccessreviews')
  ? new Response(JSON.stringify({ status: { allowed: true } }), { status: 201 })
  : new Response('{}', { status: 201 })));

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
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'web' } });
    fireEvent.change(screen.getByLabelText('Image'), { target: { value: 'nginx:1' } });
    fireEvent.change(screen.getByLabelText('Container port'), { target: { value: '8080' } });
    // All-namespaces mode: the target is chosen, never defaulted.
    fireEvent.change(await screen.findByLabelText('Namespace'), { target: { value: 'shop' } });
    const dryRun = screen.getByRole('button', { name: 'Dry run' });
    await waitFor(() => expect((dryRun as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dryRun);
    const create = await screen.findByRole('button', { name: /Create \d objects/ });
    await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(create);

    const isCreate = (c: unknown) => { const [u, i] = c as [string, RequestInit]; return i?.method === 'POST' && !u.includes('dryRun') && !u.endsWith('/selfsubjectaccessreviews'); };
    await waitFor(() => expect(fetchMock.mock.calls.some(isCreate)).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(isCreate) as unknown as [string, RequestInit];
    expect(url).toContain('/managedclusters/prod/proxy/apis/apps/v1/namespaces/');
    expect(url).toMatch(/\/deployments$/);
    expect(init.method).toBe('POST');
  });
});
