// @vitest-environment jsdom
/**
 * The Software hub once embedded the OperatorHub catalog as an "Operators"
 * tab, then made that tab a redirect to /operators. The tab is gone; old
 * `?tab=operators` links are redirected at the route (SoftwareRoutes.test).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../create/InstalledTab', () => ({ InstalledTab: () => <div>installed</div> }));
vi.mock('../OperatorCatalogView', () => ({ default: () => <div data-testid="embedded-catalog" /> }));

import CreateView from '../CreateView';

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/software" element={<CreateView />} />
          <Route path="/operators" element={<div>operators page</div>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as never; });
afterEach(cleanup);

describe('Software › Operators', () => {
  it('has no Operators tab', async () => {
    renderAt('/software');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(
      ['Installed', 'Quick Deploy', 'Helm Charts', 'Templates', 'Import YAML'],
    );
    expect(screen.queryByRole('tab', { name: /Operators/ })).toBeNull();
    expect(screen.queryByTestId('embedded-catalog')).toBeNull();
  });
});
