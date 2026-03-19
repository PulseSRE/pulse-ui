// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => selector({
    addTab: vi.fn(),
    openCommandPalette: vi.fn(),
    connectionStatus: 'connected',
  }),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => {
    if (apiPath.includes('nodes')) return { data: [
      { metadata: { name: 'node-1' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } },
      { metadata: { name: 'node-2' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } },
    ], isLoading: false };
    return { data: [], isLoading: false };
  },
}));

import WelcomeView from '../WelcomeView';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderView() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><WelcomeView /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WelcomeView', () => {
  afterEach(() => { cleanup(); queryClient.clear(); });

  it('renders ShiftOps title', () => {
    renderView();
    expect(screen.getByText('ShiftOps')).toBeDefined();
  });

  it('shows the value proposition tagline', () => {
    renderView();
    expect(screen.getByText(/67 automated health checks/)).toBeDefined();
  });

  it('shows connected cluster status pill with node count', () => {
    renderView();
    expect(screen.getByText(/Connected/)).toBeDefined();
    expect(screen.getByText(/2 nodes/)).toBeDefined();
  });

  it('shows Cluster Pulse as primary CTA at the top', () => {
    renderView();
    expect(screen.getByText('Cluster Pulse')).toBeDefined();
    expect(screen.getByText(/Risk score, attention items/)).toBeDefined();
  });

  it('shows quick nav row with Compute, Workloads, Administration, Alerts', () => {
    renderView();
    expect(screen.getByText('Compute')).toBeDefined();
    expect(screen.getByText('Workloads')).toBeDefined();
    expect(screen.getByText('Administration')).toBeDefined();
    expect(screen.getByText('Alerts')).toBeDefined();
  });

  it('shows Readiness Checklist and Find Anything action cards', () => {
    renderView();
    expect(screen.getByText('Readiness Checklist')).toBeDefined();
    expect(screen.getByText('Find Anything')).toBeDefined();
  });

  it('shows remaining view tiles', () => {
    renderView();
    expect(screen.getByText('Software')).toBeDefined();
    expect(screen.getByText('Networking')).toBeDefined();
    expect(screen.getByText('Storage')).toBeDefined();
    expect(screen.getByText('Builds')).toBeDefined();
    expect(screen.getByText('Security')).toBeDefined();
    expect(screen.getByText('Access Control')).toBeDefined();
    expect(screen.getByText('CRDs')).toBeDefined();
  });

  it('shows Key Capabilities divider', () => {
    renderView();
    expect(screen.getByText('Key Capabilities')).toBeDefined();
  });

  it('renders all 10 feature showcase items', () => {
    renderView();
    expect(screen.getByText('YAML Editor')).toBeDefined();
    expect(screen.getByText('Impersonation')).toBeDefined();
    expect(screen.getByText('Rollback')).toBeDefined();
    expect(screen.getByText('Dependency Graph')).toBeDefined();
    expect(screen.getByText('Log Streaming')).toBeDefined();
    expect(screen.getByText('Cluster Snapshots')).toBeDefined();
    expect(screen.getByText('Resource Diffing')).toBeDefined();
    expect(screen.getByText('Workload Audit')).toBeDefined();
    expect(screen.getByText('Security Audit')).toBeDefined();
    expect(screen.getByText('Pod Shell')).toBeDefined();
  });

  it('renders feature descriptions', () => {
    renderView();
    expect(screen.getByText(/dry-run validation/)).toBeDefined();
    expect(screen.getByText(/impersonation headers/)).toBeDefined();
    expect(screen.getByText(/owner chains/)).toBeDefined();
  });

  it('shows All Views divider', () => {
    renderView();
    expect(screen.getByText('All Views')).toBeDefined();
  });

  it('shows keyboard shortcuts', () => {
    renderView();
    expect(screen.getByText('Command Palette')).toBeDefined();
    expect(screen.getByText('Resource Browser')).toBeDefined();
    expect(screen.getByText('Navigate Table')).toBeDefined();
  });

  it('shows footer with GitHub link and version', () => {
    renderView();
    expect(screen.getByText('GitHub')).toBeDefined();
    expect(screen.getByText('v3.0.0')).toBeDefined();
    const link = screen.getByText('GitHub').closest('a');
    expect(link?.getAttribute('href')).toBe('https://github.com/alimobrem/ShiftOps');
  });
});
