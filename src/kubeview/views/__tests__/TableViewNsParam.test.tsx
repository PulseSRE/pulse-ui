// @vitest-environment jsdom
/**
 * `/r/<gvr>?ns=<namespace>` (DetailView breadcrumb, agent namespace dashboards,
 * resource_counts cards) used to open the list for whatever namespace was
 * globally selected. TableView now lists that namespace and adopts it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import React from 'react';

const setSelectedNamespace = vi.fn();
const watchCalls: Array<{ apiPath: string; namespace?: string }> = [];
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: any) => selector({ selectedNamespace: 'default', addTab: vi.fn(), addToast: vi.fn(), setConnectionStatus: vi.fn(), setSelectedNamespace }),
    { getState: () => ({ setSelectedNamespace }) },
  ),
}));
vi.mock('../../store/clusterStore', () => ({ useClusterStore: (selector: any) => selector({ resourceRegistry: null }) }));
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: (opts: { apiPath: string; namespace?: string }) => { watchCalls.push(opts); return { data: [], isLoading: false, error: null }; },
}));
vi.mock('../../engine/query', () => ({ k8sPatch: vi.fn(), k8sDelete: vi.fn(), k8sList: vi.fn().mockResolvedValue([]) }));
vi.mock('../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: true, isLoading: false }) }));

import TableView from '../TableView';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}{l.search}</span>;
}

function renderAt(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/r/:gvr" element={<><Where /><TableView gvrKey="v1/pods" /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TableView ?ns=', () => {
  afterEach(() => { cleanup(); watchCalls.length = 0; setSelectedNamespace.mockReset(); });

  it('lists the namespace named in ?ns= from the first render', () => {
    renderAt('/r/v1~pods?ns=team-a');
    expect(watchCalls[0]).toMatchObject({ namespace: 'team-a' });
  });

  it('adopts it as the selected namespace and drops it from the URL', () => {
    renderAt('/r/v1~pods?ns=team-a&q=web');
    expect(setSelectedNamespace).toHaveBeenCalledWith('team-a');
    expect(screen.getByTestId('where').textContent).toBe('/r/v1~pods?q=web');
  });

  it('ns=* means all namespaces', () => {
    renderAt('/r/v1~pods?ns=*');
    expect(watchCalls[0].namespace).toBeUndefined();
    expect(setSelectedNamespace).toHaveBeenCalledWith('*');
  });

  it('ignores a malformed namespace', () => {
    renderAt('/r/v1~pods?ns=Bad_NS');
    expect(watchCalls[0]).toMatchObject({ namespace: 'default' });
    expect(setSelectedNamespace).not.toHaveBeenCalled();
  });

  it('without ?ns= the selected namespace applies', () => {
    renderAt('/r/v1~pods');
    expect(watchCalls[0]).toMatchObject({ namespace: 'default' });
  });
});
