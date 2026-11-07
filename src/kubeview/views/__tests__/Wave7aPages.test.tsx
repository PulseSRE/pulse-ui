// @vitest-environment jsdom
/**
 * Wave 7a page actions: Storage (create PVC, set default StorageClass,
 * delete a Released PV, clickable CSI driver and snapshot rows), Networking
 * (create Service/Route/Ingress in the selected namespace; services with no
 * ready endpoints), and the project dashboard (cards open filtered lists;
 * Routes, PVCs and quota usage sections).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { installFetch, setAllow, respond, writes, json, renderWithProviders } from '../../components/workloads/__tests__/actionHarness';

const mockData: Record<string, unknown[]> = {};
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({ data: mockData[apiPath] || [], isLoading: false, isError: false }),
}));
const goMock = vi.fn();
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => goMock }));
vi.mock('../../components/metrics/Sparkline', () => ({ MetricCard: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../../components/metrics/prometheus', async (orig) => ({ ...(await orig<object>()), queryInstant: vi.fn().mockResolvedValue([]), queryRange: vi.fn().mockResolvedValue([]) }));

import StorageView from '../StorageView';
import NetworkingView from '../NetworkingView';
import ProjectDashboard from '../ProjectDashboard';
import { useUIStore } from '../../store/uiStore';

const list = (items: unknown[]) => json({ kind: 'List', apiVersion: 'v1', items });

beforeEach(() => { installFetch(); useUIStore.setState({ selectedNamespace: 'shop' } as never); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); goMock.mockReset(); Object.keys(mockData).forEach((k) => delete mockData[k]); });

describe('Storage page', () => {
  beforeEach(() => {
    respond((c) => {
      if (c.method !== 'GET') return undefined;
      if (c.path === '/apis/storage.k8s.io/v1/storageclasses') return list([
        { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name: 'gp3', uid: 'a', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } }, provisioner: 'ebs' },
        { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name: 'fast', uid: 'b' }, provisioner: 'ebs' },
      ]);
      if (c.path === '/apis/storage.k8s.io/v1/csidrivers') return list([{ metadata: { name: 'ebs.csi.aws.com', uid: 'c' }, spec: {} }]);
      if (c.path.startsWith('/apis/snapshot.storage.k8s.io/v1/namespaces/shop/volumesnapshots')) return list([{ metadata: { name: 'snap-1', namespace: 'shop', uid: 's' }, spec: { source: { persistentVolumeClaimName: 'data' } }, status: { readyToUse: true } }]);
      return undefined;
    });
    mockData['/api/v1/persistentvolumes'] = [{
      apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: 'pv-old', uid: 'pv-u' },
      spec: { capacity: { storage: '5Gi' }, persistentVolumeReclaimPolicy: 'Retain', claimRef: { namespace: 'shop', name: 'gone' } },
      status: { phase: 'Released' },
    }];
  });

  it('Create PVC opens the create page for the selected namespace', async () => {
    setAllow({ 'create/persistentvolumeclaims': true });
    renderWithProviders(<StorageView />);
    const btn = () => screen.getByRole('button', { name: /Create PVC/ }) as HTMLButtonElement;
    await waitFor(() => expect(btn().disabled).toBe(false));
    fireEvent.click(btn());
    expect(goMock).toHaveBeenCalledWith('/create/v1~persistentvolumeclaims?ns=shop', 'Create PVC');
  });

  it('Set default on a non-default class swaps the annotation', async () => {
    setAllow({ 'patch/storageclasses': true });
    renderWithProviders(<StorageView />);
    const btn = () => screen.getByRole('button', { name: 'Set fast as default StorageClass' }) as HTMLButtonElement;
    await waitFor(() => expect(btn().disabled).toBe(false));
    expect(screen.queryByRole('button', { name: 'Set gp3 as default StorageClass' })).toBeNull();
    fireEvent.click(btn());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Set as default' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes().map((w) => w.path)).toEqual(['/apis/storage.k8s.io/v1/storageclasses/fast', '/apis/storage.k8s.io/v1/storageclasses/gp3']);
  });

  it('a Released PV can be deleted after a confirmation that says the data stays', async () => {
    setAllow({ 'delete/persistentvolumes': true });
    renderWithProviders(<StorageView />);
    const btn = () => screen.getByRole('button', { name: 'Delete PV pv-old' }) as HTMLButtonElement;
    await waitFor(() => expect(btn().disabled).toBe(false));
    fireEvent.click(btn());
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/backing storage is NOT deleted/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete PV' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', path: '/api/v1/persistentvolumes/pv-old', body: { preconditions: { uid: 'pv-u' } } });
  });

  it('a PV with reclaim policy Delete warns that the backing volume will be destroyed', async () => {
    setAllow({ 'delete/persistentvolumes': true });
    (mockData['/api/v1/persistentvolumes'][0] as { spec: Record<string, unknown> }).spec.persistentVolumeReclaimPolicy = 'Delete';
    renderWithProviders(<StorageView />);
    const btn = () => screen.getByRole('button', { name: 'Delete PV pv-old' }) as HTMLButtonElement;
    await waitFor(() => expect(btn().disabled).toBe(false));
    fireEvent.click(btn());
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/backing volume will be destroyed/);
    expect(within(dialog).getByRole('button', { name: 'Delete PV and volume' })).toBeTruthy();
  });

  it('PV delete is disabled without permission', async () => {
    setAllow({});
    renderWithProviders(<StorageView />);
    const btn = screen.getByRole('button', { name: 'Delete PV pv-old' }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(btn.title).toMatch(/permission/);
  });

  it('CSI driver and snapshot rows open their detail pages', async () => {
    renderWithProviders(<StorageView />);
    fireEvent.click(await screen.findByRole('button', { name: /ebs\.csi\.aws\.com/ }));
    expect(goMock).toHaveBeenCalledWith('/r/storage.k8s.io~v1~csidrivers/_/ebs.csi.aws.com', 'ebs.csi.aws.com');
    fireEvent.click(await screen.findByRole('button', { name: /snap-1/ }));
    expect(goMock).toHaveBeenCalledWith('/r/snapshot.storage.k8s.io~v1~volumesnapshots/shop/snap-1', 'snap-1');
  });
});

describe('Networking page', () => {
  it('create buttons open the create page for the kind, in the selected namespace', async () => {
    setAllow({ 'create/services': true, 'create/routes': true, 'create/ingresses': true });
    renderWithProviders(<NetworkingView />);
    for (const [label, path] of [['Service', '/create/v1~services?ns=shop'], ['Route', '/create/route.openshift.io~v1~routes?ns=shop'], ['Ingress', '/create/networking.k8s.io~v1~ingresses?ns=shop']]) {
      const btn = () => screen.getByRole('button', { name: label }) as HTMLButtonElement;
      await waitFor(() => expect(btn().disabled).toBe(false));
      fireEvent.click(btn());
      expect(goMock).toHaveBeenLastCalledWith(path, `Create ${label}`);
    }
  });

  it('lists services whose selector matches no ready pod, using the endpoints already fetched', async () => {
    mockData['/api/v1/services'] = [
      { metadata: { name: 'web', namespace: 'shop', uid: '1' }, spec: { selector: { app: 'web' } } },
      { metadata: { name: 'api', namespace: 'shop', uid: '2' }, spec: { selector: { app: 'api' } } },
    ];
    respond((c) => (c.method === 'GET' && c.path === '/api/v1/namespaces/shop/endpoints'
      ? list([{ metadata: { name: 'web', namespace: 'shop' }, subsets: [{ addresses: [{ ip: '1' }] }] }, { metadata: { name: 'api', namespace: 'shop' }, subsets: [] }])
      : undefined));
    renderWithProviders(<NetworkingView />);
    expect(await screen.findByText('Services with no ready endpoints (1)')).toBeTruthy();
    expect(screen.getByText('1 service with no ready endpoints')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^api/ }));
    expect(goMock).toHaveBeenCalledWith('/r/v1~services/shop/api', 'api');
  });

  it('when endpoints cannot be read, no service is reported as having none', async () => {
    mockData['/api/v1/services'] = [{ metadata: { name: 'api', namespace: 'shop', uid: '2' }, spec: { selector: { app: 'api' } } }];
    respond((c) => (c.path === '/api/v1/namespaces/shop/endpoints' ? json({ message: 'forbidden', code: 403 }, 403) : undefined));
    renderWithProviders(<NetworkingView />);
    await waitFor(() => expect(writes()).toHaveLength(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/with no ready endpoints/)).toBeNull();
  });
});

describe('Project dashboard', () => {
  const renderProject = () => renderWithProviders(
    <Routes><Route path="/project/:namespace" element={<ProjectDashboard />} /></Routes>,
    '/project/shop',
  );

  it('summary cards open the filtered lists', () => {
    renderProject();
    fireEvent.click(screen.getByRole('button', { name: /^Deployments: 0/ }));
    expect(goMock).toHaveBeenCalledWith('/r/apps~v1~deployments?ns=shop', 'Deployments (shop)');
    fireEvent.click(screen.getByRole('button', { name: /^Events/ }));
    expect(goMock).toHaveBeenCalledWith('/r/v1~events?ns=shop', 'Events (shop)');
  });

  it('shows Routes (with https URL for TLS), PVCs and quota usage', () => {
    mockData['/apis/route.openshift.io/v1/routes'] = [{ metadata: { name: 'shop', namespace: 'shop', uid: 'r' }, spec: { host: 'shop.apps.example.com', tls: { termination: 'edge' } } }];
    mockData['/api/v1/persistentvolumeclaims'] = [{ metadata: { name: 'data', namespace: 'shop', uid: 'p' }, spec: { storageClassName: 'gp3', resources: { requests: { storage: '10Gi' } } }, status: { phase: 'Bound' } }];
    mockData['/api/v1/resourcequotas'] = [{ metadata: { name: 'compute', namespace: 'shop', uid: 'q' }, status: { hard: { 'requests.cpu': '4', 'requests.memory': '8Gi' }, used: { 'requests.cpu': '3600m', 'requests.memory': '2Gi' } } }];
    renderProject();
    expect(screen.getByText('https://shop.apps.example.com')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open https://shop.apps.example.com' }).getAttribute('href')).toBe('https://shop.apps.example.com');
    expect(screen.getByText(/10Gi · gp3/)).toBeTruthy();
    expect(screen.getByText('3600m / 4 (90%)')).toBeTruthy();
    expect(screen.getByText('2Gi / 8Gi (25%)')).toBeTruthy();
  });

  it('says when no quota limits the project', () => {
    renderProject();
    expect(screen.getByText(/No ResourceQuota in this project/)).toBeTruthy();
  });
});
