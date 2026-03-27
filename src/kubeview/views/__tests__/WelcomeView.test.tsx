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
    // Allow per-test overrides
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
    expect(screen.getByText(/Incidents, remediation, and production readiness/)).toBeDefined();
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

  it('shows primary action cards: Incident Center and Production Readiness', () => {
    renderView();
    expect(screen.getByText('Incident Center')).toBeDefined();
    expect(screen.getByText('Production Readiness')).toBeDefined();
  });

  it('shows All Views section with view tiles', () => {
    renderView();
    expect(screen.getByText('All Views')).toBeDefined();
    expect(screen.getByText('Pulse')).toBeDefined();
    expect(screen.getByText('Incidents')).toBeDefined();
    expect(screen.getByText('Workloads')).toBeDefined();
    expect(screen.getByText('Compute')).toBeDefined();
    expect(screen.getByText('Networking')).toBeDefined();
    expect(screen.getByText('Storage')).toBeDefined();
    expect(screen.getByText('Builds')).toBeDefined();
    expect(screen.getByText('Security')).toBeDefined();
    expect(screen.getByText('CRDs')).toBeDefined();
    expect(screen.getByText('Identity')).toBeDefined();
    expect(screen.getByText('Admin')).toBeDefined();
    expect(screen.getByText('Fleet')).toBeDefined();
    expect(screen.getByText('Alerts')).toBeDefined();
    expect(screen.getByText('GitOps')).toBeDefined();
    expect(screen.getByText('Onboarding')).toBeDefined();
  });

  it('shows launchpad cluster state summary when welcomeLaunchpad is enabled', () => {
    renderView();
    expect(screen.getByText('Nodes ready')).toBeDefined();
    expect(screen.getByText('Alerts firing')).toBeDefined();
    expect(screen.getByText('Cluster')).toBeDefined();
  });

  it('shows Production Setup onboarding CTA', () => {
    renderView();
    expect(screen.getByText('Production Setup')).toBeDefined();
    expect(screen.getByText(/readiness wizard/)).toBeDefined();
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
    expect(screen.getByText(/^v\d+\.\d+\.\d+$/)).toBeDefined();
    const link = screen.getByText('GitHub').closest('a');
    expect(link?.getAttribute('href')).toBe('https://github.com/alimobrem/OpenshiftPulse');
  });

  describe('cluster error recovery', () => {
    afterEach(() => {
      delete _mockListWatchData.nodes;
    });

    it('shows retry button, hint text, and admin link when cluster API is unreachable', () => {
      _mockListWatchData.nodes = { data: [], isLoading: false, isError: true };
      renderView();
      expect(screen.getByText('Unable to reach cluster API')).toBeDefined();
      expect(screen.getByText(/oc proxy --port=8001/)).toBeDefined();
      expect(screen.getByText('Retry')).toBeDefined();
      expect(screen.getAllByText('Administration').length).toBeGreaterThanOrEqual(1);
    });

    it('clicking Retry calls invalidateQueries', () => {
      _mockListWatchData.nodes = { data: [], isLoading: false, isError: true };
      renderView();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      fireEvent.click(screen.getByText('Retry'));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['k8s'] });
      invalidateSpy.mockRestore();
    });
  });
});
