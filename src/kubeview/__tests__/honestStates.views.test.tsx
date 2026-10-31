// @vitest-environment jsdom
/**
 * Wave 2, page level: pages rendered with their reads failing show an error
 * or unknown state — never "removed", "Intermediate", 0, "None (leaf node)",
 * "Running" for a crashlooping pod, or a made-up admin identity.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

const listWatch: Record<string, { data?: unknown[]; isError?: boolean; isLoading?: boolean }> = {};
vi.mock('../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => {
    const r = listWatch[apiPath] ?? { data: [] };
    return { data: r.data, isLoading: !!r.isLoading, isError: !!r.isError, error: r.isError ? new Error('forbidden') : null, refetch: vi.fn() };
  },
}));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../hooks/usePulseStatus', () => ({ usePulseUpgrade: () => ({ data: null }) }));
vi.mock('../components/metrics/Sparkline', () => ({ MetricCard: ({ title }: { title: string }) => <div>{title}</div>, Sparkline: () => <div /> }));
vi.mock('../components/metrics/MetricsChart', () => ({ MetricsChart: () => <div data-testid="chart" /> }));
vi.mock('../components/topology/GraphRenderer', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../components/topology/GraphRenderer');
  return {
    ...actual,
    default: ({ nodes, setSelectedNode }: { nodes: Array<{ id: string }>; setSelectedNode: (id: string) => void }) => (
      <button type="button" onClick={() => setSelectedNode(nodes[0].id)}>select first node</button>
    ),
  };
});

import { mockFetchRoutes, renderWithClient, renderWithFailedRequests, expectNoAllClear } from './helpers/honestStates';
import IdentityView from '../views/IdentityView';
import TopologyView from '../views/TopologyView';
import ProjectDashboard from '../views/ProjectDashboard';
import { CommandBar } from '../components/CommandBar';
import { UsageTab } from '../views/toolbox/UsageTab';
import { useToolUsageStore } from '../store/toolUsageStore';

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const k of Object.keys(listWatch)) delete listWatch[k];
});

function auditRow(label: string) {
  return screen.getByText(label).closest('div.px-4') as HTMLElement;
}

describe('IdentityView', () => {
  it('refreshes the kubeadmin check after removing it (invalidates the secret query)', async () => {
    let deleted = false;
    mockFetchRoutes({
      '/secrets/kubeadmin': (_url, init) => {
        if (init?.method === 'DELETE') { deleted = true; return { body: { status: 'Success' } }; }
        return deleted ? { status: 404, body: { code: 404 } } : { body: { metadata: { name: 'kubeadmin' } } };
      },
      'oauths/cluster': { body: { spec: { identityProviders: [{ name: 'ldap', type: 'LDAP' }] } } },
      'users/~': { body: { metadata: { name: 'alice' } } },
    }, 404);
    renderWithClient(<IdentityView />);
    const title = await screen.findByText('kubeadmin Removed');
    await waitFor(() => expect(title.parentElement!.textContent).toMatch(/1 need attention/));
    fireEvent.click(title.closest('button')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove kubeadmin' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove kubeadmin' }));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.getByText('kubeadmin Removed').parentElement!.textContent).toMatch(/1 pass/));
  });

  it('does not report kubeadmin as removed when the secret cannot be read', async () => {
    renderWithFailedRequests(<IdentityView />, { status: 403 });
    const title = await screen.findByText('kubeadmin Removed');
    await waitFor(() => expect(title.parentElement!.textContent).toMatch(/1 need attention/));
    fireEvent.click(title.closest('button')!);
    expect(await screen.findByText(/Unknown — could not read kube-system\/kubeadmin \(Permission denied \(403\)\)/)).toBeTruthy();
  });
});

describe('TopologyView', () => {
  it('shows an error, not "None (leaf node)", when the blast-radius lookup fails', async () => {
    mockFetchRoutes({
      '/api/agent/topology/blast-radius': { status: 500, body: { detail: 'boom' } },
      '/api/agent/topology': { body: { nodes: [{ id: 'Deployment/web/api', kind: 'Deployment', name: 'api', namespace: 'web', status: 'healthy' }], edges: [], summary: { nodes: 1, edges: 0, kinds: {}, last_refresh: 0 } } },
    });
    renderWithClient(<TopologyView />);
    fireEvent.click(await screen.findByText('select first node'));
    await waitFor(() => expect(screen.getByText(/Downstream could not be loaded/)).toBeTruthy());
    expect(screen.queryByText('None (leaf node)')).toBeNull();
  });
});

describe('ProjectDashboard', () => {
  it('counts a CrashLoopBackOff pod as failing, not running', async () => {
    listWatch['/api/v1/pods'] = {
      data: [{
        metadata: { name: 'api-1', namespace: 'shop', uid: 'p1' },
        status: { phase: 'Running', containerStatuses: [{ name: 'api', ready: false, restartCount: 9, state: { waiting: { reason: 'CrashLoopBackOff' } } }] },
      }],
    };
    mockFetchRoutes({ '/api/prometheus': { body: { status: 'success', data: { result: [] } } } });
    renderWithClient(
      <Routes><Route path="/project/:namespace" element={<ProjectDashboard />} /></Routes>,
      { route: '/project/shop' },
    );
    const row = (await screen.findByText('api-1')).closest('button')!;
    expect(row.textContent).toContain('CrashLoopBackOff');
    expect(row.querySelector('.text-emerald-500')).toBeNull();
  });

  it('counts initializing pods as pending, not failing', async () => {
    listWatch['/api/v1/pods'] = {
      data: [
        { metadata: { name: 'init-1', namespace: 'shop', uid: 'i1' }, status: { phase: 'Pending', initContainerStatuses: [{ name: 'setup', ready: false, restartCount: 0, state: { waiting: { reason: 'PodInitializing' } } }] } },
        { metadata: { name: 'init-2', namespace: 'shop', uid: 'i2' }, status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: false, restartCount: 0, state: { waiting: { reason: 'PodInitializing' } } }] } },
      ],
    };
    mockFetchRoutes({ '/api/prometheus': { body: { status: 'success', data: { result: [] } } } });
    renderWithClient(
      <Routes><Route path="/project/:namespace" element={<ProjectDashboard />} /></Routes>,
      { route: '/project/shop' },
    );
    await screen.findByText('init-1');
    expect(screen.getByText('2 pending')).toBeTruthy();
    expect(screen.queryByText(/failing/)).toBeNull();
  });

  it('counts every warning event and lists the newest first', async () => {
    const ev = (i: number) => ({ type: 'Warning', reason: `R${i}`, message: `m${i}`, metadata: { uid: `e${i}`, name: `e${i}` }, lastTimestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), involvedObject: { kind: 'Pod', name: 'p' } });
    listWatch['/api/v1/events'] = { data: Array.from({ length: 12 }, (_, i) => ev(i)) };
    mockFetchRoutes({ '/api/prometheus': { body: { status: 'success', data: { result: [] } } } });
    renderWithClient(
      <Routes><Route path="/project/:namespace" element={<ProjectDashboard />} /></Routes>,
      { route: '/project/shop' },
    );
    expect(await screen.findByText(/Recent Warning Events \(12, newest 10 shown\)/)).toBeTruthy();
    const reasons = screen.getAllByText(/^R\d+$/).map((el) => el.textContent);
    expect(reasons[0]).toBe('R11');
    expect(reasons).not.toContain('R0');
  });

  it('shows a metrics error, not "No data available", when Prometheus fails', async () => {
    renderWithFailedRequests(
      <Routes><Route path="/project/:namespace" element={<ProjectDashboard />} /></Routes>,
      { status: 503, route: '/project/shop' },
    );
    await waitFor(() => expect(screen.getAllByText(/metrics could not be loaded/).length).toBeGreaterThan(0));
    expectNoAllClear();
  });
});

describe('CommandBar', () => {
  it('shows "Unknown user" with no role, not admin / Cluster Administrator, when the lookup fails', async () => {
    renderWithFailedRequests(<CommandBar />, { status: 403 });
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    await waitFor(() => expect(screen.getByText('Unknown user')).toBeTruthy());
    expect(screen.queryByText('Cluster Administrator')).toBeNull();
    expect(screen.queryByText('admin')).toBeNull();
  });

  it('derives the role from a SelfSubjectAccessReview', async () => {
    const fetchMock = mockFetchRoutes({
      'users/~': { body: { metadata: { name: 'kube:admin' }, groups: [] } },
      'selfsubjectaccessreviews': { body: { status: { allowed: true } } },
    }, 404);
    renderWithClient(<CommandBar />);
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    await waitFor(() => expect(screen.getByText('kube:admin')).toBeTruthy());
    expect(screen.getByText('Cluster Administrator')).toBeTruthy();
    const ssar = fetchMock.mock.calls.find(([u]) => String(u).includes('selfsubjectaccessreviews'))!;
    expect((ssar[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((ssar[1] as RequestInit).body)).spec.resourceAttributes).toEqual({ verb: '*', group: '*', resource: '*' });
  });
});

describe('CommandBar impersonation', () => {
  it('asks the SelfSubjectAccessReview as the impersonated user', async () => {
    const { useUIStore } = await import('../store/uiStore');
    useUIStore.setState({ impersonateUser: 'bob', impersonateGroups: [] });
    try {
      const fetchMock = mockFetchRoutes({ 'selfsubjectaccessreviews': { body: { status: { allowed: false } } } }, 404);
      renderWithClient(<CommandBar />);
      await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('selfsubjectaccessreviews'))).toBe(true));
      const ssar = fetchMock.mock.calls.find(([u]) => String(u).includes('selfsubjectaccessreviews'))!;
      expect((ssar[1] as RequestInit).headers).toMatchObject({ 'Impersonate-User': 'bob' });
    } finally {
      cleanup(); // unmount before the impersonation change re-keys the query
      useUIStore.setState({ impersonateUser: '', impersonateGroups: [] });
    }
  });
});

describe('UsageTab', () => {
  beforeEach(() => useToolUsageStore.setState({ usage: null, usageLoading: false, usageError: null }));

  it('shows an error, not "No tool usage recorded yet", when the usage read fails, and lists skills from the agent', async () => {
    mockFetchRoutes({
      '/api/agent/skills': { body: [{ name: 'sre' }, { name: 'my_custom_skill' }] },
      '/api/agent/tools/usage': { status: 500, body: { detail: 'db down' } },
    });
    renderWithClient(<UsageTab />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Tool usage could not be loaded'));
    expect(screen.queryByText('No tool usage recorded yet')).toBeNull();
    await waitFor(() => expect(screen.getByRole('option', { name: 'my custom skill' })).toBeTruthy());
  });
});
