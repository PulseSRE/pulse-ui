// @vitest-environment jsdom
/** Overview → "Manage providers" opens Cluster Config with OAuth already open. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const k8sGet = vi.fn();
vi.mock('../../engine/query', async (orig) => ({ ...(await orig<object>()), k8sGet: (...a: unknown[]) => k8sGet(...a) }));

import ClusterConfig from '../ClusterConfig';

let qc: QueryClient | undefined;
function renderAt(path: string) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><ClusterConfig /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); qc?.clear(); k8sGet.mockReset(); });

describe('ClusterConfig ?section=', () => {
  it('opens and reads the requested section', async () => {
    k8sGet.mockRejectedValue(new Error('403'));
    renderAt('/admin?tab=config&section=oauth');
    await waitFor(() => expect(k8sGet).toHaveBeenCalledWith('/apis/config.openshift.io/v1/oauths/cluster', expect.anything()));
    expect(k8sGet).toHaveBeenCalledTimes(1);
  });

  it('opens nothing without one', () => {
    renderAt('/admin?tab=config');
    expect(k8sGet).not.toHaveBeenCalled();
  });
});

describe('ClusterConfig section states', () => {
  it.each([
    ['403', Object.assign(new Error('proxies.config.openshift.io "cluster" is forbidden'), { statusCode: 403 }), /Permission denied/],
    ['500', Object.assign(new Error('internal error'), { statusCode: 500 }), /status 500/],
  ])('a %s read shows the reason with Retry, not an empty editor', async (_l, err, reason) => {
    k8sGet.mockRejectedValue(err);
    renderAt('/admin?tab=config&section=proxy');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Proxy configuration could not be loaded');
    expect(alert.textContent).toMatch(reason);
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(/has no Proxy configuration resource/)).toBeNull();
  });

  it('a 404 says the resource is not on this cluster (a real empty answer, not an error)', async () => {
    k8sGet.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    renderAt('/admin?tab=config&section=proxy');
    expect(await screen.findByText(/This cluster has no Proxy configuration resource \(proxies\/cluster\)/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
