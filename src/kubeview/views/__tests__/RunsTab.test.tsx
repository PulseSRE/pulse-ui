// @vitest-environment jsdom
/**
 * The durable-runs list.
 *
 * Two things here are worth pinning. First, a run has to be identifiable: the
 * list is useless if thirty rows all read `incident-<uuid>`, so the memo
 * Temporal carries with each execution is what the row shows. Second, cancel
 * on an incident run is not "stop watching" — the workflow rolls the fix back
 * from its snapshot — so the confirmation has to say so before the user
 * commits to it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }));

import { RunsTab } from '../toolbox/RunsTab';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const runningFix = {
  workflow_id: 'incident-f-123',
  run_id: 'r1',
  type: 'PulseIncidentWorkflow',
  status: 'RUNNING',
  started_at: '2026-09-01T10:00:00+00:00',
  closed_at: '',
  memo: {
    kind: 'incident',
    finding_id: 'f-123',
    strategy: 'restart_controller',
    resource_name: 'web-1',
    resource_namespace: 'payments',
  },
};

function respondWith(runs: unknown[], onPost?: (url: string) => void) {
  mockFetch.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : ((input as Request)?.url ?? String(input ?? ''));
    if (init?.method === 'POST') {
      onPost?.(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'cancellation_requested' }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ runs }) });
  });
}

describe('RunsTab', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(cleanup);

  it('labels a run with what it is fixing, not just its id', async () => {
    respondWith([runningFix]);
    renderWithProviders(<RunsTab />);

    await waitFor(() => {
      expect(screen.getByText('restart_controller on web-1 in payments')).toBeTruthy();
    });
  });

  it('still lists a run whose memo is missing', async () => {
    // Runs started before memo existed must not disappear from the list.
    respondWith([{ ...runningFix, memo: undefined }]);
    renderWithProviders(<RunsTab />);

    await waitFor(() => {
      expect(screen.getByText('PulseIncidentWorkflow')).toBeTruthy();
    });
  });

  it('warns that cancelling a fix rolls it back before sending anything', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const posts: string[] = [];
    respondWith([runningFix], (url) => posts.push(url));
    renderWithProviders(<RunsTab />);

    await waitFor(() => expect(screen.getByText('Cancel')).toBeTruthy());
    fireEvent.click(screen.getByText('Cancel'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(confirmSpy.mock.calls[0][0]).toContain('rolls it back');
    expect(posts).toHaveLength(0);
    confirmSpy.mockRestore();
  });

  it('sends the cancel once confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const posts: string[] = [];
    respondWith([runningFix], (url) => posts.push(url));
    renderWithProviders(<RunsTab />);

    await waitFor(() => expect(screen.getByText('Cancel')).toBeTruthy());
    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(posts.some((u) => u.includes('/workflow-runs/incident-f-123/cancel'))).toBe(true);
    });
    confirmSpy.mockRestore();
  });

  it('offers no cancel for a run that has already finished', async () => {
    respondWith([{ ...runningFix, status: 'COMPLETED', closed_at: '2026-09-01T10:05:00+00:00' }]);
    renderWithProviders(<RunsTab />);

    await waitFor(() => expect(screen.getByText('COMPLETED')).toBeTruthy());
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('explains that durable execution is off rather than showing an error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ detail: 'Set PULSE_AGENT_TEMPORAL_HOST' }),
    });
    renderWithProviders(<RunsTab />);

    await waitFor(() => {
      expect(screen.getByText(/Durable execution is not configured/)).toBeTruthy();
    });
  });
});
