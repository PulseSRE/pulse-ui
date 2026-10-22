// @vitest-environment jsdom
/**
 * Durable approvals and durable runs from the inbox.
 *
 * Found against a real Temporal server: a run's approval gate could only be
 * answered from the plan panel that started it, while that panel stayed open,
 * and "Run durably" started plans with an empty incident. These pin that the
 * question can be answered where it shows up, that approving asks first (an
 * approved phase may change the cluster), and that a run started from an inbox
 * item targets that item.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }));

import { ApprovalButtons, DurableApprovalPanel, DurableRunStarter } from '../DurableRunControls';
import { RunsTab } from '../../toolbox/RunsTab';
import { buildIncident } from '../../toolbox/PlanRunPanel';
import { describeAwaiting } from '../../../engine/durableRunsApi';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

type Call = { url: string; method: string; body: unknown };

function route(handlers: Record<string, (call: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  mockFetch.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const key = Object.keys(handlers).find((k) => url.includes(k));
    const out = key ? handlers[key](call) : { status: 404, body: {} };
    const status = out.status ?? 200;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(out.body) });
  });
  return calls;
}

const waiting = {
  workflow_id: 'plan-crashloop-abc',
  phase_id: 'remediate',
  memo: { incident_type: 'crashloop', resource_name: 'web-0', resource_namespace: 'shop' },
  phases: { triage: { status: 'complete' }, diagnose: { status: 'complete' } },
};

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('approving a waiting phase', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('names the phase and target and says it may change the cluster before sending', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const calls = route({});
    render(<ApprovalButtons run={waiting} />);
    fireEvent.click(screen.getByText('Approve'));
    expect(confirmSpy.mock.calls[0][0]).toContain("'remediate' of the crashloop plan on web-0 in shop");
    expect(confirmSpy.mock.calls[0][0]).toContain('may change the cluster');
    expect(calls).toHaveLength(0);
  });

  it('sends an explicit verdict for the right run and phase', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = route({ '/approve': () => ({ body: { status: 'signalled' } }) });
    render(<ApprovalButtons run={waiting} />);
    fireEvent.click(screen.getByText('Deny'));
    await waitFor(() => expect(screen.getByText(/Denied/)).toBeTruthy());
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toContain('/workflow-runs/plan-crashloop-abc/approve');
    expect(post.body).toEqual({ phase_id: 'remediate', approved: false });
  });

  it("shows the agent's reason when the verdict cannot be delivered", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    route({ '/approve': () => ({ status: 403, body: { detail: 'Administrator access required' } }) });
    render(<ApprovalButtons run={waiting} />);
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.getByText('Administrator access required')).toBeTruthy());
    expect(screen.getByText('Approve')).toBeTruthy();
  });

  it('the inbox panel answers the run named in the item', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = route({ '/approve': () => ({ body: {} }) });
    render(<DurableApprovalPanel workflowId="plan-x" phaseId="fix" />);
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/workflow-runs/plan-x/approve'))).toBe(true));
  });
});

describe('Runs tab', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('lists runs waiting for approval with what they wait on, answerable in place', async () => {
    route({
      '/workflow-runs/awaiting-approval': () => ({ body: { runs: [waiting] } }),
      '/workflow-runs?': () => ({ body: { runs: [] } }),
    });
    withQuery(<RunsTab />);
    await waitFor(() => expect(screen.getByText('Waiting for your approval')).toBeTruthy());
    expect(screen.getByText("'remediate' of the crashloop plan on web-0 in shop")).toBeTruthy();
    expect(screen.getByText('Approve')).toBeTruthy();
  });

  it('shows no approval section when nothing waits or durable execution is off', async () => {
    route({
      '/workflow-runs/awaiting-approval': () => ({ status: 503, body: { detail: 'off' } }),
      '/workflow-runs?': () => ({ body: { runs: [] } }),
    });
    withQuery(<RunsTab />);
    await waitFor(() => expect(screen.getByText('No durable runs yet.')).toBeTruthy());
    expect(screen.queryByText('Waiting for your approval')).toBeNull();
  });
});

describe('starting a durable run from an inbox item', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('offers the matching plan, says where it will stop, and starts it for this item', async () => {
    const calls = route({
      '/inbox/inb-1/plan': () => ({
        body: {
          incident_type: 'crashloop',
          plan_name: 'Crashloop Resolution',
          phases: [{ id: 'triage', approval_required: false }, { id: 'remediate', approval_required: true }],
        },
      }),
      '/inbox/inb-1/durable-run': () => ({ body: { workflow_id: 'plan-crashloop-1', plan_name: 'Crashloop Resolution' } }),
    });
    render(<DurableRunStarter itemId="inb-1" />);
    await waitFor(() => expect(screen.getByText(/Crashloop Resolution/)).toBeTruthy());
    expect(screen.getByText(/Stops and asks before remediate/)).toBeTruthy();
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(screen.getByText('plan-crashloop-1')).toBeTruthy());
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/inbox/inb-1/durable-run'))).toBe(true);
  });

  it('stays hidden when no plan matches the item', async () => {
    const calls = route({ '/plan': () => ({ status: 404, body: {} }) });
    const { container } = render(<DurableRunStarter itemId="inb-2" />);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(container.textContent).toBe('');
  });

  it('surfaces why the run could not start', async () => {
    route({
      '/plan': () => ({ body: { incident_type: 'x', plan_name: 'X', phases: [] } }),
      '/durable-run': () => ({ status: 503, body: { detail: 'The Temporal worker has not connected yet' } }),
    });
    render(<DurableRunStarter itemId="inb-3" />);
    await waitFor(() => expect(screen.getByText('Start')).toBeTruthy());
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(screen.getByText('The Temporal worker has not connected yet')).toBeTruthy());
  });
});

describe('plan panel target', () => {
  it('sends what the person typed, and nothing for empty fields', () => {
    expect(buildIncident({ title: '', namespace: '', kind: 'Deployment', name: '' })).toEqual({});
    expect(buildIncident({ title: ' checkout down ', namespace: 'shop', kind: 'Deployment', name: 'checkout' })).toEqual({
      title: 'checkout down',
      resources: [{ kind: 'Deployment', name: 'checkout', namespace: 'shop' }],
    });
    expect(buildIncident({ title: '', namespace: '', kind: 'Node', name: 'worker-1' })).toEqual({
      resources: [{ kind: 'Node', name: 'worker-1' }],
    });
  });

  it('describes a waiting run without a memo', () => {
    expect(describeAwaiting({ phase_id: 'fix', memo: undefined })).toBe("'fix' of the plan");
  });
});
