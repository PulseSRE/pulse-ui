// @vitest-environment jsdom
/**
 * Readiness waivers kept by the agent (`/readiness/waivers`), driven through
 * the real checklist, gate card and waiver dialog.
 *
 * What these prove: the list comes from the agent and is counted once; a
 * waive or unwaive goes to the agent and never sends an author; a 403 says an
 * admin must do it and keeps the dialog open with nothing stored; any other
 * failure is shown, never dropped; a 404 (older agent) falls back to browser
 * storage and says so; and browser-only waivers are offered for saving to the
 * cluster, not moved without asking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }));
vi.mock('../../store/clusterStore', () => ({
  useClusterStore: (selector: (s: { isHyperShift: boolean }) => unknown) => selector({ isHyperShift: false }),
}));
vi.mock('../../components/onboarding/InstallationReadinessPanel', () => ({ InstallationReadinessPanel: () => null }));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../engine/askPulse', () => ({ askPulse: vi.fn() }));

const k8sGet = vi.fn();
vi.mock('../../engine/query', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../engine/query');
  return { ...actual, k8sGet: (...a: unknown[]) => k8sGet(...a) };
});

const agentFetch = vi.fn();
vi.mock('../../engine/safeQuery', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../engine/safeQuery');
  return { ...actual, agentFetch: (...a: unknown[]) => agentFetch(...a) };
});

const evaluateAllGates = vi.fn();
vi.mock('../../engine/readiness/gates', () => ({
  ALL_GATES: [
    { id: 'gate-1', category: 'prerequisites', title: 'Gate One', whyItMatters: 'first', evaluate: vi.fn() },
    { id: 'gate-2', category: 'security', title: 'Network policies', whyItMatters: 'isolation', evaluate: vi.fn() },
  ],
  evaluateAllGates: (...a: unknown[]) => evaluateAllGates(...a),
}));

import OnboardingView, { applyWaivers } from '../OnboardingView';
import { useOnboardingStore } from '../../store/onboardingStore';

const result = (gateId: string, status: string, detail = '') => ({ gateId, status, detail, fixGuidance: '', evaluatedAt: 0 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const SERVER_WAIVER = {
  gate_id: 'gate-2',
  reason: 'isolated by the CNI',
  waived_by: 'alice',
  created_at: '2026-10-01T12:00:00+00:00',
  expires_at: '2027-01-31T23:59:59+00:00',
};

/** The agent's waiver endpoints, as a tiny in-memory server. */
function agent(opts: { list?: () => Response; put?: (gateId: string, body: Record<string, unknown>) => Response; del?: (gateId: string) => Response; initial?: typeof SERVER_WAIVER[] } = {}) {
  const store = new Map((opts.initial ?? []).map((w) => [w.gate_id, w]));
  agentFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/agent/readiness/waivers' && method === 'GET') {
      return opts.list ? opts.list() : json({ waivers: [...store.values()] });
    }
    const m = url.match(/^\/api\/agent\/readiness\/waivers\/(.+)$/);
    if (m && method === 'PUT') {
      const body = JSON.parse(String(init?.body));
      if (opts.put) return opts.put(m[1], body);
      const saved = { gate_id: m[1], reason: body.reason, waived_by: 'server-user', created_at: '2026-11-01T09:00:00+00:00', expires_at: body.expires_at };
      store.set(m[1], saved);
      return json(saved);
    }
    if (m && method === 'DELETE') {
      if (opts.del) return opts.del(m[1]);
      const deleted = store.delete(m[1]);
      return json({ gate_id: m[1], deleted });
    }
    return json({ detail: 'Not Found' }, 404);
  });
  return store;
}

const calls = (method: string) => agentFetch.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <OnboardingView />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The checklist's Security category header (the sidebar score lists categories too). */
function securityHeader(): HTMLElement {
  const header = screen.getAllByRole('button').find((b) => b.textContent?.startsWith('Security') && /\d\/\d/.test(b.textContent));
  if (!header) throw new Error('Security category header not rendered');
  return header;
}

/** gate-2 is the only Security gate: 1/1 when waived, 0/1 when failing. */
async function securityIs(count: '0/1' | '1/1') {
  await waitFor(() => expect(securityHeader().textContent).toContain(count));
}

function openGate(title: string) {
  fireEvent.click(screen.getByText(title));
}

async function waiveGate2(reason: string) {
  await screen.findByText('Network policies');
  // The security category is open because gate-2 is failing; open its card's Waive.
  fireEvent.click(screen.getByText('Waive'));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Waiver reason'), { target: { value: reason } });
  fireEvent.click(within(dialog).getByText('Waive'));
  return dialog;
}

beforeEach(() => {
  localStorage.setItem('openshiftpulse:onboarding-completed', 'true');
  useOnboardingStore.setState({ waivers: {} });
  k8sGet.mockResolvedValue({ metadata: { name: 'browser-user' } });
  evaluateAllGates.mockResolvedValue({ 'gate-1': result('gate-1', 'passed'), 'gate-2': result('gate-2', 'failed', 'No NetworkPolicy') });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('cluster waivers', () => {
  it("counts the cluster's waivers and shows who waived, when and until when", async () => {
    agent({ initial: [SERVER_WAIVER] });
    renderView();
    await securityIs('1/1');
    fireEvent.click(securityHeader());
    openGate('Network policies');
    const details = await screen.findByTestId('waiver-details');
    expect(details.textContent).toContain('Waived by alice on');
    expect(details.textContent).toContain('2026');
    expect(details.textContent).toContain('expires');
    expect(details.textContent).toContain('isolated by the CNI');
    // Counted as passed.
    await securityIs('1/1');
  });

  it('waives through the agent without sending an author, and counts it', async () => {
    const store = agent();
    renderView();
    const dialog = await waiveGate2('accepted until Q1');
    // The dialog says where the waiver goes.
    expect(dialog.textContent).toContain('saved on this cluster with your name');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [[url, init]] = calls('PUT');
    expect(url).toBe('/api/agent/readiness/waivers/gate-2');
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'accepted until Q1', expires_at: null });
    expect(store.get('gate-2')?.reason).toBe('accepted until Q1');
    await securityIs('1/1');
    // Not written to this browser.
    expect(useOnboardingStore.getState().waivers).toEqual({});
  });

  it('sends a chosen expiry date', async () => {
    agent();
    renderView();
    await screen.findByText('Network policies');
    fireEvent.click(screen.getByText('Waive'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Waiver reason'), { target: { value: 'temporary' } });
    fireEvent.change(within(dialog).getByLabelText('Waiver expiry date'), { target: { value: '2099-03-01' } });
    fireEvent.click(within(dialog).getByText('Waive'));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    const body = JSON.parse(String(calls('PUT')[0][1].body));
    expect(new Date(body.expires_at).getFullYear()).toBe(2099);
  });

  it('on 403 says an admin must waive it, keeps the dialog open and stores nothing', async () => {
    agent({ put: () => json({ detail: 'Administrator access required' }, 403) });
    renderView();
    const dialog = await waiveGate2('please');
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Only a Pulse administrator can waive a gate');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((within(dialog).getByLabelText('Waiver reason') as HTMLTextAreaElement).value).toBe('please');
    expect(useOnboardingStore.getState().waivers).toEqual({});
    // Still counted as failing.
    await securityIs('0/1');
  });

  it('on any other error shows it and does not drop the waiver into the browser', async () => {
    agent({ put: () => json({ error: 'Waiver storage is unavailable; the database could not be reached.' }, 503) });
    renderView();
    const dialog = await waiveGate2('accepted');
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Could not save the waiver (503)');
    expect(alert.textContent).toContain('database could not be reached');
    expect(useOnboardingStore.getState().waivers).toEqual({});
  });

  it('removes a waiver through the agent', async () => {
    agent({ initial: [SERVER_WAIVER] });
    renderView();
    await securityIs('1/1');
    fireEvent.click(securityHeader());
    openGate('Network policies');
    fireEvent.click(await screen.findByText('Remove waiver'));
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1));
    expect(calls('DELETE')[0][0]).toBe('/api/agent/readiness/waivers/gate-2');
    await securityIs('0/1');
  });

  it('keeps the waiver and shows why when removing it fails', async () => {
    agent({ initial: [SERVER_WAIVER], del: () => json({ detail: 'Administrator access required' }, 403) });
    renderView();
    await securityIs('1/1');
    fireEvent.click(securityHeader());
    openGate('Network policies');
    fireEvent.click(await screen.findByText('Remove waiver'));
    const alert = await within(screen.getByTestId('waiver-details')).findByRole('alert');
    expect(alert.textContent).toContain('Only a Pulse administrator can remove a waiver');
    await securityIs('1/1');
  });

  it('falls back to this browser on an older agent (404) and says so', async () => {
    agent({ list: () => json({ detail: 'Not Found' }, 404) });
    renderView();
    expect(await screen.findByTestId('waiver-browser-banner')).toBeTruthy();
    const dialog = await waiveGate2('accepted');
    expect(within(dialog).getByTestId('waiver-browser-notice').textContent).toContain('stored in this browser only');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useOnboardingStore.getState().waivers['local/gate-2']).toMatchObject({ reason: 'accepted', approvedBy: 'browser-user' });
    expect(calls('PUT')).toHaveLength(0);
  });

  it('shows a list failure with Retry instead of falling back to the browser', async () => {
    let fail = true;
    useOnboardingStore.setState({ waivers: { 'local/gate-2': { reason: 'browser one', waivedAt: 1, approvedBy: 'bob' } } });
    agent({
      initial: [SERVER_WAIVER],
      list: () => (fail ? json({ error: 'Waiver storage is unavailable' }, 503) : json({ waivers: [SERVER_WAIVER] })),
    });
    renderView();
    const alert = await screen.findByText(/Could not load waivers \(503\)/);
    expect(alert.textContent).toContain('counted as not passed');
    // The browser waiver is not applied as a silent substitute.
    expect(screen.queryByTestId('waiver-browser-banner')).toBeNull();
    await securityIs('0/1');

    fail = false;
    fireEvent.click(screen.getByText('Retry', { selector: 'button' }));
    await waitFor(() => expect(screen.queryByText(/Could not load waivers/)).toBeNull());
    await securityIs('1/1');
  });
});

describe('moving browser-only waivers to the cluster', () => {
  beforeEach(() => {
    useOnboardingStore.setState({
      waivers: {
        'local/gate-2': { reason: 'accepted in Q3', waivedAt: Date.parse('2026-09-15T00:00:00Z'), approvedBy: 'bob' },
        'other-cluster/gate-2': { reason: 'not ours', waivedAt: 1, approvedBy: 'eve' },
      },
    });
  });

  it('offers to save them, and does not save them until asked', async () => {
    agent();
    renderView();
    const offer = await screen.findByTestId('waiver-migration');
    expect(offer.textContent).toContain('One waiver is saved only in this browser (gate-2)');
    expect(within(offer).getByRole('button').textContent).toBe('Save this browser-only waiver to the cluster');
    // Offered, not run; and not counted meanwhile.
    expect(calls('PUT')).toHaveLength(0);
    await securityIs('0/1');
  });

  it('saves them on request, keeping who and when in the reason, and clears them from the browser', async () => {
    const store = agent();
    renderView();
    fireEvent.click(within(await screen.findByTestId('waiver-migration')).getByRole('button'));
    await waitFor(() => expect(screen.queryByTestId('waiver-migration')).toBeNull());
    expect(store.get('gate-2')?.reason).toBe('accepted in Q3 (waived in a browser by bob on 2026-09-15)');
    expect(useOnboardingStore.getState().waivers).toEqual({ 'other-cluster/gate-2': expect.anything() });
    await securityIs('1/1');
  });

  it('keeps them in the browser and says why when saving is refused', async () => {
    agent({ put: () => json({ detail: 'Administrator access required' }, 403) });
    renderView();
    const offer = await screen.findByTestId('waiver-migration');
    fireEvent.click(within(offer).getByRole('button'));
    const alert = await within(offer).findByRole('alert');
    expect(alert.textContent).toContain('Saved 0 of 1');
    expect(alert.textContent).toContain('Only a Pulse administrator');
    expect(useOnboardingStore.getState().waivers['local/gate-2']).toBeDefined();
  });

  it('does not offer gates the cluster already has a waiver for', async () => {
    agent({ initial: [SERVER_WAIVER] });
    renderView();
    await securityIs('1/1');
    await securityIs('1/1');
    expect(screen.queryByTestId('waiver-migration')).toBeNull();
  });
});

describe('applyWaivers', () => {
  const results = { 'gate-2': result('gate-2', 'failed') } as never;

  it('does not apply a waiver past its expiry', () => {
    const now = Date.parse('2027-02-01T00:00:00Z');
    const out = applyWaivers(results, { 'gate-2': { reason: 'r', approvedBy: 'a', expiresAt: now - 1 } }, now);
    expect(out['gate-2'].status).toBe('failed');
  });

  it('applies one that has not expired, or has no expiry', () => {
    const now = Date.parse('2027-02-01T00:00:00Z');
    expect(applyWaivers(results, { 'gate-2': { reason: 'r', approvedBy: 'a', expiresAt: now + 1 } }, now)['gate-2'].status).toBe('waived');
    expect(applyWaivers(results, { 'gate-2': { reason: 'r', approvedBy: 'a', expiresAt: null } }, now)['gate-2'].status).toBe('waived');
  });
});
