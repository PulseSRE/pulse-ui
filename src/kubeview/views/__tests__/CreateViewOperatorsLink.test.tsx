// @vitest-environment jsdom
/**
 * The Create page embedded the whole OperatorHub catalog as its "Operators"
 * tab, a second copy of /operators. It now opens /operators, and old
 * `?tab=operators&q=…` links land there with their search.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
          <Route path="/create/:gvr" element={<CreateView gvrKey="v1/pods" />} />
          <Route path="/operators" element={<div>operators page</div>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as never; });
afterEach(cleanup);

describe('Create › Operators', () => {
  it('the Operators tab opens /operators instead of embedding a second catalog', async () => {
    renderAt('/create/v1~pods');
    fireEvent.click(screen.getByRole('tab', { name: /Operators/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/operators'));
    expect(screen.queryByTestId('embedded-catalog')).toBeNull();
  });

  it('an old ?tab=operators&q= link lands on /operators with the search', async () => {
    renderAt('/create/v1~pods?tab=operators&q=cluster-logging');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/operators?q=cluster-logging'));
    expect(screen.getByText('operators page')).toBeDefined();
  });
});
