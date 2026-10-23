// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
};

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

import { FleetReportTab, computeRiskScore } from '../FleetReportTab';

describe('FleetReportTab', () => {
  afterEach(() => cleanup());

  it('renders cluster names in table', () => {
    render(<FleetReportTab />);
    expect(screen.getByText('prod-east')).toBeTruthy();
    expect(screen.getByText('prod-west')).toBeTruthy();
  });

  it('shows fleet risk score', () => {
    render(<FleetReportTab />);
    // 2/3 connected = 67%
    expect(screen.getByTestId('risk-score').textContent).toBe('67');
    expect(screen.getByTestId('risk-badge').textContent).toBe('Degraded');
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
describe('computeRiskScore', () => {
  it('does not call an empty fleet healthy', () => {
    expect(computeRiskScore([])).toMatchObject({ score: null, label: 'No clusters' });
  });
  it('does not call unchecked clusters healthy', () => {
    expect(computeRiskScore([{ status: 'unknown' }, { status: 'unknown' }])).toMatchObject({ score: null, label: 'Checking' });
  });
  it('scores only the clusters whose health is known', () => {
    expect(computeRiskScore([{ status: 'connected' }, { status: 'unreachable' }, { status: 'unknown' }])).toMatchObject({ score: 50, label: 'Critical' });
  });
});
