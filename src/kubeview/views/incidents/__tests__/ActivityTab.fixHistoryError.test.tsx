// @vitest-environment jsdom
/**
 * A fix-history read that fails used to be logged and dropped, so Activity
 * said "No agent actions" — as if the agent had never fixed anything. Driven
 * through the real monitorStore with fetch answering the status under test.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQuery: () => ({ data: undefined }),
}));
vi.mock('../IncidentLifecycleDrawer', () => ({ IncidentLifecycleDrawer: () => null }));

import { ActivityTab } from '../ActivityTab';
import { useMonitorStore } from '../../../store/monitorStore';

function answer(status: number, body: unknown = {}) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Error', headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  useMonitorStore.setState({ fixHistory: [], fixHistoryError: null, investigations: [], findings: [] } as never);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ActivityTab fix history', () => {
  it.each([403, 500])('shows a load error, not "No agent actions", when fix history fails with %i', async (status) => {
    answer(status);
    render(<MemoryRouter><ActivityTab /></MemoryRouter>);
    expect(await screen.findByText('Agent fix history could not be loaded')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(String(status));
    expect(screen.queryByText('No agent actions')).toBeNull();
  });

  it('retries and clears the error once the read succeeds', async () => {
    answer(500);
    render(<MemoryRouter><ActivityTab /></MemoryRouter>);
    await screen.findByText('Agent fix history could not be loaded');
    answer(200, { actions: [], total: 0, page: 1, pageSize: 20 });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.queryByText('Agent fix history could not be loaded')).toBeNull());
    expect(screen.getByText('No agent actions')).toBeTruthy();
  });
});
