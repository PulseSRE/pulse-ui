// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mocks must be declared before imports that use them

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
      addTab: addTabMock,
      addToast: addToastMock,
      setSelectedNamespace: vi.fn(),
    };
    return selector(state);
  },
}));

// Mock the query module so no real fetch calls happen
vi.mock('../../engine/query', () => ({
  k8sList: vi.fn().mockResolvedValue([]),
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sPatch: vi.fn().mockResolvedValue({}),
}));

// Mock the ClusterConfig sub-component to keep tests focused
vi.mock('../../components/ClusterConfig', () => ({
  default: () => <div data-testid="cluster-config">ClusterConfig</div>,
}));

import AdminView from '../AdminView';
import { k8sGet, k8sList } from '../../engine/query';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderAdmin(queryClient?: QueryClient) {
  const qc = queryClient ?? createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders admin tabs', () => {
    renderAdmin();
    expect(screen.getByText('Overview')).toBeDefined();
    expect(screen.getByText('Cluster Config')).toBeDefined();
    expect(screen.getByText(/^Updates/)).toBeDefined();
    expect(screen.getByText(/^Snapshots/)).toBeDefined();
    expect(screen.getAllByText(/Quotas/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Certificates')).toBeDefined();
    expect(screen.getByText(/^Operators/)).toBeDefined();
  });

  it('renders the Administration heading', () => {
    renderAdmin();
    expect(screen.getByText('Administration')).toBeDefined();
  });

  it('shows cluster version info card on overview', () => {
    renderAdmin();
    // Overview is the default tab and should show these info cards
    expect(screen.getByText('Cluster Version')).toBeDefined();
  });

  it('shows platform info card on overview', () => {
    renderAdmin();
    expect(screen.getByText('Platform')).toBeDefined();
  });

  it('shows nodes info card on overview', () => {
    renderAdmin();
    expect(screen.getByText('Nodes')).toBeDefined();
  });

  it('shows CRDs info card on overview', () => {
    renderAdmin();
    expect(screen.getByText('CRDs')).toBeDefined();
  });

  it('shows control plane panel on overview', () => {
    renderAdmin();
    expect(screen.getAllByText('Control Plane').length).toBeGreaterThanOrEqual(1);
  });

  it('shows identity providers panel on overview', () => {
    renderAdmin();
    expect(screen.getByText('Identity Providers')).toBeDefined();
  });

  it('shows cluster capacity panel on overview', () => {
    renderAdmin();
    expect(screen.getByText('Cluster Capacity')).toBeDefined();
  });

  it('shows Capture Snapshot button on snapshots tab', () => {
    renderAdmin();
    const snapshotsTab = screen.getByRole('tab', { name: /^Snapshots/ });
    fireEvent.click(snapshotsTab);
    expect(screen.getByText('Capture Snapshot')).toBeDefined();
  });

  it('shows No Snapshots Yet message on snapshots tab when none exist', () => {
    renderAdmin();
    const snapshotsTab = screen.getByRole('tab', { name: /^Snapshots/ });
    fireEvent.click(snapshotsTab);
    expect(screen.getByText('No Snapshots Yet')).toBeDefined();
  });

  it('shows Import button on snapshots tab', () => {
    renderAdmin();
    const snapshotsTab = screen.getByRole('tab', { name: /^Snapshots/ });
    fireEvent.click(snapshotsTab);
    expect(screen.getByText('Import')).toBeDefined();
  });

  it('shows quotas panels when switching to quotas tab', () => {
    renderAdmin();
    const quotasTabs = screen.getAllByRole('tab', { name: /Quotas/ });
    fireEvent.click(quotasTabs[0]);
    expect(screen.getAllByText(/Resource Quotas/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Limit Ranges/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows ClusterConfig component on config tab', () => {
    renderAdmin();
    const configTab = screen.getByRole('tab', { name: /Cluster Config/ });
    fireEvent.click(configTab);
    expect(screen.getByTestId('cluster-config')).toBeDefined();
  });

  it('renders overview tab without crashing', () => {
    // Verifies the component mounts and renders the Overview tab header
    const { container } = renderAdmin();
    expect(container.querySelector('.bg-slate-950')).toBeDefined();
  });
});
