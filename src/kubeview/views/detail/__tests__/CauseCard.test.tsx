// @vitest-environment jsdom
/**
 * "Pulse found the cause": the monitor finding for the pod or its owner with
 * the investigation's cause, evidence, ruled-out alternatives, confidence and
 * time; without one, Diagnose through the inbox (reusing an open item) with
 * the report in the same card; honest states when the agent is unreachable,
 * forbids the request (403) or fails (500).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CauseCard } from '../CauseCard';
import { useMonitorStore } from '../../../store/monitorStore';
import { DIAGNOSE_POLL_MS } from '../useDiagnose';

const match = { kind: 'Pod', name: 'api-x', namespace: 'payments', owner: { kind: 'Deployment', name: 'api' } };

function finding(extra: Record<string, unknown> = {}) {
  return { id: 'f1', severity: 'critical', category: 'crashloop', title: 'api is crash-looping', summary: 'Restarting', resources: [{ kind: 'Deployment', name: 'api', namespace: 'payments' }], autoFixable: false, timestamp: Date.parse('2026-11-02T14:02:00Z'), confidence: 0.6, ...extra };
}
const investigation = {
  id: 'i1', findingId: 'f1', category: 'crashloop', status: 'completed', summary: 's', timestamp: Date.parse('2026-11-02T14:05:00Z'),
  suspectedCause: 'The api container runs out of memory 40s after start.', confidence: 0.85,
  evidenceDetail: [{ observation: '6 OOMKilled terminations in 58 minutes', source: 'pod status' }, { observation: 'unrelated', stance: 'contradicts' }],
  alternativesConsidered: ['Node memory pressure', 'Readiness probe timeout'],
};

type Reply = { status: number; body?: unknown } | Error;
let routes: Array<[RegExp, string, Reply | (() => Reply)]> = [];
function reply(r: Reply) {
  if (r instanceof Error) return Promise.reject(r);
  return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, statusText: '', json: async () => r.body ?? {} } as Response);
}
beforeEach(() => {
  routes = [];
  useMonitorStore.setState({ connected: true, connectionError: null, findings: [], dismissedFindingIds: [], investigations: [] });
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const hit = routes.find(([re, m]) => m === method && re.test(url));
    if (!hit) return reply({ status: 599 });
    const r = typeof hit[2] === 'function' ? hit[2]() : hit[2];
    return reply(r);
  }) as never;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const renderCard = () => render(<MemoryRouter><CauseCard match={match} noun="pod" /></MemoryRouter>);
const calls = (method: string, re: RegExp) => (global.fetch as unknown as { mock: { calls: Array<[string, RequestInit?]> } }).mock.calls.filter(([u, i]) => (i?.method ?? 'GET') === method && re.test(u));

describe('with a monitor finding', () => {
  it('shows the cause, evidence, ruled-out alternatives, confidence and times', () => {
    useMonitorStore.setState({ findings: [finding()] as never, investigations: [investigation] as never });
    renderCard();
    expect(screen.getByRole('heading', { name: 'Pulse found the cause' })).toBeDefined();
    expect(screen.getByText('The api container runs out of memory 40s after start.')).toBeDefined();
    expect(screen.getByLabelText('Evidence').textContent).toBe('6 OOMKilled terminations in 58 minutes — from pod status');
    expect(screen.getByText('Node memory pressure · Readiness probe timeout')).toBeDefined();
    expect(screen.getByText('Confidence 0.85')).toBeDefined();
    expect(screen.getByText(/Monitor finding · open since .* · investigated /)).toBeDefined();
  });

  it('a finding not yet investigated is a problem, not a cause, and offers Diagnose', () => {
    useMonitorStore.setState({ findings: [finding()] as never });
    renderCard();
    expect(screen.getByRole('heading', { name: 'Pulse found a problem' })).toBeDefined();
    expect(screen.getByText(/not investigated yet/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Diagnose' })).toBeDefined();
  });

  it('ignores dismissed findings and findings about other workloads', () => {
    useMonitorStore.setState({ findings: [finding({ id: 'f2', resources: [{ kind: 'Deployment', name: 'web', namespace: 'payments' }] }), finding()] as never, dismissedFindingIds: ['f1'] });
    renderCard();
    expect(screen.getByText('No open monitor finding for this pod.')).toBeDefined();
  });
});

describe('no finding', () => {
  it('monitor unreachable: says so instead of "nothing found"', () => {
    useMonitorStore.setState({ connected: false, connectionError: 'WebSocket closed (1006)' });
    renderCard();
    expect(screen.getByTestId('monitor-unreachable').textContent).toContain('unreachable (WebSocket closed (1006))');
    expect(screen.queryByText(/No open monitor finding/)).toBeNull();
  });

  it('Diagnose creates an item for the pod, starts the investigation and shows the report when it lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let polls = 0;
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [], groups: [], stats: {}, total: 0 } }],
      [/\/api\/agent\/inbox$/, 'POST', { status: 201, body: { id: 'it-1', item_type: 'task', status: 'new' } }],
      [/inbox\/it-1\/investigate$/, 'POST', { status: 200, body: { ok: true } }],
      [/inbox\/it-1\/investigation$/, 'GET', () => (++polls < 2 ? { status: 404, body: { detail: 'No investigation linked' } } : { status: 200, body: { id: 'r', summary: 's', suspected_cause: 'Memory limit too low for the new cache size.', recommended_fix: '', confidence: 0.8, evidence: ['heap at limit'], alternatives_considered: ['DNS'] } })],
      [/inbox\/it-1$/, 'GET', { status: 200, body: { id: 'it-1', status: 'claimed', resources: [] } }],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    await screen.findByText(/Investigating/);
    const [, init] = calls('POST', /\/api\/agent\/inbox$/)[0];
    expect(JSON.parse(String(init!.body))).toMatchObject({ namespace: 'payments', resources: [{ kind: 'Pod', name: 'api-x', namespace: 'payments' }] });
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS * 2); });
    expect(await screen.findByText('Memory limit too low for the new cache size.')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Pulse found the cause' })).toBeDefined();
    expect(screen.getByText('Confidence 0.80')).toBeDefined();
  });

  it('reuses an open inbox item for the same pod and shows its existing report without a new item', async () => {
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [{ id: 'old', status: 'triaged', resources: [{ kind: 'Pod', name: 'api-x', namespace: 'payments' }], metadata: { investigation_id: 'inv' } }], groups: [], stats: {}, total: 1 } }],
      [/inbox\/old\/investigation$/, 'GET', { status: 200, body: { id: 'inv', summary: 'Earlier finding: bad config.', suspected_cause: '', recommended_fix: '', confidence: 0.7, evidence: [], alternatives_considered: [] } }],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect(await screen.findByText('Earlier finding: bad config.')).toBeDefined();
    expect(calls('POST', /\/api\/agent\/inbox$/)).toHaveLength(0);
    expect(calls('POST', /investigate$/)).toHaveLength(0);
  });

  it('agent_review_failed is shown as a failed diagnosis', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [], groups: [], stats: {}, total: 0 } }],
      [/\/api\/agent\/inbox$/, 'POST', { status: 201, body: { id: 'it-2' } }],
      [/inbox\/it-2\/investigate$/, 'POST', { status: 200, body: {} }],
      [/inbox\/it-2\/investigation$/, 'GET', { status: 404, body: {} }],
      [/inbox\/it-2$/, 'GET', { status: 200, body: { id: 'it-2', status: 'agent_review_failed' } }],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    await screen.findByText(/Investigating/);
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not \(agent_review_failed\)/);
  });

  it.each([[403, /You do not have permission to do this/], [500, /Request failed \(500\)/]])('a %s creating the item is shown as an error', async (status, text) => {
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [], groups: [], stats: {}, total: 0 } }],
      [/\/api\/agent\/inbox$/, 'POST', { status, body: { detail: 'nope' } }],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(text);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('agent unreachable (network error) says nothing was investigated', async () => {
    routes = [[/\/api\/agent\/inbox\?/, 'GET', new TypeError('Failed to fetch')]];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    await waitFor(() => expect(screen.getByTestId('diagnose-unreachable').textContent).toContain('unreachable (Failed to fetch)'));
  });
});
