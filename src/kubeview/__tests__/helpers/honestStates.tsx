/**
 * Test helpers for "a failure must never look like all clear".
 *
 * `renderWithFailedRequests` renders a page with every network read failing
 * (403 by default; routes can be let through), and `expectNoAllClear` asserts
 * that what the user sees is an error or unknown state, not reassurance.
 */
import React from 'react';
import { vi, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

export type MockRoute = { status?: number; body: unknown } | ((url: string, init?: RequestInit) => { status?: number; body: unknown });

/**
 * Stub global fetch. Routes match by substring (longest first); anything not
 * matched answers `fallbackStatus` (403 unless given).
 */
export function mockFetchRoutes(routes: Record<string, MockRoute> = {}, fallbackStatus = 403) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.includes(k));
    if (!key) {
      return new Response(JSON.stringify({ kind: 'Status', message: 'forbidden', code: fallbackStatus }), {
        status: fallbackStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const route = routes[key];
    const r = typeof route === 'function' ? route(url, init) : route;
    if (r.status === 0) throw new TypeError('Failed to fetch');
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function renderWithClient(ui: React.ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

/** Render with every request failing (except the routes given). */
export function renderWithFailedRequests(
  ui: React.ReactElement,
  { status = 403, routes = {}, route }: { status?: number; routes?: Record<string, MockRoute>; route?: string } = {},
) {
  const fetchMock = mockFetchRoutes(routes, status);
  return { ...renderWithClient(ui, { route }), fetchMock };
}

/** Copy that only a successful, healthy read may show. */
export const ALL_CLEAR_COPY: RegExp[] = [
  /all systems go/i,
  /your cluster is healthy/i,
  /all clusters are quiet/i,
  /no firing alerts/i,
  /\bup to date\b/i,
  /identical across/i,
  /setup complete/i,
  /no issues detected/i,
  /none \(leaf node\)/i,
  /no tool usage recorded/i,
  /no timeline entries/i,
  /no log files found/i,
  /no crds match/i,
  /no data available/i,
];

/**
 * Assert the page shows no all-clear copy, and does show an error or unknown
 * state. Pass extra patterns that are all-clear on this particular page.
 */
export function expectNoAllClear(container: HTMLElement = document.body, extra: RegExp[] = []) {
  const text = container.textContent ?? '';
  for (const re of [...ALL_CLEAR_COPY, ...extra]) {
    expect(text, `all-clear copy ${re} shown on failure`).not.toMatch(re);
  }
  // Only a dedicated marker counts: an announced error (role="alert", which
  // LoadError renders) or an element marked unknown. Any text containing
  // "error" or "failed" is not enough — an all-clear page can contain those.
  const alerts = screen.queryAllByRole('alert');
  const unknownMarkers = container.querySelectorAll('[data-unknown], [aria-label="Unknown"]');
  expect(alerts.length + unknownMarkers.length, 'no role="alert" or unknown marker shown').toBeGreaterThan(0);
}
