// @vitest-environment jsdom
// Since pulse-agent#258 the fix-history summary's success figures count fixes
// that *held* (verification), and `completed` means "applied". Mission Control
// must say "Fixes that held (N of M applied)", keep older agents' figure under
// its real name ("applied"), and link to the fixes behind each number.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import type { FixHistorySummary } from '../../../engine/analyticsApi';
import { fixOutcomeFigures, categoryOutcome, FIX_ESCALATION_CREATOR } from '../../../engine/fixOutcomes';

const go = vi.fn();
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => go }));

const queryData: Record<string, unknown> = {};
const queryErrors: Record<string, boolean> = {};
const queryFns: Record<string, () => unknown> = {};
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey, queryFn }: { queryKey: unknown[]; queryFn: () => unknown }) => {
    queryFns[String(queryKey[0])] = queryFn;
    return { data: queryData[String(queryKey[0])], isLoading: false, isError: Boolean(queryErrors[String(queryKey[0])]) };
  },
}));
vi.mock('../../../engine/analyticsApi', () => ({ fetchResolutions: vi.fn(), fetchFixHistorySummary: vi.fn() }));
const fetchInbox = vi.fn();
vi.mock('../../../engine/inboxApi', () => ({ fetchInbox: (...a: unknown[]) => fetchInbox(...a) }));
vi.mock('../../incidents/IncidentLifecycleDrawer', () => ({ IncidentLifecycleDrawer: () => null }));

import { AgentHealth } from '../AgentHealth';
import { OutcomesDrawer } from '../OutcomesDrawer';

const NEW_AGENT: FixHistorySummary = {
  total_actions: 14,
  completed: 10,
  failed: 2,
  rolled_back: 0,
  success_rate: 0.21, // held / total, as the agent computes it
  applied_rate: 0.71,
  rollback_rate: 0,
  avg_resolution_ms: 0,
  by_category: [{ category: 'crashloop', count: 8, success_count: 2, applied_count: 5, auto_fixed: 5, confirmation_required: 0 }],
  trend: { current_week: 14, previous_week: 0, delta: 14 },
  verification: { resolved: 3, still_failing: 4, improved: 0, unverifiable: 1, recurred: 1, pending: 5, resolution_rate: 0.21 },
};

// An agent before #258: success_rate is completed / total, and there is no applied_rate.
const OLD_AGENT: FixHistorySummary = {
  ...NEW_AGENT,
  applied_rate: undefined,
  success_rate: 0.71,
  by_category: [{ category: 'crashloop', count: 8, success_count: 5, auto_fixed: 5, confirmation_required: 0 }],
};

afterEach(() => {
  cleanup();
  go.mockReset();
  for (const k of Object.keys(queryData)) delete queryData[k];
  for (const k of Object.keys(queryErrors)) delete queryErrors[k];
});

describe('fixOutcomeFigures', () => {
  it('counts held of applied for agents that report verification', () => {
    const f = fixOutcomeFigures(NEW_AGENT);
    expect(f).toMatchObject({ reportsHeld: true, label: 'Fixes that held', applied: 10, held: 3, notHeld: 5, failed: 2, pct: 30 });
    expect(f.basis).toBe('3 of 10 applied');
  });

  it("keeps an older agent's figure under its real meaning: applied", () => {
    const f = fixOutcomeFigures(OLD_AGENT);
    expect(f).toMatchObject({ reportsHeld: false, label: 'Fixes applied', held: null, notHeld: null, pct: 71 });
    expect(f.basis).toMatch(/does not report whether they held/);
  });

  it('shows no percentage when nothing was applied', () => {
    expect(fixOutcomeFigures({ ...NEW_AGENT, completed: 0, verification: { ...NEW_AGENT.verification, resolved: 0 } }).pct).toBeNull();
  });

  it('labels a category held-of-applied, or applied for older agents', () => {
    expect(categoryOutcome(NEW_AGENT.by_category[0], true)).toBe('2 held of 5 applied');
    expect(categoryOutcome(OLD_AGENT.by_category[0], false)).toBe('5/8 applied');
  });
});

function renderHealth(summary: FixHistorySummary) {
  return render(
    <AgentHealth evalStatus={null} coverage={null} confidence={null} costStats={null} readiness={null}
      fixSummary={summary} onOpenScannerDrawer={() => {}} onOpenEvalDrawer={() => {}} onOpenMemoryDrawer={() => {}} />,
  );
}

describe('AgentHealth fix figures', () => {
  it('says "Fixes that held" with N of M applied, not "Auto-fix success"', () => {
    renderHealth(NEW_AGENT);
    const fig = screen.getByTestId('fix-held-figure');
    expect(fig.textContent).toContain('Fixes that held: 30% (3 of 10 applied)');
    expect(fig.textContent).toContain('3 held');
    expect(fig.textContent).toContain('5 did not hold');
    expect(document.body.textContent).not.toMatch(/Auto-fix success/);
  });

  it('links applied and failed to Inbox › Activity filtered by status', () => {
    renderHealth(NEW_AGENT);
    fireEvent.click(screen.getByTestId('fix-applied-link'));
    expect(go).toHaveBeenLastCalledWith('/inbox?tab=activity&fixStatus=completed', 'Activity');
    fireEvent.click(screen.getByTestId('fix-failed-link'));
    expect(go).toHaveBeenLastCalledWith('/inbox?tab=activity&fixStatus=failed', 'Activity');
  });

  it('labels an older agent\'s figure "applied" and claims nothing about holding', () => {
    renderHealth(OLD_AGENT);
    const fig = screen.getByTestId('fix-held-figure');
    expect(fig.textContent).toContain('Fixes applied: 71%');
    expect(fig.textContent).not.toMatch(/held:|\d+ held\b/);
  });
});

describe('OutcomesDrawer fix figures and escalations', () => {
  it('shows applied, held % and the per-category held of applied', () => {
    queryData['fix-history-summary'] = NEW_AGENT;
    render(<OutcomesDrawer onClose={() => {}} />);
    expect(screen.getByTestId('outcomes-held-pct').textContent).toBe('30%');
    expect(screen.getByText('Held')).toBeDefined();
    expect(screen.getByTestId('outcomes-held-line').textContent).toContain('Fixes that held: 3 of 10 applied');
    expect(screen.getByText('2 held of 5 applied')).toBeDefined();
    fireEvent.click(screen.getByTestId('outcomes-failed'));
    expect(go).toHaveBeenLastCalledWith('/inbox?tab=activity&fixStatus=failed', 'Activity');
    fireEvent.click(screen.getByTestId('outcomes-applied'));
    expect(go).toHaveBeenLastCalledWith('/inbox?tab=activity&fixStatus=completed', 'Activity');
  });

  it('labels an older agent\'s percentage "Applied"', () => {
    queryData['fix-history-summary'] = OLD_AGENT;
    render(<OutcomesDrawer onClose={() => {}} />);
    expect(screen.getByTestId('outcomes-held-pct').textContent).toBe('71%');
    expect(screen.queryByText('Held')).toBeNull();
    expect(screen.getByText('5/8 applied')).toBeDefined();
  });

  it('lists open "auto-fix stopped" items with their next step and owner, and opens them', async () => {
    queryData['fix-history-summary'] = NEW_AGENT;
    queryData['fix-escalations'] = {
      items: [
        {
          id: 'inb-1', status: 'new', title: 'Auto-fix stopped on Deployment shop/checkout: the image cannot be pulled',
          metadata: { next_step: 'Fix the image reference (tag or repository) of container app.', owners: { people: [{ value: 'payments' }] } },
        },
        {
          id: 'inb-2', status: 'new', title: 'Auto-fix stopped on Deployment shop/cart: it runs out of memory',
          metadata: { next_step: 'Raise the memory limit.', owners: { people: [] } },
        },
        { id: 'inb-3', status: 'resolved', title: 'Auto-fix stopped on old thing', metadata: {} },
      ],
    };
    render(<OutcomesDrawer onClose={() => {}} />);
    const section = screen.getByTestId('fix-escalations');
    expect(section.textContent).toContain('the image cannot be pulled');
    expect(section.textContent).toContain('Owner: payments');
    expect(section.textContent).toContain('Owner: unknown');
    expect(section.textContent).not.toContain('old thing');
    fireEvent.click(screen.getByText(/the image cannot be pulled/));
    expect(go).toHaveBeenLastCalledWith('/inbox?task=inb-1', 'Inbox');
    await queryFns['fix-escalations']();
    expect(fetchInbox).toHaveBeenCalledWith({ created_by: FIX_ESCALATION_CREATOR, limit: 50 });
  });

  it('says so when the stopped fixes cannot be read, rather than showing none', () => {
    queryData['fix-history-summary'] = NEW_AGENT;
    queryErrors['fix-escalations'] = true;
    render(<OutcomesDrawer onClose={() => {}} />);
    expect(screen.getByTestId('fix-escalations').textContent).toContain('could not be loaded');
  });

  it('shows no section when nothing is waiting', () => {
    queryData['fix-history-summary'] = NEW_AGENT;
    queryData['fix-escalations'] = { items: [] };
    render(<OutcomesDrawer onClose={() => {}} />);
    expect(screen.queryByTestId('fix-escalations')).toBeNull();
  });
});
