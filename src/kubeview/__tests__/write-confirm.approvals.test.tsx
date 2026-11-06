// @vitest-environment jsdom
/**
 * Every approval of an agent write goes through one confirm (H1 of the
 * page-consistency review): Inbox → Approve, a durable run's waiting phase,
 * the plan-run panel's waiting phase, and the chat's ConfirmationCard.
 *
 * For each entry point: confirm sends exactly the agent's request (and the
 * chat echoes the backend nonce unchanged), cancel sends nothing, the dialog
 * says there is no dry run, a refusal (403/409) is shown, permission is
 * stated honestly (Pulse's service account is not checked against the
 * person's RBAC; the chat's forwarded-token write is), observe mode cannot
 * approve by button or keyboard, and a cluster switch while the confirm is
 * open sends nothing.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

let agentHandlers: Set<(e: unknown) => void> | null = null;
const wsConfirms: Array<[boolean, string | undefined]> = [];
vi.mock('../engine/agentClient', () => ({
  AgentClient: class {
    connected = false;
    private handlers = new Set<(e: unknown) => void>();
    constructor(public mode: string) { agentHandlers = this.handlers; }
    on(h: (e: unknown) => void) { this.handlers.add(h); return () => this.handlers.delete(h); }
    connect() { this.connected = true; for (const h of this.handlers) h({ type: 'connected' }); }
    disconnect() { this.connected = false; }
    send() {}
    confirm(approved: boolean, nonce?: string) { wsConfirms.push([approved, nonce]); }
    clear() {}
    switchMode(mode: string) { this.mode = mode; }
  },
}));

import { ProposedFixes } from '../views/inbox/ProposedFixes';
import { ApprovalButtons } from '../views/inbox/DurableRunControls';
import { PlanRunPanel } from '../views/toolbox/PlanRunPanel';
import { ConfirmationCard } from '../components/agent/ConfirmationCard';
import { useAgentStore } from '../store/agentStore';
import { useTrustStore } from '../store/trustStore';
import { useFleetStore } from '../store/fleetStore';
import { useUIStore } from '../store/uiStore';
import { resetApprovalsStore } from '../store/approvalsStore';
import { getAllConnections, registerCluster, resetConnections } from '../engine/clusterConnection';

type Call = { url: string; method: string; body: unknown };
type Reply = { status?: number; body: unknown };
const SSAR = '/selfsubjectaccessreviews';
let calls: Call[] = [];
let replies: Array<[string, (c: Call) => Reply]> = [];
let ssarAllowed = true;
let ssarStatus = 201;

const fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  const method = init.method ?? 'GET';
  const call = { url, method, body: init.body ? JSON.parse(String(init.body)) : undefined };
  calls.push(call);
  const out: Reply = url.includes(SSAR)
    ? { status: ssarStatus, body: { status: { allowed: ssarAllowed } } }
    : (replies.find(([k]) => `${method} ${url}`.includes(k))?.[1](call) ?? { status: 404, body: {} });
  const status = out.status ?? 200;
  return Promise.resolve({ ok: status < 400, status, statusText: String(status), json: async () => out.body, text: async () => JSON.stringify(out.body) } as Response);
});
const writes = () => calls.filter((c) => c.method === 'POST' && !c.url.includes(SSAR));

function mount(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}>{ui}</QueryClientProvider></MemoryRouter>);
}
const switchCluster = (id: string) => act(() => { useFleetStore.getState().setActiveCluster(id); });

beforeEach(() => {
  resetConnections();
  registerCluster({ id: 'prod-east', name: 'Prod East', connectionType: 'acm-proxy', target: 'prod-east' });
  useFleetStore.setState({ activeClusterId: 'local', clusters: getAllConnections() });
  useUIStore.setState({ impersonateUser: '', impersonateGroups: [] });
  useTrustStore.setState({ trustLevel: 1, history: [] });
  resetApprovalsStore();
  calls = [];
  replies = [];
  ssarAllowed = true;
  ssarStatus = 201;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetConnections(); });

/* ---------------- the three REST approvals ---------------- */

const PROPOSAL = {
  id: 'a-1', findingId: 'f-1', timestamp: Date.now(), category: 'crashloop', tool: 'restart_deployment',
  input: { fixDescription: 'Restart the api Deployment', namespace: 'shop', name: 'api' }, status: 'proposed',
  beforeState: '', afterState: '', reasoning: 'Pods crash-looping', durationMs: 0, rollbackAvailable: false,
  resources: [{ kind: 'Deployment', name: 'api', namespace: 'shop' }],
};
const RUN = { workflow_id: 'wf-1', phase_id: 'remediate', memo: { incident_type: 'crashloop', resource_kind: 'Deployment', resource_name: 'web', resource_namespace: 'shop' } };

interface Route {
  name: string;
  /** Renders the entry point and leaves its row Approve on screen. */
  setup: (approve: () => Reply) => Promise<void>;
  confirmLabel: string;
  approveUrl: string;
  /** The exact request body the agent's endpoint takes (none for fix approval). */
  body: unknown;
  /** Where a refusal is shown: in the dialog, or as the row's outcome (the list is re-read). */
  refusalInDialog: boolean;
}

const routes: Route[] = [
  {
    name: 'Inbox → Approve a proposed fix',
    setup: async (approve) => {
      replies = [
        ['POST /api/agent/fix-history/a-1/approve', approve],
        ['GET /api/agent/fix-history', () => ({ body: { actions: [PROPOSAL], total: 1, page: 1, pageSize: 20 } })],
      ];
      mount(<ProposedFixes />);
      await screen.findByText('1 fix waiting on you');
    },
    confirmLabel: 'Run fix on Deployment api',
    approveUrl: '/api/agent/fix-history/a-1/approve',
    body: undefined,
    refusalInDialog: false,
  },
  {
    name: 'durable run → Approve a waiting phase',
    setup: async (approve) => {
      replies = [['POST /api/agent/workflow-runs/wf-1/approve', approve]];
      mount(<ApprovalButtons run={RUN} />);
    },
    confirmLabel: 'Approve phase remediate',
    approveUrl: '/api/agent/workflow-runs/wf-1/approve',
    body: { phase_id: 'remediate', approved: true },
    refusalInDialog: true,
  },
  {
    name: 'plan-run panel → Approve a waiting phase',
    setup: async (approve) => {
      replies = [
        ['POST /api/agent/workflow-runs/wf-1/approve', approve],
        ['POST /api/agent/plan-templates/crashloop/run', () => ({ body: { workflow_id: 'wf-1' } })],
        ['GET /api/agent/workflow-runs/wf-1', () => ({ body: { workflow_id: 'wf-1', status: 'RUNNING', progress: { current_phase: 'remediate', awaiting_approval: 'remediate', phases: { remediate: { status: null, confidence: 0 } } } } })],
      ];
      mount(<PlanRunPanel incidentType="crashloop" />);
      fireEvent.change(screen.getByLabelText('Namespace'), { target: { value: 'shop' } });
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'web' } });
      fireEvent.click(screen.getByRole('button', { name: /Run durably/ }));
      await screen.findByText(/Phase “remediate” is waiting for your approval/);
    },
    confirmLabel: 'Approve phase remediate',
    approveUrl: '/api/agent/workflow-runs/wf-1/approve',
    body: { phase_id: 'remediate', approved: true },
    refusalInDialog: true,
  },
];

const rowApprove = () => screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
async function openDialog() {
  fireEvent.click(rowApprove());
  return screen.findByRole('dialog');
}
const confirmButton = (label: string) => screen.getByRole('button', { name: label }) as HTMLButtonElement;

describe.each(routes)('$name', (r) => {
  it('confirm: one click opens the dialog; only its confirm sends exactly the agent request', async () => {
    await r.setup(() => ({ body: { ...PROPOSAL, status: 'completed' } }));
    const dialog = await openDialog();
    expect(writes().filter((c) => c.url.includes('/approve'))).toHaveLength(0);
    // Where, and as whom — stated honestly.
    expect(within(dialog).getByTestId('write-where').textContent).toBe("shop · cluster Local Cluster · acting as Pulse's service account");
    expect(within(dialog).getByText('What will change')).toBeTruthy();
    fireEvent.click(confirmButton(r.confirmLabel));
    await waitFor(() => expect(writes().filter((c) => c.url.includes('/approve'))).toHaveLength(1));
    const sent = writes().find((c) => c.url.includes('/approve'))!;
    expect(sent.url).toBe(r.approveUrl);
    // The verdict goes as the endpoint defines it, nothing added.
    expect(sent.body).toEqual(r.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancel sends nothing', async () => {
    await r.setup(() => ({ body: {} }));
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes().filter((c) => c.url.includes('/approve'))).toHaveLength(0);
  });

  it('says the agent offers no dry run, and does not hold Approve on one', async () => {
    await r.setup(() => ({ body: {} }));
    await openDialog();
    expect(screen.getByTestId('write-dry-run').textContent).toBe('No dry run available for this action');
    expect(confirmButton(r.confirmLabel).disabled).toBe(false);
  });

  it.each([
    [403, 'Administrator access required'],
    [409, 'Somebody else already answered this'],
  ])('a %s refusal is shown with the agent\'s words', async (status, message) => {
    await r.setup(() => ({ status, body: { error: message, detail: message } }));
    await openDialog();
    fireEvent.click(confirmButton(r.confirmLabel));
    if (r.refusalInDialog) {
      expect((await screen.findByRole('alert')).textContent).toContain(message);
      expect(screen.getByRole('dialog')).toBeTruthy();
    } else {
      expect(await screen.findByText(message)).toBeTruthy();
    }
  });

  it("runs as Pulse's service account: the person's RBAC is not asked or claimed", async () => {
    ssarAllowed = false;
    await r.setup(() => ({ body: {} }));
    await openDialog();
    expect(calls.filter((c) => c.url.includes(SSAR))).toHaveLength(0);
    expect(screen.queryByTestId('write-blocked')).toBeNull();
    expect(confirmButton(r.confirmLabel).disabled).toBe(false);
  });

  it('observe mode: the row Approve is disabled, and an open dialog cannot approve by button or keyboard', async () => {
    useTrustStore.setState({ trustLevel: 0 });
    await r.setup(() => ({ body: {} }));
    expect(rowApprove().disabled).toBe(true);
    fireEvent.click(rowApprove());
    expect(screen.queryByRole('dialog')).toBeNull();

    // Switched to observe while the dialog is open.
    act(() => { useTrustStore.setState({ trustLevel: 1 }); });
    await openDialog();
    act(() => { useTrustStore.setState({ trustLevel: 0 }); });
    expect(confirmButton(r.confirmLabel).disabled).toBe(true);
    expect(screen.getByTestId('write-blocked').textContent).toMatch(/Observe mode/);
    fireEvent.click(confirmButton(r.confirmLabel));
    fireEvent.keyDown(confirmButton(r.confirmLabel), { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'y' });
    expect(writes().filter((c) => c.url.includes('/approve'))).toHaveLength(0);
  });

  it('a cluster switch while the dialog is open sends nothing and says why', async () => {
    await r.setup(() => ({ body: {} }));
    await openDialog();
    switchCluster('prod-east');
    fireEvent.click(confirmButton(r.confirmLabel));
    expect((await screen.findByRole('alert')).textContent).toMatch(/was not run: it was prepared on Local Cluster, but the active cluster is now Prod East/);
    expect(writes().filter((c) => c.url.includes('/approve'))).toHaveLength(0);
  });
});

/* ---------------- the chat ConfirmationCard (WebSocket, nonce) ---------------- */

function ChatHarness() {
  const pending = useAgentStore((s) => s.pendingConfirm);
  const confirmAction = useAgentStore((s) => s.confirmAction);
  return pending ? <ConfirmationCard confirm={pending} onConfirm={confirmAction} /> : null;
}

describe('chat → ConfirmationCard', () => {
  beforeEach(() => {
    wsConfirms.length = 0;
    useAgentStore.setState({ pendingConfirm: null, error: null });
    useAgentStore.getState().connect();
  });
  afterEach(() => { useAgentStore.getState().disconnect(); });

  const ask = (nonce = 'n-7f3a') => act(() => {
    for (const h of agentHandlers ?? []) h({ type: 'confirm_request', tool: 'scale_deployment', input: { namespace: 'shop', name: 'web', replicas: 2 }, nonce });
  });

  it('confirm echoes the backend nonce unchanged, after the permission check', async () => {
    mount(<ChatHarness />);
    ask('nonce/with+odd=chars');
    fireEvent.click(await screen.findByRole('button', { name: 'Approve operation (Y)' }));
    expect(wsConfirms).toEqual([[true, 'nonce/with+odd=chars']]);
    const review = calls.find((c) => c.url.includes(SSAR))!;
    expect(review.body).toMatchObject({ spec: { resourceAttributes: { verb: 'patch', group: 'apps', resource: 'deployments', subresource: 'scale', namespace: 'shop' } } });
  });

  it('shows the same body as the dialog: where, what, no dry run', async () => {
    mount(<ChatHarness />);
    ask();
    expect(screen.getByTestId('write-where').textContent).toMatch(/^shop · cluster Local Cluster · acting as you, through the agent/);
    expect(screen.getByText('What will change')).toBeTruthy();
    expect(screen.getByTestId('write-dry-run').textContent).toBe('No dry run available for this action');
  });

  it('deny (cancel) answers no with the same nonce', async () => {
    mount(<ChatHarness />);
    ask();
    fireEvent.click(await screen.findByRole('button', { name: 'Deny operation (N)' }));
    expect(wsConfirms).toEqual([[false, 'n-7f3a']]);
  });

  it.each([
    ['RBAC-denied', () => { ssarAllowed = false; }],
    ['a 403 from the access review (fails closed)', () => { ssarStatus = 403; }],
  ])('%s: no Approve, Y does nothing, and it says why', async (_n, arrange) => {
    arrange();
    mount(<ChatHarness />);
    ask();
    expect(await screen.findByText(/You do not have permission to patch deployments\/scale in shop/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'y' });
    expect(wsConfirms).toEqual([]);
  });

  it('observe mode: no Approve, Y does nothing, Escape declines with the nonce', async () => {
    useTrustStore.setState({ trustLevel: 0 });
    mount(<ChatHarness />);
    ask();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'y' });
    expect(wsConfirms).toEqual([]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(wsConfirms).toEqual([[false, 'n-7f3a']]);
  });

  it('a cluster switch after the request declines it with the nonce and says why', async () => {
    mount(<ChatHarness />);
    ask();
    await screen.findByRole('button', { name: 'Approve operation (Y)' });
    switchCluster('prod-east');
    expect(screen.getByText(/You are viewing Prod East; this change applies to Local Cluster, where the agent runs/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve operation (Y)' }));
    expect(wsConfirms).toEqual([[false, 'n-7f3a']]);
    expect(useAgentStore.getState().error).toMatch(/scale_deployment was not run/);
  });
});
