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
};

vi.mock('../../hooks/useIncidentTimeline', () => ({
  useIncidentTimeline: () => _mockTimelineData,
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
