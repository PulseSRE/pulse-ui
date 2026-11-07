// @vitest-environment jsdom
/**
 * Home › What needs attention (Wave 12): one worst-first list from the
 * monitor's findings, with cause, preceding change, confidence, owner and one
 * action; system namespaces collapsed; failed scanners as "Could not check";
 * the browser's own list only when the monitor is unreachable, labelled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createHarness, json, REMOTE } from '../../../__tests__/actionHarness';
import { useMonitorStore } from '../../../store/monitorStore';
import type { Finding, InvestigationReport } from '../../../engine/monitorClient';
import { useActiveClusterId } from '../../../hooks/useClusterBase';

const askPulse = vi.fn();
vi.mock('../../../engine/askPulse', () => ({ askPulse: (...a: unknown[]) => askPulse(...a) }));
vi.setConfig({ testTimeout: 20_000 });

import { AttentionList, useAttentionModel } from '../AttentionList';
import type { LiveObjects } from '../attention';

const h = createHarness();
const go = vi.fn();
const NOW = Date.now();
const ONSET = NOW - 22 * 60_000;

function View({ live }: { live: LiveObjects }) {
  const clusterId = useActiveClusterId();
  const model = useAttentionModel(live, clusterId);
  return <AttentionList model={model} clusterId={clusterId} go={go} />;
}
const EMPTY: LiveObjects = { pods: [], deployments: [], nodes: [], pvcs: [] };

const finding = (over: Partial<Finding>): Finding => ({
  id: 'f-x', severity: 'warning', category: 'crashloop', title: 'Problem', summary: 'scanner summary',
  resources: [], autoFixable: false, timestamp: NOW, ...over,
});

const OOM = finding({ id: 'f-oom', severity: 'critical', category: 'oom', title: 'OOMKilled 6× in 1h', summary: 'OOM', resources: [{ kind: 'Pod', name: 'api-7f9c4d-x2k8q', namespace: 'payments' }], startedAt: ONSET, confidence: 0.6 });
const PENDING = finding({ id: 'f-pend', severity: 'warning', category: 'scheduling', title: 'Pending for 25m', summary: 'Pending', resources: [{ kind: 'Pod', name: 'cart-6b8d5-p4wz2', namespace: 'shop' }], startedAt: NOW - 25 * 60_000 });
const SYS = finding({ id: 'f-sys', severity: 'warning', category: 'restarts', title: 'restarted 2× in 6h', resources: [{ kind: 'Pod', name: 'prometheus-k8s-1', namespace: 'openshift-monitoring' }], confidence: 0.55 });
const NOISY = finding({ id: 'f-noisy', severity: 'warning', category: 'restarts', title: 'flappy', resources: [{ kind: 'Pod', name: 'flap-1', namespace: 'shop' }], noiseScore: 0.9 });
const DEGRADED = finding({ id: 'f-deg', severity: 'warning', category: 'degraded', title: 'Storage scanner is blind', summary: 'the Pulse service account cannot list VolumeAttachments (403)', remedy: 'Grant list on volumeattachments', resources: [] });

const INV: InvestigationReport = { id: 'inv-1', findingId: 'f-oom', category: 'oom', status: 'completed', summary: '', suspectedCause: 'Memory p95 410Mi against a 256Mi limit since revision 14', confidence: 0.85, timestamp: NOW };

const INBOX = {
  items: [{ id: 'inb-oom', item_type: 'task', status: 'new', title: 'OOMKilled', summary: '', severity: 'critical', priority_score: 1, confidence: 0.85, noise_score: 0, namespace: 'payments', resources: [{ kind: 'Pod', name: 'api-7f9c4d-x2k8q', namespace: 'payments' }], correlation_key: 'oom:payments:Pod/api', claimed_by: 'alice', claimed_at: 1, created_by: 'system:monitor', due_date: null, finding_id: 'f-oom', view_id: null, pinned_by: [], metadata: { action_plan: [{ title: 'raise limit' }] }, created_at: 1, updated_at: 1, resolved_at: null, snoozed_until: null }],
  groups: [], stats: {}, total: 1, current_user: 'alice',
};

let changesFor: (url: string) => Response;

function connect(findings: Finding[], extra: Record<string, unknown> = {}) {
  useMonitorStore.setState({
    connected: true, connectionError: null, lastScanTime: NOW - 40_000, findings, investigations: [INV], pendingActions: [], dismissedFindingIds: [],
    scanReport: { scanId: 1, duration_ms: 1, total_findings: 0, timestamp: NOW, scanners: [
      { name: 'a', displayName: 'Crashloops', description: '', duration_ms: 1, findings_count: 0, checks: [], status: 'clean' },
      { name: 'b', displayName: 'Storage', description: 'volumes', duration_ms: 1, findings_count: 0, checks: [], status: 'error' },
    ] },
    ...extra,
  } as never);
}

beforeEach(() => {
  h.setup();
  go.mockReset();
  askPulse.mockReset();
  changesFor = (url) => (url.includes('name=api-7f9c4d-x2k8q')
    ? json({ available: true, changes: [{ at: new Date(ONSET - 4 * 60_000).toISOString(), kind: 'ConfigMap', namespace: 'payments', name: 'api-cfg', summary: 'edited', actor: 'alice', source: 'configmap' }] })
    : json({ available: true, changes: [] }));
  h.state.handler = (r) => {
    if (r.url.startsWith('/api/agent/inbox')) return json(INBOX);
    if (r.url.startsWith('/api/agent/changes')) return changesFor(r.url);
    return json({});
  };
});
afterEach(() => {
  cleanup();
  h.teardown();
  useMonitorStore.setState({ connected: false, lastScanTime: 0, findings: [], investigations: [], scanReport: null } as never);
});

describe('from the monitor', () => {
  it('shows one worst-first row per finding with cause, change before, confidence, owner and one action', async () => {
    connect([PENDING, OOM]);
    h.renderUi(<View live={EMPTY} />);
    const rows = await screen.findAllByTestId('attention-row');
    expect(rows[0].textContent).toContain('payments/api-7f9c4d-x2k8q · OOMKilled 6× in 1h');
    expect(rows[1].textContent).toContain('shop/cart-6b8d5-p4wz2 · Pending for 25m');
    const oom = rows[0];
    expect(oom.textContent).toContain('Memory p95 410Mi against a 256Mi limit');
    expect(oom.textContent).toContain('0.85');
    expect(oom.textContent).toContain('investigated');
    expect(await within(oom).findByText('claimed by alice')).toBeTruthy();
    expect(await within(oom).findByText(/ConfigMap api-cfg edited by alice/)).toBeTruthy();
    expect(within(oom).getByText(/4 min before/)).toBeTruthy();
    expect(await within(rows[1]).findByText('No change found in 24h')).toBeTruthy();
    expect(rows[1].textContent).toContain('Not investigated yet');
    fireEvent.click(within(oom).getByRole('button', { name: 'Review fix' }));
    expect(go).toHaveBeenCalledWith('/inbox?task=inb-oom', 'Inbox');
    // The change lookup is the resource's own, read before the onset.
    const req = h.state.requests.find((r) => r.url.includes('/api/agent/changes') && r.url.includes('api-7f9c4d'))!;
    expect(req.url).toContain('kind=Pod');
    expect(req.url).toContain('namespace=payments');
    // Pulse suggests starting with the worst diagnosed problem.
    expect(screen.getByText(/Pulse suggests starting with api-7f9c4d-x2k8q in payments/)).toBeTruthy();
  });

  it('Ask Pulse entries attach the resource they are about', async () => {
    connect([OOM, PENDING]);
    h.renderUi(<View live={EMPTY} />);
    const rows = await screen.findAllByTestId('attention-row');
    // The pending pod has no Inbox item, so its action is Ask Pulse to investigate.
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Ask Pulse to investigate' }));
    expect(askPulse).toHaveBeenLastCalledWith(expect.stringMatching(/^Investigate: /), { kind: 'Pod', name: 'cart-6b8d5-p4wz2', namespace: 'shop' });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Pulse why' }));
    expect(askPulse).toHaveBeenLastCalledWith(expect.stringMatching(/^Why should I start with /), { kind: 'Pod', name: 'api-7f9c4d-x2k8q', namespace: 'payments' });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Pulse about this list' }));
    expect(askPulse).toHaveBeenLastCalledWith(expect.stringMatching(/^What needs attention on this cluster\?/));
  });

  it('uses the diagnosis engine for cause text when nothing investigated it', async () => {
    const crash = finding({ id: 'f-c', severity: 'critical', title: 'CrashLoopBackOff', resources: [{ kind: 'Pod', name: 'web-1', namespace: 'shop' }] });
    connect([crash], { investigations: [] });
    const pod = { metadata: { name: 'web-1', namespace: 'shop' }, spec: { containers: [{ name: 'web' }] }, status: { phase: 'Running', containerStatuses: [{ name: 'web', ready: false, restartCount: 9, state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m0s restarting failed container' } } }] } };
    h.renderUi(<View live={{ ...EMPTY, pods: [pod as never] }} />);
    const row = (await screen.findAllByTestId('attention-row'))[0];
    expect(row.textContent).toContain('Container web is in CrashLoopBackOff: back-off 5m0s restarting failed container');
    expect(row.textContent).not.toContain('scanner summary');
  });

  it('collapses system namespaces, hides noisy findings with a count, and shows failed scanners as Could not check', async () => {
    connect([OOM, SYS, NOISY, DEGRADED]);
    h.renderUi(<View live={EMPTY} />);
    await screen.findAllByTestId('attention-row');
    expect(screen.getAllByTestId('attention-row')).toHaveLength(1);
    expect(screen.queryByTestId('attention-system-row')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /System namespaces: 1 problem \(openshift-monitoring 1\)/ }));
    expect(screen.getByTestId('attention-system-row').textContent).toContain('prometheus-k8s-1');
    const cnc = screen.getByTestId('attention-could-not-check');
    expect(cnc.textContent).toContain('cannot list VolumeAttachments (403)');
    expect(cnc.textContent).toContain('To fix: Grant list on volumeattachments');
    // The failed Storage scanner is the blind scanner above, named once.
    expect(cnc.textContent).not.toContain('Storage scanner failed in the last scan');
    expect(cnc.textContent).toContain('1 of 2 scanners ran');
    expect(screen.getByText(/1 noisy finding is hidden by noise learning/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
    expect(screen.getAllByTestId('attention-row')).toHaveLength(2);
  });

  it('a change lookup that fails says Could not check; an agent without /changes says so', async () => {
    connect([OOM]);
    changesFor = () => json({ detail: 'replicasets is forbidden' }, 403);
    h.renderUi(<View live={EMPTY} />);
    const row = (await screen.findAllByTestId('attention-row'))[0];
    expect(await within(row).findByText('Could not check')).toBeTruthy();
    cleanup();
    changesFor = () => json({ detail: 'Not Found' }, 404);
    h.renderUi(<View live={EMPTY} />);
    const row2 = (await screen.findAllByTestId('attention-row'))[0];
    expect(await within(row2).findByText('Not available on this agent')).toBeTruthy();
  });

  it('an unreadable Inbox makes owners unknown, not "No Inbox item" silently', async () => {
    connect([OOM]);
    h.state.handler = (r) => (r.url.startsWith('/api/agent/inbox') ? json({ detail: 'boom' }, 500) : json({ available: true, changes: [] }));
    h.renderUi(<View live={EMPTY} />);
    expect(await screen.findByText(/The Inbox could not be read: owners and Inbox links are unknown/)).toBeTruthy();
  });

  it('before the first scan it says Checking, not empty', async () => {
    connect([], { lastScanTime: 0 });
    h.renderUi(<View live={EMPTY} />);
    expect(await screen.findByText(/has not finished its first scan/)).toBeTruthy();
    expect(screen.queryByTestId('attention-empty')).toBeNull();
  });
});

describe('review follow-ups', () => {
  it('folds a firing alert about the same pod into its row instead of a second row', async () => {
    const alertF = finding({ id: 'f-alert', severity: 'critical', category: 'alerts', title: 'KubePodCrashLooping', resources: [{ kind: 'Pod', name: 'api-7f9c4d-x2k8q', namespace: 'payments' }] });
    connect([OOM, alertF]);
    h.renderUi(<View live={EMPTY} />);
    await waitFor(() => expect(screen.getAllByTestId('attention-row')).toHaveLength(1));
    expect(screen.getAllByTestId('attention-row')[0].textContent).toContain('Also in: alert KubePodCrashLooping');
    // The stat tile counts the problem once.
    expect(screen.getAllByText('Critical')[0].nextElementSibling?.textContent).toBe('1');
  });

  it('owner is "Checking…" while the Inbox loads and "Unknown" when it failed; the owner filters are off meanwhile', async () => {
    connect([PENDING]);
    let release: (r: Response) => void = () => {};
    h.state.handler = (r) => (r.url.startsWith('/api/agent/inbox') ? new Promise<Response>((res) => { release = res; }) : json({ available: true, changes: [] }));
    h.renderUi(<View live={EMPTY} />);
    const row = (await screen.findAllByTestId('attention-row'))[0];
    expect(within(row).getByText('Checking…', { selector: 'td:nth-child(6) span' })).toBeTruthy();
    const owner = screen.getByLabelText('Owner') as HTMLSelectElement;
    expect((within(owner).getByRole('option', { name: 'Unowned' }) as HTMLOptionElement).disabled).toBe(true);
    release(json({ detail: 'boom' }, 500));
    expect(await within(row).findByText('Unknown')).toBeTruthy();
    expect((within(owner).getByRole('option', { name: 'Mine' }) as HTMLOptionElement).disabled).toBe(true);
  });

  it('an Inbox item of another category for the same pod is not this finding\'s item', async () => {
    const other = { ...INBOX.items[0], id: 'inb-crash', finding_id: 'f-other', correlation_key: 'crashloop:payments:Pod/api', claimed_by: 'zed', metadata: {} };
    h.state.handler = (r) => (r.url.startsWith('/api/agent/inbox') ? json({ ...INBOX, items: [other] }) : json({ available: true, changes: [] }));
    connect([OOM]);
    h.renderUi(<View live={EMPTY} />);
    const row = (await screen.findAllByTestId('attention-row'))[0];
    expect(await within(row).findByText('No Inbox item')).toBeTruthy();
    expect(row.textContent).not.toContain('zed');
  });

  it('honours /changes unreadable and truncated, and says when the resource was deleted', async () => {
    connect([OOM]);
    changesFor = () => json({ available: true, changes: [], unreadable: ['secrets: forbidden'] });
    h.renderUi(<View live={EMPTY} />);
    let row = (await screen.findAllByTestId('attention-row'))[0];
    expect(await within(row).findByText('No change found (could not read: secrets: forbidden)')).toBeTruthy();
    cleanup();
    changesFor = () => json({ available: true, changes: [], truncated: true });
    h.renderUi(<View live={EMPTY} />);
    row = (await screen.findAllByTestId('attention-row'))[0];
    expect(await within(row).findByText('No change found in 24h (partial list)')).toBeTruthy();
    cleanup();
    changesFor = () => json({ detail: 'pod not found', code: 'resource_not_found' }, 404);
    h.renderUi(<View live={EMPTY} />);
    row = (await screen.findAllByTestId('attention-row'))[0];
    expect(await within(row).findByText('The pod was deleted')).toBeTruthy();
  });
});

describe('without the monitor', () => {
  const OOM_JOB_POD = { metadata: { name: 'export-1', namespace: 'billing', ownerReferences: [{ kind: 'Job', name: 'export' }], creationTimestamp: new Date(NOW - 3600_000).toISOString() }, spec: { containers: [{ name: 'x' }] }, status: { phase: 'Running', containerStatuses: [{ name: 'x', ready: false, restartCount: 2, state: { running: {} }, lastState: { terminated: { reason: 'OOMKilled' } } }] } };
  const SYS_POD = { metadata: { name: 'router-1', namespace: 'openshift-ingress', creationTimestamp: new Date(NOW).toISOString() }, spec: { containers: [{ name: 'r' }] }, status: { phase: 'Running', containerStatuses: [{ name: 'r', ready: false, restartCount: 0, state: { waiting: { reason: 'CrashLoopBackOff' } } }] } };

  it('computes the list in the browser, says so, and includes Job pods, OOM and system namespaces', async () => {
    useMonitorStore.setState({ connected: false, connectionError: 'socket closed', lastScanTime: 0, findings: [] } as never);
    h.renderUi(<View live={{ ...EMPTY, pods: [OOM_JOB_POD as never, SYS_POD as never] }} />);
    expect((await screen.findByTestId('attention-fallback')).textContent).toMatch(/monitor is unreachable \(socket closed\)/);
    const rows = screen.getAllByTestId('attention-row');
    expect(rows[0].textContent).toContain('billing/export-1');
    expect(rows[0].textContent).toContain('OOM');
    expect(screen.getByRole('button', { name: /System namespaces: 1 problem/ })).toBeTruthy();
    // Without the monitor, what its scanners could not check is unknown ("—"), not "none".
    expect(screen.queryByTestId('attention-could-not-check')).toBeNull();
  });

  it('on a remote cluster: browser list, and no Pulse AI actions', async () => {
    connect([OOM]);
    h.setActive(REMOTE);
    h.renderUi(<View live={{ ...EMPTY, pods: [OOM_JOB_POD as never] }} />);
    expect((await screen.findByTestId('attention-fallback')).textContent).toMatch(/local cluster only/);
    // The local monitor's finding is not shown as this cluster's.
    expect(screen.queryByText(/api-7f9c4d-x2k8q/)).toBeNull();
    expect(screen.getByText('Pulse AI answers about the local cluster only.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Ask Pulse about this list' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Ask Pulse to investigate' })).toBeNull();
    await waitFor(() => expect(h.state.requests.some((r) => r.url.startsWith('/api/agent/'))).toBe(false));
  });
});
