// @vitest-environment jsdom
/**
 * Batch F: failures and "switched off" are shown as such, never as an empty
 * or successful state. Each of these rendered the reassuring answer before.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

import { agentJson, AgentHttpError } from '../../engine/safeQuery';
import MemoryView from '../MemoryView';
import ClusterKnowledge from '../memory/ClusterKnowledge';
import { SLOTab } from '../toolbox/SLOTab';

type Route = { status?: number; body: unknown };

function mockFetch(routes: Record<string, Route | ((init?: RequestInit) => Route)>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => String(url).includes(k));
    const route = key ? routes[key] : { status: 404, body: { detail: 'not mocked' } };
    const r = typeof route === 'function' ? route(init) : route;
    const status = r.status ?? 200;
    return new Response(JSON.stringify(r.body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('agentJson', () => {
  it('throws with the server detail on an error status', async () => {
    mockFetch({ '/x': { status: 403, body: { detail: 'admin only' } } });
    await expect(agentJson('/x')).rejects.toThrow('You do not have permission to do this: admin only');
    await expect(agentJson('/x')).rejects.toBeInstanceOf(AgentHttpError);
  });

  it('returns parsed JSON on success', async () => {
    mockFetch({ '/x': { body: { a: 1 } } });
    await expect(agentJson('/x')).resolves.toEqual({ a: 1 });
  });
});

describe('MemoryView', () => {
  const ok = {
    '/memory/summary': { body: { incidents_count: 0, runbooks_count: 0, patterns_count: 0, avg_score: 0 } },
    '/memory/runbooks': { body: { runbooks: [], enabled: true } },
    '/memory/patterns': { body: { patterns: [], enabled: true } },
  };

  it('shows a load error, not "no incidents recorded", when the read fails', async () => {
    mockFetch({ ...ok, '/memory/incidents': { status: 500, body: { detail: 'db down' } } });
    wrap(<MemoryView />);
    expect(await screen.findByText('Incident history could not be loaded')).toBeDefined();
    expect(screen.queryByText('No incidents recorded yet')).toBeNull();
  });

  it('says memory is switched off instead of "nothing learned yet"', async () => {
    mockFetch({
      ...ok,
      '/memory/runbooks': { body: { runbooks: [], enabled: false } },
      '/memory/incidents': { body: { incidents: [], enabled: false } },
    });
    wrap(<MemoryView />);
    expect(await screen.findByText('Agent memory is switched off')).toBeDefined();
    expect(screen.queryByText('No incidents recorded yet')).toBeNull();
  });

  it('reports the import counts the agent actually returns', async () => {
    mockFetch({
      ...ok,
      '/memory/incidents': { body: { incidents: [], enabled: true } },
      '/memory/import': { body: { imported_runbooks: 3, imported_patterns: 2 } },
    });
    const { container } = wrap(<MemoryView />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([JSON.stringify({ runbooks: [], patterns: [] })], 'm.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify({ runbooks: [] })) });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('Imported 3 runbooks, 2 patterns')).toBeDefined();
  });

  it('shows why an import was refused', async () => {
    mockFetch({
      ...ok,
      '/memory/incidents': { body: { incidents: [], enabled: true } },
      '/memory/import': { status: 503, body: { detail: 'Memory system not enabled' } },
    });
    const { container } = wrap(<MemoryView />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{}'], 'm.json');
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('{}') });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/Memory system not enabled/)).toBeDefined();
  });

  it('offers to forget a learned incident', async () => {
    mockFetch({
      ...ok,
      '/memory/incidents': {
        body: { enabled: true, incidents: [{ id: 7, query: 'why is api down', resolution: '', outcome: 'resolved', score: 0.8 }] },
      },
    });
    wrap(<MemoryView />);
    expect(await screen.findByLabelText('Forget this incident')).toBeDefined();
  });
});

describe('ClusterKnowledge', () => {
  it('keeps the form open and says why when saving a fact is refused', async () => {
    mockFetch({
      '/memory/learning': { body: { pending: 0, promoted: 0, discarded: 0, expired: 0 } },
      '/memory/environment': (init) =>
        init?.method === 'POST' ? { status: 403, body: { detail: 'admin required' } } : { body: { facts: [] } },
    });
    wrap(<ClusterKnowledge />);
    fireEvent.click(await screen.findByText('Add fact'));
    fireEvent.change(screen.getByLabelText('Fact key'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('Fact value'), { target: { value: 'team-a' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('The fact was not saved')).toBeDefined();
    expect(screen.getByLabelText('Fact key')).toBeDefined();
  });

  it('shows a load error instead of "nothing recorded yet"', async () => {
    mockFetch({
      '/memory/learning': { body: { pending: 0, promoted: 0, discarded: 0, expired: 0 } },
      '/memory/environment': { status: 500, body: {} },
    });
    wrap(<ClusterKnowledge />);
    expect(await screen.findByText('Cluster facts could not be loaded')).toBeDefined();
    expect(screen.queryByText('Nothing recorded yet')).toBeNull();
  });
});

describe('SLOTab', () => {
  it('shows a load error, not "No SLOs defined yet"', async () => {
    mockFetch({ '/api/agent/slo': { status: 500, body: {} } });
    wrap(<SLOTab />);
    expect(await screen.findByText('SLOs could not be loaded')).toBeDefined();
    expect(screen.queryByText('No SLOs defined yet')).toBeNull();
  });

  it('lists an SLO without data as NO DATA and takes the level from the agent', async () => {
    mockFetch({
      '/api/agent/slo': {
        body: {
          total: 2,
          slos: [
            { service: 'web', type: 'availability', target: 0.999, window_days: 30, alert_level: 'no_data', current_value: null, error_budget_remaining: null, burn_rate: null },
            { service: 'api', type: 'availability', target: 0.999, window_days: 30, alert_level: 'critical', current_value: 0.98, error_budget_remaining: 0.5, burn_rate: 1.5, budget_remaining_hours: 12 },
          ],
        },
      },
    });
    wrap(<SLOTab />);
    expect(await screen.findByText('NO DATA')).toBeDefined();
    // 1.5x used to read as "ELEVATED" from the card's own thresholds.
    expect(screen.getByText('CRITICAL')).toBeDefined();
    expect(screen.getByText('12h left at this rate')).toBeDefined();
  });

  it('keeps the form open and says why when creating an SLO fails', async () => {
    mockFetch({
      '/api/agent/slo': (init) =>
        init?.method === 'POST' ? { status: 422, body: { detail: 'target must be between 0 and 100' } } : { body: { slos: [], total: 0 } },
    });
    wrap(<SLOTab />);
    fireEvent.click(await screen.findByText('Add SLO'));
    fireEvent.change(screen.getByPlaceholderText('e.g., checkout-api'), { target: { value: 'checkout' } });
    fireEvent.click(screen.getByText('Create SLO'));
    await waitFor(() => expect(screen.getByText('The SLO was not created')).toBeDefined());
    expect(screen.getByText('New Service Level Objective')).toBeDefined();
  });
});
