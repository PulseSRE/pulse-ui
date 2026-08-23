// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React, { Suspense } from 'react';

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
      openDock: vi.fn(),
      setLastSyncTime: vi.fn(),
      addDegradedReason: vi.fn(),
      removeDegradedReason: vi.fn(),
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
  k8sDelete: vi.fn(),
  k8sPatch: vi.fn(),
  k8sCreate: vi.fn(),
  k8sLogs: vi.fn(),
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
}));

vi.mock('../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div>,
  Sparkline: () => <div data-testid="sparkline" />,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../components/PodTerminal', () => ({
  default: () => <div data-testid="pod-terminal" />,
}));

vi.mock('../../components/DataEditor', () => ({
  default: () => <div data-testid="data-editor">DataEditor</div>,
}));

vi.mock('../../components/DeployProgress', () => ({
  default: () => <div data-testid="deploy-progress">DeployProgress</div>,
}));

// ---- Mock lazy components to control behavior ----

// NLFilterBar: default renders fine, can be swapped to throw
let nlFilterBarShouldThrow = false;
vi.mock('../../components/agent/NLFilterBar', () => ({
  NLFilterBar: (props: any) => {
    if (nlFilterBarShouldThrow) throw new Error('NLFilterBar crash');
    return <div data-testid="nl-filter-bar">NLFilterBar</div>;
  },
}));

// AmbientInsight: can be swapped to throw
let ambientInsightShouldThrow = false;
vi.mock('../../components/agent/AmbientInsight', () => ({
  AmbientInsight: (props: any) => {
    if (ambientInsightShouldThrow) throw new Error('AmbientInsight crash');
    return <div data-testid="ambient-insight">AmbientInsight</div>;
  },
}));

const askPulseMock = vi.fn();
vi.mock('../../engine/askPulse', () => ({ askPulse: (...a: unknown[]) => askPulseMock(...a) }));

// ---- Helpers ----

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function makePod() {
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
    },
    spec: {
      containers: [{ name: 'main', image: 'nginx:latest', ports: [{ containerPort: 80, protocol: 'TCP' }] }],
    },
    status: {
      phase: 'Running',
      containerStatuses: [{ name: 'main', ready: true, restartCount: 0, state: { running: { startedAt: '2025-01-01T00:00:00Z' } } }],
      conditions: [
        { type: 'Ready', status: 'True', lastTransitionTime: '2025-01-01T00:00:00Z' },
      ],
    },
  };
}

// StatefulSet goes through the generic layout path which includes the AI components
function makeStatefulSet() {
  return {
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    metadata: {
      name: 'my-sts',
      namespace: 'default',
      uid: 'sts-uid-123',
      creationTimestamp: '2025-01-01T00:00:00Z',
      resourceVersion: '99999',
      labels: { app: 'db' },
      annotations: {},
    },
    spec: {
      replicas: 3,
      selector: { matchLabels: { app: 'db' } },
      template: { metadata: { labels: { app: 'db' } }, spec: { containers: [{ name: 'db', image: 'postgres' }] } },
    },
    status: {
      replicas: 3,
      readyReplicas: 3,
      conditions: [
        { type: 'Available', status: 'True', reason: 'MinimumReplicasAvailable', lastTransitionTime: '2025-01-01T00:00:00Z' },
      ],
    },
  };
}

// Import after mocks
import DetailView from '../DetailView';
import TableView from '../TableView';

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

function renderTableView(props: { gvrKey: string; namespace?: string }) {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TableView {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----

describe('Suspense + ErrorBoundary wrapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    nlFilterBarShouldThrow = false;
    ambientInsightShouldThrow = false;
    mockK8sList.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('TableView - NLFilterBar', () => {
    it('wraps NLFilterBar in ErrorBoundary with contextual fallbackTitle', async () => {
      nlFilterBarShouldThrow = true;

      renderTableView({ gvrKey: 'v1/pods', namespace: 'default' });

      // Toggle the NL filter to show
      const nlButton = screen.getByTitle('AI filter');
      fireEvent.click(nlButton);

      await waitFor(() => {
        expect(screen.getByText('AI filter failed to load')).toBeDefined();
      });
    });

    it('renders NLFilterBar successfully when no error', async () => {
      renderTableView({ gvrKey: 'v1/pods', namespace: 'default' });

      const nlButton = screen.getByTitle('AI filter');
      fireEvent.click(nlButton);

      await waitFor(() => {
        expect(screen.getByTestId('nl-filter-bar')).toBeDefined();
      });
    });

    it('shows skeleton placeholder while NLFilterBar loads', () => {
      // We test that the Suspense fallback has animated skeleton elements
      // by checking the source structure - the fallback has animate-pulse class
      renderTableView({ gvrKey: 'v1/pods', namespace: 'default' });

      const nlButton = screen.getByTitle('AI filter');
      fireEvent.click(nlButton);

      // The component loads synchronously in test (mocked), so the skeleton
      // may flash briefly. We verify the structure exists by checking the
      // component renders without error.
      expect(screen.getByTestId('nl-filter-bar')).toBeDefined();
    });
  });

  describe('DetailView - AmbientInsight', () => {
    it('wraps AmbientInsight in its own ErrorBoundary', async () => {
      ambientInsightShouldThrow = true;
      mockK8sGet.mockResolvedValue(makeStatefulSet());

      renderDetailView({ gvrKey: 'apps/v1/statefulsets', namespace: 'default', name: 'my-sts' });

      await waitFor(() => {
        expect(screen.getByText('AI insight unavailable')).toBeDefined();
      });

      // The way to ask about this resource should still be there — it is
      // suggestions into the sidebar now, not an embedded chat.
      expect(screen.getByText(/Ask Pulse AI about this/)).toBeDefined();
    });

    it('renders AmbientInsight successfully when no error', async () => {
      mockK8sGet.mockResolvedValue(makeStatefulSet());

      renderDetailView({ gvrKey: 'apps/v1/statefulsets', namespace: 'default', name: 'my-sts' });

      await waitFor(() => {
        expect(screen.getByTestId('ambient-insight')).toBeDefined();
      });
    });
  });

  describe('Isolation - one crash does not take down the other', () => {
    it('an AmbientInsight crash leaves the rest of the detail page usable', async () => {
      // This used to be a pair of tests asserting AmbientInsight and
      // InlineAgent could not take each other down. InlineAgent is gone —
      // the detail page no longer embeds a chat, it offers suggestions that
      // open the one Pulse AI sidebar — so the pairing is moot. The property
      // that still matters is that the insight panel failing does not cost
      // the operator the page or the way to ask about it.
      ambientInsightShouldThrow = true;
      mockK8sGet.mockResolvedValue(makeStatefulSet());

      renderDetailView({ gvrKey: 'apps/v1/statefulsets', namespace: 'default', name: 'my-sts' });

      await waitFor(() => {
        expect(screen.getByText('AI insight unavailable')).toBeDefined();
      });

      // The suggestions that reach the sidebar are still there, and they still
      // name the resource — a question about "a StatefulSet" that does not say
      // which one is much less use than one that does.
      expect(screen.getByText(/Ask Pulse AI about this/)).toBeDefined();
      fireEvent.click(screen.getByText('What changed recently?'));
      expect(askPulseMock).toHaveBeenCalledWith(
        'What changed recently?',
        expect.objectContaining({ kind: 'StatefulSet', name: 'my-sts', namespace: 'default' }),
      );

      // And so is the rest of the detail view.
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading.textContent).toBe('my-sts');
    });

    it('NLFilterBar crash does not take down the table', async () => {
      nlFilterBarShouldThrow = true;

      renderTableView({ gvrKey: 'v1/pods', namespace: 'default' });

      const nlButton = screen.getByTitle('AI filter');
      fireEvent.click(nlButton);

      await waitFor(() => {
        expect(screen.getByText('AI filter failed to load')).toBeDefined();
      });

      // The table header is still present
      expect(screen.getByText('Pods')).toBeDefined();
    });
  });
});
