// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ---- Mocks ----

const navigateMock = vi.fn();
const addTabMock = vi.fn();
const addToastMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = {
      addToast: addToastMock,
      addTab: addTabMock,
      selectedNamespace: 'default',
      setDockContext: vi.fn(),
    };
    return selector(state);
  },
}));

vi.mock('../../store/clusterStore', () => ({
  useClusterStore: (selector: any) => {
    const state = { resourceRegistry: new Map() };
    return selector(state);
  },
}));

const mockK8sGet = vi.fn();
const mockK8sList = vi.fn();

vi.mock('../../engine/query', () => ({
  k8sGet: (...args: any[]) => mockK8sGet(...args),
  k8sList: (...args: any[]) => mockK8sList(...args),
  k8sDelete: vi.fn().mockResolvedValue({}),
  k8sPatch: vi.fn().mockResolvedValue({}),
  sanitizePromQL: (v: string) => v.replace(/[^a-zA-Z0-9_\-./]/g, ''),
}));

vi.mock('../../engine/favorites', () => ({
  toggleFavorite: vi.fn(() => true),
  isFavorite: vi.fn(() => false),
}));

vi.mock('../../components/metrics/prometheus', () => ({
  queryInstant: vi.fn().mockResolvedValue([]),
  queryRange: vi.fn().mockResolvedValue([]),
  getTimeRange: vi.fn().mockReturnValue([0, 1]),
  metricsAvailableFor: () => true,
}));

vi.mock('../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div>,
  Sparkline: () => <div data-testid="sparkline" />,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../components/PodTerminal', () => ({
  default: ({ onClose }: any) => <div data-testid="pod-terminal"><button onClick={onClose}>Close Terminal</button></div>,
}));

vi.mock('../../components/DataEditor', () => ({
  default: () => <div data-testid="data-editor">DataEditor</div>,
}));

vi.mock('../../components/DeployProgress', () => ({
  default: () => <div data-testid="deploy-progress">DeployProgress</div>,
}));

// RBAC: deny both delete and update
vi.mock('../../hooks/useCanI', () => ({
  useCanI: () => ({ allowed: false, isLoading: false }),
  useCanDelete: () => ({ allowed: false, isLoading: false }),
  useCanCreate: () => ({ allowed: false, isLoading: false }),
  useCanUpdate: () => ({ allowed: false, isLoading: false }),
}));

import DetailView from '../DetailView';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function makeDeployment() {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: 'my-deployment',
      namespace: 'default',
      uid: 'deploy-uid-123',
      creationTimestamp: '2025-01-01T00:00:00Z',
      resourceVersion: '99999',
      labels: { app: 'web' },
      annotations: {},
    },
    spec: {
      replicas: 3,
      selector: { matchLabels: { app: 'web' } },
      template: { metadata: { labels: { app: 'web' } }, spec: { containers: [{ name: 'web', image: 'nginx' }] } },
    },
    status: {
      availableReplicas: 3,
      readyReplicas: 3,
      replicas: 3,
      conditions: [
        { type: 'Available', status: 'True', reason: 'MinimumReplicasAvailable', lastTransitionTime: '2025-01-01T00:00:00Z' },
      ],
    },
  };
}

function renderDetailView(props: { gvrKey: string; namespace?: string; name: string }) {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DetailView {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DetailView RBAC disabled buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockK8sList.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('scale, restart and pause are in the actions menu, disabled with the reason, when update is denied', async () => {
    mockK8sGet.mockResolvedValue(makeDeployment());

    renderDetailView({ gvrKey: 'apps/v1/deployments', namespace: 'default', name: 'my-deployment' });

    await waitFor(() => {
      expect(screen.getAllByText('my-deployment').length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getByTitle('More actions'));
    for (const label of ['Set replicas…', 'Restart rollout', 'Pause rollout']) {
      const item = screen.getByRole('menuitem', { name: label }) as HTMLButtonElement;
      expect(item.disabled).toBe(true);
      expect(item.getAttribute('title')).toMatch(/permission/);
    }
  });

  it('shows delete menu item as disabled with tooltip when canDelete is false', async () => {
    mockK8sGet.mockResolvedValue(makeDeployment());

    renderDetailView({ gvrKey: 'apps/v1/deployments', namespace: 'default', name: 'my-deployment' });

    await waitFor(() => {
      expect(screen.getAllByText('my-deployment').length).toBeGreaterThanOrEqual(1);
    });

    // Open the more actions menu
    const moreButton = screen.getByTitle('More actions');
    fireEvent.click(moreButton);

    // Delete menu item should show "no permission" text
    const deleteItem = screen.getByText('Delete (no permission)');
    expect(deleteItem).toBeDefined();

    // Should be disabled
    const deleteBtn = deleteItem.closest('button');
    expect(deleteBtn).toHaveProperty('disabled', true);
  });
});
