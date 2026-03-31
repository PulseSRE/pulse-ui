// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const navigateMock = vi.fn();
const addTabMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = {
      selectedNamespace: '*',
      addTab: addTabMock,
      setConnectionStatus: vi.fn(),
      addToast: vi.fn(),
    };
    return selector(state);
  },
}));

const _mockListWatchData: Record<string, { data: any[]; isLoading: boolean }> = {};

vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => {
    const entry = _mockListWatchData[apiPath] ?? { data: [], isLoading: false };
    return { data: entry.data, isLoading: entry.isLoading };
  },
}));

vi.mock('../../hooks/useNavigateTab', () => ({
  useNavigateTab: () => vi.fn(),
}));

vi.mock('../../engine/query', () => ({
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sList: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../components/metrics/prometheus', () => ({
  queryInstant: vi.fn().mockResolvedValue([]),
  queryRange: vi.fn().mockResolvedValue([]),
  getTimeRange: vi.fn().mockReturnValue([0, 1]),
}));

vi.mock('../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div>,
  Sparkline: () => <div data-testid="sparkline" />,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../engine/gvr', () => ({
  resourceDetailUrl: (r: any) => `/r/v1~pods/${r.metadata?.namespace}/${r.metadata?.name}`,
}));

vi.mock('../../engine/diagnosis', () => ({
  diagnoseResource: () => [],
}));

import PulseView from '../PulseView';

function setMockData(data: Record<string, { data: any[]; isLoading: boolean }>) {
  for (const key of Object.keys(_mockListWatchData)) {
    delete _mockListWatchData[key];
  }
  Object.assign(_mockListWatchData, data);
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderPulse() {
  const queryClient = createQueryClient();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search: '', href: 'http://localhost/pulse' },
    writable: true,
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PulseView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeNode(name: string, ready: boolean) {
  return {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: { name, uid: `uid-${name}`, labels: {} },
    spec: {},
    status: { conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] },
  };
}

function makeOperator(name: string, degraded: boolean) {
  return {
    apiVersion: 'config.openshift.io/v1',
    kind: 'ClusterOperator',
    metadata: { name, uid: `uid-${name}` },
    status: {
      conditions: degraded
        ? [{ type: 'Degraded', status: 'True', message: `${name} is degraded` }]
        : [{ type: 'Available', status: 'True' }],
    },
  };
}

describe('PulseView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockData({});
  });

  afterEach(cleanup);

  it('renders header with Cluster Pulse title', () => {
    renderPulse();
    expect(screen.getByText('Cluster Pulse')).toBeDefined();
  });

  it('renders health overview subtitle', () => {
    renderPulse();
    expect(screen.getByText(/Health overview/)).toBeDefined();
  });

  it('renders zone headers for all 4 zones', () => {
    // Include a degraded operator so Zen state doesn't trigger
    setMockData({
      '/api/v1/nodes': { data: [makeNode('node-1', true)], isLoading: false },
      '/api/v1/pods': { data: [], isLoading: false },
      '/apis/apps/v1/deployments': { data: [], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [makeOperator('kube-apiserver', true)], isLoading: false },
    });

    renderPulse();
    expect(screen.getByText('Heartbeat')).toBeDefined();
    expect(screen.getByText('Bottleneck')).toBeDefined();
    expect(screen.getByText('Fire Alarm')).toBeDefined();
    expect(screen.getByText('Roadmap')).toBeDefined();
  });

  it('renders metric sparkline cards', () => {
    setMockData({
      '/api/v1/nodes': { data: [], isLoading: false },
      '/api/v1/pods': { data: [], isLoading: false },
      '/apis/apps/v1/deployments': { data: [], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [], isLoading: false },
    });

    renderPulse();
    const cards = screen.getAllByTestId('metric-card');
    expect(cards.length).toBe(4);
  });

  it('shows zen state when cluster is healthy', () => {
    setMockData({
      '/api/v1/nodes': { data: [makeNode('node-1', true)], isLoading: false },
      '/api/v1/pods': { data: [], isLoading: false },
      '/apis/apps/v1/deployments': { data: [], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [makeOperator('auth', false)], isLoading: false },
    });

    renderPulse();
    expect(screen.getByText('All Systems Nominal')).toBeDefined();
  });

  it('shows control plane section', () => {
    setMockData({
      '/api/v1/nodes': { data: [], isLoading: false },
      '/api/v1/pods': { data: [], isLoading: false },
      '/apis/apps/v1/deployments': { data: [], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [makeOperator('kube-apiserver', false)], isLoading: false },
    });

    renderPulse();
    expect(screen.getByText('Control Plane')).toBeDefined();
  });
});
