// @vitest-environment jsdom
/**
 * Admin tabs follow `?tab=` through the router. AdminView read the URL once on
 * mount, so in-page links such as the Overview CRDs card (`/admin?tab=crds`)
 * changed the address bar and nothing else.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Link, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => selector({ addTab: vi.fn(), addToast: vi.fn(), setSelectedNamespace: vi.fn(), setLastSyncTime: vi.fn(), selectedNamespace: '*' }),
}));
vi.mock('../../engine/query', () => ({
  k8sList: vi.fn().mockResolvedValue([]),
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sPatch: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../components/ClusterConfig', () => ({ default: () => <div data-testid="cluster-config">ClusterConfig</div> }));
vi.mock('../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));

import AdminView from '../AdminView';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}{l.search}</span>;
}

function renderAt(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/admin" element={<><Link to="/admin?tab=crds">jump to crds</Link><Where /><AdminView /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const selected = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

describe('AdminView tabs', () => {
  afterEach(cleanup);

  it('opens the tab named in ?tab=', () => {
    renderAt('/admin?tab=certificates');
    expect(selected()).toMatch(/Certificates/);
  });

  it('switches tab when a link changes ?tab= while the page is open', () => {
    renderAt('/admin');
    expect(selected()).toMatch(/Overview/);
    fireEvent.click(screen.getByText('jump to crds'));
    expect(selected()).toMatch(/CRD/);
  });

  it('clicking a tab writes it to the URL', () => {
    renderAt('/admin');
    fireEvent.click(screen.getAllByRole('tab').find((t) => /Quotas/.test(t.textContent || ''))!);
    expect(screen.getByTestId('where').textContent).toBe('/admin?tab=quotas');
  });

  it('ignores an unknown ?tab= value', () => {
    renderAt('/admin?tab=nope');
    expect(selected()).toMatch(/Overview/);
  });
});
