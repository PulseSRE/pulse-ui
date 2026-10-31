// @vitest-environment jsdom
/**
 * Proof and closure on the inbox queue.
 *
 * Proof: the ranked list showed an ordering the operator could not
 * interrogate — the priority factors now ride in metadata and render as a
 * hoverable "P n.n" on the card. The six status dots whose meanings lived
 * only in tooltips collapse into one worded chip.
 *
 * Closure: a chronic condition looked new on every visit; it now carries its
 * 30-day visit ordinal, and an investigated item can leave the queue as a
 * draft runbook skill through the existing approval gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// The drawer links and navigates through the router.
const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: MemoryRouter });
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }));

const addToast = vi.fn();
vi.mock('../../../store/inboxStore', () => ({
  useInboxStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      setSelectedItem: vi.fn(),
      acknowledge: vi.fn(),
      claim: vi.fn(),
      snooze: vi.fn(),
      dismiss: vi.fn(),
      pin: vi.fn(),
      resolve: vi.fn(),
      restore: vi.fn(),
      advanceStatus: vi.fn(),
    };
    return selector(state);
  }),
}));
vi.mock('../../../store/agentStore', () => ({
  useAgentStore: { getState: () => ({ connectAndSend: vi.fn() }) },
}));
vi.mock('../../../store/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      expandAISidebar: vi.fn(),
      setAISidebarMode: vi.fn(),
      addToast,
      setActiveTab: vi.fn(),
      // agentFetch's checkAuth() reads these on every response.
      addDegradedReason: vi.fn(),
      removeDegradedReason: vi.fn(),
    }),
  },
}));

import { InboxItem } from '../InboxItem';
import type { InboxItem as InboxItemType } from '../../../engine/inboxApi';

function makeItem(overrides: Partial<InboxItemType> = {}): InboxItemType {
  return {
    id: 'i-1',
    item_type: 'task',
    status: 'new',
    title: 'Pod crashlooping',
    summary: 'restarts',
    severity: 'critical',
    priority_score: 7.2,
    confidence: 0.9,
    noise_score: 0,
    namespace: 'production',
    resources: [],
    correlation_key: 'crashloop:x',
    claimed_by: null,
    claimed_at: null,
    created_by: 'system:monitor',
    due_date: null,
    finding_id: null,
    view_id: null,
    pinned_by: [],
    metadata: {},
    created_at: Math.floor(Date.now() / 1000) - 60,
    updated_at: Math.floor(Date.now() / 1000),
    ...overrides,
  } as InboxItemType;
}

describe('one worded chip instead of dot soup', () => {
  afterEach(cleanup);

  it('agent_cleared renders a worded chip, not a bare dot', () => {
    render(<InboxItem item={makeItem({ status: 'agent_cleared', metadata: { dismiss_reason: 'noise' } })} />);
    expect(screen.getByText('Cleared')).toBeDefined();
  });

  it('reviewing wins over triaged when both apply', () => {
    render(
      <InboxItem
        item={makeItem({ status: 'agent_reviewing', metadata: { triaged: true, triage_urgency: 'soon' } })}
      />,
    );
    expect(screen.getByText('Reviewing…')).toBeDefined();
    expect(screen.queryByText(/Triaged/)).toBeNull();
  });

  it('triaged carries its urgency as a word', () => {
    render(<InboxItem item={makeItem({ metadata: { triaged: true, triage_urgency: 'soon' } })} />);
    expect(screen.getByText('Triaged · soon')).toBeDefined();
  });

  it('a plain new item shows no state chip at all', () => {
    render(<InboxItem item={makeItem()} />);
    expect(screen.queryByText(/Reviewing|Cleared|Triaged|Approval|Archived/)).toBeNull();
  });
});

describe('proof: the rank explains itself', () => {
  afterEach(cleanup);

  it('renders the priority with its factors one hover away', () => {
    render(
      <InboxItem
        item={makeItem({
          metadata: {
            priority_factors: {
              severity: 'critical', severity_weight: 4, layer: 'infrastructure', layer_weight: 2,
              confidence: 0.9, noise_score: 0, base: 7.2, age_bonus: 0.1, novelty_bonus: 1.4, due_bonus: 0, total: 8.7,
            },
          },
        })}
      />,
    );
    expect(screen.getByText('P 8.7')).toBeDefined();
  });

  it('no factors, no unexplained number', () => {
    render(<InboxItem item={makeItem()} />);
    expect(screen.queryByText(/^P \d/)).toBeNull();
  });

  it('shows which SLO the item backs', () => {
    render(
      <InboxItem
        item={makeItem({ metadata: { slo_impact: [{ service: 'payment-api', slo_type: 'availability' }] } })}
      />,
    );
    expect(screen.getByText('SLO · payment-api')).toBeDefined();
  });
});

describe('closure: chronic work is named as chronic', () => {
  afterEach(cleanup);

  it('a repeat visit carries its ordinal', () => {
    render(<InboxItem item={makeItem({ metadata: { recurrence_30d: 3 } })} />);
    expect(screen.getByText('3rd in 30d')).toBeDefined();
  });

  it('a first visit claims nothing', () => {
    render(<InboxItem item={makeItem({ metadata: { recurrence_30d: 1 } })} />);
    expect(screen.queryByText(/in 30d/)).toBeNull();
  });
});

describe('closure: create runbook from the drawer', () => {
  beforeEach(() => {
    addToast.mockClear();
    global.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(cleanup);

  async function renderDrawer(metadata: Record<string, unknown>) {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string | Request) => {
      const u = typeof url === 'string' ? url : url.url;
      if (u.includes('/runbook')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ skill: 'crashloop-payments', path: '/skills/crashloop-payments/skill.md' }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ steps: [] }) });
    });
    const { TaskDetailDrawer } = await import('../TaskDetailDrawer');
    render(<TaskDetailDrawer item={makeItem({ metadata })} onClose={() => {}} />);
  }

  it('an investigated item offers Create Runbook and reports the draft', async () => {
    await renderDrawer({ investigation_summary: 'OOM under peak load', suspected_cause: 'limit too low' });
    const btn = await screen.findByText('Create Runbook');
    fireEvent.click(btn);
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    const toast = addToast.mock.calls[0][0];
    expect(toast.type).toBe('success');
    expect(toast.title).toContain('crashloop-payments');
  });

  it('the draft toast points at Pulse Agent → Skills and opens it through the router', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string | Request) => {
      const u = typeof url === 'string' ? url : url.url;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(u.includes('/runbook') ? { skill: 'crashloop-payments' } : { steps: [] }),
      });
    });
    const { TaskDetailDrawer } = await import('../TaskDetailDrawer');
    function Where() {
      const l = useLocation();
      return <span data-testid="where">{l.pathname}{l.search}</span>;
    }
    rtlRender(
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes><Route path="*" element={<><Where /><TaskDetailDrawer item={makeItem({ metadata: { investigation_summary: 's', suspected_cause: 'c' } })} onClose={() => {}} /></>} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText('Create Runbook'));
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    const toast = addToast.mock.calls[0][0];
    expect(toast.detail).toContain('Pulse Agent → Skills');
    expect(toast.detail).not.toContain('Toolbox');
    act(() => toast.action.onClick());
    expect(screen.getByTestId('where').textContent).toBe('/agent?tab=skills');
  });

  it('an uninvestigated item does not offer it', async () => {
    await renderDrawer({});
    expect(screen.queryByText('Create Runbook')).toBeNull();
  });
});

describe('the dismiss confirmation names the item\'s real severity', () => {
  afterEach(cleanup);

  it('a warning item is not called critical', () => {
    render(<InboxItem item={makeItem({ severity: 'warning' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText('Dismiss warning item?')).toBeTruthy();
    expect(screen.queryByText('Dismiss critical item?')).toBeNull();
  });

  it('a critical item still says critical', () => {
    render(<InboxItem item={makeItem({ severity: 'critical' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText('Dismiss critical item?')).toBeTruthy();
  });
});
