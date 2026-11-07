// @vitest-environment jsdom
/**
 * The command bar's namespace picker writes the page's `?ns=`, and on a page
 * that shows every namespace it says so instead of being silently ignored.
 * Topology's own namespace select is the same scope.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../../hooks/usePulseStatus', () => ({ usePulseUpgrade: () => ({ phase: '', upgrading: false }) }));
vi.mock('../../engine/inboxApi', async (orig) => ({ ...(await orig<object>()), fetchInboxStats: () => Promise.resolve({}) }));
vi.mock('../../engine/query', async (orig) => ({
  ...(await orig<object>()),
  k8sFetch: (_cluster: string, path: string) => Promise.resolve(path === '/api/v1/namespaces'
    ? new Response(JSON.stringify({ items: [{ metadata: { name: 'payments' } }, { metadata: { name: 'shop' } }] }), { status: 200 })
    : new Response('{}', { status: 404 })),
}));
const agentFetch = vi.fn();
vi.mock('../../engine/safeQuery', async (orig) => ({ ...(await orig<object>()), agentFetch: (url: string) => agentFetch(url) }));

import { CommandBar } from '../../components/CommandBar';
import { StatusBar } from '../../components/StatusBar';
import TopologyView from '../TopologyView';
import { useNamespaceScope, resetNamespaceScopeSync } from '../../hooks/useNamespaceScope';
import { useUIStore } from '../../store/uiStore';
import { useFleetStore } from '../../store/fleetStore';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}{l.search}</span>;
}
function ScopedPage() {
  const { namespace } = useNamespaceScope();
  return <div data-testid="page-scope">{namespace}</div>;
}
function UnscopedPage() {
  useNamespaceScope({ applies: false });
  return <div>security</div>;
}

let client: QueryClient;
function renderAt(at: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <CommandBar />
        <Routes>
          <Route path="/workloads" element={<ScopedPage />} />
          <Route path="/security" element={<UnscopedPage />} />
          <Route path="/topology" element={<TopologyView />} />
        </Routes>
        <StatusBar />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  resetNamespaceScopeSync();
  useUIStore.setState({ selectedNamespace: '*', namespaceScopeUsers: 0, namespaceScopeOptOuts: 0 });
  useFleetStore.setState({ activeClusterId: 'local' });
  agentFetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ nodes: [], edges: [], summary: { nodes: 0, edges: 0, kinds: {}, last_refresh: 0 } }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  client.clear();
  agentFetch.mockReset();
  useUIStore.setState({ selectedNamespace: '*' });
});

describe('namespace picker', () => {
  it('writes ?ns= on a scoped page; the page and status bar follow', async () => {
    renderAt('/workloads?tab=pods');
    fireEvent.click(screen.getByTitle('Switch namespace (⌘N)'));
    fireEvent.click(await screen.findByRole('button', { name: 'payments' }));
    expect(where()).toBe('/workloads?tab=pods&ns=payments');
    expect(screen.getByTestId('page-scope').textContent).toBe('payments');
    expect(screen.getByTitle('Switch namespace (⌘N)').textContent).toBe('payments');
  });

  it('a shared link opens the page in its scope and the picker shows it', () => {
    renderAt('/workloads?ns=shop');
    expect(screen.getByTestId('page-scope').textContent).toBe('shop');
    expect(screen.getByTitle('Switch namespace (⌘N)').textContent).toBe('shop');
  });

  it('on a page that shows every namespace it reads "All namespaces on this page" and cannot be opened', () => {
    useUIStore.setState({ selectedNamespace: 'payments' });
    renderAt('/security');
    const picker = screen.getByRole('button', { name: 'Namespace: all namespaces on this page' });
    expect(picker).toHaveProperty('disabled', true);
    expect(picker.textContent).toBe('All namespaces on this page');
    expect(picker.getAttribute('title')).toMatch(/payments is kept for other pages/);
    expect(screen.getByText('all namespaces')).toBeDefined();
    // The choice is kept, and the URL is not rewritten.
    expect(useUIStore.getState().selectedNamespace).toBe('payments');
    expect(where()).toBe('/security');
  });
});

describe('Topology', () => {
  it('its namespace select is the shared scope, and the graph is fetched for it', async () => {
    renderAt('/topology?ns=payments');
    await waitFor(() => expect(agentFetch).toHaveBeenCalledWith('/api/agent/topology?namespace=payments'));
    expect(screen.getByTitle('Switch namespace (⌘N)').textContent).toBe('payments');
  });

  it('All namespaces in the picker shows the whole graph and leaves no ?ns=', async () => {
    useUIStore.setState({ selectedNamespace: 'payments' });
    renderAt('/topology?ns=payments');
    fireEvent.click(screen.getByTitle('Switch namespace (⌘N)'));
    fireEvent.click(await screen.findByRole('button', { name: /All Namespaces/ }));
    expect(where()).toBe('/topology');
    await waitFor(() => expect(agentFetch).toHaveBeenLastCalledWith('/api/agent/topology'));
  });
});
