// @vitest-environment jsdom
/**
 * Inline row actions: gated by RBAC, disruptive ones confirmed, drain is a
 * real drain (dialog first), and read-only users can still open YAML.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
const addToastMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: any) => selector({ selectedNamespace: '*', addTab: vi.fn(), addToast: addToastMock, setConnectionStatus: vi.fn() }),
    { getState: () => ({ setSelectedNamespace: vi.fn(), addToast: addToastMock }) },
  ),
}));
vi.mock('../../store/clusterStore', () => ({ useClusterStore: (sel: any) => sel({ resourceRegistry: null }) }));

const watch: { data: any[]; isLoading: boolean; error: Error | null } = { data: [], isLoading: false, error: null };
vi.mock('../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => watch }));

const k8sPatch = vi.fn().mockResolvedValue({});
const k8sList = vi.fn().mockResolvedValue([]);
vi.mock('../../engine/query', () => ({
  k8sPatch: (...a: unknown[]) => k8sPatch(...a),
  k8sDelete: vi.fn().mockResolvedValue({}),
  k8sList: (...a: unknown[]) => k8sList(...a),
  k8sCreate: vi.fn().mockResolvedValue({}),
  k8sGet: vi.fn().mockResolvedValue({}),
  k8sFetch: vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })),
}));

let rbac: Record<string, boolean> = {};
vi.mock('../../hooks/useCanI', () => ({
  useCanI: (verb: string) => ({ allowed: rbac[verb] ?? true, isLoading: false }),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({ index: i, start: i * 36, size: 36, key: i })),
    measureElement: () => {},
  }),
}));

import TableView from '../TableView';
import { registerBuiltinEnhancers } from '../../engine/enhancers/register';

registerBuiltinEnhancers();

const deployment = {
  apiVersion: 'apps/v1', kind: 'Deployment',
  metadata: { name: 'web', namespace: 'shop', uid: 'd1', resourceVersion: '7', creationTimestamp: '2025-01-01T00:00:00Z' },
  spec: { replicas: 1, selector: { matchLabels: { app: 'web' } } },
  status: { replicas: 1, readyReplicas: 1, availableReplicas: 1 },
};
const nodeRes = {
  apiVersion: 'v1', kind: 'Node',
  metadata: { name: 'worker-1', uid: 'n1', creationTimestamp: '2025-01-01T00:00:00Z' },
  spec: {}, status: { conditions: [{ type: 'Ready', status: 'True' }] },
};

function renderTable(gvrKey: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><TableView gvrKey={gvrKey} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); rbac = {}; });
afterEach(() => cleanup());

describe('deployment inline actions', () => {
  beforeEach(() => { watch.data = [deployment]; });

  it('scaling down to 0 asks first, then patches replicas', async () => {
    renderTable('apps/v1/deployments');
    fireEvent.click(screen.getByTitle('Scale down'));
    expect(await screen.findByText('Scale "web" to 0?')).toBeTruthy();
    expect(k8sPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Scale to 0' }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalledTimes(1));
    expect(k8sPatch.mock.calls[0][0]).toBe('/apis/apps/v1/namespaces/shop/deployments/web');
    expect(k8sPatch.mock.calls[0][1]).toEqual({ metadata: { resourceVersion: '7' }, spec: { replicas: 0 } });
  });

  it('rollout restart asks first, then patches the template annotation', async () => {
    renderTable('apps/v1/deployments');
    fireEvent.click(screen.getByRole('button', { name: 'Restart rollout' }));
    expect(await screen.findByText('Restart Deployment "web"?')).toBeTruthy();
    expect(k8sPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalledTimes(1));
    const body = k8sPatch.mock.calls[0][1] as any;
    expect(Object.keys(body.spec.template.metadata.annotations)).toEqual(['kubectl.kubernetes.io/restartedAt']);
  });

  it('a failed confirmed action keeps the dialog and reports the error', async () => {
    k8sPatch.mockRejectedValueOnce(new Error('forbidden'));
    renderTable('apps/v1/deployments');
    fireEvent.click(screen.getByRole('button', { name: 'Restart rollout' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalled());
    expect(screen.getByText('Restart Deployment "web"?')).toBeTruthy();
  });

  it('hides scale and restart without update permission, but still opens YAML read-only', () => {
    rbac = { update: false };
    renderTable('apps/v1/deployments');
    expect(screen.queryByTitle('Scale down')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restart rollout' })).toBeNull();
    const yaml = screen.getByRole('button', { name: 'View YAML' });
    expect((yaml as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(yaml);
    expect(navigateMock).toHaveBeenCalledWith('/yaml/apps~v1~deployments/shop/web');
  });
});

describe('node inline actions', () => {
  beforeEach(() => { watch.data = [nodeRes]; });

  it('Drain opens the drain dialog and changes nothing until confirmed', async () => {
    renderTable('v1/nodes');
    fireEvent.click(screen.getByRole('button', { name: 'Drain node' }));
    expect(await screen.findByText('Drain node worker-1?')).toBeTruthy();
    expect(k8sPatch).not.toHaveBeenCalled();
  });

  it('Cordon asks first (same words as the node page), then patches the node through its own path', async () => {
    renderTable('v1/nodes');
    fireEvent.click(screen.getByRole('button', { name: 'Cordon node' }));
    expect(await screen.findByText('Cordon node "worker-1"?')).toBeTruthy();
    expect(screen.getByText(/No new pods will be scheduled on worker-1/)).toBeTruthy();
    expect(k8sPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cordon' }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalled());
    expect(k8sPatch.mock.calls[0][0]).toBe('/api/v1/nodes/worker-1');
    expect(k8sPatch.mock.calls[0][1]).toEqual({ spec: { unschedulable: true } });
  });

  it('cancelling the cordon confirmation sends nothing', async () => {
    renderTable('v1/nodes');
    fireEvent.click(screen.getByRole('button', { name: 'Cordon node' }));
    await screen.findByText('Cordon node "worker-1"?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Cordon node "worker-1"?')).toBeNull());
    expect(k8sPatch).not.toHaveBeenCalled();
  });

  it('Uncordon on a cordoned node asks first too', async () => {
    watch.data = [{ ...nodeRes, spec: { unschedulable: true } }];
    renderTable('v1/nodes');
    fireEvent.click(screen.getByRole('button', { name: 'Uncordon node' }));
    expect(await screen.findByText('Uncordon node "worker-1"?')).toBeTruthy();
    expect(k8sPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Uncordon' }));
    await waitFor(() => expect(k8sPatch.mock.calls[0]?.[1]).toEqual({ spec: { unschedulable: false } }));
  });

  it('hides cordon and drain without update permission', () => {
    rbac = { update: false };
    renderTable('v1/nodes');
    expect(screen.queryByRole('button', { name: 'Drain node' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cordon node' })).toBeNull();
  });
});

describe('deleting a Deployment from the table', () => {
  beforeEach(() => { watch.data = [deployment, { ...deployment, metadata: { ...deployment.metadata, name: 'api', uid: 'd2' } }]; });

  it('the row trash opens the delete-with-related-objects dialog, not a plain confirm', async () => {
    renderTable('apps/v1/deployments');
    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    expect(await screen.findByRole('heading', { name: 'Delete Deployment api?' })).toBeTruthy();
    expect(screen.getByLabelText(/to confirm/)).toBeTruthy();
  });

  it('bulk delete goes through the same dialog, one workload at a time', async () => {
    renderTable('apps/v1/deployments');
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(await screen.findByTitle('Delete 2 selected'));
    expect(await screen.findByRole('heading', { name: 'Delete Deployment api?' })).toBeTruthy();
    expect(screen.getByText('1 of 2 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Delete Deployment web?' })).toBeTruthy();
    expect(screen.getByText('2 of 2 selected')).toBeTruthy();
  });
});
