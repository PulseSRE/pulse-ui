// @vitest-environment jsdom
/**
 * UI for the skill lifecycle gates: a refreshed or newborn agent skill is out
 * of automatic routing until a person approves it, and a misrouting skill can
 * be quarantined (reversibly). The buttons here are the human half of the
 * agent's learning loop — without them the gates are dead ends.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }));

import { SkillDetailDrawer } from '../toolbox/SkillDetailDrawer';
import { SkillsTab } from '../toolbox/SkillsTab';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const baseSkill = {
  name: 'crashloop-payments',
  display_name: 'Crashloop Payments',
  version: 1,
  description: 'Auto-generated skill',
  keywords: ['crashloop'],
  categories: ['diagnostics'],
  priority: 5,
  write_tools: false,
  requires_tools: [],
  handoff_to: {},
  configurable: [],
  degraded: false,
  builtin: false,
  generated_by: 'auto',
  reviewed: false,
  quarantined: false,
  incident_type: 'crashloop',
  prompt_length: 500,
  raw_content: '---\nname: crashloop-payments\n---\nBody',
};

function routeFetch(skill: Record<string, unknown>, calls: string[] = []) {
  mockFetch.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : ((input as Request)?.url ?? String(input ?? ''));
    if (init?.method === 'POST') {
      calls.push(url);
      return jsonResponse({ name: skill.name });
    }
    if (url.includes('/versions')) return jsonResponse({ versions: [] });
    if (url.includes('/usage')) return jsonResponse({ runs: 0, skills: [] });
    if (url.includes(`/skills/${skill.name}`)) return jsonResponse(skill);
    if (url.includes('/skills')) return jsonResponse([skill]);
    return jsonResponse({});
  });
}

describe('SkillDetailDrawer routing gates', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(cleanup);

  it('unreviewed newborn skill shows the review banner with an approve action', async () => {
    routeFetch({ ...baseSkill, reviewed: false, version: 1 });
    renderWithProviders(<SkillDetailDrawer name="crashloop-payments" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Awaiting review/)).toBeDefined());
    expect(screen.getByText('Approve for routing')).toBeDefined();
  });

  it('a refreshed skill (v>1) explains that re-review is needed, not first review', async () => {
    routeFetch({ ...baseSkill, reviewed: false, version: 4 });
    renderWithProviders(<SkillDetailDrawer name="crashloop-payments" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Awaiting re-review/)).toBeDefined());
    expect(screen.getByText(/learned a new verified case/)).toBeDefined();
  });

  it('approve calls the approve endpoint', async () => {
    const calls: string[] = [];
    routeFetch({ ...baseSkill, reviewed: false }, calls);
    renderWithProviders(<SkillDetailDrawer name="crashloop-payments" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Approve for routing')).toBeDefined());
    fireEvent.click(screen.getByText('Approve for routing'));
    await waitFor(() =>
      expect(calls).toContain('/api/agent/admin/skills/crashloop-payments/approve'),
    );
  });

  it('a reviewed, healthy skill shows no gate banners', async () => {
    routeFetch({ ...baseSkill, reviewed: true });
    renderWithProviders(<SkillDetailDrawer name="crashloop-payments" onClose={() => {}} />);
    await waitFor(() => expect(screen.getAllByText('crashloop-payments').length).toBeGreaterThan(0));
    expect(screen.queryByText(/Awaiting review/)).toBeNull();
    expect(screen.queryByText(/Quarantined/)).toBeNull();
  });

  it('quarantined skill shows the quarantine banner with a restore action', async () => {
    const calls: string[] = [];
    routeFetch({ ...baseSkill, reviewed: true, quarantined: true }, calls);
    renderWithProviders(<SkillDetailDrawer name="crashloop-payments" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/excluded from automatic routing/)).toBeDefined());
    fireEvent.click(screen.getByText('Restore to routing'));
    await waitFor(() =>
      expect(calls).toContain('/api/agent/admin/skills/crashloop-payments/unquarantine'),
    );
  });

  it('quarantine goes through a confirm dialog before calling the endpoint', async () => {
    const calls: string[] = [];
    routeFetch({ ...baseSkill, reviewed: true }, calls);
    renderWithProviders(<SkillDetailDrawer name="crashloop-payments" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Quarantine')).toBeDefined());
    fireEvent.click(screen.getByText('Quarantine'));
    // Nothing sent yet — the dialog is the gate.
    expect(calls).toHaveLength(0);
    await waitFor(() => expect(screen.getByText('Quarantine Skill')).toBeDefined());
    // Two buttons say "Quarantine": the header action and the dialog's
    // confirm. The dialog rendered last; its confirm is the final match.
    const buttons = screen.getAllByRole('button', { name: 'Quarantine' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(calls).toContain('/api/agent/admin/skills/crashloop-payments/quarantine'),
    );
  });

  it('no quarantine button while already quarantined', async () => {
    routeFetch({ ...baseSkill, reviewed: true, quarantined: true });
    renderWithProviders(<SkillDetailDrawer name="crashloop-payments" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Restore to routing')).toBeDefined());
    expect(screen.queryByText(/^Quarantine$/)).toBeNull();
  });

  it('shows what the skill was learned from when incident_type is present', async () => {
    routeFetch({ ...baseSkill, reviewed: true });
    renderWithProviders(<SkillDetailDrawer name="crashloop-payments" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('crashloop incidents')).toBeDefined());
  });
});

describe('SkillsTab quarantine badge', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(cleanup);

  it('marks a quarantined skill on its card', async () => {
    routeFetch({ ...baseSkill, reviewed: true, quarantined: true });
    renderWithProviders(<SkillsTab />);
    await waitFor(() => expect(screen.getByText('Quarantined')).toBeDefined());
  });

  it('healthy skills carry no quarantine badge', async () => {
    routeFetch({ ...baseSkill, reviewed: true, quarantined: false });
    renderWithProviders(<SkillsTab />);
    await waitFor(() => expect(screen.getByText('Crashloop Payments')).toBeDefined());
    expect(screen.queryByText('Quarantined')).toBeNull();
  });
});
