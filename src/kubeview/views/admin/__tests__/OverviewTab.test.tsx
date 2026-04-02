// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

vi.mock('../../../components/primitives/Panel', () => ({
  Panel: ({ title, children }: any) => <div data-testid="panel"><h3>{title}</h3>{children}</div>,
}));

vi.mock('../../../components/primitives/Card', () => ({
  Card: ({ children, className }: any) => <div data-testid="card" className={className}>{children}</div>,
}));

vi.mock('../../../components/primitives/MetricGrid', () => ({
  MetricGrid: ({ children }: any) => <div data-testid="metric-grid">{children}</div>,
}));

vi.mock('../../../components/primitives/InfoCard', () => ({
  InfoCard: ({ label, value, sub, onClick }: any) => (
    <div data-testid={`info-card-${label}`} onClick={onClick}>
      <span>{label}</span>
      <span>{value}</span>
      {sub && <span>{sub}</span>}
    </div>
  ),
}));

vi.mock('../../../engine/formatting', () => ({
  formatMem: (v: number) => `${Math.round(v / (1024 * 1024 * 1024))}Gi`,
}));

vi.mock('../../../components/metrics/ControlPlaneMetrics', () => ({
  ControlPlaneMetrics: () => <div data-testid="cp-metrics">Control Plane Metrics</div>,
}));

import { OverviewTab } from '../OverviewTab';
import type { OverviewTabProps } from '../OverviewTab';

function makeProps(overrides: Partial<OverviewTabProps> = {}): OverviewTabProps {
  return {
    overviewLoading: false,
    overviewError: false,
    firingAlerts: [],
    alertCounts: { critical: 0, warning: 0, info: 0 },
    operators: [{ metadata: { name: 'op1', uid: 'u1', creationTimestamp: '' }, status: { conditions: [{ type: 'Available', status: 'True' }] } }] as any[],
    opDegraded: 0,
    opProgressing: 0,
    degradedOperators: [],
    nodes: [{ metadata: { name: 'node1', uid: 'n1', creationTimestamp: '' }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: {} } }] as any[],
    nodeRoles: [['worker', 1]],
    cvVersion: '4.15.0',
    cvChannel: 'stable-4.15',
    platform: 'AWS',
    apiUrl: 'https://api.cluster.example.com:6443',
    controlPlaneTopology: 'HighlyAvailable',
    isHyperShift: false,
    clusterAge: { label: '6 months', date: '2025-09-01T00:00:00Z' },
    nsStats: { total: 50, user: 30, system: 20 },
    crds: Array.from({ length: 10 }, (_, i) => ({ metadata: { name: `crd-${i}`, uid: `c${i}`, creationTimestamp: '' } })) as any[],
    crdGroupCount: 5,
    availableUpdates: [],
    expiringCerts: [],
    quotaHotSpots: [],
    clusterCapacity: { cpuAllocatable: 32, memAllocatable: 64 * 1024 * 1024 * 1024, cpuCapacity: 40, memCapacity: 80 * 1024 * 1024 * 1024, pods: 750 },
    apiServerOperator: { metadata: { name: 'kube-apiserver', uid: 'a1', creationTimestamp: '' }, status: { conditions: [{ type: 'Available', status: 'True' }], latestAvailableRevision: 5 } } as any,
    etcdOperator: { metadata: { name: 'etcd', uid: 'e1', creationTimestamp: '' }, status: { conditions: [{ type: 'Available', status: 'True' }, { type: 'EtcdMembersAvailable', status: 'True', message: '3 members' }] } } as any,
    identityProviders: [],
    ingressConfig: { metadata: { name: 'cluster', uid: 'i1', creationTimestamp: '' }, spec: { domain: 'apps.cluster.example.com' } } as any,
    certExpiry: null,
    quotas: [],
    limitRanges: [],
    latestEvents: [],
    recentEvents: [],
    setActiveTab: vi.fn(),
    go: vi.fn(),
    ...overrides,
  };
}

describe('OverviewTab', () => {
  afterEach(cleanup);

  it('shows loading skeleton when loading', () => {
    const { container } = render(<OverviewTab {...makeProps({ overviewLoading: true })} />);
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);
  });

  it('shows error banner on error', () => {
    render(<OverviewTab {...makeProps({ overviewError: true })} />);
    expect(screen.getByText('Failed to load cluster data')).toBeDefined();
  });

  it('shows no alerts green banner when no alerts', () => {
    render(<OverviewTab {...makeProps()} />);
    expect(screen.getByText('No alerts firing')).toBeDefined();
  });

  it('shows firing alerts banner with counts', () => {
    render(<OverviewTab {...makeProps({
      firingAlerts: [
        { labels: { alertname: 'KubePodCrashLooping' }, annotations: {}, state: 'firing' },
        { labels: { alertname: 'NodeNotReady' }, annotations: {}, state: 'firing' },
      ],
      alertCounts: { critical: 1, warning: 1, info: 0 },
    })} />);
    expect(screen.getByText('2 alerts firing')).toBeDefined();
    expect(screen.getByText('1 critical')).toBeDefined();
    expect(screen.getByText('1 warning')).toBeDefined();
  });

  it('renders info cards with cluster version, platform, nodes', () => {
    render(<OverviewTab {...makeProps()} />);
    expect(screen.getByTestId('info-card-Cluster Version')).toBeDefined();
    expect(screen.getAllByText('4.15.0').length).toBeGreaterThan(0);
    expect(screen.getByTestId('info-card-Platform')).toBeDefined();
    expect(screen.getByText('AWS')).toBeDefined();
    expect(screen.getByTestId('info-card-Nodes')).toBeDefined();
    // "1" appears multiple times (nodes count, operator count, etc.)
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('renders cluster capacity panel', () => {
    render(<OverviewTab {...makeProps()} />);
    expect(screen.getByText('32 cores')).toBeDefined();
    expect(screen.getByText('750')).toBeDefined();
  });

  it('renders control plane status', () => {
    render(<OverviewTab {...makeProps()} />);
    expect(screen.getByText('API Server')).toBeDefined();
    expect(screen.getByText('etcd')).toBeDefined();
  });

  it('shows update banner when updates available', () => {
    render(<OverviewTab {...makeProps({ availableUpdates: [{ version: '4.16.0' }] })} />);
    expect(screen.getByText('Cluster update available')).toBeDefined();
    expect(screen.getByText('4.16.0')).toBeDefined();
  });

  it('shows no identity providers message when empty', () => {
    render(<OverviewTab {...makeProps({ identityProviders: [] })} />);
    expect(screen.getByText('No identity providers configured')).toBeDefined();
  });

  it('shows identity providers when present', () => {
    render(<OverviewTab {...makeProps({ identityProviders: [{ name: 'htpasswd', type: 'HTPasswd' }] })} />);
    expect(screen.getByText('htpasswd')).toBeDefined();
    expect(screen.getByText('HTPasswd')).toBeDefined();
  });

  it('shows expiring certs panel', () => {
    render(<OverviewTab {...makeProps({
      expiringCerts: [{ name: 'router-cert', namespace: 'openshift-ingress', daysLeft: 5 }],
    })} />);
    expect(screen.getAllByText(/cert.*expiring/i).length).toBeGreaterThan(0);
    expect(screen.getByText('openshift-ingress/router-cert')).toBeDefined();
    expect(screen.getByText('5d left')).toBeDefined();
  });

  it('shows quota hot spots', () => {
    render(<OverviewTab {...makeProps({
      quotaHotSpots: [{ namespace: 'prod', resource: 'cpu', pct: 92 }],
    })} />);
    expect(screen.getAllByText(/quota.*above 80%/i).length).toBeGreaterThan(0);
    expect(screen.getByText('92%')).toBeDefined();
  });

  it('shows HyperShift control plane when isHyperShift', () => {
    render(<OverviewTab {...makeProps({ isHyperShift: true })} />);
    expect(screen.getByText('Hosted (External)')).toBeDefined();
  });

  it('shows degraded operators when present', () => {
    render(<OverviewTab {...makeProps({
      opDegraded: 1,
      degradedOperators: [{ name: 'dns', message: 'DNS pods crashing' }],
    })} />);
    expect(screen.getByText('dns')).toBeDefined();
    expect(screen.getByText('DNS pods crashing')).toBeDefined();
  });

  it('calls setActiveTab when clicking update banner button', () => {
    const setActiveTab = vi.fn();
    render(<OverviewTab {...makeProps({ availableUpdates: [{ version: '4.16.0' }], setActiveTab })} />);
    fireEvent.click(screen.getByText('View updates'));
    expect(setActiveTab).toHaveBeenCalledWith('updates');
  });

  it('renders control plane metrics', () => {
    render(<OverviewTab {...makeProps()} />);
    expect(screen.getByTestId('cp-metrics')).toBeDefined();
  });

  it('renders warning events when present', () => {
    const event = {
      metadata: { name: 'ev1', uid: 'ev1', creationTimestamp: '2026-01-01T00:00:00Z', namespace: 'default' },
      reason: 'BackOff',
      message: 'Back-off restarting failed container',
      involvedObject: { kind: 'Pod', name: 'nginx-abc', namespace: 'default' },
      lastTimestamp: new Date().toISOString(),
    } as any;
    render(<OverviewTab {...makeProps({ latestEvents: [event], recentEvents: [event] })} />);
    expect(screen.getByText('BackOff')).toBeDefined();
    expect(screen.getByText('Back-off restarting failed container')).toBeDefined();
  });
});
