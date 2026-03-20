// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useClusterStore } from '../store/clusterStore';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../store/uiStore', () => ({
  useUIStore: (selector: any) => selector({
    selectedNamespace: '*',
    addTab: vi.fn(),
    setConnectionStatus: vi.fn(),
    addToast: vi.fn(),
  }),
}));

const _mockListWatchData: Record<string, any[]> = {};
vi.mock('../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({
    data: _mockListWatchData[apiPath] || [],
    isLoading: false,
  }),
}));

vi.mock('../hooks/useNavigateTab', () => ({
  useNavigateTab: () => vi.fn(),
}));

vi.mock('../engine/query', () => ({
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sList: vi.fn().mockResolvedValue([]),
  k8sPatch: vi.fn().mockResolvedValue(null),
}));

vi.mock('../components/metrics/prometheus', () => ({
  queryInstant: vi.fn().mockResolvedValue([]),
  queryRange: vi.fn().mockResolvedValue([]),
  getTimeRange: vi.fn().mockReturnValue([0, 1]),
}));

vi.mock('../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div>,
  Sparkline: () => <div data-testid="sparkline" />,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

function qcWrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  useClusterStore.setState({
    resourceRegistry: null,
    apiGroups: [],
    discoveryLoading: false,
    discoveryError: null,
    clusterVersion: null,
    kubernetesVersion: null,
    platform: null,
    controlPlaneTopology: null,
    isHyperShift: false,
  });
});

afterEach(() => {
  cleanup();
  Object.keys(_mockListWatchData).forEach(k => delete _mockListWatchData[k]);
});

describe('HyperShift detection - clusterStore', () => {
  it('detects External topology as HyperShift', () => {
    useClusterStore.getState().setClusterInfo({ controlPlaneTopology: 'External' });
    expect(useClusterStore.getState().isHyperShift).toBe(true);
  });

  it('HighlyAvailable topology is not HyperShift', () => {
    useClusterStore.getState().setClusterInfo({ controlPlaneTopology: 'HighlyAvailable' });
    expect(useClusterStore.getState().isHyperShift).toBe(false);
  });

  it('preserves HyperShift state across partial updates', () => {
    useClusterStore.getState().setClusterInfo({ controlPlaneTopology: 'External' });
    useClusterStore.getState().setClusterInfo({ version: '4.17' });
    expect(useClusterStore.getState().isHyperShift).toBe(true);
  });
});

describe('HyperShift UI - ReportTab', () => {
  // Lazy import to ensure mocks are in place
  let ReportTab: any;
  beforeEach(async () => {
    const mod = await import('../views/pulse/ReportTab');
    ReportTab = mod.ReportTab;
  });

  it('shows "Hosted Control Plane" badge when HyperShift', () => {
    useClusterStore.setState({ isHyperShift: true, controlPlaneTopology: 'External' });
    qcWrap(<ReportTab nodes={[]} allPods={[]} deployments={[]} pvcs={[]} operators={[]} go={vi.fn()} />);
    expect(screen.getByText('Hosted Control Plane')).toBeDefined();
  });

  it('does not show "Hosted Control Plane" badge on traditional cluster', () => {
    useClusterStore.setState({ isHyperShift: false, controlPlaneTopology: 'HighlyAvailable' });
    qcWrap(<ReportTab nodes={[]} allPods={[]} deployments={[]} pvcs={[]} operators={[]} go={vi.fn()} />);
    expect(screen.queryByText('Hosted Control Plane')).toBeNull();
  });

  it('shows "managed externally" when HyperShift with no CP operators', () => {
    useClusterStore.setState({ isHyperShift: true, controlPlaneTopology: 'External' });
    qcWrap(<ReportTab nodes={[]} allPods={[]} deployments={[]} pvcs={[]} operators={[]} go={vi.fn()} />);
    expect(screen.getByText('Control plane operators managed externally')).toBeDefined();
  });

  it('shows CP operators that exist on HyperShift cluster', () => {
    useClusterStore.setState({ isHyperShift: true, controlPlaneTopology: 'External' });
    const ops = [
      { metadata: { name: 'authentication' }, status: { conditions: [{ type: 'Available', status: 'True' }] } },
    ];
    qcWrap(<ReportTab nodes={[]} allPods={[]} deployments={[]} pvcs={[]} operators={ops as any} go={vi.fn()} />);
    expect(screen.getByText('authentication')).toBeDefined();
    // Should not show missing operators like etcd
    expect(screen.queryByText('etcd')).toBeNull();
  });
});

describe('HyperShift UI - ProductionReadiness', () => {
  let ProductionReadiness: any;
  beforeEach(async () => {
    const mod = await import('../components/ProductionReadiness');
    ProductionReadiness = mod.default;
  });

  it('shows "Hosted Control Plane" check as pass on HyperShift', () => {
    useClusterStore.setState({ isHyperShift: true, controlPlaneTopology: 'External' });
    qcWrap(<ProductionReadiness />);
    expect(screen.getByText('Hosted Control Plane')).toBeDefined();
    expect(screen.getByText(/Managed externally/)).toBeDefined();
  });

  it('shows "High Availability Control Plane" on traditional cluster', () => {
    useClusterStore.setState({ isHyperShift: false, controlPlaneTopology: 'HighlyAvailable' });
    qcWrap(<ProductionReadiness />);
    expect(screen.getByText('High Availability Control Plane')).toBeDefined();
  });

  it('shows etcd backup as pass with hosting provider message on HyperShift', () => {
    useClusterStore.setState({ isHyperShift: true, controlPlaneTopology: 'External' });
    qcWrap(<ProductionReadiness />);
    expect(screen.getByText('Managed by hosting provider')).toBeDefined();
  });
});

describe('HyperShift UI - ComputeView health audit', () => {
  const workerNode = {
    metadata: { name: 'worker-1', uid: 'w1', labels: { 'node-role.kubernetes.io/worker': '' }, creationTimestamp: '2025-01-01T00:00:00Z' },
    status: {
      conditions: [{ type: 'Ready', status: 'True' }],
      allocatable: { cpu: '4', memory: '16Gi', pods: '250' },
      capacity: { cpu: '4', memory: '16Gi' },
      nodeInfo: { kubeletVersion: 'v1.30.0', osImage: 'RHCOS', containerRuntimeVersion: 'cri-o://1.30' },
    },
  };

  let ComputeView: any;
  beforeEach(async () => {
    const mod = await import('../views/ComputeView');
    ComputeView = mod.default;
    _mockListWatchData['/api/v1/nodes'] = [workerNode];
  });

  it('skips HA Control Plane check on HyperShift', () => {
    useClusterStore.setState({ isHyperShift: true, controlPlaneTopology: 'External' });
    qcWrap(<ComputeView />);
    expect(screen.queryByText('HA Control Plane')).toBeNull();
  });

  it('shows HA Control Plane check on traditional cluster', () => {
    useClusterStore.setState({ isHyperShift: false, controlPlaneTopology: 'HighlyAvailable' });
    qcWrap(<ComputeView />);
    expect(screen.getByText('HA Control Plane')).toBeDefined();
  });

  it('shows "Worker Nodes" title on HyperShift', () => {
    useClusterStore.setState({ isHyperShift: true, controlPlaneTopology: 'External' });
    qcWrap(<ComputeView />);
    expect(screen.getByText('Worker Nodes')).toBeDefined();
  });
});
