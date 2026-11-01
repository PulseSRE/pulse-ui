/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useArgoCDStore } from '../../store/argoCDStore';

// Mock query module
vi.mock('../../engine/query', () => ({
  k8sList: vi.fn().mockResolvedValue([]),
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sPatch: vi.fn().mockResolvedValue({}),
}));

// Mock useNavigateTab
vi.mock('../../hooks/useNavigateTab', () => ({
  useNavigateTab: () => vi.fn(),
}));

// Mock useArgoCD to prevent auto-detection overriding store state
const mockUseArgoCD = vi.fn();
vi.mock('../../hooks/useArgoCD', () => ({
  useArgoCD: () => mockUseArgoCD(),
  useArgoCDRefresh: () => vi.fn(),
}));

// Mock useUIStore
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: any) => any) => {
    const state = { addToast: vi.fn(), selectedNamespace: '*' };
    return selector(state);
  }, { getState: () => ({ impersonateUser: '', impersonateGroups: [] }) }),
}));

import ArgoCDView from '../ArgoCDView';

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ArgoCDView />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ArgoCDView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useArgoCDStore.setState({ applicationsError: null, rolloutsAvailable: false, rollouts: [], rolloutsError: null });
  });
  afterEach(cleanup);

  it('shows setup wizard CTA when ArgoCD is unavailable', () => {
    mockUseArgoCD.mockReturnValue({ available: false, detecting: false, applications: [], applicationsLoading: false, namespace: null });
    renderView();
    expect(screen.getByText('Set Up GitOps')).toBeDefined();
  });

  it('renders GitOps heading when ArgoCD is available', () => {
    mockUseArgoCD.mockReturnValue({ available: true, detecting: false, applications: [], applicationsLoading: false, namespace: 'openshift-gitops' });
    renderView();
    expect(screen.getAllByText(/GitOps/).length).toBeGreaterThanOrEqual(1);
  });

  it('counts apps in the stat cards only; Missing counts as unhealthy; Out of Sync opens Drift', () => {
    const app = (name: string, sync: string, health: string) => ({ apiVersion: 'argoproj.io/v1alpha1', kind: 'Application', metadata: { name, namespace: 'openshift-gitops', uid: name }, status: { sync: { status: sync }, health: { status: health }, resources: [] } });
    mockUseArgoCD.mockReturnValue({ available: true, detecting: false, applications: [app('a', 'OutOfSync', 'Missing'), app('b', 'Synced', 'Healthy')], applicationsLoading: false, namespace: 'openshift-gitops' });
    renderView();
    expect(screen.queryByRole('tab', { name: /\(\d+\)/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show degraded applications' }).textContent).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: 'Show drift' }));
    expect(screen.getByRole('tab', { name: 'Drift' }).getAttribute('aria-selected')).toBe('true');
    window.history.replaceState(null, '', '/');
  });

  it('renders application count cards', () => {
    const apps = [
      { apiVersion: 'argoproj.io/v1alpha1', kind: 'Application', metadata: { name: 'app1', namespace: 'openshift-gitops', uid: '1' }, status: { sync: { status: 'Synced' }, health: { status: 'Healthy' }, resources: [] } },
      { apiVersion: 'argoproj.io/v1alpha1', kind: 'Application', metadata: { name: 'app2', namespace: 'openshift-gitops', uid: '2' }, status: { sync: { status: 'OutOfSync' }, health: { status: 'Degraded' }, resources: [] } },
    ];
    mockUseArgoCD.mockReturnValue({ available: true, detecting: false, applications: apps, applicationsLoading: false, namespace: 'openshift-gitops' });
    renderView();

    // Tab + summary card both show application info
    expect(screen.getAllByText(/Applications/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Out of Sync/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Degraded/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders tabs', () => {
    mockUseArgoCD.mockReturnValue({ available: true, detecting: false, applications: [], applicationsLoading: false, namespace: 'openshift-gitops' });
    renderView();
    expect(screen.getAllByText(/Applications/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Sync History/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Drift/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows a load error, not "No ArgoCD Applications found", when the list failed', () => {
    useArgoCDStore.setState({ applicationsError: 'Permission denied (403)' });
    mockUseArgoCD.mockReturnValue({ available: true, detecting: false, applications: [], applicationsLoading: false, namespace: 'openshift-gitops' });
    renderView();
    expect(screen.getByRole('alert').textContent).toContain('ArgoCD Applications could not be loaded');
    expect(screen.queryByText(/No ArgoCD Applications found/)).toBeNull();
    useArgoCDStore.setState({ applicationsError: null });
  });

  it('shows the Rollouts tab once detection reports rollouts (subscribes to the store)', () => {
    useArgoCDStore.setState({ rolloutsAvailable: false, rollouts: [] });
    mockUseArgoCD.mockReturnValue({ available: true, detecting: false, applications: [], applicationsLoading: false, namespace: 'openshift-gitops' });
    renderView();
    expect(screen.queryByRole('tab', { name: 'Rollouts' })).toBeNull();
    act(() => { useArgoCDStore.setState({ rolloutsAvailable: true }); });
    expect(screen.getByRole('tab', { name: 'Rollouts' })).toBeTruthy();
    useArgoCDStore.setState({ rolloutsAvailable: false });
  });

  it('shows empty state when no applications', () => {
    mockUseArgoCD.mockReturnValue({ available: true, detecting: false, applications: [], applicationsLoading: false, namespace: 'openshift-gitops' });
    renderView();
    expect(screen.getAllByText(/No ArgoCD Applications found/).length).toBeGreaterThanOrEqual(1);
  });
});
