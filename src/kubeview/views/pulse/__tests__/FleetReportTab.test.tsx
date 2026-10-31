// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

const mockClusters = [
  { id: 'local', name: 'local', status: 'connected', connectionType: 'local', apiBase: '/api/kubernetes', lastHealthCheck: Date.now(), metadata: { nodeCount: 3, version: '4.14' } },
  { id: 'prod-east', name: 'prod-east', status: 'connected', connectionType: 'acm-proxy', apiBase: '/proxy', lastHealthCheck: Date.now(), metadata: { nodeCount: 12, version: '4.14' } },
  { id: 'prod-west', name: 'prod-west', status: 'unreachable', connectionType: 'acm-proxy', apiBase: '/proxy', lastHealthCheck: Date.now(), metadata: { nodeCount: 0 } },
];

const mockState = {
  clusters: mockClusters,
  fleetMode: 'multi' as const,
  refreshAllHealth: vi.fn().mockResolvedValue(undefined),
  setActiveCluster: vi.fn(),
};

const go = vi.fn();
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => go }));

vi.mock('../../../store/fleetStore', () => ({
  useFleetStore: vi.fn(() => mockState),
}));

// Card requires title+icon — provide simple mock
vi.mock('../../../components/primitives/Card', () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock('../../../components/agent/AmbientInsight', () => ({
  AmbientInsight: () => <div data-testid="ambient-insight" />,
}));

import { FleetReportTab, computeReachability } from '../FleetReportTab';

describe('FleetReportTab', () => {
  afterEach(() => cleanup());

  it('renders cluster names in table', () => {
    render(<FleetReportTab />);
    expect(screen.getByText('prod-east')).toBeTruthy();
    expect(screen.getByText('prod-west')).toBeTruthy();
  });

  it('shows reachability (high is good), not a "risk score"', () => {
    render(<FleetReportTab />);
    // 2/3 connected = 67%
    expect(screen.getByText('Fleet reachability')).toBeTruthy();
    expect(screen.queryByText(/Risk Score/i)).toBeNull();
    expect(screen.getByTestId('risk-score').textContent).toBe('67%');
    expect(screen.getByTestId('risk-badge').textContent).toBe('Partly reachable');
    // The connected ratio is not repeated as "x / y clusters healthy".
    expect(screen.queryByText(/clusters healthy/)).toBeNull();
  });

  it('a cluster row switches Pulse to that cluster; "Open Fleet" goes to /fleet', () => {
    render(<FleetReportTab />);
    fireEvent.click(screen.getByTitle('Show prod-east on Pulse'));
    expect(mockState.setActiveCluster).toHaveBeenCalledWith('prod-east');
    fireEvent.click(screen.getByText('Open Fleet →'));
    expect(go).toHaveBeenCalledWith('/fleet', 'Fleet');
  });

  it('shows cluster count badge', () => {
    render(<FleetReportTab />);
    expect(screen.getByText('3 clusters')).toBeTruthy();
  });

  it('renders refresh button', () => {
    render(<FleetReportTab />);
    expect(screen.getByText('Refresh All')).toBeTruthy();
  });

  it('shows Connected status for healthy clusters', () => {
    render(<FleetReportTab />);
    expect(screen.getAllByText('Connected').length).toBe(2);
  });

  it('shows Unreachable status for down clusters', () => {
    render(<FleetReportTab />);
    expect(screen.getByText('Unreachable')).toBeTruthy();
  });
});

// Regression: with no clusters, or none checked yet, the fleet scored 100
// "Healthy" — absence of data shown as absence of problems.
describe('computeReachability', () => {
  it('does not call an empty fleet healthy', () => {
    expect(computeReachability([])).toMatchObject({ score: null, label: 'No clusters' });
  });
  it('does not call unchecked clusters healthy', () => {
    expect(computeReachability([{ status: 'unknown' }, { status: 'unknown' }])).toMatchObject({ score: null, label: 'Checking' });
  });
  it('scores only the clusters whose health is known', () => {
    expect(computeReachability([{ status: 'connected' }, { status: 'unreachable' }, { status: 'unknown' }])).toMatchObject({ score: 50, label: 'Mostly unreachable' });
  });
});
