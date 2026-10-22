// @vitest-environment jsdom
/**
 * Quick Deploy built its URLs from the local cluster's base, so with a remote
 * cluster active the screen showed one cluster and created the app in another.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

    render(<MemoryRouter><QuickDeployTab /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('my-app'), { target: { value: 'web' } });
    fireEvent.change(screen.getByPlaceholderText('nginx:latest or quay.io/org/image:tag'), { target: { value: 'nginx:1' } });
    fireEvent.click(screen.getByText('Deploy'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/managedclusters/prod/proxy/apis/apps/v1/namespaces/');
    expect(url).toMatch(/\/deployments$/);
    expect(init.method).toBe('POST');
  });
});
