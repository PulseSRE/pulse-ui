// @vitest-environment jsdom
/**
 * One inbox count, one bell. The CommandBar bell used to run its own 60 s poll
 * while the StatusBar showed a second bell from inboxStore.stats, so the two
 * could disagree. Now the CommandBar bell reads inboxStore.stats (and keeps it
 * fresh); the StatusBar has no bell.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import React from 'react';

const fetchInboxStats = vi.fn();
vi.mock('../../engine/inboxApi', async (orig) => ({ ...(await orig<object>()), fetchInboxStats: () => fetchInboxStats() }));
vi.mock('../../hooks/usePulseStatus', () => ({ usePulseUpgrade: () => ({ phase: '', upgrading: false }) }));

import { CommandBar } from '../CommandBar';
import { StatusBar } from '../StatusBar';
import { useInboxStore } from '../../store/inboxStore';
import { useUIStore } from '../../store/uiStore';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}{l.search}</span>;
}

function renderShell(at = '/workloads') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <Routes><Route path="*" element={<><CommandBar /><StatusBar /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as never;
  useInboxStore.setState({ stats: {} });
});
afterEach(() => { cleanup(); fetchInboxStats.mockReset(); });

describe('inbox bell', () => {
  it('shows the inbox store count once, fetched from /inbox/stats', async () => {
    fetchInboxStats.mockResolvedValue({ needs_attention: 4, critical: 1 });
    renderShell();
    const bell = await screen.findByRole('button', { name: 'Inbox: 4 need attention' });
    expect(bell.textContent).toBe('4');
    expect(useInboxStore.getState().stats.needs_attention).toBe(4);
    // No second bell in the status bar.
    expect(screen.getAllByRole('button', { name: /need attention/ })).toHaveLength(1);
    fireEvent.click(bell);
    expect(screen.getByTestId('where').textContent).toBe('/inbox');
  });

  it('follows the store when it changes (same number the sidebar and dock read)', async () => {
    fetchInboxStats.mockResolvedValue({ needs_attention: 2 });
    renderShell();
    await screen.findByRole('button', { name: 'Inbox: 2 need attention' });
    React.act(() => { useInboxStore.setState({ stats: { needs_attention: 7 } }); });
    expect(screen.getByRole('button', { name: 'Inbox: 7 need attention' })).toBeDefined();
  });

  it('a failed stats fetch leaves the bell empty rather than inventing a number', async () => {
    fetchInboxStats.mockRejectedValue(new Error('500'));
    renderShell();
    await waitFor(() => expect(fetchInboxStats).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Inbox: nothing needs attention' }).textContent).toBe('');
  });
});

describe('status bar page label', () => {
  it('labels /create pages "Create", not "Software"', () => {
    fetchInboxStats.mockResolvedValue({});
    renderShell('/create/v1~pods');
    expect(screen.getByText('· Create')).toBeDefined();
    expect(screen.queryByText('· Software')).toBeNull();
  });
});

describe('namespace picker', () => {
  it('opens the project dashboard for the selected namespace', async () => {
    fetchInboxStats.mockResolvedValue({});
    useUIStore.setState({ selectedNamespace: 'payments' });
    renderShell();
    fireEvent.click(screen.getByTitle('Switch namespace (⌘N)'));
    fireEvent.click(screen.getByText('Open project dashboard'));
    expect(screen.getByTestId('where').textContent).toBe('/project/payments');
  });

  it('offers no project dashboard for "All namespaces"', () => {
    fetchInboxStats.mockResolvedValue({});
    useUIStore.setState({ selectedNamespace: '*' });
    renderShell();
    fireEvent.click(screen.getByTitle('Switch namespace (⌘N)'));
    expect(screen.queryByText('Open project dashboard')).toBeNull();
  });
});
