// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => selector({ selectedNamespace: '*', addTab: vi.fn(), addToast: vi.fn() }),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));
vi.mock('../../components/primitives/Card', () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
}));
vi.mock('../../engine/gvr', () => ({
  resourceDetailUrl: () => '/r/mock/resource',
}));
vi.mock('../../engine/colors', () => ({
  CHART_COLORS: { blue: '#3b82f6', green: '#22c55e', red: '#ef4444' },
}));

const _mockTimelineData = {
  entries: [] as any[],
  correlationGroups: [] as any[],
  counts: { alert: 0, event: 0, rollout: 0, config: 0 } as Record<string, number>,
  isLoading: false,
  failedSources: [] as string[],
  requestedSources: 4,
  refetch: vi.fn(),
};

vi.mock('../../hooks/useIncidentTimeline', () => ({
  useIncidentTimeline: () => _mockTimelineData,
  TIME_RANGE_MS: { '15m': 900000, '1h': 3600000, '6h': 21600000, '24h': 86400000, '3d': 259200000, '7d': 604800000 },
}));

import TimelineView from '../TimelineView';

function renderView() {
  return render(<TimelineView />);
}

describe('TimelineView', () => {
  afterEach(() => {
    cleanup();
    _mockTimelineData.entries = [];
    _mockTimelineData.correlationGroups = [];
    _mockTimelineData.counts = { alert: 0, event: 0, rollout: 0, config: 0 };
    _mockTimelineData.isLoading = false;
    _mockTimelineData.failedSources = [];
    _mockTimelineData.requestedSources = 4;
    _mockTimelineData.refetch = vi.fn();
  });

  it('when every requested source failed it shows an error with retry, not an empty timeline', () => {
    _mockTimelineData.failedSources = ['alerts (Prometheus)', 'events', 'rollouts', 'config changes'];
    renderView();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The timeline could not be loaded');
    expect(screen.queryByText('No timeline entries found')).toBeNull();
    expect(screen.queryByText('Nothing found in the sources that could be read')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Timeline density' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(_mockTimelineData.refetch).toHaveBeenCalled();
  });

  it('a partial failure can be retried too', () => {
    _mockTimelineData.failedSources = ['events'];
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(_mockTimelineData.refetch).toHaveBeenCalled();
  });

  it('shows per-category density over the selected range', () => {
    const now = Date.now();
    _mockTimelineData.entries = [
      { id: 'a', timestamp: new Date(now - 60_000).toISOString(), category: 'alert', severity: 'critical', title: 'X', detail: '', source: { type: 'prometheus' } },
      { id: 'b', timestamp: new Date(now - 120_000).toISOString(), category: 'event', severity: 'warning', title: 'Y', detail: '', source: { type: 'k8s-event' } },
      { id: 'c', timestamp: new Date(now - 180_000).toISOString(), category: 'event', severity: 'warning', title: 'Z', detail: '', source: { type: 'k8s-event' } },
      // Outside the 6h range: not counted.
      { id: 'd', timestamp: new Date(now - 7 * 3600_000).toISOString(), category: 'rollout', severity: 'info', title: 'W', detail: '', source: { type: 'replicaset' } },
    ];
    renderView();
    const density = screen.getByRole('list', { name: 'Timeline density' });
    expect(density.textContent).toContain('Alerts 1');
    expect(density.textContent).toContain('Events 2');
    expect(density.textContent).toContain('Rollouts 0');
  });

  it('says the timeline is incomplete when Prometheus could not be read', () => {
    _mockTimelineData.failedSources = ['alerts (Prometheus)'];
    renderView();
    expect(screen.getByRole('alert').textContent).toMatch(/Could not read alerts \(Prometheus\)/);
    expect(screen.queryByText('No timeline entries found')).toBeNull();
    expect(screen.getByText('Nothing found in the sources that could be read')).toBeDefined();
  });

  it('renders the page header', () => {
    renderView();
    expect(screen.getByText('Cluster Timeline')).toBeDefined();
  });

  it('renders time range selector buttons', () => {
    renderView();
    expect(screen.getByText('15m')).toBeDefined();
    expect(screen.getByText('1h')).toBeDefined();
    expect(screen.getByText('6h')).toBeDefined();
    expect(screen.getByText('24h')).toBeDefined();
    expect(screen.getByText('3d')).toBeDefined();
    expect(screen.getByText('7d')).toBeDefined();
  });

  it('renders category toggle buttons', () => {
    renderView();
    expect(screen.getByText('Alerts')).toBeDefined();
    expect(screen.getByText('Events')).toBeDefined();
    expect(screen.getByText('Rollouts')).toBeDefined();
    expect(screen.getByText('Config')).toBeDefined();
  });

  it('shows empty state when no entries', () => {
    renderView();
    expect(screen.getByText('No timeline entries found')).toBeDefined();
  });

  it('renders timeline entries when data is present', () => {
    _mockTimelineData.entries = [
      {
        id: '1',
        timestamp: new Date().toISOString(),
        category: 'alert',
        severity: 'warning',
        title: 'HighMemoryUsage',
        detail: 'Pod memory above 90%',
        namespace: 'monitoring',
        resource: { apiVersion: 'v1', kind: 'Pod', name: 'prometheus-0', namespace: 'monitoring' },
      },
    ];
    _mockTimelineData.counts = { alert: 1, event: 0, rollout: 0, config: 0 };
    renderView();
    expect(screen.getByText('HighMemoryUsage')).toBeDefined();
    expect(screen.getByText('1 entries')).toBeDefined();
  });
});
