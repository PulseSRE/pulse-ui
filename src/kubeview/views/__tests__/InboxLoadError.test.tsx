// @vitest-environment jsdom
/**
 * A failed inbox read is an error with its reason and Retry, never
 * "All clear" — the most reassuring sentence the page can say.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../inbox/EpisodePanel', () => ({ EpisodePanel: () => null }));
vi.mock('../inbox/InboxHeader', () => ({ InboxHeader: () => null }));
vi.mock('../inbox/InboxFilterBar', () => ({ InboxFilterBar: () => null }));
vi.mock('../inbox/ApprovalsQueue', () => ({ ApprovalsQueue: () => null, useApprovalCount: () => 0 }));
vi.mock('../incidents/ActivityTab', () => ({ ActivityTab: () => null }));
vi.mock('../../components/primitives/CapabilityBanner', () => ({ CapabilityBanner: () => null }));
vi.mock('../../store/approvalsStore', () => ({ useApprovalsStore: (sel: (s: unknown) => unknown) => sel({ refresh: vi.fn() }) }));

import { InboxPage } from '../InboxPage';
import { useInboxStore } from '../../store/inboxStore';

const fetchMock = vi.fn();
/** Any of the page's empty states: only a successful read may show one. */
const EMPTY = /All clear|Inbox is empty|No items match your filters/;

function answer(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

let qc: QueryClient | undefined;
function renderPage() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/inbox']}><InboxPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  useInboxStore.setState({ items: [], groups: [], error: null, loading: false, activePreset: 'needs_attention', filters: { status: '__needs_attention__' } });
});
afterEach(() => {
  cleanup();
  qc?.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('Inbox read failures', () => {
  it.each([
    [403, /You do not have permission to do this|Permission denied/],
    [500, /status 500|Request failed \(500\)/],
  ])('a %s shows "Inbox could not be loaded" with the reason and Retry, not an empty state', async (status, reason) => {
    fetchMock.mockImplementation(() => answer(status, { detail: 'nope' }));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Inbox could not be loaded');
    expect(alert.textContent).toMatch(reason);
    expect(screen.queryByText(EMPTY)).toBeNull();

    // Retry reads again, and a successful empty answer is then a real empty state.
    fetchMock.mockImplementation((url: string) => answer(200, url.includes('/stats') ? {} : { items: [], groups: [], total: 0 }));
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(EMPTY)).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a successful empty read says what is next, with no error', async () => {
    fetchMock.mockImplementation((url: string) => answer(200, url.includes('/stats') ? {} : { items: [], groups: [], total: 0 }));
    renderPage();
    expect(await screen.findByText(EMPTY)).toBeDefined();
    await waitFor(() => expect(useInboxStore.getState().loading).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
