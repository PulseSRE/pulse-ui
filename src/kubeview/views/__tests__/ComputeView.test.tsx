// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => selector({ selectedNamespace: '*', addTab: vi.fn() }),
}));
const mockData: Record<string, any[]> = {};
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({ data: mockData[apiPath] || [], isLoading: false }),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../engine/query', () => ({ k8sList: vi.fn().mockResolvedValue([]), k8sGet: vi.fn().mockResolvedValue(null) }));
vi.mock('../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div>,
}));
vi.mock('../../components/metrics/prometheus', () => ({ queryInstant: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import ComputeView from '../ComputeView';

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ComputeView /></MemoryRouter></QueryClientProvider>);
}

describe('ComputeView', () => {
  afterEach(() => { cleanup(); Object.keys(mockData).forEach(k => delete mockData[k]); });

  it('renders page header', () => {
    renderView();
    expect(screen.getAllByText('Compute').length).toBeGreaterThanOrEqual(1);
  });

  it('shows cluster capacity stats', () => {
    renderView();
    expect(screen.getAllByText(/Total CPU/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Total Memory/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows metric cards', () => {
    renderView();
    expect(screen.getAllByTestId('metric-card').length).toBeGreaterThanOrEqual(4);
  });

  it('shows nodes table', () => {
    renderView();
    expect(screen.getAllByText(/Nodes/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders with node data', () => {
    mockData['/api/v1/nodes'] = [{
      metadata: { name: 'node-1', uid: '1', labels: { 'node-role.kubernetes.io/worker': '' }, creationTimestamp: '2025-01-01T00:00:00Z' },
      status: {
        conditions: [{ type: 'Ready', status: 'True' }],
        allocatable: { cpu: '4', memory: '16Gi', pods: '250' },
        capacity: { cpu: '4', memory: '16Gi' },
        nodeInfo: { kubeletVersion: 'v1.28.0', osImage: 'RHCOS', containerRuntimeVersion: 'cri-o://1.28' },
      },
    }];
    renderView();
    // Node name appears in hex map (may be shortened) or stat cards
    expect(screen.getByText('Compute')).toBeTruthy();
    expect(screen.getByText('Nodes')).toBeTruthy();
  });

  // Regression: kube_node_info (kube-state-metrics) never has an `instance`
  // label of its own — only `node` — so joining on it with bare
  // `on(instance) group_left(node) kube_node_info` gives every node's series
  // the same empty match key `{}` and Thanos rejects the query with a 422
  // ("duplicate series for the match group"). The query must project
  // kube_node_info's `node` label onto a synthetic `instance` label via
  // `label_replace(...)` before joining so the match key is unique per node.
  it('joins kube_node_info via label_replace(node -> instance) to avoid the ambiguous-match 422', async () => {
    const { queryInstant } = await import('../../components/metrics/prometheus');
    const seenQueries: string[] = [];
    (queryInstant as any).mockImplementation((query: string) => {
      seenQueries.push(query);
      return Promise.resolve([]);
    });

    renderView();

    await screen.findByText('Compute');

    const cpuQuery = seenQueries.find((q) => q.includes('node_cpu_seconds_total'));
    const memQuery = seenQueries.find((q) => q.includes('node_memory_MemAvailable_bytes') && q.includes('kube_node_info'));

    expect(cpuQuery).toContain('label_replace(kube_node_info, "instance", "$1", "node", "(.+)")');
    expect(cpuQuery).not.toMatch(/on\(instance\)\s+group_left\(node\)\s+kube_node_info\b/);
    expect(memQuery).toContain('label_replace(kube_node_info, "instance", "$1", "node", "(.+)")');
  });

  // Defensive fallback: safeQuery only swallows 404s, so any other failure
  // (e.g. a cluster where the label_replace assumption somehow still doesn't
  // hold) must be caught explicitly and retried as a plain by-instance query
  // — otherwise the hex map/table show "—" for every node's CPU/memory
  // forever, even though Prometheus itself is reachable and healthy.
  it('falls back to the plain per-node query and still shows CPU/memory when the kube_node_info join errors', async () => {
    const { queryInstant } = await import('../../components/metrics/prometheus');
    (queryInstant as any).mockImplementation((query: string) => {
      if (query.includes('kube_node_info')) {
        return Promise.reject(new Error('Prometheus query failed: 422 Unprocessable Entity'));
      }
      // node-cpu resolves usage in cores (the component divides by node
      // capacity to get a percentage); node-mem resolves an already-computed percentage.
      if (query.includes('node_cpu_seconds_total')) {
        return Promise.resolve([{ metric: { instance: 'node-1' }, value: 1.6 }]);
      }
      if (query.includes('node_memory_MemAvailable_bytes')) {
        return Promise.resolve([{ metric: { instance: 'node-1' }, value: 55 }]);
      }
      return Promise.resolve([]);
    });

    mockData['/api/v1/nodes'] = [{
      metadata: { name: 'node-1', uid: '1', labels: { 'node-role.kubernetes.io/worker': '' }, creationTimestamp: '2025-01-01T00:00:00Z' },
      status: {
        conditions: [{ type: 'Ready', status: 'True' }],
        allocatable: { cpu: '4', memory: '16Gi', pods: '250' },
        capacity: { cpu: '4', memory: '16Gi' },
        nodeInfo: { kubeletVersion: 'v1.28.0', osImage: 'RHCOS', containerRuntimeVersion: 'cri-o://1.28' },
      },
    }];

    renderView();

    // 1.6 cores / 4 cores capacity = 40%
    expect(await screen.findByText('40%')).toBeTruthy();
    expect(screen.getByText('55%')).toBeTruthy();
  });
});
