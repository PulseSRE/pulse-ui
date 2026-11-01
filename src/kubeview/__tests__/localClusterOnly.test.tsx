// @vitest-environment jsdom
/**
 * Topology, the Dependencies action and the Timeline's alerts come from the
 * Pulse agent / the local Prometheus, which see the local (hub) cluster only.
 * With a remote cluster active they used to show the hub's data under the
 * remote cluster's name, or silently drop a source. Now they say so.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
const agentFetch = vi.fn();
vi.mock('../engine/safeQuery', async (orig) => ({ ...(await orig<object>()), agentFetch: (url: string) => agentFetch(url) }));

import TopologyView from '../views/TopologyView';
import TimelineView from '../views/TimelineView';
import { DetailViewHeader } from '../views/detail/DetailViewHeader';
import { useFleetStore } from '../store/fleetStore';
import { mockFetchRoutes } from './helpers/honestStates';

const GRAPH = {
  nodes: [{ id: 'Deployment/shop/web', kind: 'Deployment', name: 'web', namespace: 'shop', status: 'healthy' }],
  edges: [],
  summary: { nodes: 1, edges: 0, kinds: {}, last_refresh: 0 },
};

function wrap(ui: React.ReactElement, path = '/') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function setCluster(id: string) {
  useFleetStore.setState({
    activeClusterId: id,
    clusters: [{ id: 'local', name: 'Local Cluster', status: 'connected' }, { id: 'east', name: 'east', status: 'connected' }] as never,
  });
}

beforeEach(() => {
  agentFetch.mockReset();
  agentFetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(GRAPH), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setCluster('local'); });

describe('Topology', () => {
  it('shows a local-cluster-only notice for a remote cluster and does not read the hub graph', async () => {
    setCluster('east');
    wrap(<TopologyView />, '/topology');
    expect(await screen.findByText('Topology is available for the local cluster only')).toBeTruthy();
    expect(screen.getByText(/hidden for east/)).toBeTruthy();
    expect(agentFetch).not.toHaveBeenCalled();
    expect(screen.queryByText('web')).toBeNull();
  });

  it('shows the graph for the local cluster', async () => {
    setCluster('local');
    wrap(<TopologyView />, '/topology?namespace=shop');
    await waitFor(() => expect(agentFetch).toHaveBeenCalled());
    expect(screen.queryByText('Topology is available for the local cluster only')).toBeNull();
  });
});

describe('Dependencies action', () => {
  const props = {
    resource: { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'cfg', namespace: 'shop', uid: 'u' } } as never,
    namespace: 'shop', name: 'cfg', gvrUrl: 'v1~configmaps', resourcePlural: 'configmaps', starred: false,
    currentPath: '/r/v1~configmaps/shop/cfg', actionLoading: null, isWorkload: false, canDelete: true,
    onNavigateBack: vi.fn(), onGoToList: vi.fn(), onGoToListFiltered: vi.fn(), onCopyName: vi.fn(), onToggleFavorite: vi.fn(),
    onViewLogs: vi.fn(), onOpenTerminal: vi.fn(), onDebug: vi.fn(), onViewYaml: vi.fn(), onViewMetrics: vi.fn(),
    onDeleteRequest: vi.fn(),
  };

  it('is disabled with the reason when unavailable (remote cluster)', () => {
    mockFetchRoutes({}, 404);
    const onViewDeps = vi.fn();
    wrap(<DetailViewHeader {...props} onViewDeps={onViewDeps} depsUnavailable="The dependency graph comes from the Pulse agent, which watches the local cluster only." />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const item = screen.getByRole('menuitem', { name: /Dependencies \(local cluster only\)/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.title).toMatch(/local cluster only/);
    fireEvent.click(item);
    expect(onViewDeps).not.toHaveBeenCalled();
  });

  it('works on the local cluster', () => {
    mockFetchRoutes({}, 404);
    const onViewDeps = vi.fn();
    wrap(<DetailViewHeader {...props} onViewDeps={onViewDeps} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dependencies' }));
    expect(onViewDeps).toHaveBeenCalled();
  });
});

describe('Timeline alerts source', () => {
  it('lists alerts as unavailable for a remote cluster instead of silently dropping them', async () => {
    setCluster('east');
    mockFetchRoutes({ '/events': { body: { items: [] } } }, 404);
    wrap(<TimelineView />, '/timeline');
    expect(await screen.findByTestId('timeline-unavailable-sources')).toBeTruthy();
    expect(screen.getByTestId('timeline-unavailable-sources').textContent).toMatch(/alerts/);
    expect(document.body.textContent).not.toMatch(/No timeline entries found/);
  });

  it('has no unavailable sources on the local cluster', async () => {
    setCluster('local');
    mockFetchRoutes({ '/events': { body: { items: [] } }, '/api/v1/rules': { body: { data: { groups: [] } } }, '/query_range': { body: { data: { result: [] } } } }, 404);
    wrap(<TimelineView />, '/timeline');
    await waitFor(() => expect(screen.queryByText('Loading timeline...')).toBeNull());
    expect(screen.queryByTestId('timeline-unavailable-sources')).toBeNull();
  });
});
