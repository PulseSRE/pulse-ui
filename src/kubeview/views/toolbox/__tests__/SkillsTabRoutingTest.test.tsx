// @vitest-environment jsdom
/** A failed routing test only went to console.error; the user saw nothing. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const agentFetch = vi.fn();
vi.mock('../../../engine/safeQuery', () => ({
  agentFetch: (...a: unknown[]) => agentFetch(...a),
  agentJson: vi.fn().mockResolvedValue([]),
}));
vi.mock('../SkillDetailDrawer', () => ({ SkillDetailDrawer: () => null }));

import { SkillsTab } from '../SkillsTab';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  agentFetch.mockReset();
  agentFetch.mockImplementation(async (url: string) => (url.includes('/usage') ? json(null) : json({})));
});
afterEach(() => cleanup());

function runTest() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SkillsTab /></QueryClientProvider>);
  fireEvent.change(screen.getByPlaceholderText(/Type a query/), { target: { value: 'why is my pod crashlooping' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test' }));
}

describe('SkillsTab routing test', () => {
  it('posts the query and shows the chosen skill', async () => {
    agentFetch.mockImplementation(async (url: string) => (url.endsWith('/skills/test') ? json({ skill: 'sre', description: 'SRE', degraded: false }) : json(null)));
    runTest();
    expect(await screen.findByText('sre')).toBeTruthy();
    const call = agentFetch.mock.calls.find((c) => String(c[0]).endsWith('/skills/test'))!;
    expect(call[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ query: 'why is my pod crashlooping' }) });
  });

  it('shows a server error inline', async () => {
    agentFetch.mockImplementation(async (url: string) => (url.endsWith('/skills/test') ? json({ detail: 'admin only' }, 403) : json(null)));
    runTest();
    expect((await screen.findByRole('alert')).textContent).toBe('Routing test failed (403: admin only)');
  });

  it('shows a network error inline', async () => {
    agentFetch.mockImplementation(async (url: string) => { if (url.endsWith('/skills/test')) throw new Error('Failed to fetch'); return json(null); });
    runTest();
    expect((await screen.findByRole('alert')).textContent).toBe('Routing test failed: Failed to fetch');
  });
});
