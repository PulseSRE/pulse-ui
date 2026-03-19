// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// --- Mocks (vi.mock is hoisted before imports) ---

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
    };
    return selector(state);
  },
}));

// Mock useK8sListWatch — returns data based on apiPath
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

// Now import the component (mocks are hoisted above this)
import PulseView from '../PulseView';

// --- Helpers ---

function setMockData(data: Record<string, { data: any[]; isLoading: boolean }>) {
  // Clear and repopulate the shared mock data object
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

function renderPulse(tab: string = 'overview') {
  const queryClient = createQueryClient();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search: `?tab=${tab}`, href: `http://localhost/pulse?tab=${tab}` },
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

// Pod factory
function makePod(name: string, phase: string, opts?: {
  namespace?: string;
  containerState?: Record<string, unknown>;
  ownerKind?: string;
  uid?: string;
}) {
  const containerStatuses = opts?.containerState
    ? [{ name: 'main', ready: false, restartCount: 5, state: opts.containerState }]
    : phase === 'Running'
    ? [{ name: 'main', ready: true, restartCount: 0, state: { running: {} } }]
    : [];

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name,
      namespace: opts?.namespace ?? 'default',
      uid: opts?.uid ?? `uid-${name}`,
      ownerReferences: opts?.ownerKind
        ? [{ kind: opts.ownerKind, name: 'owner', uid: 'owner-uid', apiVersion: 'v1' }]
        : [],
    },
    spec: {},
    status: { phase, containerStatuses },
  };
}

// Node factory
function makeNode(name: string, ready: boolean, pressure?: { disk?: boolean; memory?: boolean; pid?: boolean }) {
  const conditions: Array<Record<string, string>> = [
    { type: 'Ready', status: ready ? 'True' : 'False' },
  ];
  if (pressure?.disk) conditions.push({ type: 'DiskPressure', status: 'True' });
  if (pressure?.memory) conditions.push({ type: 'MemoryPressure', status: 'True' });
  if (pressure?.pid) conditions.push({ type: 'PIDPressure', status: 'True' });

  return {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: { name, uid: `uid-${name}`, labels: {} },
    spec: {},
    status: { conditions },
  };
}

// Deployment factory
function makeDeployment(name: string, ready: number, desired: number, opts?: { namespace?: string }) {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace: opts?.namespace ?? 'default', uid: `uid-${name}` },
    spec: { replicas: desired },
    status: { readyReplicas: ready, availableReplicas: ready },
  };
}

// Operator factory
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

// --- Tests ---

describe('PulseView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockData({});
  });

  afterEach(() => {
    cleanup();
  });

  it('renders "Everything looks good" when no issues', () => {
    setMockData({
      '/api/v1/nodes': { data: [makeNode('node-1', true), makeNode('node-2', true)], isLoading: false },
      '/api/v1/pods': { data: [makePod('pod-1', 'Running')], isLoading: false },
      '/apis/apps/v1/deployments': { data: [makeDeployment('deploy-1', 2, 2)], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [makeOperator('auth', false)], isLoading: false },
    });

    renderPulse();
    expect(screen.getByText('Everything looks good')).toBeDefined();
    expect(screen.getByText('All systems healthy')).toBeDefined();
  });

  it('shows failing pod count when pods are in CrashLoopBackOff', () => {
    const crashPod = makePod('crash-pod', 'Running', {
      containerState: { waiting: { reason: 'CrashLoopBackOff' } },
    });

    setMockData({
      '/api/v1/nodes': { data: [makeNode('node-1', true)], isLoading: false },
      '/api/v1/pods': { data: [crashPod, makePod('ok-pod', 'Running')], isLoading: false },
      '/apis/apps/v1/deployments': { data: [], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [], isLoading: false },
    });

    renderPulse();
    expect(screen.getByText('Failing Pods (1)')).toBeDefined();
    expect(screen.getByText('crash-pod')).toBeDefined();
    expect(screen.getByText('CrashLoopBackOff')).toBeDefined();
  });

  it('shows stat cards (Nodes, Pods, Deployments, Operators, CPU, Memory)', () => {
    setMockData({
      '/api/v1/nodes': { data: [makeNode('node-1', true), makeNode('node-2', true)], isLoading: false },
      '/api/v1/pods': { data: [makePod('pod-1', 'Running'), makePod('pod-2', 'Running')], isLoading: false },
      '/apis/apps/v1/deployments': { data: [makeDeployment('d1', 1, 1)], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [makeOperator('dns', false)], isLoading: false },
    });

    renderPulse();
    expect(screen.getByText('Nodes')).toBeDefined();
    expect(screen.getByText('Pods')).toBeDefined();
    expect(screen.getByText('Deployments')).toBeDefined();
    expect(screen.getByText('Operators')).toBeDefined();
    expect(screen.getByText('CPU')).toBeDefined();
    expect(screen.getByText('Memory')).toBeDefined();

    // Values: healthy/total format (multiple stat cards may show same ratio)
    expect(screen.getAllByText('2/2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1/1').length).toBeGreaterThanOrEqual(1);
  });

  it('shows degraded operator section', () => {
    setMockData({
      '/api/v1/nodes': { data: [makeNode('node-1', true)], isLoading: false },
      '/api/v1/pods': { data: [], isLoading: false },
      '/apis/apps/v1/deployments': { data: [], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': {
        data: [makeOperator('auth', true), makeOperator('dns', false)],
        isLoading: false,
      },
    });

    renderPulse();
    expect(screen.getByText('Degraded Operators (1)')).toBeDefined();
    expect(screen.getByText('auth')).toBeDefined();
    expect(screen.getByText('Degraded')).toBeDefined();
  });

  it('excludes installer pods from failing pods', () => {
    const installerPod = makePod('installer-1-node-1', 'Failed');
    const prunerPod = makePod('revision-pruner-1-node-1', 'Failed');

    setMockData({
      '/api/v1/nodes': { data: [makeNode('node-1', true)], isLoading: false },
      '/api/v1/pods': { data: [installerPod, prunerPod, makePod('ok-pod', 'Running')], isLoading: false },
      '/apis/apps/v1/deployments': { data: [], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [], isLoading: false },
    });

    renderPulse();
    expect(screen.getByText('Everything looks good')).toBeDefined();
    expect(screen.queryByText('Failing Pods')).toBeNull();
  });

  it('excludes job-owned failed pods', () => {
    const jobPod = makePod('job-pod-abc', 'Failed', { ownerKind: 'Job' });

    setMockData({
      '/api/v1/nodes': { data: [makeNode('node-1', true)], isLoading: false },
      '/api/v1/pods': { data: [jobPod], isLoading: false },
      '/apis/apps/v1/deployments': { data: [], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [], isLoading: false },
    });

    renderPulse();
    expect(screen.getByText('Everything looks good')).toBeDefined();
  });

  it('shows unready nodes section', () => {
    setMockData({
      '/api/v1/nodes': { data: [makeNode('bad-node', false), makeNode('good-node', true)], isLoading: false },
      '/api/v1/pods': { data: [], isLoading: false },
      '/apis/apps/v1/deployments': { data: [], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [], isLoading: false },
    });

    renderPulse();
    expect(screen.getByText('Unready Nodes (1)')).toBeDefined();
    expect(screen.getByText('bad-node')).toBeDefined();
    expect(screen.getByText('NotReady')).toBeDefined();
  });

  it('shows "Cluster-wide" label for node/operator issues', () => {
    setMockData({
      '/api/v1/nodes': { data: [makeNode('bad-node', false)], isLoading: false },
      '/api/v1/pods': { data: [], isLoading: false },
      '/apis/apps/v1/deployments': { data: [], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [makeOperator('auth', true)], isLoading: false },
    });

    renderPulse();
    expect(screen.getByText('Cluster-wide issues')).toBeDefined();
    expect(screen.getByText('Cluster-wide')).toBeDefined();
  });

  it('shows separate namespace and cluster stat sections', () => {
    setMockData({
      '/api/v1/nodes': { data: [makeNode('node-1', true)], isLoading: false },
      '/api/v1/pods': { data: [makePod('pod-1', 'Running')], isLoading: false },
      '/apis/apps/v1/deployments': { data: [makeDeployment('d1', 1, 1)], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [makeOperator('dns', false)], isLoading: false },
    });

    renderPulse();
    // Cluster-wide label always shows
    expect(screen.getByText('Cluster-wide')).toBeDefined();
    // Cluster stats
    expect(screen.getByText('Nodes')).toBeDefined();
    expect(screen.getByText('Operators')).toBeDefined();
    expect(screen.getByText('CPU')).toBeDefined();
    expect(screen.getByText('Memory')).toBeDefined();
    // Namespace stats
    expect(screen.getByText('Pods')).toBeDefined();
    expect(screen.getByText('Deployments')).toBeDefined();
    expect(screen.getByText('PVCs')).toBeDefined();
  });

  it('shows the issue count badge when there are issues', () => {
    setMockData({
      '/api/v1/nodes': { data: [makeNode('bad-node', false)], isLoading: false },
      '/api/v1/pods': { data: [], isLoading: false },
      '/apis/apps/v1/deployments': { data: [], isLoading: false },
      '/api/v1/persistentvolumeclaims': { data: [], isLoading: false },
      '/apis/config.openshift.io/v1/clusteroperators': { data: [], isLoading: false },
    });

    renderPulse();
    expect(screen.getByText('1 issue')).toBeDefined();
  });
});
