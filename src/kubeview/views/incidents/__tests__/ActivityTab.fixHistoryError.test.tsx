// @vitest-environment jsdom
/**
 * A fix-history read that fails used to be logged and dropped, so Activity
 * said "0 agent actions" / "No agent actions" — as if the agent had never
 * fixed anything. Postmortems that failed to load read as none. Driven
 * through the real monitorStore and react-query with fetch routed by URL.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../IncidentLifecycleDrawer', () => ({ IncidentLifecycleDrawer: () => null }));

import { ActivityTab } from '../ActivityTab';
import { useMonitorStore } from '../../../store/monitorStore';

type Answer = { status: number; body?: unknown };
function route(answers: { fixHistory: Answer; postmortems?: Answer }) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const a: Answer = url.includes('/fix-history') ? answers.fixHistory
      : url.includes('/postmortems') ? (answers.postmortems ?? { status: 200, body: { postmortems: [], total: 0 } })
        : { status: 200, body: { events: [] } };
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status, statusText: a.status === 200 ? 'OK' : 'Error', headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const EMPTY_HISTORY: Answer = { status: 200, body: { actions: [], total: 0, page: 1, pageSize: 20 } };

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ActivityTab /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  useMonitorStore.setState({ fixHistory: [], fixHistoryError: null, investigations: [], findings: [] } as never);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ActivityTab fix history', () => {
  it.each([403, 500])('shows a load error and an unknown count, not "0 agent actions", when fix history fails with %i', async (status) => {
    route({ fixHistory: { status } });
    renderTab();
    expect(await screen.findByText('Agent fix history could not be loaded')).toBeTruthy();
    expect(screen.getByText('— agent actions')).toBeTruthy();
    expect(screen.queryByText(/^0 agent actions/)).toBeNull();
    expect(screen.queryByText('No agent actions')).toBeNull();
  });

  it('retries and clears the error once the read succeeds', async () => {
    route({ fixHistory: { status: 500 } });
    renderTab();
    await screen.findByText('Agent fix history could not be loaded');
    route({ fixHistory: EMPTY_HISTORY });
    fireEvent.click(screen.getAllByRole('button', { name: /retry/i })[0]);
    await waitFor(() => expect(screen.queryByText('Agent fix history could not be loaded')).toBeNull());
    expect(screen.getByText('No agent actions')).toBeTruthy();
    expect(screen.getByText('0 agent actions')).toBeTruthy();
  });
});

describe('ActivityTab postmortems', () => {
  it.each([403, 500])('shows an error when postmortems fail with %i', async (status) => {
    route({ fixHistory: EMPTY_HISTORY, postmortems: { status } });
    renderTab();
    expect(await screen.findByText('Postmortems could not be loaded')).toBeTruthy();
    expect(screen.getByText(new RegExp(`\\(${status}\\)`))).toBeTruthy();
  });

  it('treats a 404 (agent without postmortems) as none, not an error', async () => {
    const fn = route({ fixHistory: EMPTY_HISTORY, postmortems: { status: 404 } });
    renderTab();
    await waitFor(() => expect(fn.mock.calls.some((c) => String(c[0]).includes('/postmortems'))).toBe(true));
    await screen.findByText('No agent actions');
    expect(screen.queryByText('Postmortems could not be loaded')).toBeNull();
  });
});

describe('ActivityTab ?fixStatus= (linked from the Overview\'s "N failed")', () => {
  function renderAt(url: string) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}><ActivityTab /></MemoryRouter></QueryClientProvider>);
  }

  it('asks the agent for failed fixes only, says so, and Show all drops the filter', async () => {
    const fn = route({ fixHistory: EMPTY_HISTORY });
    renderAt('/inbox?tab=activity&fixStatus=failed');
    expect((await screen.findByTestId('fix-status-filter')).textContent).toMatch(/Showing failed fixes only/);
    await waitFor(() => expect(fn.mock.calls.some((c) => String(c[0]).includes('/fix-history?') && String(c[0]).includes('status=failed'))).toBe(true));
    expect(await screen.findByText('No failed fixes.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => expect(screen.queryByTestId('fix-status-filter')).toBeNull());
    await waitFor(() => expect(String(fn.mock.calls.filter((c) => String(c[0]).includes('/fix-history')).at(-1)![0])).not.toContain('status='));
  });

  it('ignores an unknown status instead of sending it', async () => {
    const fn = route({ fixHistory: EMPTY_HISTORY });
    renderAt('/inbox?tab=activity&fixStatus=bogus');
    await screen.findByText('No agent actions');
    expect(screen.queryByTestId('fix-status-filter')).toBeNull();
    expect(fn.mock.calls.some((c) => String(c[0]).includes('status='))).toBe(false);
  });
});
