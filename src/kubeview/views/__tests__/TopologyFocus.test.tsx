// @vitest-environment jsdom
/**
 * /topology is the one dependency graph. A resource's "Dependencies" action
 * and old /deps links open it focused on that resource, and the highlighted
 * blast radius is the agent's own list, so it matches the count shown.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const agentFetch = vi.fn();
vi.mock('../../engine/safeQuery', async (orig) => ({ ...(await orig<object>()), agentFetch: (url: string) => agentFetch(url) }));

import TopologyView from '../TopologyView';
import { resourceRoutes } from '../../routes';

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

const GRAPH = {
  nodes: [
    { id: 'Deployment/shop/web', kind: 'Deployment', name: 'web', namespace: 'shop', status: 'healthy' },
    { id: 'ReplicaSet/shop/web-1', kind: 'ReplicaSet', name: 'web-1', namespace: 'shop', status: 'healthy' },
    { id: 'Pod/shop/web-1-a', kind: 'Pod', name: 'web-1-a', namespace: 'shop', status: 'healthy' },
    { id: 'Service/shop/web', kind: 'Service', name: 'web', namespace: 'shop', status: 'healthy' },
  ],
  edges: [
    { source: 'Deployment/shop/web', target: 'ReplicaSet/shop/web-1', relationship: 'owns' },
    { source: 'ReplicaSet/shop/web-1', target: 'Pod/shop/web-1-a', relationship: 'owns' },
    { source: 'Service/shop/web', target: 'Pod/shop/web-1-a', relationship: 'selects' },
  ],
  summary: { nodes: 4, edges: 3, kinds: {}, last_refresh: 0 },
};

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {resourceRoutes()}
          <Route path="/topology" element={<><TopologyView /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  agentFetch.mockImplementation((url: string) => {
    if (url.startsWith('/api/agent/topology/blast-radius')) {
      return json({ resources: [{ id: 'ReplicaSet/shop/web-1', kind: 'ReplicaSet', name: 'web-1', namespace: 'shop', relationship: 'owns' }] });
    }
    return json(GRAPH);
  });
});
afterEach(() => { cleanup(); agentFetch.mockReset(); });

describe('/deps redirects to /topology', () => {
  it('opens /topology focused on the resource', async () => {
    renderAt('/deps/apps~v1~deployments/shop/web');
    await waitFor(() => expect(screen.getByTestId('where').textContent)
      .toBe('/topology?namespace=shop&focus=Deployment%2Fshop%2Fweb'));
    expect(await screen.findByRole('heading', { name: 'Topology' })).toBeDefined();
  });

  it('selects the focused resource and asks the agent for its blast radius', async () => {
    renderAt('/topology?namespace=shop&focus=Deployment%2Fshop%2Fweb');
    await waitFor(() => expect(agentFetch).toHaveBeenCalledWith('/api/agent/topology?namespace=shop'));
    await waitFor(() => expect(agentFetch).toHaveBeenCalledWith('/api/agent/topology/blast-radius?node_id=Deployment%2Fshop%2Fweb'));
    expect(await screen.findByText('Blast radius: 1 resource')).toBeDefined();
  });

  it('highlights exactly the agent\'s blast radius, not a client-side walk', async () => {
    const { container } = renderAt('/topology?namespace=shop&focus=Deployment%2Fshop%2Fweb');
    await screen.findByText('Blast radius: 1 resource');
    // The client-side walk would also reach the Pod; the agent says only the ReplicaSet.
    const dimmed = (name: string) => {
      const label = [...container.querySelectorAll('svg text')].find((t) => t.textContent === name);
      return label?.closest('g')?.getAttribute('opacity');
    };
    expect(dimmed('web-1')).toBe('1');
    expect(dimmed('web-1-a')).toBe('0.12');
  });

  it('says when the resource is not in the graph', async () => {
    renderAt('/topology?namespace=shop&focus=Deployment%2Fshop%2Fgone');
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Deployment/gone is not in the dependency graph for shop'));
  });

  it('a failed graph fetch shows the error with Retry', async () => {
    agentFetch.mockImplementation(() => json({}, 503));
    renderAt('/topology?namespace=shop&focus=Deployment%2Fshop%2Fweb');
    expect(await screen.findByText('Topology fetch failed (503)')).toBeDefined();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeDefined();
  });
});
