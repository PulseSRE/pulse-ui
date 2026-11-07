// @vitest-environment jsdom
/**
 * The quick filters (Needs Attention, Agent Cleared, …) only filter the Inbox
 * list, so they belong to the Inbox tab and not above the tab list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../inbox/EpisodePanel', () => ({ EpisodePanel: () => null }));
vi.mock('../inbox/InboxFilterBar', () => ({ InboxFilterBar: () => null }));
vi.mock('../inbox/InboxResetButton', () => ({ InboxResetButton: () => null }));
vi.mock('../inbox/ApprovalsQueue', () => ({ ApprovalsQueue: () => <p>approvals queue</p>, useApprovalCount: () => 0 }));
vi.mock('../incidents/ActivityTab', () => ({ ActivityTab: () => <p>activity feed</p> }));
vi.mock('../../components/primitives/CapabilityBanner', () => ({ CapabilityBanner: () => null }));
vi.mock('../../store/approvalsStore', () => ({ useApprovalsStore: (sel: (s: unknown) => unknown) => sel({ refresh: vi.fn() }) }));

import { InboxPage } from '../InboxPage';
import { useInboxStore } from '../../store/inboxStore';

let qc: QueryClient | undefined;
function renderAt(path: string) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><InboxPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [], groups: [], stats: {} }), { status: 200, headers: { 'content-type': 'application/json' } }))));
  useInboxStore.setState({ items: [], groups: [], error: null, loading: false, activePreset: 'needs_attention', refresh: vi.fn(async () => {}) });
});
afterEach(() => {
  cleanup();
  qc?.clear();
  qc = undefined;
  vi.unstubAllGlobals();
});

describe('Inbox quick filters', () => {
  it('show on the Inbox tab', () => {
    renderAt('/inbox');
    expect(screen.getByRole('group', { name: 'Quick filters' })).toBeTruthy();
  });

  it('do not show on the Activity or Approvals tabs, which they do not filter', () => {
    renderAt('/inbox?tab=activity');
    expect(screen.getByText('activity feed')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Quick filters' })).toBeNull();
    cleanup();
    renderAt('/inbox?tab=approvals');
    expect(screen.getByText('approvals queue')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Quick filters' })).toBeNull();
  });
});
