// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ClusterKnowledge, { formatMetricValue } from '../memory/ClusterKnowledge';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

function routeFetch(routes: Record<string, unknown>) {
  mockFetch.mockImplementation((url: string) => {
    for (const [fragment, body] of Object.entries(routes)) {
      if (url.includes(fragment)) return jsonResponse(body);
    }
    return jsonResponse({});
  });
}

describe('formatMetricValue', () => {
  it('compacts large values the way an operator writes them', () => {
    expect(formatMetricValue(1_500)).toBe('1.5k');
    expect(formatMetricValue(2_400_000)).toBe('2.4M');
    expect(formatMetricValue(3_000_000_000)).toBe('3.0G');
  });

  it('keeps small values readable', () => {
    expect(formatMetricValue(0)).toBe('0');
    expect(formatMetricValue(12.345)).toBe('12.35');
  });

  it('does not render a non-finite value as a number', () => {
    expect(formatMetricValue(Number.NaN)).toBe('—');
    expect(formatMetricValue(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('ClusterKnowledge', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows the learning gate counters', async () => {
    routeFetch({
      '/memory/learning': { pending: 3, promoted: 7, discarded: 2, expired: 1 },
      '/memory/environment': { facts: [] },
    });
    renderWithProviders(<ClusterKnowledge />);

    await waitFor(() => expect(screen.getByText('Awaiting outcome')).toBeDefined());
    expect(screen.getByText('7')).toBeDefined();
    expect(screen.getByText(/78% of judged trajectories/)).toBeDefined();
  });

  it('groups environment facts by scope and shows their source', async () => {
    routeFetch({
      '/memory/learning': { pending: 0, promoted: 0, discarded: 0, expired: 0 },
      '/memory/environment': {
        facts: [
          { scope: 'cluster', key: 'prometheus_retention', value: '30 days', source: 'operator', confidence: 0.9, updatedAt: 0 },
          { scope: 'payments', key: 'owner', value: 'commerce team', source: '', confidence: 0.8, updatedAt: 0 },
        ],
      },
    });
    renderWithProviders(<ClusterKnowledge />);

    await waitFor(() => expect(screen.getByText('prometheus_retention')).toBeDefined());
    expect(screen.getByText('30 days')).toBeDefined();
    expect(screen.getByText('payments')).toBeDefined();
    expect(screen.getByText('via operator')).toBeDefined();
    expect(screen.getByText('source unknown')).toBeDefined();
  });

  it('explains the consequence when nothing is known yet', async () => {
    routeFetch({
      '/memory/learning': { pending: 0, promoted: 0, discarded: 0, expired: 0 },
      '/memory/environment': { facts: [] },
    });
    renderWithProviders(<ClusterKnowledge />);

    await waitFor(() => expect(screen.getByText('Nothing recorded yet')).toBeDefined());
    expect(screen.getByText(/treats this cluster like any other/)).toBeDefined();
  });

  it('does not request baselines until a namespace is given', async () => {
    routeFetch({
      '/memory/learning': { pending: 0, promoted: 0, discarded: 0, expired: 0 },
      '/memory/environment': { facts: [] },
    });
    renderWithProviders(<ClusterKnowledge />);

    await waitFor(() => expect(screen.getByText('Nothing recorded yet')).toBeDefined());
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/memory/baselines'))).toBe(false);
    expect(screen.getByText(/Enter a namespace/)).toBeDefined();
  });
});
