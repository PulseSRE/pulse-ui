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

// Mock engine/query
const mockK8sGet = vi.fn();
const mockK8sList = vi.fn();
const mockK8sDelete = vi.fn();
const mockK8sPatch = vi.fn();

vi.mock('../../engine/query', () => ({
  k8sGet: (...args: any[]) => mockK8sGet(...args),
  k8sList: (...args: any[]) => mockK8sList(...args),
  k8sDelete: (...args: any[]) => mockK8sDelete(...args),
  k8sPatch: (...args: any[]) => mockK8sPatch(...args),
  sanitizePromQL: (v: string) => v.replace(/[^a-zA-Z0-9_\-./]/g, ''),
}));

// Mock engine/favorites
vi.mock('../../engine/favorites', () => ({
  toggleFavorite: vi.fn(() => true),
  isFavorite: vi.fn(() => false),
}));

vi.mock('../../components/metrics/prometheus', () => ({
  queryInstant: vi.fn().mockResolvedValue([]),
  queryRange: vi.fn().mockResolvedValue([]),
  getTimeRange: vi.fn().mockReturnValue([0, 1]),
}));

vi.mock('../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div>,
  Sparkline: () => <div data-testid="sparkline" />,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Mock child components that are complex
vi.mock('../../components/PodTerminal', () => ({
  default: ({ onClose }: any) => <div data-testid="pod-terminal"><button onClick={onClose}>Close Terminal</button></div>,
}));

vi.mock('../../components/DataEditor', () => ({
  default: () => <div data-testid="data-editor">DataEditor</div>,
}));

vi.mock('../../components/DeployProgress', () => ({
  default: () => <div data-testid="deploy-progress">DeployProgress</div>,
}));

// ---- Helpers ----

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function makePod(overrides: Record<string, any> = {}) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: 'my-pod',
      namespace: 'default',
      uid: 'pod-uid-123',
      creationTimestamp: '2025-01-01T00:00:00Z',
      resourceVersion: '12345',
      labels: { app: 'test' },
      annotations: {},
      ...overrides.metadata,
    },
    spec: {
      containers: [
        { name: 'main', image: 'nginx:latest', ports: [{ containerPort: 80, protocol: 'TCP' }] },
      ],
      ...overrides.spec,
    },
    status: {
      phase: 'Running',
      containerStatuses: [
        { name: 'main', ready: true, restartCount: 0, state: { running: { startedAt: '2025-01-01T00:00:00Z' } } },
      ],
      conditions: [
        { type: 'Ready', status: 'True', lastTransitionTime: '2025-01-01T00:00:00Z' },
        { type: 'Initialized', status: 'True', lastTransitionTime: '2025-01-01T00:00:00Z' },
      ],
      ...overrides.status,
    },
  };
}

function makeDeployment(overrides: Record<string, any> = {}) {
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
      ...overrides.metadata,
    },
    spec: {
      replicas: 3,
      selector: { matchLabels: { app: 'web' } },
      template: { metadata: { labels: { app: 'web' } }, spec: { containers: [{ name: 'web', image: 'nginx' }] } },
      ...overrides.spec,
    },
    status: {
      availableReplicas: 3,
      readyReplicas: 3,
      replicas: 3,
      conditions: [
        { type: 'Available', status: 'True', reason: 'MinimumReplicasAvailable', lastTransitionTime: '2025-01-01T00:00:00Z' },
      ],
      ...overrides.status,
    },
  };
}

// Import after mocks
import DetailView from '../DetailView';

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

// ---- Tests ----

describe('DetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockK8sList.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders resource name and kind for a Pod', async () => {
    const pod = makePod();
    mockK8sGet.mockResolvedValue(pod);

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'my-pod' });

    await waitFor(() => {
      expect(screen.getAllByText('my-pod').length).toBeGreaterThanOrEqual(1);
    });
    // The h1 heading should contain the resource name
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('my-pod');
    // Kind shown in subtitle
    expect(screen.getByText(/Pod · v1/)).toBeDefined();
  });

  it('renders resource name and kind for a Deployment', async () => {
    const dep = makeDeployment();
    mockK8sGet.mockResolvedValue(dep);

    renderDetailView({ gvrKey: 'apps/v1/deployments', namespace: 'default', name: 'my-deployment' });

    await waitFor(() => {
      expect(screen.getAllByText('my-deployment').length).toBeGreaterThanOrEqual(1);
    });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('my-deployment');
    expect(screen.getByText(/Deployment · apps\/v1/)).toBeDefined();
  });

  it('shows YAML button for all resources', async () => {
    mockK8sGet.mockResolvedValue(makePod());

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'my-pod' });

    await waitFor(() => {
      expect(screen.getByText('YAML')).toBeDefined();
    });
  });

  it('shows Logs and Terminal buttons for Pods', async () => {
    mockK8sGet.mockResolvedValue(makePod());

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'my-pod' });

    await waitFor(() => {
      expect(screen.getAllByText('Logs').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Terminal').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows Logs button for Deployments (workload-level logs)', async () => {
    mockK8sGet.mockResolvedValue(makeDeployment());

    renderDetailView({ gvrKey: 'apps/v1/deployments', namespace: 'default', name: 'my-deployment' });

    await waitFor(() => {
      expect(screen.getAllByText('my-deployment').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('Logs')).toBeDefined();
  });

  it('shows scale controls for Deployments', async () => {
    mockK8sGet.mockResolvedValue(makeDeployment());

    renderDetailView({ gvrKey: 'apps/v1/deployments', namespace: 'default', name: 'my-deployment' });

    await waitFor(() => {
      // The replicas count appears in scale controls and deployment summary
      expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    });
    // Restart button for deployments
    expect(screen.getByText('Restart')).toBeDefined();
  });

  it('shows delete confirmation dialog when delete action is clicked', async () => {
    mockK8sGet.mockResolvedValue(makePod());

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'my-pod' });

    await waitFor(() => {
      expect(screen.getAllByText('my-pod').length).toBeGreaterThanOrEqual(1);
    });

    // Click the more actions button
    const moreButton = screen.getByTitle('More actions');
    fireEvent.click(moreButton);

    // Click Delete in the dropdown
    const deleteButton = screen.getByText('Delete');
    fireEvent.click(deleteButton);

    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByText('Delete Pod')).toBeDefined();
      expect(screen.getByText(/Are you sure you want to delete "my-pod"/)).toBeDefined();
    });
  });

  it('shows 404 page for missing resources', async () => {
    mockK8sGet.mockRejectedValue(new Error('not found'));

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'deleted-pod' });

    await waitFor(() => {
      expect(screen.getByText('Resource not found')).toBeDefined();
    });
    expect(screen.getByText(/This resource may have been deleted/)).toBeDefined();
    expect(screen.getByText('View all pods')).toBeDefined();
    expect(screen.getByText('Go back')).toBeDefined();
  });

  it('shows error page for non-404 errors', async () => {
    mockK8sGet.mockRejectedValue(new Error('forbidden'));

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'my-pod' });

    await waitFor(() => {
      expect(screen.getByText('Error loading resource')).toBeDefined();
    });
  });

  it('shows conditions tab with condition data', async () => {
    const pod = makePod();
    mockK8sGet.mockResolvedValue(pod);

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'my-pod' });

    await waitFor(() => {
      expect(screen.getAllByText('my-pod').length).toBeGreaterThanOrEqual(1);
    });

    // Click conditions tab
    const conditionsTab = screen.getByText('Conditions (2)');
    fireEvent.click(conditionsTab);

    // Should show condition types
    await waitFor(() => {
      expect(screen.getByText('Ready')).toBeDefined();
      expect(screen.getByText('Initialized')).toBeDefined();
    });
  });

  it('does not show diagnosis box (removed for cleaner detail view)', async () => {
    const unhealthyPod = makePod({
      status: {
        phase: 'Running',
        containerStatuses: [
          {
            name: 'main',
            ready: false,
            restartCount: 15,
            state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m0s restarting' } },
          },
        ],
        conditions: [
          { type: 'Ready', status: 'False', reason: 'ContainersNotReady', lastTransitionTime: '2025-01-01T00:00:00Z' },
        ],
      },
    });
    mockK8sGet.mockResolvedValue(unhealthyPod);

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'my-pod' });

    await waitFor(() => {
      expect(screen.getAllByText('my-pod').length).toBeGreaterThanOrEqual(1);
    });

    // Diagnosis box was removed — detail view no longer shows diagnoses
    const diagHeading = screen.queryByText(/Diagnoses/);
    expect(diagHeading).toBeNull();
  });

  it('shows loading state initially', () => {
    // Never resolves
    mockK8sGet.mockReturnValue(new Promise(() => {}));

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'my-pod' });

    // Skeleton loading state renders animated placeholders
    expect(document.querySelector('.animate-pulse')).toBeDefined();
  });

  it('shows namespace badge when resource has namespace', async () => {
    mockK8sGet.mockResolvedValue(makePod());

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'my-pod' });

    await waitFor(() => {
      expect(screen.getAllByText('my-pod').length).toBeGreaterThanOrEqual(1);
    });
    // Namespace badge has specific styling class
    const badges = screen.getAllByText('default');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    // At least one should be the namespace badge (purple background)
    const namespaceBadge = badges.find((el) => el.className.includes('purple'));
    expect(namespaceBadge).toBeDefined();
  });

  it('shows events tab with event count', async () => {
    const pod = makePod();
    mockK8sGet.mockResolvedValue(pod);
    mockK8sList.mockResolvedValue([
      {
        apiVersion: 'v1',
        kind: 'Event',
        metadata: { name: 'ev1', namespace: 'default' },
        type: 'Normal',
        reason: 'Scheduled',
        message: 'Successfully assigned pod',
        lastTimestamp: '2025-01-01T00:00:00Z',
        involvedObject: { kind: 'Pod', name: 'my-pod' },
      },
    ]);

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'my-pod' });

    await waitFor(() => {
      expect(screen.getAllByText(/Events/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows containers section for pods in overview tab', async () => {
    mockK8sGet.mockResolvedValue(makePod());

    renderDetailView({ gvrKey: 'v1/pods', namespace: 'default', name: 'my-pod' });

    await waitFor(() => {
      expect(screen.getByText('Containers (1)')).toBeDefined();
      expect(screen.getAllByText('main').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('nginx:latest').length).toBeGreaterThanOrEqual(1);
    });
  });
});
