// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// --- Mocks ---

const navigateMock = vi.fn();
const addTabMock = vi.fn();
const addToastMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: any) => {
      const state = {
        selectedNamespace: '*',
        addTab: addTabMock,
        addToast: addToastMock,
        setConnectionStatus: vi.fn(),
      };
      return selector(state);
    },
    {
      getState: () => ({
        setSelectedNamespace: vi.fn(),
      }),
    },
  ),
}));

vi.mock('../../store/clusterStore', () => ({
  useClusterStore: (selector: any) => {
    const state = { resourceRegistry: null };
    return selector(state);
  },
}));

const _mockWatchResult: { data: any[]; isLoading: boolean; error: Error | null } = {
  data: [],
  isLoading: false,
  error: null,
};

vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: () => _mockWatchResult,
}));

vi.mock('../../engine/query', () => ({
  k8sPatch: vi.fn().mockResolvedValue({}),
  k8sDelete: vi.fn().mockResolvedValue({}),
  k8sList: vi.fn().mockResolvedValue([]),
}));

// RBAC: deny delete, allow update and create
vi.mock('../../hooks/useCanI', () => ({
  useCanI: (verb: string) => ({
    allowed: verb !== 'delete',
    isLoading: false,
  }),
  useCanDelete: () => ({ allowed: false, isLoading: false }),
  useCanCreate: () => ({ allowed: true, isLoading: false }),
  useCanUpdate: () => ({ allowed: true, isLoading: false }),
}));

vi.mock('../../hooks/useResourceUrl', () => ({
  buildApiPathFromResource: (r: any) =>
    `/api/v1/namespaces/${r.metadata?.namespace ?? 'default'}/${r.kind?.toLowerCase() ?? 'resources'}/${r.metadata?.name ?? 'unknown'}`,
}));

vi.mock('../../engine/yamlUtils', () => ({
  jsonToYaml: (obj: any) => JSON.stringify(obj, null, 2),
}));

vi.mock('../../components/feedback/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, onConfirm, onClose }: any) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null,
}));

vi.mock('../../components/DeployProgress', () => ({
  default: () => <div data-testid="deploy-progress" />,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 36,
        size: 36,
        key: i,
      })),
    measureElement: () => {},
  }),
}));

import TableView from '../TableView';

function makePodResource(name: string, namespace = 'default') {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name,
      namespace,
      uid: `uid-${name}`,
      creationTimestamp: '2025-01-01T00:00:00Z',
      labels: {},
    },
    spec: {},
    status: { phase: 'Running', containerStatuses: [{ name: 'main', ready: true, restartCount: 0, state: { running: {} } }] },
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderTable(gvrKey = 'v1/pods') {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TableView gvrKey={gvrKey} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TableView RBAC disabled buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _mockWatchResult.data = [makePodResource('test-pod')];
    _mockWatchResult.isLoading = false;
    _mockWatchResult.error = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders delete button even when canDelete is false', () => {
    renderTable('v1/pods');

    const deleteButton = screen.getByTitle('No delete permission');
    expect(deleteButton).toBeDefined();
    expect(deleteButton.tagName).toBe('BUTTON');
  });

  it('delete button is disabled when canDelete is false', () => {
    renderTable('v1/pods');

    const deleteButton = screen.getByTitle('No delete permission');
    expect(deleteButton).toHaveProperty('disabled', true);
  });

  it('delete button tooltip says "No delete permission"', () => {
    renderTable('v1/pods');

    const deleteButton = screen.getByTitle('No delete permission');
    expect(deleteButton.getAttribute('title')).toBe('No delete permission');
  });

  it('bulk delete button is disabled when canDelete is false', () => {
    _mockWatchResult.data = [makePodResource('pod-a'), makePodResource('pod-b')];
    renderTable('v1/pods');

    // Select all
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    // Bulk delete should appear but be disabled
    const bulkDeleteBtn = screen.getByText('Delete 2');
    expect(bulkDeleteBtn.closest('button')).toHaveProperty('disabled', true);
  });

  it('bulk delete button tooltip says "No delete permission"', () => {
    _mockWatchResult.data = [makePodResource('pod-a'), makePodResource('pod-b')];
    renderTable('v1/pods');

    // Select all
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    // The bulk delete button should have the tooltip
    const bulkDeleteBtn = screen.getByText('Delete 2').closest('button');
    expect(bulkDeleteBtn?.getAttribute('title')).toBe('No delete permission');
  });
});
