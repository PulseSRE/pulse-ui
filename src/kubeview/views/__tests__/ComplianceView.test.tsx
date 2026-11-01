/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// Mock query module
vi.mock('../../engine/query', () => ({
  k8sList: vi.fn().mockResolvedValue([]),
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sPatch: vi.fn().mockResolvedValue({}),
}));

// Mock clusterConnection — default: two connected clusters
const mockGetAllConnections = vi.fn();
vi.mock('../../engine/clusterConnection', () => ({
  getAllConnections: () => mockGetAllConnections(),
  getClusterBase: (id?: string) => `/api/kubernetes`,
  getActiveClusterId: () => 'local',
}));

// Mock useUIStore for impersonation headers
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: (s: any) => any) => {
      const state = { addToast: vi.fn(), selectedNamespace: '*' };
      return selector(state);
    },
    { getState: () => ({ impersonateUser: '', impersonateGroups: [] }) },
  ),
}));

import ComplianceView from '../fleet/ComplianceView';

function twoClusterSetup() {
  mockGetAllConnections.mockReturnValue([
    { id: 'local', name: 'Local Cluster', connectionType: 'local', apiBase: '/api/kubernetes', status: 'connected', lastHealthCheck: Date.now() },
    { id: 'prod-east', name: 'prod-east', connectionType: 'acm-proxy', apiBase: '/api/kubernetes/cluster/prod-east', status: 'connected', lastHealthCheck: Date.now() },
  ]);
}

function singleClusterSetup() {
  mockGetAllConnections.mockReturnValue([
    { id: 'local', name: 'Local Cluster', connectionType: 'local', apiBase: '/api/kubernetes', status: 'connected', lastHealthCheck: Date.now() },
  ]);
}

function noClusterSetup() {
  mockGetAllConnections.mockReturnValue([]);
}

function renderView() {
  return render(
    <MemoryRouter>
      <ComplianceView />
    </MemoryRouter>,
  );
}

describe('ComplianceView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Fleet Compliance heading', () => {
    twoClusterSetup();
    renderView();
    expect(screen.getByText('Fleet Compliance')).toBeDefined();
  });

  it('shows the Security Matrix section', () => {
    twoClusterSetup();
    renderView();
    expect(screen.getAllByText('Security Matrix').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the Certificate Expiry section', () => {
    twoClusterSetup();
    renderView();
    expect(screen.getAllByText('Certificate Expiry').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the RBAC Baseline Comparison section', () => {
    twoClusterSetup();
    renderView();
    expect(screen.getAllByText('RBAC Baseline Comparison').length).toBeGreaterThanOrEqual(1);
  });

  it('links configuration drift to Compare & Drift instead of repeating it', () => {
    twoClusterSetup();
    renderView();
    expect(screen.queryByText('Configuration Drift Detection')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Open Compare & Drift/ }).length).toBeGreaterThanOrEqual(1);
  });

  it('handles single-cluster gracefully', () => {
    singleClusterSetup();
    renderView();
    // Still renders heading and sections — data simply shows one column
    expect(screen.getAllByText('Fleet Compliance').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Security Matrix').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/1 cluster/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when no clusters are connected', () => {
    noClusterSetup();
    renderView();
    expect(screen.getAllByText('No Clusters Connected').length).toBeGreaterThanOrEqual(1);
  });

  it('displays cluster names as column headers in security matrix', () => {
    twoClusterSetup();
    renderView();
    expect(screen.getAllByText('Local Cluster').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('prod-east').length).toBeGreaterThanOrEqual(1);
  });

  it('shows rescan button', () => {
    twoClusterSetup();
    renderView();
    expect(screen.getAllByText('Re-scan').length).toBeGreaterThanOrEqual(1);
  });
});
