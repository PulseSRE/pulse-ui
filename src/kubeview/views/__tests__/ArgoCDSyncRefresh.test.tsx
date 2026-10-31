// @vitest-environment jsdom
/**
 * "Sync" only set the hard-refresh annotation: Argo re-read Git and nothing
 * was applied. Sync now starts a sync operation (target revision from the
 * app spec, optional prune); Refresh is a separate control that says it
 * applies nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const k8sPatch = vi.fn();
vi.mock('../../engine/query', () => ({
  k8sList: vi.fn().mockResolvedValue([]),
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sPatch: (...a: unknown[]) => k8sPatch(...a),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
const mockUseArgoCD = vi.fn();
vi.mock('../../hooks/useArgoCD', () => ({ useArgoCD: () => mockUseArgoCD(), useArgoCDRefresh: () => vi.fn() }));
const addToast = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign((sel: (s: any) => any) => sel({ addToast, selectedNamespace: '*' }), {
    getState: () => ({ impersonateUser: '', impersonateGroups: [], addToast }),
  }),
}));
const showErrorToast = vi.fn();
vi.mock('../../engine/errorToast', () => ({ showErrorToast: (...a: unknown[]) => showErrorToast(...a) }));

import ArgoCDView from '../ArgoCDView';

const app = (over: Record<string, unknown> = {}) => ({
  apiVersion: 'argoproj.io/v1alpha1', kind: 'Application',
  metadata: { name: 'shop', namespace: 'openshift-gitops', uid: 'a1' },
  spec: { project: 'default', destination: { namespace: 'shop' }, source: { repoURL: 'https://git/x.git', path: 'k8s', targetRevision: 'release-2' } },
  status: { sync: { status: 'OutOfSync' }, health: { status: 'Healthy' }, resources: [] },
  ...over,
});

function renderView(apps: unknown[]) {
  mockUseArgoCD.mockReturnValue({ available: true, detecting: false, applications: apps, applicationsLoading: false, namespace: 'openshift-gitops' });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ArgoCDView /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); k8sPatch.mockResolvedValue({}); });
afterEach(() => cleanup());

describe('Argo CD Sync vs Refresh', () => {
  it('Sync confirms, then patches operation.sync with the spec revision', async () => {
    renderView([app()]);
    fireEvent.click(screen.getByRole('button', { name: 'Sync shop' }));
    expect(screen.getByText('Sync shop?')).toBeTruthy();
    expect(k8sPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalledTimes(1));
    const [path, body, type, cluster] = k8sPatch.mock.calls[0];
    expect(path).toBe('/apis/argoproj.io/v1alpha1/namespaces/openshift-gitops/applications/shop');
    expect(body).toEqual({ operation: { initiatedBy: { username: 'pulse-ui' }, sync: { revision: 'release-2' } } });
    expect(type).toBe('application/merge-patch+json');
    expect(cluster).toBe('local');
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sync started for shop' }));
  });

  it('Sync with prune asks Argo to prune', async () => {
    renderView([app()]);
    fireEvent.click(screen.getByRole('button', { name: 'Sync shop' }));
    fireEvent.click(screen.getByLabelText(/Prune resources/));
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalled());
    expect(k8sPatch.mock.calls[0][1].operation.sync).toEqual({ revision: 'release-2', prune: true });
  });

  it('multi-source apps sync each source revision', async () => {
    renderView([app({ spec: { project: 'default', destination: {}, sources: [{ repoURL: 'a', targetRevision: 'v1' }, { repoURL: 'b' }] } })]);
    fireEvent.click(screen.getByRole('button', { name: 'Sync shop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalled());
    expect(k8sPatch.mock.calls[0][1].operation.sync).toEqual({ revisions: ['v1', 'HEAD'] });
  });

  it('does not start a second sync while one is running', async () => {
    renderView([app({ status: { sync: { status: 'OutOfSync' }, health: { status: 'Healthy' }, operationState: { phase: 'Running' }, resources: [] } })]);
    fireEvent.click(screen.getByRole('button', { name: 'Sync shop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'shop is already syncing' })));
    expect(k8sPatch).not.toHaveBeenCalled();
  });

  it('Refresh sets only the hard-refresh annotation and says so', async () => {
    renderView([app()]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh shop' }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalled());
    expect(k8sPatch.mock.calls[0][1]).toEqual({ metadata: { annotations: { 'argocd.argoproj.io/refresh': 'hard' } } });
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Refresh requested for shop' }));
  });

  it('a rejected sync reports the failure', async () => {
    k8sPatch.mockRejectedValueOnce(new Error('forbidden'));
    renderView([app()]);
    fireEvent.click(screen.getByRole('button', { name: 'Sync shop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.any(Error), 'Sync failed'));
    expect(addToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Sync started for shop' }));
  });
});
