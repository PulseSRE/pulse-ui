// @vitest-environment jsdom
/**
 * "Pulse found the cause": the monitor finding for the pod or its owner with
 * the investigation's cause, evidence, ruled-out alternatives, confidence and
 * time; without one, Diagnose through the inbox (reusing an open item) with
 * the report in the same card; honest states when the agent is unreachable,
 * forbids the request (403) or fails (500).
 *
 * The agent replies are pulse-agent#233's real shapes: POST …/investigate
 * answers 202 with the run (`state`/`status` queued|running) or 409/429 with
 * `detail: {reason, message, retry_after}`; GET …/investigation answers
 * `{item_id, state, run, error}` before a report exists and the report row
 * plus `state`/`run` after, where `state` (not the row's `status`) decides.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CauseCard } from '../CauseCard';
import { useMonitorStore } from '../../../store/monitorStore';
import { useFleetStore } from '../../../store/fleetStore';
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
afterEach(() => { cleanup(); vi.useRealTimers(); useFleetStore.setState({ activeClusterId: 'local' }); });

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

  const emptyInbox: [RegExp, string, Reply] = [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [], groups: [], stats: {}, total: 0 } }];
  const created: [RegExp, string, Reply] = [/\/api\/agent\/inbox$/, 'POST', { status: 201, body: { id: 'it-1', item_type: 'task', status: 'new' } }];

  // pulse-agent#233's shapes. The run, as POST …/investigate returns it and GET reports it under `run`:
  const runOf = (state: string, extra: Record<string, unknown> = {}) => ({
    item_id: 'it-1', state, source: 'request', requested_by: 'alice', queued_at: 1_762_000_000,
    started_at: state === 'queued' ? null : 1_762_000_005, finished_at: state === 'done' || state === 'failed' ? 1_762_000_100 : null,
    error: null, report_id: null, ...extra,
  });
  // 202 from POST …/investigate: the run plus status (= state) and ok.
  const started = (state: string) => ({ status: 202, body: { ok: true, ...runOf(state), status: state } });
  // GET …/investigation before a report exists: {item_id, state, run, error}.
  const pending = (state: string, error: string | null = null) => ({ status: 200, body: { item_id: 'it-1', state, run: runOf(state, { error }), error } });
  // GET …/investigation with a report: the investigations row (its status is the report's) plus state and run.
  const row = { id: 'inv-1', finding_id: 'f', timestamp: 1_762_000_100_000, category: 'task', severity: 'warning', status: 'completed', summary: 's', suspected_cause: 'Memory limit too low for the new cache size.', recommended_fix: '', confidence: 0.8, error: null, resources: [], evidence: ['heap at limit'], alternatives_considered: ['DNS'], evidence_detail: [], security_notes: [] };
  const withReport = (state: string, extra: Record<string, unknown> = {}) => ({ status: 200, body: { ...row, ...extra, state, run: runOf(state, { report_id: 'inv-1' }) } });
  const refusal = (status: number, reason: string, message: string, retry_after: number | null) => ({ status, body: { detail: { reason, message, retry_after } } });

  it('creates an item for the pod, starts the investigation, shows queued then running, then the report, and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seq: Reply[] = [pending('queued'), pending('running'), withReport('done')];
    routes = [
      emptyInbox, created,
      [/inbox\/it-1\/investigate$/, 'POST', started('queued')],
      [/inbox\/it-1\/investigation$/, 'GET', () => seq.shift() ?? withReport('done')],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect((await screen.findByTestId('diagnose-run')).textContent).toMatch(/^Queued for investigation/);
    const [, init] = calls('POST', /\/api\/agent\/inbox$/)[0];
    expect(JSON.parse(String(init!.body))).toMatchObject({ namespace: 'payments', resources: [{ kind: 'Pod', name: 'api-x', namespace: 'payments' }] });
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS); });
    expect(screen.getByTestId('diagnose-run').textContent).toMatch(/^Queued for investigation/);
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS); });
    await waitFor(() => expect(screen.getByTestId('diagnose-run').textContent).toMatch(/^Investigating/));
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS); });
    expect(await screen.findByText('Memory limit too low for the new cache size.')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Pulse found the cause' })).toBeDefined();
    expect(screen.getByText('Confidence 0.80')).toBeDefined();
    const polls = calls('GET', /investigation$/).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS * 3); });
    expect(calls('GET', /investigation$/).length).toBe(polls);
  });

  it('a new run beside an older linked report keeps waiting: state, not the report row, decides', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seq: Reply[] = [withReport('running', { suspected_cause: 'An older cause.' }), withReport('done')];
    routes = [emptyInbox, created,
      [/inbox\/it-1\/investigate$/, 'POST', started('running')],
      [/inbox\/it-1\/investigation$/, 'GET', () => seq.shift() ?? withReport('done')]];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect((await screen.findByTestId('diagnose-run')).textContent).toMatch(/^Investigating/);
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS); });
    expect(screen.queryByText('An older cause.')).toBeNull();
    expect(screen.getByTestId('diagnose-run')).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS); });
    expect(await screen.findByText('Memory limit too low for the new cache size.')).toBeDefined();
  });

  it.each([
    [409, refusal(409, 'item_closed', 'The item is resolved; reopen it to investigate it again.', null), 'The item is resolved; reopen it to investigate it again.'],
    [429, refusal(429, 'cooldown', 'This was investigated 240s ago; it can be investigated again in 60s.', 60), 'This was investigated 240s ago; it can be investigated again in 60s. (retry in 60s)'],
    [429, refusal(429, 'daily_budget', 'The daily investigation budget is used up (20/20).', 7200), 'The daily investigation budget is used up (20/20). (retry in 120 min)'],
  ])('a %s refusal shows the agent\'s message and does not poll', async (_status, r, text) => {
    routes = [emptyInbox, created, [/inbox\/it-1\/investigate$/, 'POST', r]];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect((await screen.findByRole('alert')).textContent).toBe(`The agent did not start an investigation: ${text}`);
    const retry = r.body.detail.retry_after;
    const btn = screen.getByRole('button', { name: retry ? /^Try again in / : 'Try again' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(!!retry);
    expect(calls('GET', /investigation$/)).toHaveLength(0);
  });

  it('Try again is disabled until retry_after passes, with a countdown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes = [emptyInbox, created, [/inbox\/it-1\/investigate$/, 'POST', refusal(429, 'cooldown', 'Investigated 280s ago.', 3)]];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    const btn = (await screen.findByRole('button', { name: 'Try again in 3s' })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    const ready = screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
  });

  it('a done run with no report says it finished without one and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes = [emptyInbox, created,
      [/inbox\/it-1\/investigate$/, 'POST', started('running')],
      [/inbox\/it-1\/investigation$/, 'GET', pending('done')]];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    await screen.findByTestId('diagnose-run');
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS); });
    expect((await screen.findByTestId('diagnose-empty')).textContent).toBe('The investigation finished without a report.');
    const polls = calls('GET', /investigation$/).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS * 3); });
    expect(calls('GET', /investigation$/).length).toBe(polls);
    expect(screen.getByRole('button', { name: 'Diagnose again' })).toBeDefined();
  });

  it('a 401 listing the inbox says to sign in again', async () => {
    routes = [[/\/api\/agent\/inbox\?/, 'GET', { status: 401, body: {} }]];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/no user token for the agent \(401\); sign in again/);
  });

  it('an agent_cleared item is reused: the agent can still investigate it', async () => {
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [{ id: 'cleared', status: 'agent_cleared', claimed_by: null, resources: [{ kind: 'Pod', name: 'api-x', namespace: 'payments' }], metadata: {} }], groups: [], stats: {}, total: 1 } }],
      [/inbox\/cleared\/investigate$/, 'POST', started('queued')],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    await screen.findByTestId('diagnose-run');
    expect(calls('POST', /cleared\/investigate$/)).toHaveLength(1);
    expect(calls('POST', /\/api\/agent\/inbox$/)).toHaveLength(0);
  });

  it('a 401 (no forwarded user token) says to sign in again', async () => {
    routes = [emptyInbox, created, [/inbox\/it-1\/investigate$/, 'POST', { status: 401, body: { detail: 'User access token required' } }]];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/no user token for the agent \(401\); sign in again/);
  });

  it.each([
    ['before a report exists', pending('failed', 'Investigation timed out after 300s')],
    ['with its failed report', { status: 200, body: { ...row, status: 'failed', summary: '', suspected_cause: '', error: 'x', state: 'failed', run: runOf('failed', { error: 'Investigation timed out after 300s', report_id: 'inv-1' }) } }],
  ])('a failed run (%s) stops polling and shows the run\'s error', async (_label, failed) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes = [emptyInbox, created,
      [/inbox\/it-1\/investigate$/, 'POST', started('running')],
      [/inbox\/it-1\/investigation$/, 'GET', failed as Reply]];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    await screen.findByTestId('diagnose-run');
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS); });
    expect((await screen.findByRole('alert')).textContent).toBe('Diagnose failed: Investigation timed out after 300s');
    const polls = calls('GET', /investigation$/).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS * 3); });
    expect(calls('GET', /investigation$/).length).toBe(polls);
  });

  it('reuses an open item that already has an investigation and says when it was made', async () => {
    const at = Date.now() - 3 * 3600_000;
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [{ id: 'old', status: 'triaged', claimed_by: 'bob', resources: [{ kind: 'Pod', name: 'api-x', namespace: 'payments' }], metadata: { investigation_id: 'inv' } }], groups: [], stats: {}, total: 1 } }],
      [/inbox\/old\/investigation$/, 'GET', { status: 200, body: { ...row, id: 'inv', summary: 'Earlier finding: bad config.', suspected_cause: '', timestamp: at, state: 'done', run: null } }],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect(await screen.findByText('Earlier finding: bad config.')).toBeDefined();
    // No suspected_cause: not "found the cause"; the summary is the context.
    expect(screen.getByRole('heading', { name: 'No cause identified' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Pulse found the cause' })).toBeNull();
    expect(screen.getByTestId('no-cause').textContent).toBe('The investigation did not identify a cause.');
    expect(screen.getByTestId('diagnose-reused').textContent).toMatch(/investigated 3h ago/);
    expect(calls('POST', /\/api\/agent\/inbox$/)).toHaveLength(0);
    expect(calls('POST', /investigate$/)).toHaveLength(0);
  });

  it('Diagnose again on a reused report starts a new run and shows the new report', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const at = Date.now() - 2 * 86400_000;
    let posted = false;
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [{ id: 'it-1', status: 'triaged', claimed_by: 'bob', resources: [{ kind: 'Pod', name: 'api-x', namespace: 'payments' }], metadata: { investigation_id: 'inv' } }], groups: [], stats: {}, total: 1 } }],
      [/inbox\/it-1\/investigation$/, 'GET', () => (posted ? withReport('done', { suspected_cause: 'A fresh cause.', timestamp: Date.now() }) : { status: 200, body: { ...row, suspected_cause: 'An old cause.', timestamp: at, state: 'done', run: null } })],
      [/inbox\/it-1\/investigate$/, 'POST', () => { posted = true; return started('queued'); }],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect(await screen.findByText('An old cause.')).toBeDefined();
    expect(screen.getByTestId('diagnose-reused').textContent).toMatch(/investigated 2d ago/);
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose again' }));
    expect((await screen.findByTestId('diagnose-run')).textContent).toMatch(/^Queued for investigation/);
    expect(calls('POST', /it-1\/investigate$/)).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS); });
    expect(await screen.findByText('A fresh cause.')).toBeDefined();
    expect(screen.queryByText('An old cause.')).toBeNull();
  });

  it('reuses an item whose run is in progress (someone else claimed it) and waits for that run', async () => {
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [{ id: 'old', status: 'claimed', claimed_by: 'bob', resources: [{ kind: 'Pod', name: 'api-x', namespace: 'payments' }], metadata: { investigation_run: runOf('running', { item_id: 'old' }) } }], groups: [], stats: {}, total: 1 } }],
      [/inbox\/old\/investigation$/, 'GET', pending('running')],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect((await screen.findByTestId('diagnose-run')).textContent).toMatch(/^Investigating \(the open inbox item for this resource\)/);
    expect(calls('POST', /investigate$/)).toHaveLength(0);
    expect(calls('POST', /\/api\/agent\/inbox$/)).toHaveLength(0);
  });

  it('an item whose last run failed is investigated again', async () => {
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [{ id: 'it-1', status: 'claimed', claimed_by: 'bob', resources: [{ kind: 'Pod', name: 'api-x', namespace: 'payments' }], metadata: { investigation_run: runOf('failed', { error: 'boom' }) } }], groups: [], stats: {}, total: 1 } }],
      [/inbox\/it-1\/investigation$/, 'GET', pending('failed', 'boom')],
      [/inbox\/it-1\/investigate$/, 'POST', started('queued')],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect((await screen.findByTestId('diagnose-run')).textContent).toMatch(/^Queued for investigation \(the open inbox item/);
    expect(calls('POST', /it-1\/investigate$/)).toHaveLength(1);
  });

  it('does not reuse an item someone else has claimed without an investigation', async () => {
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [{ id: 'theirs', status: 'claimed', claimed_by: 'bob', resources: [{ kind: 'Pod', name: 'api-x', namespace: 'payments' }], metadata: {} }], groups: [], stats: {}, total: 1 } }],
      created,
      [/inbox\/it-1\/investigate$/, 'POST', started('queued')],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    await screen.findByTestId('diagnose-run');
    expect(calls('POST', /\/api\/agent\/inbox$/)).toHaveLength(1);
    expect(calls('POST', /theirs\/investigate$/)).toHaveLength(0);
  });

  it.each([[403, /You do not have permission to do this/], [500, /Request failed \(500\)/]])('a %s creating the item is shown as an error', async (status, text) => {
    routes = [emptyInbox, [/\/api\/agent\/inbox$/, 'POST', { status, body: { detail: 'nope' } }]];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(text);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('a 500 while polling ends in an error, not a silent wait', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes = [emptyInbox, created,
      [/inbox\/it-1\/investigate$/, 'POST', started('queued')],
      [/inbox\/it-1\/investigation$/, 'GET', { status: 500, body: {} }]];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    await screen.findByTestId('diagnose-run');
    await act(async () => { await vi.advanceTimersByTimeAsync(DIAGNOSE_POLL_MS); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Request failed \(500\)/);
  });

  it('agent unreachable (network error) says nothing was investigated', async () => {
    routes = [[/\/api\/agent\/inbox\?/, 'GET', new TypeError('Failed to fetch')]];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    await waitFor(() => expect(screen.getByTestId('diagnose-unreachable').textContent).toContain('unreachable (Failed to fetch)'));
  });

  it('on a remote cluster Diagnose is disabled, says why, and sends nothing', async () => {
    useFleetStore.setState({ activeClusterId: 'prod-east' });
    renderCard();
    expect(screen.getByTestId('cause-remote').textContent).toBe('Pulse AI answers about the local cluster only.');
    const btn = screen.getByRole('button', { name: 'Diagnose' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    await act(async () => { await Promise.resolve(); });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Asking the agent/)).toBeNull();
  });

  it('Try again after a refused Diagnose again starts a new run, not the old report', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let refuse = true;
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [{ id: 'it-1', status: 'triaged', claimed_by: 'bob', resources: [{ kind: 'Pod', name: 'api-x', namespace: 'payments' }], metadata: { investigation_id: 'inv' } }], groups: [], stats: {}, total: 1 } }],
      [/inbox\/it-1\/investigation$/, 'GET', { status: 200, body: { ...row, suspected_cause: 'An old cause.', state: 'done', run: null } }],
      [/inbox\/it-1\/investigate$/, 'POST', () => (refuse ? refusal(429, 'cooldown', 'Investigated 298s ago.', 2) : started('queued'))],
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect(await screen.findByText('An old cause.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose again' }));
    expect(await screen.findByRole('button', { name: 'Try again in 2s' })).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    refuse = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findByTestId('diagnose-run')).textContent).toMatch(/^Queued for investigation/);
    expect(calls('POST', /it-1\/investigate$/)).toHaveLength(2);
    expect(screen.queryByText('An old cause.')).toBeNull();
  });

  it('a finding in another namespace with the same pod name does not match', () => {
    useMonitorStore.setState({ findings: [finding({ resources: [{ kind: 'Pod', name: 'api-x', namespace: 'other' }] }), finding({ id: 'f3', resources: [{ kind: 'Pod', name: 'api-x' }] })] as never });
    renderCard();
    expect(screen.getByText('No open monitor finding for this pod.')).toBeDefined();
  });
});

describe('a cluster-scoped Node', () => {
  const nodeMatch = { kind: 'Node', name: 'worker-1', namespace: '' };
  const nodeFinding = (extra: Record<string, unknown> = {}) => finding({ id: 'n1', category: 'node_pressure', title: 'worker-1 has memory pressure', resources: [{ kind: 'Node', name: 'worker-1' }], ...extra });
  const renderNode = () => render(<MemoryRouter><CauseCard match={nodeMatch} noun="Node" /></MemoryRouter>);

  it('shows the finding about the node (its ref has no namespace)', () => {
    useMonitorStore.setState({ findings: [nodeFinding()] as never, investigations: [{ ...investigation, findingId: 'n1', suspectedCause: 'kubelet reserved memory is too low.' }] as never });
    renderNode();
    expect(screen.getByRole('heading', { name: 'Pulse found the cause' })).toBeDefined();
    expect(screen.getByText('kubelet reserved memory is too low.')).toBeDefined();
  });

  it('does not match another node, or a namespaced kind with the same name', () => {
    useMonitorStore.setState({ findings: [
      nodeFinding({ id: 'n2', resources: [{ kind: 'Node', name: 'worker-2' }] }),
      nodeFinding({ id: 'n3', resources: [{ kind: 'Pod', name: 'worker-1', namespace: 'default' }] }),
    ] as never });
    renderNode();
    expect(screen.getByText('No open monitor finding for this Node.')).toBeDefined();
  });

  it('a kind the registry does not know (ClusterOperator) still matches without a namespace', () => {
    useMonitorStore.setState({ findings: [finding({ id: 'co', title: 'ingress is degraded', resources: [{ kind: 'ClusterOperator', name: 'ingress' }] })] as never });
    render(<MemoryRouter><CauseCard match={{ kind: 'ClusterOperator', name: 'ingress', namespace: '' }} noun="ClusterOperator" /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Pulse found a problem' })).toBeDefined();
    expect(screen.getByText('ingress is degraded')).toBeDefined();
  });

  it('Diagnose creates an inbox item without a namespace', async () => {
    useMonitorStore.setState({ findings: [nodeFinding()] as never });
    routes = [
      [/\/api\/agent\/inbox\?/, 'GET', { status: 200, body: { items: [], groups: [], stats: {}, total: 0 } }],
      [/\/api\/agent\/inbox$/, 'POST', { status: 201, body: { id: 'it-1', item_type: 'task', status: 'new' } }],
      [/inbox\/it-1\/investigate$/, 'POST', { status: 202, body: { ok: true, item_id: 'it-1', state: 'queued', status: 'queued' } }],
    ];
    renderNode();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    await waitFor(() => expect(calls('POST', /\/api\/agent\/inbox$/).length).toBe(1));
    const body = JSON.parse(String(calls('POST', /\/api\/agent\/inbox$/)[0][1]!.body));
    expect(body.title).toBe('Diagnose Node worker-1');
    expect(body).not.toHaveProperty('namespace');
    expect(body.resources).toEqual([{ kind: 'Node', name: 'worker-1' }]);
    // The inbox list is not filtered to an empty namespace.
    expect(calls('GET', /\/api\/agent\/inbox\?/)[0][0]).not.toMatch(/namespace=/);
  });
});
