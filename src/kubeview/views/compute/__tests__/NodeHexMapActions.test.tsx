// @vitest-environment jsdom
/**
 * Every NodeHexMap menu item used to be `() => {}`. These tests click each
 * control (from the visible actions buttons, not only right-click) and assert
 * the request it sends, the navigation it makes, or the confirmation it asks
 * for — and that items the user's RBAC does not allow are not offered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { NodeHexMap, type PodInfo } from '../NodeHexMap';
import { useNodeMapActions } from '../useNodeMapActions';
import { useUIStore } from '../../../store/uiStore';
import { useFleetStore } from '../../../store/fleetStore';
import { registerCluster, resetConnections, setActiveClusterId } from '../../../engine/clusterConnection';
import type { NodeDetail } from '../types';

const calls: Array<{ method: string; url: string; body?: any }> = [];
let allow: Record<string, boolean> = {};
let extra: Array<(url: string, method: string) => Response | undefined> = [];
let evicted = false;
let nodePods: unknown[] = [];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  calls.length = 0;
  allow = { 'update/nodes': true, 'delete/pods': true };
  extra = [];
  evicted = false;
  nodePods = [{ metadata: { name: 'web-1', namespace: 'shop', uid: 'uid-web-1', ownerReferences: [{ kind: 'ReplicaSet', name: 'web-abc', controller: true }] }, status: { phase: 'Running' } }];
  useUIStore.setState({ toasts: [], terminalContext: null } as never);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url.endsWith('/selfsubjectaccessreviews')) {
      const a = body.spec.resourceAttributes;
      return json({ status: { allowed: !!allow[`${a.verb}/${a.resource}`] } });
    }
    for (const r of extra) { const res = r(url, method); if (res) return res; }
    if (method === 'PATCH' && url.endsWith('/api/v1/nodes/worker-1')) return json({});
    if (method === 'GET' && url.includes('/api/v1/pods?fieldSelector=')) {
      return json({ kind: 'PodList', apiVersion: 'v1', items: nodePods });
    }
    if (method === 'POST' && url.endsWith('/eviction')) { evicted = true; return json({ kind: 'Status', status: 'Success' }, 201); }
    if (method === 'DELETE') return json({ kind: 'Status', status: 'Success' });
    if (method === 'GET' && url.endsWith('/api/v1/namespaces/shop/pods/web-1') && !evicted) {
      return json({ metadata: { name: 'web-1', namespace: 'shop' }, spec: { containers: [{ name: 'app' }] }, status: { containerStatuses: [{ name: 'app', state: { running: {} } }] } });
    }
    if (method === 'GET' && url.includes('/api/v1/namespaces/default/pods?labelSelector=')) return json({ kind: 'PodList', apiVersion: 'v1', items: [] });
    return json({ message: 'not found' }, 404);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetConnections();
  useFleetStore.setState({ activeClusterId: 'local' });
});

const node: NodeDetail = {
  name: 'worker-1',
  status: { ready: true },
  roles: ['worker'],
  unschedulable: false,
  pressures: [],
  podCount: 1,
  podCap: 110,
  cpuUsagePct: 10,
  memUsagePct: 10,
} as unknown as NodeDetail;

const pods: Record<string, PodInfo[]> = { 'worker-1': [{ name: 'web-1', namespace: 'shop', status: 'Running', restarts: 0, uid: 'uid-web-1' }] };

function Harness() {
  const { actions, dialogs } = useNodeMapActions();
  return (
    <>
      <NodeHexMap nodes={[node]} podsByNode={pods} actions={actions} />
      {dialogs}
    </>
  );
}

function Where() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderMap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/compute']}>
        <Routes>
          <Route path="*" element={<><Harness /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openNodeMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Actions for node worker-1' }));
  return screen.findByRole('menu');
}

async function openPodMenu() {
  fireEvent.click(screen.getByText('worker-1'));
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for pod web-1' }));
  return screen.findByRole('menu');
}

describe('NodeHexMap node actions', () => {
  it('Cordon patches spec.unschedulable on the node', async () => {
    renderMap();
    const menu = await openNodeMenu();
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Cordon Node' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe('/api/kubernetes/api/v1/nodes/worker-1');
    expect(patch.body).toEqual({ spec: { unschedulable: true } });
    await waitFor(() => expect(useUIStore.getState().toasts.some((t) => t.title === 'Node "worker-1" cordoned')).toBe(true));
  });

  it('Drain asks for confirmation, then cordons and evicts', async () => {
    renderMap();
    const menu = await openNodeMenu();
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Drain Node' }));
    expect(await screen.findByText('Drain node worker-1?')).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH' || c.method === 'POST' && c.url.endsWith('/eviction'))).toBe(false);
    await screen.findByText(/1 pod to evict/);

    fireEvent.click(screen.getByRole('button', { name: 'Drain' }));
    await screen.findByText('Node "worker-1" drained');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ spec: { unschedulable: true } });
    const eviction = calls.find((c) => c.url.endsWith('/eviction'))!;
    expect(eviction.method).toBe('POST');
    expect(eviction.url).toBe('/api/kubernetes/api/v1/namespaces/shop/pods/web-1/eviction');
    expect(eviction.body).toEqual({ apiVersion: 'policy/v1', kind: 'Eviction', metadata: { name: 'web-1', namespace: 'shop' } });
    expect(useUIStore.getState().toasts.some((t) => /started/i.test(t.title))).toBe(false);
  });

  it('lists an unmanaged pod by name and evicts it only when opted in', async () => {
    nodePods = [{ metadata: { name: 'scratch', namespace: 'shop', uid: 'u-s' }, status: { phase: 'Running' } }];
    renderMap();
    const menu = await openNodeMenu();
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Drain Node' }));
    expect(await screen.findByText('shop/scratch')).toBeTruthy();
    expect(screen.getByText(/0 pods to evict/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Evict unmanaged pods too/));
    expect(screen.getByText(/1 pod to evict/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Drain' }));
    await screen.findByText('Node "worker-1" drained');
    expect(calls.find((c) => c.url.endsWith('/eviction'))!.url).toBe('/api/kubernetes/api/v1/namespaces/shop/pods/scratch/eviction');
  });

  it('a cluster switch while the drain dialog is open does not retarget the drain', async () => {
    registerCluster({ id: 'prod', name: 'Prod', connectionType: 'acm-proxy', target: 'prod' });
    renderMap();
    const menu = await openNodeMenu();
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Drain Node' }));
    await screen.findByText(/1 pod to evict/);
    act(() => { useFleetStore.setState({ activeClusterId: 'prod' }); setActiveClusterId('prod'); });
    fireEvent.click(screen.getByRole('button', { name: 'Drain' }));
    await screen.findByText('Node "worker-1" drained');
    const writes = calls.filter((c) => c.method === 'PATCH' || c.method === 'POST' && c.url.endsWith('/eviction'));
    expect(writes.length).toBe(2);
    for (const w of writes) expect(w.url.startsWith('/api/kubernetes/api/v1/')).toBe(true);
  });

  it('Open Terminal looks for the node debug pod and says when there is none', async () => {
    renderMap();
    const menu = await openNodeMenu();
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Open Terminal' }));
    await waitFor(() => expect(useUIStore.getState().toasts.some((t) => t.title === 'No debug pod on this node')).toBe(true));
    expect(calls.some((c) => c.url === '/api/kubernetes/api/v1/namespaces/default/pods?labelSelector=openshiftpulse%2Fdebug-node%3Dworker-1')).toBe(true);
  });

  it('a failed cordon shows an error, not success', async () => {
    extra.push((url, method) => (method === 'PATCH' ? json({ kind: 'Status', reason: 'Forbidden', message: 'forbidden' }, 403) : undefined));
    renderMap();
    const menu = await openNodeMenu();
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Cordon Node' }));
    await waitFor(() => expect(useUIStore.getState().toasts.some((t) => t.type === 'error')).toBe(true));
    expect(useUIStore.getState().toasts.some((t) => t.title === 'Node "worker-1" cordoned')).toBe(false);
  });

  it('does not offer cordon or drain without node update permission', async () => {
    allow['update/nodes'] = false;
    renderMap();
    const menu = await openNodeMenu();
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/selfsubjectaccessreviews')).length).toBeGreaterThan(0));
    expect(within(menu).queryByRole('menuitem', { name: /Cordon/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Drain/ })).toBeNull();
  });
});

describe('NodeHexMap pod actions', () => {
  it('View Logs navigates to /logs/{ns}/{pod}', async () => {
    renderMap();
    const menu = await openPodMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'View Logs' }));
    expect(screen.getByTestId('location').textContent).toBe('/logs/shop/web-1');
  });

  it('Exec opens the pod terminal in its default container', async () => {
    renderMap();
    const menu = await openPodMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Exec Into Container' }));
    await waitFor(() => expect(useUIStore.getState().terminalContext).toMatchObject({ namespace: 'shop', podName: 'web-1', containerName: 'app' }));
  });

  it('Delete Pod confirms, then deletes exactly that pod', async () => {
    renderMap();
    const menu = await openPodMenu();
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Delete Pod' }));
    expect(screen.getByText('Delete pod')).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.url).toBe('/api/kubernetes/api/v1/namespaces/shop/pods/web-1');
    expect(del.body.preconditions).toEqual({ uid: 'uid-web-1' });
  });

  it('a cluster switch while the delete confirmation is open does not retarget the delete', async () => {
    registerCluster({ id: 'prod', name: 'Prod', connectionType: 'acm-proxy', target: 'prod' });
    renderMap();
    const menu = await openPodMenu();
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Delete Pod' }));
    act(() => { useFleetStore.setState({ activeClusterId: 'prod' }); setActiveClusterId('prod'); });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe('/api/kubernetes/api/v1/namespaces/shop/pods/web-1');
  });

  it('does not offer Delete Pod without pod delete permission', async () => {
    allow['delete/pods'] = false;
    renderMap();
    const menu = await openPodMenu();
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/selfsubjectaccessreviews')).length).toBeGreaterThan(1));
    expect(within(menu).queryByRole('menuitem', { name: 'Delete Pod' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'View Logs' })).toBeTruthy();
  });

  it('without actions the menu only offers working items', async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><NodeHexMap nodes={[node]} podsByNode={pods} /></MemoryRouter>
      </QueryClientProvider>,
    );
    const menu = await openNodeMenu();
    const labels = within(menu).getAllByRole('menuitem').map((b) => b.textContent);
    expect(labels).toEqual(['Copy Node Name']);
  });
});
