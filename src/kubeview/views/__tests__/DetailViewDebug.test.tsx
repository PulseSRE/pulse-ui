// @vitest-environment jsdom
/**
 * Wave 10: Debug used to write to the cluster without asking. On a node it
 * created a privileged hostPID/hostNetwork pod in "default" and the toast
 * claimed it "auto-deletes in 1 hour" (it only stopped, and stayed). On a pod
 * it added a `busybox:latest` ephemeral container from Docker Hub. Now each
 * asks first, says exactly what it creates, is offered only when RBAC allows
 * it, and the node pod really ends (activeDeadlineSeconds, or End session).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../../components/metrics/prometheus', () => ({
  queryInstant: vi.fn().mockResolvedValue([]),
  queryRange: vi.fn().mockResolvedValue([]),
  getTimeRange: vi.fn().mockReturnValue([0, 1]),
}));
vi.mock('../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div>{title}</div>,
  Sparkline: () => <div />,
}));

import DetailView from '../DetailView';
import PodTerminal from '../../components/PodTerminal';
import { BottomDock } from '../../components/BottomDock';
import { useUIStore } from '../../store/uiStore';
import { resetConnections } from '../../engine/clusterConnection';
import { NODE_DEBUG_DEADLINE_SECONDS, NODE_DEBUG_IMAGE, POD_DEBUG_IMAGE } from '../../engine/debugPods';

const calls: Array<{ method: string; url: string; body?: any }> = [];
let allow: Record<string, boolean> = {};
let writeStatus = 200;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const node = {
  apiVersion: 'v1', kind: 'Node',
  metadata: { name: 'worker-1', uid: 'n1', creationTimestamp: '2025-01-01T00:00:00Z', labels: {} },
  spec: {},
  status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: {} },
};
const pod = {
  apiVersion: 'v1', kind: 'Pod',
  metadata: { name: 'web-1', namespace: 'shop', uid: 'p1', creationTimestamp: '2025-01-01T00:00:00Z', labels: {} },
  spec: { containers: [{ name: 'app', image: 'quay.io/shop/web:1' }] },
  status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: true, restartCount: 0, state: { running: {} } }] },
};

beforeEach(() => {
  calls.length = 0;
  allow = { 'create/pods': true, 'patch/pods/ephemeralcontainers': true, 'delete/pods': true, 'patch/nodes': true };
  writeStatus = 200;
  useUIStore.setState({ toasts: [], terminalContext: null, bottomDockPanel: null } as never);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url.endsWith('/selfsubjectaccessreviews')) {
      const a = body.spec.resourceAttributes;
      return json({ status: { allowed: !!allow[`${a.verb}/${a.resource}${a.subresource ? `/${a.subresource}` : ''}`] } });
    }
    if (method !== 'GET') {
      if (writeStatus !== 200) return json({ kind: 'Status', reason: 'Forbidden', message: 'pods is forbidden', code: writeStatus }, writeStatus);
      return json(method === 'POST' ? { ...body } : { kind: 'Status', status: 'Success' });
    }
    if (url.endsWith('/api/v1/nodes/worker-1')) return json(node);
    if (url.endsWith('/api/v1/namespaces/shop/pods/web-1')) return json(pod);
    if (url.includes('/events') || url.includes('/pods?') || url.includes('/pods')) return json({ kind: 'List', items: [] });
    return json({ message: 'not found' }, 404);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetConnections();
});

function renderDetail(props: { gvrKey: string; namespace?: string; name: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DetailView {...props} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.endsWith('/selfsubjectaccessreviews'));

async function debugButton() {
  const btn = await screen.findByRole('button', { name: /Debug/ });
  return btn as HTMLButtonElement;
}

describe('node Debug', () => {
  it('asks first, naming the privileged pod, its namespace, image and lifetime; nothing is created before confirming', async () => {
    renderDetail({ gvrKey: 'v1/nodes', name: 'worker-1' });
    const btn = await debugButton();
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Start a privileged debug pod on node "worker-1"?')).toBeTruthy();
    expect(dialog.textContent).toMatch(/in namespace "default", scheduled onto worker-1/);
    expect(dialog.textContent).toContain(NODE_DEBUG_IMAGE);
    expect(dialog.textContent).toMatch(/Privileged container, sharing the node's process IDs \(hostPID\) and network \(hostNetwork\)/);
    expect(dialog.textContent).toMatch(/whole filesystem mounted read-write at \/host/);
    expect(dialog.textContent).toMatch(/Stopped by Kubernetes after 60 minutes \(activeDeadlineSeconds\)/);
    expect(writes()).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create debug pod' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const post = writes()[0];
    expect(post.method).toBe('POST');
    expect(post.url).toBe('/api/kubernetes/api/v1/namespaces/default/pods');
    expect(post.body.spec).toMatchObject({
      nodeName: 'worker-1', hostPID: true, hostNetwork: true, restartPolicy: 'Never',
      activeDeadlineSeconds: NODE_DEBUG_DEADLINE_SECONDS,
    });
    expect(post.body.spec.containers[0]).toMatchObject({ image: NODE_DEBUG_IMAGE, securityContext: { privileged: true } });

    await waitFor(() => expect(useUIStore.getState().toasts.length).toBeGreaterThan(0));
    const toast = useUIStore.getState().toasts.find((t) => /Debug pod created/.test(t.title))!;
    expect(toast.detail).not.toMatch(/auto-deletes/);
    expect(toast.detail).toMatch(/stops after 60 minutes; End session in the terminal deletes it/);
    expect(useUIStore.getState().terminalContext).toMatchObject({ namespace: 'default', podName: post.body.metadata.name, isNode: true });
  });

  it('Cancel creates nothing', async () => {
    renderDetail({ gvrKey: 'v1/nodes', name: 'worker-1' });
    const btn = await debugButton();
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toHaveLength(0);
    expect(useUIStore.getState().terminalContext).toBeNull();
  });

  it('a refused create stays in the dialog and opens no terminal', async () => {
    writeStatus = 403;
    renderDetail({ gvrKey: 'v1/nodes', name: 'worker-1' });
    const btn = await debugButton();
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create debug pod' }));
    expect(await within(dialog).findByText(/Create debug pod failed: Permission denied/)).toBeTruthy();
    expect(useUIStore.getState().terminalContext).toBeNull();
  });

  it('is disabled, with the reason, without permission to create pods in default', async () => {
    allow['create/pods'] = false;
    renderDetail({ gvrKey: 'v1/nodes', name: 'worker-1' });
    const btn = await debugButton();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/selfsubjectaccessreviews') && c.body.spec.resourceAttributes.resource === 'pods')).toBe(true));
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(btn.title).toBe('You do not have permission to create pods in default');
    fireEvent.click(btn);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes()).toHaveLength(0);
  });
});

describe('pod Debug', () => {
  it('asks first, naming the image and the pod; the image can be changed before it is added', async () => {
    renderDetail({ gvrKey: 'v1/pods', namespace: 'shop', name: 'web-1' });
    const btn = await debugButton();
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Add a debug container to pod "web-1"?')).toBeTruthy();
    expect(dialog.textContent).toMatch(/to shop\/web-1, sharing the process namespace of "app"/);
    const image = within(dialog).getByLabelText(/Image/) as HTMLInputElement;
    expect(image.value).toBe(POD_DEBUG_IMAGE);
    expect(writes()).toHaveLength(0);

    fireEvent.change(image, { target: { value: 'mirror.example.com/tools/busybox:1.36' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add debug container' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const patch = writes()[0];
    expect(patch.method).toBe('PATCH');
    expect(patch.url).toBe('/api/kubernetes/api/v1/namespaces/shop/pods/web-1/ephemeralcontainers');
    expect(patch.body.spec.ephemeralContainers[0]).toMatchObject({ image: 'mirror.example.com/tools/busybox:1.36', targetContainerName: 'app' });
  });

  it('refetches the pod after the container is added, so it appears without a reload', async () => {
    renderDetail({ gvrKey: 'v1/pods', namespace: 'shop', name: 'web-1' });
    const btn = await debugButton();
    await waitFor(() => expect(btn.disabled).toBe(false));
    const podGets = () => calls.filter((c) => c.method === 'GET' && c.url.endsWith('/api/v1/namespaces/shop/pods/web-1')).length;
    const before = podGets();
    fireEvent.click(btn);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add debug container' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    await waitFor(() => expect(podGets()).toBeGreaterThan(before));
  });

  it('an empty image cannot be confirmed', async () => {
    renderDetail({ gvrKey: 'v1/pods', namespace: 'shop', name: 'web-1' });
    const btn = await debugButton();
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Image/), { target: { value: '  ' } });
    expect((within(dialog).getByRole('button', { name: 'Add debug container' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText('Enter an image.')).toBeTruthy();
  });

  it('Cancel adds nothing', async () => {
    renderDetail({ gvrKey: 'v1/pods', namespace: 'shop', name: 'web-1' });
    const btn = await debugButton();
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toHaveLength(0);
  });

  it('is disabled, with the reason, without permission to patch pods/ephemeralcontainers', async () => {
    allow['patch/pods/ephemeralcontainers'] = false;
    renderDetail({ gvrKey: 'v1/pods', namespace: 'shop', name: 'web-1' });
    const btn = await debugButton();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/selfsubjectaccessreviews') && c.body.spec.resourceAttributes.subresource === 'ephemeralcontainers')).toBe(true));
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(btn.title).toBe('You do not have permission to add debug containers to this pod');
  });
});

describe('node debug terminal: End session', () => {
  it('deletes the debug pod and closes the terminal', async () => {
    const onClose = vi.fn();
    render(<PodTerminal namespace="default" podName="debug-worker-1-ab12" containerName="debug" isNode inline onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /End session/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes()).toEqual([expect.objectContaining({ method: 'DELETE', url: '/api/kubernetes/api/v1/namespaces/default/pods/debug-worker-1-ab12' })]);
    expect(useUIStore.getState().toasts.some((t) => t.title === 'Debug pod "debug-worker-1-ab12" deleted')).toBe(true);
  });

  it('a failed delete keeps the terminal open and says so', async () => {
    writeStatus = 403;
    const onClose = vi.fn();
    render(<PodTerminal namespace="default" podName="debug-worker-1-ab12" containerName="debug" isNode inline onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /End session/ }));
    await waitFor(() => expect(useUIStore.getState().toasts.some((t) => t.type === 'error')).toBe(true));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closing the node debug terminal asks first; Delete (the default) deletes the pod and closes', async () => {
    const onClose = vi.fn();
    render(<PodTerminal namespace="default" podName="debug-worker-1-ab12" containerName="debug" isNode onClose={onClose} />);
    fireEvent.click(screen.getAllByTitle('Close')[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Delete the debug pod now?' });
    expect(onClose).not.toHaveBeenCalled();
    const del = within(dialog).getByRole('button', { name: 'Delete' });
    await waitFor(() => expect(document.activeElement).toBe(del));
    expect(within(dialog).getByRole('button', { name: 'Keep running' })).toBeTruthy();
    fireEvent.click(del);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes()).toEqual([expect.objectContaining({ method: 'DELETE', url: '/api/kubernetes/api/v1/namespaces/default/pods/debug-worker-1-ab12' })]);
  });

  it('Keep running closes without deleting and says the pod stops on its own within the hour', async () => {
    const onClose = vi.fn();
    render(<PodTerminal namespace="default" podName="debug-worker-1-ab12" containerName="debug" isNode onClose={onClose} />);
    fireEvent.click(screen.getAllByTitle('Close')[1]);
    const dialog = await screen.findByRole('dialog', { name: 'Delete the debug pod now?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep running' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes()).toHaveLength(0);
    const toast = useUIStore.getState().toasts.find((t) => /still running/.test(t.title))!;
    expect(toast.detail).toMatch(/stops on its own within 60 minutes/);
  });

  it('closing the dock on a node debug terminal asks too; an ordinary terminal closes straight away', async () => {
    useUIStore.setState({ bottomDockPanel: 'terminal', terminalContext: { namespace: 'default', podName: 'debug-worker-1-ab12', containerName: 'debug', isNode: true } } as never);
    const { unmount } = render(<BottomDock />);
    fireEvent.click(screen.getAllByTitle('Close')[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Delete the debug pod now?' });
    expect(useUIStore.getState().bottomDockPanel).toBe('terminal');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(useUIStore.getState().bottomDockPanel).toBeNull());
    expect(writes()).toEqual([expect.objectContaining({ method: 'DELETE', url: '/api/kubernetes/api/v1/namespaces/default/pods/debug-worker-1-ab12' })]);
    unmount();

    calls.length = 0;
    useUIStore.setState({ bottomDockPanel: 'terminal', terminalContext: { namespace: 'shop', podName: 'web-1', containerName: 'app' } } as never);
    render(<BottomDock />);
    fireEvent.click(screen.getAllByTitle('Close')[0]);
    expect(useUIStore.getState().bottomDockPanel).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it('is not offered on an ordinary pod terminal', () => {
    render(<PodTerminal namespace="shop" podName="web-1" containerName="app" inline onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /End session/ })).toBeNull();
  });
});
