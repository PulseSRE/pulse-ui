// @vitest-environment jsdom
/**
 * Delete progress polled a Deployment (or Job) path whatever was deleted, so
 * a deleted ConfigMap or Node never showed as gone, and every delete claimed
 * to be "terminating pods". It now polls the deleted object's own path, shows
 * pods only for kinds that own pods, and handles cluster-scoped objects.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const k8sGet = vi.fn();
const k8sList = vi.fn();
vi.mock('../../engine/query', () => ({
  k8sGet: (...a: unknown[]) => k8sGet(...a),
  k8sList: (...a: unknown[]) => k8sList(...a),
  k8sFetch: vi.fn(),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

import DeployProgress from '../DeployProgress';
import { DeleteProgressModal } from '../../views/detail/DetailViewModals';

const notFound = Object.assign(new Error('not found'), { statusCode: 404 });

function renderIt(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  k8sGet.mockRejectedValue(notFound);
  k8sList.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe('delete progress', () => {
  it('polls a deleted ConfigMap at its own path and shows no pod teardown', async () => {
    renderIt(
      <DeleteProgressModal
        resource={{ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'settings', namespace: 'shop' } }}
        namespace="shop"
        apiPath="/api/v1/namespaces/shop/configmaps/settings"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Deleted · shop/)).toBeTruthy();
    expect(k8sGet).toHaveBeenCalledWith('/api/v1/namespaces/shop/configmaps/settings', 'local');
    expect(k8sList.mock.calls.some((c) => String(c[0]).endsWith('/pods'))).toBe(false);
    expect(screen.queryByText('Terminating Pods')).toBeNull();
  });

  it('a permission error is not reported as deleted', async () => {
    k8sGet.mockRejectedValue(Object.assign(new Error('forbidden'), { statusCode: 403 }));
    renderIt(
      <DeleteProgressModal
        resource={{ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'settings', namespace: 'shop' } }}
        namespace="shop"
        apiPath="/api/v1/namespaces/shop/configmaps/settings"
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(k8sGet).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(/Waiting for finalizers/)).toBeTruthy();
    expect(screen.queryByText(/Deleted ·/)).toBeNull();
  });

  it('a cluster-scoped Node is polled without a namespace', async () => {
    renderIt(
      <DeleteProgressModal
        resource={{ apiVersion: 'v1', kind: 'Node', metadata: { name: 'worker-1' } }}
        apiPath="/api/v1/nodes/worker-1"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Deleted · cluster-scoped/)).toBeTruthy();
    expect(k8sGet).toHaveBeenCalledWith('/api/v1/nodes/worker-1', 'local');
    expect(k8sList.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['/api/v1/events?fieldSelector=involvedObject.name%3Dworker-1']));
    expect(k8sList.mock.calls.some((c) => String(c[0]).includes('/namespaces/default/'))).toBe(false);
  });

  it('a Deployment shows its own pods, found by its selector', async () => {
    k8sGet.mockResolvedValue({ metadata: { name: 'web' } });
    k8sList.mockImplementation(async (path: string) => (path.endsWith('/pods') ? [
      { metadata: { name: 'web-abc', uid: 'p1', labels: { app: 'web' }, deletionTimestamp: 'now' }, status: { phase: 'Running' } },
      { metadata: { name: 'webhook-1', uid: 'p2', labels: { app: 'webhook' } }, status: { phase: 'Running' } },
    ] : []));
    renderIt(
      <DeployProgress type="deployment" mode="delete" name="web" namespace="shop" kind="Deployment"
        resourcePath="/apis/apps/v1/namespaces/shop/deployments/web" podSelector={{ app: 'web' }} onClose={vi.fn()} />,
    );
    expect(await screen.findByText('web-abc')).toBeTruthy();
    expect(screen.queryByText('webhook-1')).toBeNull();
    expect(screen.getByText('Terminating Pods')).toBeTruthy();
  });
});
