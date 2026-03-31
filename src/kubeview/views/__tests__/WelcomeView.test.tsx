// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

/** Shared mock data — can be overridden per-test via _mockListWatchData */
const _mockListWatchData: Record<string, { data?: any[]; isLoading?: boolean; isError?: boolean }> = {};

vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => {
    if (apiPath.includes('nodes') && _mockListWatchData.nodes) {
      return { data: _mockListWatchData.nodes.data ?? [], isLoading: _mockListWatchData.nodes.isLoading ?? false, isError: _mockListWatchData.nodes.isError ?? false };
    }
    if (apiPath.includes('nodes')) return { data: [
      { metadata: { name: 'node-1' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } },
      { metadata: { name: 'node-2' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } },
    ], isLoading: false, isError: false };
    return { data: [], isLoading: false, isError: false };
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

  it('renders OpenShift Pulse title', () => {
    renderView();
    expect(screen.getByText('OpenShift Pulse')).toBeDefined();
  });

  it('shows the tagline', () => {
    renderView();
    expect(screen.getByText(/incidents, remediation, and production readiness/i)).toBeDefined();
  });

  it('shows connected cluster status pill with node count', () => {
    renderView();
    expect(screen.getByText(/2\/2 nodes ready/)).toBeDefined();
  });

  it('shows quick stats row', () => {
    renderView();
    expect(screen.getByText('Nodes')).toBeDefined();
    expect(screen.getByText('Alerts')).toBeDefined();
    expect(screen.getByText('Cluster')).toBeDefined();
  });

  it('shows primary navigation cards', () => {
    renderView();
    expect(screen.getByText('Pulse')).toBeDefined();
    expect(screen.getByText('Incidents')).toBeDefined();
    expect(screen.getByText('Reviews')).toBeDefined();
    expect(screen.getByText('Workloads')).toBeDefined();
    expect(screen.getByText('Readiness')).toBeDefined();
  });

  it('shows more views toggle', () => {
    renderView();
    expect(screen.getByText(/more views/i)).toBeDefined();
  });

  describe('cluster error recovery', () => {
    afterEach(() => {
      delete _mockListWatchData.nodes;
    });

    it('shows error state when cluster API is unreachable', () => {
      _mockListWatchData.nodes = { data: [], isLoading: false, isError: true };
      renderView();
      expect(screen.getByText(/API unreachable/)).toBeDefined();
    });

    it('clicking retry calls invalidateQueries', () => {
      _mockListWatchData.nodes = { data: [], isLoading: false, isError: true };
      renderView();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const retryBtn = screen.getByRole('button', { name: '' }); // RefreshCw button
      fireEvent.click(retryBtn);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['k8s'] });
      invalidateSpy.mockRestore();
    });
  });
});
