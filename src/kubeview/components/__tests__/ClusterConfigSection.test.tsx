// @vitest-environment jsdom
/** Overview → "Manage providers" opens Cluster Config with OAuth already open. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const k8sGet = vi.fn();
vi.mock('../../engine/query', async (orig) => ({ ...(await orig<object>()), k8sGet: (...a: unknown[]) => k8sGet(...a) }));

import ClusterConfig from '../ClusterConfig';

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}><ClusterConfig /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); k8sGet.mockReset(); });

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
