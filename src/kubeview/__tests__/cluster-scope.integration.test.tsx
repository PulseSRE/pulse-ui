// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useFleetStore } from '../store/fleetStore';
import { getAllConnections, registerCluster, resetConnections, getClusterBase } from '../engine/clusterConnection';
import { k8sGet, k8sPatch } from '../engine/query';
import { useTableActions } from '../views/table/TableActions';
import { useUIStore } from '../store/uiStore';
import { useArgoCDStore } from '../store/argoCDStore';

vi.mock('../components/Shell', async () => {
  const { Outlet } = await import('react-router-dom');
  return { Shell: () => <Outlet /> };
});
vi.mock('../routes', () => ({ resourceRoutes: () => null, domainRoutes: () => null }));
vi.mock('../views/CustomView', () => ({ default: () => null }));
vi.mock('../views/ClaimView', () => ({ default: () => null }));
vi.mock('../views/PulseView', () => ({ default: () => <TestDetail /> }));

// Deliberately unscoped key: App must isolate every domain/detail cache and dialog.
function TestDetail() {
  const [dialog, setDialog] = useState(false);
  const clusterId = useFleetStore(s => s.activeClusterId);
  const data = useQuery({ queryKey: ['detail', '/apis/apps/v1/namespaces/prod/deployments/web'], queryFn: () => k8sGet<{ replicas: number }>('/apis/apps/v1/namespaces/prod/deployments/web', clusterId) });
  return <>
    <p>replicas:{data.data?.replicas ?? 'loading'}</p>
    <button onClick={() => setDialog(true)}>Confirm scale</button>
    {dialog && <button onClick={() => k8sPatch('/apis/apps/v1/namespaces/prod/deployments/web', { spec: { replicas: 7 } }, undefined, clusterId)}>Apply scale</button>}
  </>;
}
import App from '../App';

beforeEach(() => {
  resetConnections();
  registerCluster({ id: 'b', name: 'B', connectionType: 'acm-proxy', target: 'b' });
  useFleetStore.setState({ activeClusterId: 'local', clusters: getAllConnections() });
  window.history.replaceState({}, '', '/pulse');
});
afterEach(() => { cleanup(); resetConnections(); useFleetStore.setState({ activeClusterId: 'local' }); vi.unstubAllGlobals(); });

describe('same-name cluster object isolation', () => {
  it('clears old cached detail and pending dialog when cluster changes', async () => {
    let releaseB!: (response: unknown) => void;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return Promise.resolve({ ok: true, json: async () => ({}) });
      if (url.includes('/managedclusters/b/')) return new Promise(resolve => { releaseB = resolve; });
      return Promise.resolve({ ok: true, json: async () => ({ replicas: 3 }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByText('replicas:3');
    fireEvent.click(screen.getByText('Confirm scale'));
    expect(screen.getByText('Apply scale')).toBeDefined();
    act(() => useFleetStore.getState().setActiveCluster('b'));
    expect(screen.queryByText('replicas:3')).toBeNull();
    expect(screen.queryByText('Apply scale')).toBeNull();
    await waitFor(() => expect(releaseB).toBeDefined());
    releaseB({ ok: true, json: async () => ({ replicas: 5 }) });
    await screen.findByText('replicas:5');
    fireEvent.click(screen.getByText('Confirm scale'));
    fireEvent.click(screen.getByText('Apply scale'));
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('/managedclusters/b/proxy/apis/apps/v1/namespaces/prod/deployments/web');
  });

  it('an old table action callback retains A even after unmount and switch to B', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    const resource = { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'web', namespace: 'prod', uid: 'a-web' }, spec: { replicas: 3 } };
    const { result, unmount } = renderHook(() => useTableActions({ apiPath: '/apis/apps/v1/deployments', gvrKey: 'apps/v1/deployments', sortedResources: [resource], stampedResources: [resource], visibleColumns: [], resourceKind: 'Deployment', selectedRows: new Set(), setSelectedRows: vi.fn() }), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    const callback = result.current.handleAction;
    unmount();
    act(() => useFleetStore.getState().setActiveCluster('b'));
    await callback('scale', { resource, delta: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/kubernetes/apis/apps/v1/namespaces/prod/deployments/web');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).spec.replicas).toBe(4);
    client.clear();
  });

  it('rejects an unknown explicit target instead of mutating local', () => {
    expect(() => getClusterBase('missing')).toThrow('Unknown cluster');
  });
});


it('clears retained terminal/action contexts and rejects a late A terminal on B', () => {
  useUIStore.getState().openTerminal({ namespace: 'prod', podName: 'web', containerName: 'app', clusterId: 'local' });
  useUIStore.getState().setDockContext({ namespace: 'prod', podName: 'web' });
  useUIStore.getState().openActionPanel({ metadata: { name: 'web' } });
  useFleetStore.getState().setActiveCluster('b');
  expect(useUIStore.getState().terminalContext).toBeNull();
  expect(useUIStore.getState().dockContext).toBeNull();
  expect(useUIStore.getState().actionPanelResource).toBeNull();
  useUIStore.getState().openTerminal({ namespace: 'prod', podName: 'web', containerName: 'app', clusterId: 'local' });
  expect(useUIStore.getState().terminalContext).toBeNull();
});

it('does not publish an unknown active cluster while requests still use local', () => {
  useFleetStore.getState().setActiveCluster('missing');
  expect(useFleetStore.getState().activeClusterId).toBe('local');
});

it('discards an Argo application load completing after a cluster switch', async () => {
  let release!: (response: unknown) => void;
  vi.stubGlobal('fetch', () => new Promise(resolve => { release = resolve; }));
  const loading = useArgoCDStore.getState().loadApplications();
  useFleetStore.getState().setActiveCluster('b');
  release({ ok: true, json: async () => ({ apiVersion: 'argoproj.io/v1alpha1', kind: 'ApplicationList', items: [{ metadata: { name: 'a-only', namespace: 'argocd' } }] }) });
  await loading;
  expect(useArgoCDStore.getState().applications).toEqual([]);
  expect(useArgoCDStore.getState().resourceCache.size).toBe(0);
});
