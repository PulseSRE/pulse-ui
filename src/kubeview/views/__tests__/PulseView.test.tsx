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
      connectionStatus: 'connected',
      addTab: addTabMock,
      setConnectionStatus: vi.fn(),
      addToast: vi.fn(),
    };
    return selector(state);
  },
}));

vi.mock('../../store/customViewStore', () => ({
  useCustomViewStore: (selector: any) => selector({ views: [] }),
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

// Partial mock: PulseView pulls only fetchCapabilities from this module, but
// components rendered inside it use the rest, so keep the real exports.
const capabilitiesMock = vi.fn();
vi.mock('../../engine/analyticsApi', async () => {
  const actual = await vi.importActual<any>('../../engine/analyticsApi');
  return { ...actual, fetchCapabilities: (...a: any[]) => capabilitiesMock(...a) };
});

import PulseView, { trustDivergenceNote } from '../PulseView';
import { useTrustStore } from '../../store/trustStore';

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


/**
 * The trust badge on the front door reported a browser preference.
 *
 * `useTrustStore` is zustand `persist` on localStorage, keyed per hostname. It
 * is sent to the agent when the monitor socket connects and never read back,
 * so the badge showed what this tab had asked for rather than what the agent
 * was doing. Two operators on one cluster could read two different trust
 * levels off the same agent — and since the server-side floor is now set by
 * `settings.monitor.max_trust_level`, both could be wrong about what it would
 * do with nobody watching.
 */
describe('the trust badge reports the agent, not the tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockData({});
    useTrustStore.setState({ trustLevel: 1 });
  });

  afterEach(cleanup);

  it('shows the level the agent is running at, not the one this tab asked for', async () => {
    capabilitiesMock.mockResolvedValue({ max_trust_level: 3, effective_trust_level: 3 });
    renderPulse();
    expect(await screen.findByText(/Trust 3/)).toBeDefined();
    expect(screen.queryByText(/Trust 1/)).toBeNull();
  });

  // The explanation itself lives in the tooltip, which Radix renders through a
  // portal only once open. Its decision is a pure function, so it is tested
  // directly rather than by driving hover in jsdom.
  describe('trustDivergenceNote', () => {
    it('explains the gap when the tab and the agent disagree', () => {
      expect(trustDivergenceNote(1, 3)).toBe(
        'This tab asked for 1. The agent is running at 3, set on the server.',
      );
    });

    it('says nothing when they agree', () => {
      expect(trustDivergenceNote(2, 2)).toBeNull();
    });

    it('says nothing when the agent does not report a level', () => {
      expect(trustDivergenceNote(1, undefined)).toBeNull();
    });

    it('explains a gap that runs the other way, too', () => {
      // A subscriber can raise the level, so the tab may be above the agent
      // as well as below it. Both directions are worth explaining.
      expect(trustDivergenceNote(3, 1)).toContain('running at 1');
    });

    it('treats 0 as a level, not as absent', () => {
      // Observe is the most restrictive setting and it is falsy — an operator
      // whose agent dropped to 0 most needs to be told.
      expect(trustDivergenceNote(2, 0)).toContain('running at 0');
    });
  });

  it('falls back to the local value against an agent that does not send the field', async () => {
    // An older agent has no effective_trust_level. Showing nothing, or zero,
    // would both be worse than showing the only number available.
    capabilitiesMock.mockResolvedValue({ max_trust_level: 2 });
    renderPulse();
    expect(await screen.findByText(/Trust 1/)).toBeDefined();
    expect(screen.queryByText(/This tab asked for/)).toBeNull();
  });

  it('falls back when the capabilities call fails outright', async () => {
    capabilitiesMock.mockRejectedValue(new Error('agent unreachable'));
    renderPulse();
    expect(await screen.findByText(/Trust 1/)).toBeDefined();
  });

  it('reads trust 0 as trust 0, not as missing', async () => {
    // `?? requestedTrust` rather than `|| requestedTrust`: level 0 is Observe,
    // a real and the most restrictive setting, and it is falsy.
    capabilitiesMock.mockResolvedValue({ max_trust_level: 0, effective_trust_level: 0 });
    renderPulse();
    expect(await screen.findByText(/Trust 0/)).toBeDefined();
  });
});
