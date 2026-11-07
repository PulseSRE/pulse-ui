/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock query module
const mockK8sList = vi.fn();
vi.mock('../../../engine/query', () => ({
  k8sList: (...args: any[]) => mockK8sList(...args),
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sPatch: vi.fn().mockResolvedValue({}),
  getImpersonationHeaders: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: any) => any) => {
    const state = { addToast: vi.fn(), selectedNamespace: '*' };
    return selector(state);
  }, { getState: () => ({ impersonateUser: '', impersonateGroups: [] }) }),
}));

import { ProjectsTab } from '../ProjectsTab';

let qc: QueryClient | undefined;
function renderTab() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectsTab />
    </QueryClientProvider>
  );
}

describe('ProjectsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    qc?.clear();
  });

  it.each([
    ['403', Object.assign(new Error('appprojects.argoproj.io is forbidden: User "dev" cannot list resource'), { statusCode: 403 }), /Permission denied/],
    ['500', Object.assign(new Error('etcdserver: request timed out'), { statusCode: 500 }), /server returned an error \(status 500\)/],
  ])('a %s read shows the reason and Retry, never "No AppProjects"', async (_label, err, reason) => {
    mockK8sList.mockRejectedValue(err);
    renderTab();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('AppProjects could not be loaded');
    expect(alert.textContent).toMatch(reason);
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(screen.queryByText('No AppProjects')).toBeNull();
  });

  it('shows empty state when no projects exist', async () => {
    mockK8sList.mockResolvedValue([]);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('No AppProjects')).toBeDefined();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('renders project cards with name and description', async () => {
    mockK8sList.mockResolvedValue([
      {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'AppProject',
        metadata: { name: 'my-project', uid: 'p1' },
        spec: {
          description: 'A test project',
          sourceRepos: ['https://github.com/org/repo.git'],
          destinations: [{ server: 'https://kubernetes.default.svc', namespace: 'production' }],
          roles: [{ name: 'admin' }],
        },
      },
    ]);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeDefined();
      expect(screen.getByText('A test project')).toBeDefined();
      expect(screen.getByText('1 role')).toBeDefined();
    });
  });

  it('shows default project with special badge', async () => {
    mockK8sList.mockResolvedValue([
      {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'AppProject',
        metadata: { name: 'default', uid: 'p-default' },
        spec: {
          description: 'Catch-all project',
          sourceRepos: ['*'],
          destinations: [{ server: '*', namespace: '*' }],
          roles: [],
        },
      },
    ]);
    renderTab();
    await waitFor(() => {
      // Name + badge both show "default"
      const defaults = screen.getAllByText('default');
      expect(defaults.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('* (all)')).toBeDefined();
    });
  });

  it('sorts default project first', async () => {
    mockK8sList.mockResolvedValue([
      { apiVersion: 'argoproj.io/v1alpha1', kind: 'AppProject', metadata: { name: 'zebra', uid: 'z1' }, spec: {} },
      { apiVersion: 'argoproj.io/v1alpha1', kind: 'AppProject', metadata: { name: 'default', uid: 'd1' }, spec: {} },
      { apiVersion: 'argoproj.io/v1alpha1', kind: 'AppProject', metadata: { name: 'alpha', uid: 'a1' }, spec: {} },
    ]);
    renderTab();
    await waitFor(() => {
      const zebra = screen.getByText('zebra');
      const defaultEl = screen.getAllByText('default')[0];
      const alphaEl = screen.getByText('alpha');
      // default should come before alpha and zebra in DOM order
      expect(defaultEl.compareDocumentPosition(alphaEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(defaultEl.compareDocumentPosition(zebra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it('shows error state on fetch failure', async () => {
    mockK8sList.mockRejectedValue(new Error('Forbidden'));
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('AppProjects could not be loaded')).toBeDefined();
      expect(screen.getByText('Forbidden')).toBeDefined();
    });
  });

  it('shows plural roles count', async () => {
    mockK8sList.mockResolvedValue([
      {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'AppProject',
        metadata: { name: 'multi-role', uid: 'mr1' },
        spec: { roles: [{ name: 'admin' }, { name: 'viewer' }, { name: 'editor' }] },
      },
    ]);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('3 roles')).toBeDefined();
    });
  });
});
