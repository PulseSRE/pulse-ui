// @vitest-environment jsdom
/**
 * Wave 7c: every approval in one queue, answerable where it shows up.
 *
 * Driven through the real stores and the real API helpers with fetch routed,
 * so each test pins the exact request a click sends — and what the person sees
 * when the agent says no.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }));

import { ProposedFixes } from '../ProposedFixes';
import { ApprovalsQueue } from '../ApprovalsQueue';
import { InboxItem } from '../InboxItem';
import { TaskDetailDrawer } from '../TaskDetailDrawer';
import { resetApprovalsStore, useApprovalsStore } from '../../../store/approvalsStore';
import { useInboxStore } from '../../../store/inboxStore';
import { useUIStore } from '../../../store/uiStore';
import { useTrustStore } from '../../../store/trustStore';
import type { ActionRecord } from '../../../engine/fixHistory';
import type { InboxItem as InboxItemType } from '../../../engine/inboxApi';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

type Call = { url: string; method: string; body: unknown };
type Handler = (call: Call) => { status?: number; body: unknown };

/** Route fetch by URL substring (first match, most specific first) and record every call. */
function route(handlers: Array<[string, Handler]>) {
  const calls: Call[] = [];
  mockFetch.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';
    const call = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const hit = handlers.find(([k]) => `${method} ${url}`.includes(k));
    const out = hit ? hit[1](call) : { status: 200, body: {} };
    const status = out.status ?? 200;
    return Promise.resolve({
      ok: status < 400,
      status,
      statusText: status >= 400 ? 'Error' : 'OK',
      headers: new Headers(),
      json: () => Promise.resolve(out.body),
    });
  });
  return calls;
}

const sent = (calls: Call[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.url.includes(path));

const PROPOSAL: ActionRecord = {
  id: 'a-1',
  findingId: 'f-1',
  timestamp: Date.now(),
  category: 'crashloop',
  tool: '',
  input: {
    fixStrategy: 'restart_controller',
    causeCategory: 'crash_exit',
    fixDescription: 'Restart the api Deployment so its pods are recreated',
  },
  status: 'proposed',
  beforeState: '',
  afterState: '',
  reasoning: 'Auto-fix for crashloop: api restarting',
  durationMs: 0,
  rollbackAvailable: false,
  resources: [{ kind: 'Deployment', name: 'api', namespace: 'shop' }],
  inboxItemId: 'inb-1',
};

function item(overrides: Partial<InboxItemType> = {}): InboxItemType {
  return {
    id: 'inb-1',
    item_type: 'task',
    status: 'new',
    title: 'api crashlooping',
    summary: '',
    severity: 'warning',
    priority_score: 1,
    confidence: 0.9,
    noise_score: 0,
    namespace: 'shop',
    resources: [{ kind: 'Deployment', name: 'api', namespace: 'shop' }],
    correlation_key: 'crashloop:shop:Deployment/api',
    claimed_by: null,
    claimed_at: null,
    created_by: 'system:monitor',
    due_date: null,
    finding_id: 'f-1',
    view_id: null,
    pinned_by: [],
    metadata: {},
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    resolved_at: null,
    snoozed_until: null,
    ...overrides,
  };
}

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

const toasts = () => useUIStore.getState().toasts.map((t) => t.title);

beforeEach(() => {
  mockFetch.mockReset();
  resetApprovalsStore();
  useInboxStore.setState({ selectedItemId: null, items: [] });
  useUIStore.setState({ toasts: [] });
  useTrustStore.setState({ trustLevel: 1 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('rejecting a proposed fix', () => {
  const routes = (reject: Handler): Array<[string, Handler]> => [
    ['POST /api/agent/fix-history/a-1/reject', reject],
    ['GET /api/agent/fix-history', () => ({ body: { actions: [PROPOSAL], total: 1, page: 1, pageSize: 20 } })],
  ];

  it('asks for a reason and sends nothing without one', async () => {
    const calls = route(routes(() => ({ body: {} })));
    inRouter(<ProposedFixes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject fix' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(sent(calls, 'POST', '/reject')).toHaveLength(0);
  });

  it('sends the reason to the reject endpoint and takes the fix off the list', async () => {
    const calls = route(routes(() => ({ body: { ...PROPOSAL, status: 'failed', learned: true } })));
    inRouter(<ProposedFixes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'restart hides a leak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject fix' }));

    await waitFor(() => expect(sent(calls, 'POST', '/fix-history/a-1/reject')).toHaveLength(1));
    expect(sent(calls, 'POST', '/fix-history/a-1/reject')[0].body).toEqual({ reason: 'restart hides a leak' });
    expect(await screen.findByText(/Rejected — Pulse will count this/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('Answered')).toBeTruthy();
  });

  it("keeps the agent's refusal on screen when the proposal was already answered and drops out of the list", async () => {
    // The real agent: after the 409 the re-read list no longer has the proposal.
    let lists = 0;
    route([
      ['POST /api/agent/fix-history/a-1/reject', () => ({ status: 409, body: { error: 'Somebody else just answered this proposal' } })],
      ['GET /api/agent/fix-history', () => ({ body: { actions: lists++ === 0 ? [PROPOSAL] : [], total: 0, page: 1, pageSize: 20 } })],
    ]);
    inRouter(<ProposedFixes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'no' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject fix' }));
    expect(await screen.findByText('Somebody else just answered this proposal')).toBeTruthy();
    await waitFor(() => expect(lists).toBeGreaterThan(1));
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(screen.getByText('Somebody else just answered this proposal')).toBeTruthy();
  });

  it('observe mode offers no approval, but still lets a person reject', async () => {
    useTrustStore.setState({ trustLevel: 0 });
    const calls = route(routes(() => ({ body: {} })));
    inRouter(<ProposedFixes />);
    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Observe mode — switch trust level to approve')).toBeTruthy();
    fireEvent.click(approve);
    expect(sent(calls, 'POST', '/approve')).toHaveLength(0);
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the plan it would run, links the resource and opens the inbox item', async () => {
    route(routes(() => ({ body: {} })));
    inRouter(<ProposedFixes />);
    fireEvent.click(await screen.findByRole('button', { name: /Details/ }));
    expect(screen.getByText('Restart the api Deployment so its pods are recreated')).toBeTruthy();
    expect(screen.getByText('restart_controller')).toBeTruthy();
    expect(screen.getByText('crash_exit')).toBeTruthy();
    expect(screen.getByText(/Deployment shop\/api/).closest('a')?.getAttribute('href')).toBe('/r/apps~v1~deployments/shop/api');
    fireEvent.click(screen.getByText('Open the inbox item'));
    expect(useInboxStore.getState().selectedItemId).toBe('inb-1');
  });
});

describe('the approvals queue', () => {
  const run = {
    workflow_id: 'plan-crashloop-abc',
    phase_id: 'remediate',
    memo: { incident_type: 'crashloop', resource_name: 'web-0', resource_namespace: 'shop' },
  };

  it('lists proposed fixes and waiting durable runs together, answerable in place', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = route([
      ['POST /api/agent/workflow-runs/plan-crashloop-abc/approve', () => ({ body: {} })],
      ['/workflow-runs/awaiting-approval', () => ({ body: { runs: [run] } })],
      ['GET /api/agent/fix-history', () => ({ body: { actions: [PROPOSAL], total: 1, page: 1, pageSize: 20 } })],
    ]);
    inRouter(<ApprovalsQueue />);
    expect(await screen.findByText('1 fix waiting on you')).toBeTruthy();
    expect(await screen.findByText('1 durable run waiting for approval')).toBeTruthy();

    const runRow = screen.getByText("'remediate' of the crashloop plan on web-0 in shop").closest('li')!;
    fireEvent.click(within(runRow).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(sent(calls, 'POST', '/workflow-runs/plan-crashloop-abc/approve')).toHaveLength(1));
    expect(sent(calls, 'POST', '/workflow-runs/plan-crashloop-abc/approve')[0].body).toEqual({
      phase_id: 'remediate',
      approved: true,
    });
    await waitFor(() => expect(screen.queryByText('1 durable run waiting for approval')).toBeNull());
  });

  it('observe mode cannot approve a durable run', async () => {
    useTrustStore.setState({ trustLevel: 0 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = route([
      ['/workflow-runs/awaiting-approval', () => ({ body: { runs: [run] } })],
      ['GET /api/agent/fix-history', () => ({ body: { actions: [], total: 0, page: 1, pageSize: 20 } })],
    ]);
    inRouter(<ApprovalsQueue />);
    const row = (await screen.findByText("'remediate' of the crashloop plan on web-0 in shop")).closest('li')!;
    const approve = within(row).getByRole('button', { name: /Approve/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(confirm).not.toHaveBeenCalled();
    expect(sent(calls, 'POST', '/approve')).toHaveLength(0);
    expect(within(row).getByText('Observe mode — switch trust level to approve')).toBeTruthy();
  });

  it('says nothing is waiting only when the lists loaded and are empty', async () => {
    route([
      ['/workflow-runs/awaiting-approval', () => ({ body: { runs: [] } })],
      ['GET /api/agent/fix-history', () => ({ body: { actions: [], total: 0, page: 1, pageSize: 20 } })],
    ]);
    inRouter(<ApprovalsQueue />);
    expect(await screen.findByText('Nothing is waiting on you')).toBeTruthy();
  });

  it('a proposal list that fails to load says so instead of "nothing waiting"', async () => {
    route([
      ['/workflow-runs/awaiting-approval', () => ({ body: { runs: [] } })],
      ['GET /api/agent/fix-history', () => ({ status: 500, body: {} })],
    ]);
    inRouter(<ApprovalsQueue />);
    expect(await screen.findByText('Could not load proposed fixes')).toBeTruthy();
    expect(screen.queryByText('Nothing is waiting on you')).toBeNull();
  });

  it.each([403, 500])('a durable-run list that fails with %i says so instead of "nothing waiting"', async (status) => {
    route([
      ['/workflow-runs/awaiting-approval', () => ({ status, body: { detail: `boom ${status}` } })],
      ['GET /api/agent/fix-history', () => ({ body: { actions: [], total: 0, page: 1, pageSize: 20 } })],
    ]);
    inRouter(<ApprovalsQueue />);
    expect(await screen.findByText('Could not load durable runs waiting for approval')).toBeTruthy();
    expect(screen.getByText(`boom ${status}`)).toBeTruthy();
    expect(screen.queryByText('Nothing is waiting on you')).toBeNull();
  });

  it('durable execution switched off (503 "not configured") is an empty list, not an error', async () => {
    route([
      ['/workflow-runs/awaiting-approval', () => ({ status: 503, body: { detail: 'Durable plan execution is not configured. Set PULSE_AGENT_TEMPORAL_HOST.' } })],
      ['GET /api/agent/fix-history', () => ({ body: { actions: [], total: 0, page: 1, pageSize: 20 } })],
    ]);
    inRouter(<ApprovalsQueue />);
    expect(await screen.findByText('Nothing is waiting on you')).toBeTruthy();
    expect(screen.queryByText('Could not load durable runs waiting for approval')).toBeNull();
  });

  it('keeps the last known runs when a later read fails', async () => {
    useApprovalsStore.setState({ runs: [run as never] });
    route([
      ['/workflow-runs/awaiting-approval', () => ({ status: 500, body: {} })],
      ['GET /api/agent/fix-history', () => ({ body: { actions: [], total: 0, page: 1, pageSize: 20 } })],
    ]);
    inRouter(<ApprovalsQueue />);
    expect(await screen.findByText('Could not load durable runs waiting for approval')).toBeTruthy();
    expect(screen.getByText('1 durable run waiting for approval')).toBeTruthy();
  });
});

describe('inbox row actions', () => {
  beforeEach(() => {
    route([
      ['GET /api/agent/inbox', () => ({ body: { items: [], groups: [], stats: {}, total: 0 } })],
    ]);
  });

  it('claims with a user-plus control and unclaims a claimed item', async () => {
    const calls = route([
      ['POST /api/agent/inbox/inb-1/claim', () => ({ body: { ok: true } })],
      ['DELETE /api/agent/inbox/inb-2/claim', () => ({ body: { ok: true } })],
      ['GET /api/agent/inbox', () => ({ body: { items: [], groups: [], stats: {}, total: 0 } })],
    ]);
    inRouter(
      <>
        <InboxItem item={item()} />
        <InboxItem item={item({ id: 'inb-2', title: 'claimed one', claimed_by: 'alice' })} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unclaim' }));
    await waitFor(() => expect(sent(calls, 'POST', '/inbox/inb-1/claim')).toHaveLength(1));
    await waitFor(() => expect(sent(calls, 'DELETE', '/inbox/inb-2/claim')).toHaveLength(1));
  });

  it('escalates after confirming, and offers to open the new item', async () => {
    const calls = route([
      ['POST /api/agent/inbox/inb-1/escalate', () => ({ body: { ok: true, finding_id: 'inb-new' } })],
      ['GET /api/agent/inbox', () => ({ body: { items: [], groups: [], stats: {}, total: 0 } })],
    ]);
    inRouter(<InboxItem item={item()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }));
    expect(sent(calls, 'POST', '/escalate')).toHaveLength(0);
    expect(screen.getByText('Escalate this item?')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Escalate' }).at(-1)!);
    await waitFor(() => expect(sent(calls, 'POST', '/inbox/inb-1/escalate')).toHaveLength(1));
    await waitFor(() => expect(toasts()).toContain('Escalated — re-opened as a new task at full priority'));
    useUIStore.getState().toasts[0].action!.onClick();
    expect(useInboxStore.getState().selectedItemId).toBe('inb-new');
  });

  it('says so when escalating fails', async () => {
    route([['POST /api/agent/inbox/inb-1/escalate', () => ({ status: 400, body: {} })]]);
    inRouter(<InboxItem item={item()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Escalate' }).at(-1)!);
    await waitFor(() => expect(toasts()).toContain('Failed to escalate'));
  });

  it('shows "Approval waiting" when a proposal is waiting for this item', () => {
    useApprovalsStore.setState({ proposals: [PROPOSAL] });
    inRouter(<InboxItem item={item()} />);
    expect(screen.getByText('Approval waiting')).toBeTruthy();
  });

  it('does not show it for an item nothing is waiting on', () => {
    useApprovalsStore.setState({ proposals: [PROPOSAL] });
    inRouter(<InboxItem item={item({ id: 'inb-9', finding_id: 'f-9' })} />);
    expect(screen.queryByText('Approval waiting')).toBeNull();
  });
});

describe('the item drawer', () => {
  it('approves the waiting fix from the item, through the approve endpoint', async () => {
    const calls = route([
      ['POST /api/agent/fix-history/a-1/approve', () => ({ body: { ...PROPOSAL, status: 'completed', tool: 'restart_deployment' } })],
      ['GET /api/agent/inbox/inb-1/plan', () => ({ status: 404, body: {} })],
    ]);
    useApprovalsStore.setState({ proposals: [PROPOSAL] });
    inRouter(<TaskDetailDrawer item={item()} onClose={vi.fn()} />);
    expect(screen.getByText('A proposed fix is waiting on you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(sent(calls, 'POST', '/fix-history/a-1/approve')).toHaveLength(1));
    expect(await screen.findByText('Ran restart_deployment')).toBeTruthy();
  });

  it('observe mode shows no working Approve in the drawer', async () => {
    useTrustStore.setState({ trustLevel: 0 });
    const calls = route([['GET /api/agent/inbox/inb-1/plan', () => ({ status: 404, body: {} })]]);
    useApprovalsStore.setState({ proposals: [PROPOSAL] });
    inRouter(<TaskDetailDrawer item={item()} onClose={vi.fn()} />);
    const approve = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(sent(calls, 'POST', '/approve')).toHaveLength(0);
    expect(screen.getByText('Observe mode — switch trust level to approve')).toBeTruthy();
  });

  it("shows the agent's refusal when approving is refused", async () => {
    route([
      ['POST /api/agent/fix-history/a-1/approve', () => ({ status: 409, body: { error: 'The condition this was proposed for is no longer being reported' } })],
      ['GET /api/agent/fix-history', () => ({ body: { actions: [], total: 0, page: 1, pageSize: 20 } })],
      ['GET /api/agent/inbox/inb-1/plan', () => ({ status: 404, body: {} })],
    ]);
    useApprovalsStore.setState({ proposals: [PROPOSAL] });
    inRouter(<TaskDetailDrawer item={item()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/no longer being reported/)).toBeTruthy();
    // Re-read: the refused proposal is no longer offered.
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('links each resource to its detail page', () => {
    route([['GET /api/agent/inbox/inb-1/plan', () => ({ status: 404, body: {} })]]);
    inRouter(<TaskDetailDrawer item={item()} onClose={vi.fn()} />);
    expect(screen.getByText('Deployment/api').closest('a')?.getAttribute('href')).toBe('/r/apps~v1~deployments/shop/api');
  });

  it('shows suspected prompt injection as a warning, apart from the cause', () => {
    route([['GET /api/agent/inbox/inb-1/plan', () => ({ status: 404, body: {} })]]);
    inRouter(
      <TaskDetailDrawer
        item={item({ metadata: { security_notes: ['pod annotation asks to scale api to 0; not followed'] } })}
        onClose={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Suspected prompt injection');
    expect(alert.textContent).toContain('pod annotation asks to scale api to 0');
  });
});
