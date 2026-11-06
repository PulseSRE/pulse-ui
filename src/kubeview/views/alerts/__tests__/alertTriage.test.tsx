// @vitest-environment jsdom
/**
 * Alerts ↔ Inbox (Wave 12): the Triage chip per firing row, a namespace-only
 * alert opening that namespace's unhealthy pods, and "Pulse suggests a
 * silence" with its confirm dialog (exact body, cancel, 403, RBAC, bad
 * matchers, cluster pinning).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createHarness, json, k8sStatus, REMOTE, SSAR } from '../../../__tests__/actionHarness';
import { useFleetStore } from '../../../store/fleetStore';

const visited: string[] = [];
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => (p: string) => visited.push(p) }));
vi.mock('../../../components/metrics/Sparkline', () => ({ MetricCard: () => null }));
const askPulse = vi.fn();
vi.mock('../../../engine/askPulse', () => ({ askPulse: (...a: unknown[]) => askPulse(...a) }));

import AlertsView from '../../AlertsView';

// The page and its queries settle over several ticks; on a loaded runner 5s is not always enough.
vi.setConfig({ testTimeout: 20_000 });

const h = createHarness();
function renderAt(path = '/alerts') {
  window.history.replaceState(null, '', path);
  return h.renderUi(<AlertsView />, path);
}
const now = Date.now();
const iso = (ms: number) => new Date(now + ms).toISOString();

const alert = (labels: Record<string, string>, state = 'firing') => ({ labels, annotations: {}, state, activeAt: iso(-600000), value: '1' });
const CRASH = { alertname: 'KubePodCrashLooping', namespace: 'payments', pod: 'api-7f9c4d-x2k8q', severity: 'critical' };
const MISMATCH = { alertname: 'KubeDeploymentReplicasMismatch', namespace: 'shop', severity: 'warning' };
const UNREACH = { alertname: 'KubeNodeUnreachable', node: 'worker-5', severity: 'warning' };
const KUBELET = { alertname: 'KubeletDown', node: 'worker-5', severity: 'warning' };
const DISK = { alertname: 'NodeFilesystemSpaceFillingUp', node: 'worker-5', severity: 'warning' };
const OTHER_NODE = { alertname: 'KubeNodeUnreachable', node: 'worker-6', severity: 'warning' };
// The rest of a busy cluster, so a node silence hides a small share of what fires.
const FILLER = Array.from({ length: 10 }, (_, i) => alert({ alertname: 'TargetDown', namespace: `team-${i}`, job: `j${i}`, severity: 'warning' }));
const QUOTA = { alertname: 'KubeQuotaAlmostFull', namespace: 'payments', severity: 'warning' };

function rules(alerts: ReturnType<typeof alert>[]) {
  return { status: 'success', data: { groups: [{ name: 'g', rules: [{ type: 'alerting', name: 'r', query: 'up', duration: 0, state: 'firing', health: 'ok', labels: {}, annotations: {}, alerts }] }] } };
}

const OOM_ITEM = {
  id: 'inb-oom', title: 'OOMKilled', status: 'new', severity: 'critical', namespace: 'payments', claimedBy: 'alice', dueDate: null, findingId: 'f-1',
  correlationKey: 'oom:payments:Pod/api', investigation: { id: 'inv-1', summary: '', suspectedCause: 'OOM after api-cfg edit', recommendedFix: '', confidence: 0.85 }, fixReady: true,
};
const MAINT_ITEM = {
  id: 'inb-disk', title: 'Replace disk on worker-5', status: 'new', severity: 'warning', namespace: null, claimedBy: 'dave', dueDate: Math.floor((now + 110 * 60_000) / 1000), findingId: null,
  correlationKey: 'maintenance::Node/worker-5', investigation: null, fixReady: false,
};
const triageFor = (labels: Record<string, string>) => {
  const base = { alertname: labels.alertname, correlationKey: 'k', resource: null, item: null, related: [] as unknown[], episode: null };
  if (labels.pod) return { ...base, related: [OOM_ITEM] };
  if (labels.node === 'worker-5') return { ...base, related: [MAINT_ITEM] };
  return base;
};

const NODES = { items: [
  { metadata: { name: 'worker-5' }, spec: { unschedulable: true, taints: [{ key: 'node.kubernetes.io/unschedulable', effect: 'NoSchedule', timeAdded: iso(-55 * 60_000) }] }, status: {} },
  { metadata: { name: 'worker-6' }, spec: {}, status: {} },
] };

const PODS_SHOP = { items: [
  { metadata: { name: 'storefront-7c4f9-qd2lm', namespace: 'shop', uid: '1' }, status: { phase: 'Running', containerStatuses: [{ name: 'web', ready: false, restartCount: 0, state: { running: {} } }] } },
  { metadata: { name: 'cart-6b8d5-p4wz2', namespace: 'shop', uid: '2' }, status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: '0/6 nodes are available' }] } },
  { metadata: { name: 'ok-1', namespace: 'shop', uid: '3' }, status: { phase: 'Running', containerStatuses: [{ name: 'web', ready: true, restartCount: 0, state: { running: {} } }] } },
] };

let ALERTS: ReturnType<typeof alert>[] = [];
let triageResponse: (body: any) => Response = (body) => json({ results: body.alerts.map((a: { labels: Record<string, string> }) => triageFor(a.labels)) });

beforeEach(() => {
  h.setup();
  visited.length = 0;
  askPulse.mockClear();
  try { localStorage.clear(); } catch { /* jsdom */ }
  ALERTS = [alert(CRASH), alert(MISMATCH), alert(UNREACH), alert(KUBELET), alert(DISK), alert(OTHER_NODE), alert(QUOTA, 'pending'), ...FILLER];
  triageResponse = (body) => json({ results: body.alerts.map((a: { labels: Record<string, string> }) => triageFor(a.labels)) });
  h.state.handler = (r) => {
    if (r.url.includes('/api/v1/rules')) return json(rules(ALERTS));
    if (r.url.endsWith('/api/alertmanager/api/v2/silences') && r.method === 'GET') return json([]);
    if (r.url.endsWith('/api/alertmanager/api/v2/silences') && r.method === 'POST') return json({ silenceID: 'sil-1' });
    if (r.url.endsWith('/api/agent/inbox/by-alert')) return triageResponse(r.body);
    if (r.path === '/apis/user.openshift.io/v1/users/~') return json({ metadata: { name: 'alice' } });
    if (r.path === '/api/v1/nodes') return json(NODES);
    if (r.path === '/api/v1/namespaces/shop/pods') return json(PODS_SHOP);
    return json({});
  };
});
afterEach(() => { cleanup(); h.teardown(); });

describe('Triage chip', () => {
  it('links a firing alert to the investigated Inbox item for the same pod', async () => {
    renderAt();
    const chip = await screen.findByRole('button', { name: 'Triage: cause found' });
    expect(chip.textContent).toContain('0.85');
    expect(screen.getByText(/OOM after api-cfg edit · fix ready/)).toBeTruthy();
    fireEvent.click(chip);
    expect(visited).toContain('/inbox?task=inb-oom');
    const req = h.state.requests.find((r) => r.url.endsWith('/api/agent/inbox/by-alert'))!;
    expect(req.method).toBe('POST');
    // Only firing alerts are looked up: the monitor makes items from those.
    expect(req.body.alerts.map((a: { labels: Record<string, string> }) => a.labels.alertname)).not.toContain('KubeQuotaAlmostFull');
    expect(screen.getByText('Pending alerts are not triaged until they fire')).toBeTruthy();
  });

  it('a failed Inbox lookup is "Could not check" with Retry, never "not in the Inbox"', async () => {
    triageResponse = () => json({ detail: 'The Inbox could not be read' }, 503);
    renderAt();
    const cells = await screen.findAllByTestId('triage-could-not-check');
    expect(cells[0].textContent).toContain('The Inbox could not be read');
    expect(screen.queryByText('Not in the Inbox')).toBeNull();
    triageResponse = (body) => json({ results: body.alerts.map((a: { labels: Record<string, string> }) => triageFor(a.labels)) });
    fireEvent.click(within(cells[0]).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Triage: cause found' })).toBeTruthy();
  });

  it('an agent without the endpoint hides the chips and says why', async () => {
    triageResponse = () => json({ detail: 'Method Not Allowed' }, 405);
    renderAt();
    expect(await screen.findByTestId('triage-unavailable')).toBeTruthy();
    expect(screen.queryByText(/Checking Inbox/)).toBeNull();
    expect(screen.queryByTestId('triage-could-not-check')).toBeNull();
  });
});

describe('triage batches', () => {
  it('sends at most 200 alerts per request; a failed batch marks only its own rows', async () => {
    ALERTS = Array.from({ length: 201 }, (_, i) => alert({ alertname: 'TargetDown', namespace: `ns-${i}`, job: `j${i}`, severity: 'warning' }));
    triageResponse = (body) => (body.alerts.length === 1 ? json({ detail: 'bad label' }, 400) : json({ results: body.alerts.map((a: { labels: Record<string, string> }) => triageFor(a.labels)) }));
    renderAt();
    await waitFor(() => expect(h.state.requests.filter((r) => r.url.endsWith('/api/agent/inbox/by-alert'))).toHaveLength(2));
    const sizes = h.state.requests.filter((r) => r.url.endsWith('/api/agent/inbox/by-alert')).map((r) => r.body.alerts.length).sort((a, b) => a - b);
    expect(sizes).toEqual([1, 200]);
    await waitFor(() => expect(screen.getAllByTestId('triage-could-not-check')).toHaveLength(1));
    expect(screen.getAllByText('Not in the Inbox')).toHaveLength(200);
  });
});

describe('namespace-only alert', () => {
  it('opens that namespace\'s unhealthy pods, not the whole pod list', async () => {
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: /namespace shop · unhealthy pods/ }));
    const panel = await screen.findByTestId('namespace-unhealthy-pods');
    expect(await within(panel).findByText('storefront-7c4f9-qd2lm')).toBeTruthy();
    expect(within(panel).getByText('cart-6b8d5-p4wz2')).toBeTruthy();
    expect(within(panel).queryByText('ok-1')).toBeNull();
    expect(within(panel).getByText(/2 of 3 pods/)).toBeTruthy();
    expect(panel.textContent).toContain('Opened from KubeDeploymentReplicasMismatch');
    expect(visited).not.toContain('/r/v1~pods');
  });

  it('a refused pod list is an error, not "all healthy"', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.path === '/api/v1/namespaces/shop/pods' ? k8sStatus(403, 'pods is forbidden') : base(r));
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: /namespace shop · unhealthy pods/ }));
    const panel = await screen.findByTestId('namespace-unhealthy-pods');
    expect(await within(panel).findByText(/could not be listed/)).toBeTruthy();
    expect(within(panel).queryByText(/running and ready/)).toBeNull();
  });
});

async function openSuggestedSilence() {
  renderAt();
  const banner = await screen.findByTestId('silence-suggestion');
  expect(within(banner).getByText(/Pulse suggests a silence for worker-5/)).toBeTruthy();
  expect(await within(banner).findByText(/claimed by dave/)).toBeTruthy();
  fireEvent.click(within(banner).getByRole('button', { name: /Review silence/ }));
  return screen.findByRole('dialog');
}

describe('Pulse suggests a silence', () => {
  it('the dialog shows the exact matchers, what it hides and what stays visible, and creates exactly that', async () => {
    const dialog = await openSuggestedSilence();
    expect(within(dialog).getByText('+ node="worker-5"')).toBeTruthy();
    expect(within(dialog).getByText('+ alertname=~"KubeNodeUnreachable|KubeletDown|NodeFilesystemSpaceFillingUp"')).toBeTruthy();
    // Narrow it to the two maintenance alerts; the preview follows.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit matchers' }));
    fireEvent.change(within(dialog).getByLabelText('Matchers'), { target: { value: 'node="worker-5", alertname=~"KubeNodeUnreachable|KubeletDown"' } });
    expect(within(dialog).getByText(/Not hidden: other alerts on worker-5 \(NodeFilesystemSpaceFillingUp\)/)).toBeTruthy();
    expect(within(dialog).getAllByText(/KubeNodeUnreachable|KubeletDown/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/covers the .* due time/)).toBeTruthy();
    expect(within(dialog).getByText('dave')).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: /Create silence for 2 hours/ });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    const w = h.writes()[0];
    expect(w).toMatchObject({ method: 'POST', url: '/api/alertmanager/api/v2/silences' });
    expect(w.body.matchers).toEqual([
      { name: 'node', value: 'worker-5', isRegex: false, isEqual: true },
      { name: 'alertname', value: 'KubeNodeUnreachable|KubeletDown', isRegex: true, isEqual: true },
    ]);
    expect(w.body.createdBy).toBe('alice');
    expect(w.body.comment).toContain('Replace disk on worker-5');
    expect(new Date(w.body.endsAt).getTime() - new Date(w.body.startsAt).getTime()).toBe(120 * 60_000);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The SSAR asked about the object the proxy authorises.
    const ssar = h.fetchMock.mock.calls.map(([u, i]) => [String(u), i as RequestInit]).find(([u]) => u.endsWith(SSAR));
    expect(JSON.parse(String(ssar![1].body)).spec.resourceAttributes).toMatchObject({ verb: 'create', group: 'monitoring.coreos.com', resource: 'alertmanagers', subresource: 'api', name: 'main', namespace: 'openshift-monitoring' });
  });

  it('cancel sends nothing', async () => {
    const dialog = await openSuggestedSilence();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.writes()).toHaveLength(0);
  });

  it('a 403 from Alertmanager stays in the dialog with the role needed', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'POST' && r.url.endsWith('/api/alertmanager/api/v2/silences') ? new Response('Forbidden', { status: 403 }) : base(r));
    const dialog = await openSuggestedSilence();
    const confirm = within(dialog).getByRole('button', { name: /Create silence/ });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    expect(await within(dialog).findByText(/monitoring-alertmanager-edit/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('a 400 from Alertmanager (bad matcher) shows its message', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'POST' && r.url.endsWith('/api/alertmanager/api/v2/silences') ? new Response('invalid label matcher', { status: 400 }) : base(r));
    const dialog = await openSuggestedSilence();
    const confirm = within(dialog).getByRole('button', { name: /Create silence/ });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    expect(await within(dialog).findByText(/invalid label matcher/)).toBeTruthy();
  });

  it('without the role the create button is disabled and says why', async () => {
    h.state.denied.add('create alertmanagers/api');
    const dialog = await openSuggestedSilence();
    expect(await within(dialog).findByText(/cannot create silences/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: /Create silence/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('all-matching matchers or an empty comment cannot be submitted', async () => {
    const dialog = await openSuggestedSilence();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit matchers' }));
    fireEvent.change(within(dialog).getByLabelText('Matchers'), { target: { value: 'alertname=~".*"' } });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/too broad/);
    expect((within(dialog).getByRole('button', { name: /Create silence/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Matchers'), { target: { value: 'node="worker-5"' } });
    fireEvent.change(within(dialog).getByLabelText(/Comment/), { target: { value: '  ' } });
    expect((within(dialog).getByRole('button', { name: /Create silence/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.writes()).toHaveLength(0);
  });

  it('switching to another cluster while it is open takes the dialog away and sends nothing', async () => {
    const dialog = await openSuggestedSilence();
    const confirm = within(dialog).getByRole('button', { name: /Create silence/ });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    act(() => { useFleetStore.setState({ activeClusterId: REMOTE }); });
    // Alerts are the local cluster's only: on a remote cluster the page (and its dialog) is replaced.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.writes()).toHaveLength(0);
  });

  it('when the user lookup fails, nothing can be created and it says so (no typed creator)', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.path === '/apis/user.openshift.io/v1/users/~' ? k8sStatus(403, 'forbidden') : base(r));
    const dialog = await openSuggestedSilence();
    expect((await within(dialog).findByTestId('creator-unknown')).textContent).toContain('Could not confirm who you are; try again.');
    expect(within(dialog).queryByRole('textbox', { name: /Created by/ })).toBeNull();
    expect((within(dialog).getByRole('button', { name: /Create silence/ }) as HTMLButtonElement).disabled).toBe(true);
    // Retry: the lookup answers now.
    h.state.handler = base;
    fireEvent.click(within(within(dialog).getByTestId('creator-unknown')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect((within(dialog).getByRole('button', { name: /Create silence/ }) as HTMLButtonElement).disabled).toBe(false));
    expect(h.writes()).toHaveLength(0);
  });

  it('refuses a silence that would hide too many of the firing alerts, with the reason', async () => {
    const dialog = await openSuggestedSilence();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit matchers' }));
    fireEvent.change(within(dialog).getByLabelText('Matchers'), { target: { value: 'alertname="TargetDown"' } });
    expect(within(dialog).getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/would hide 10 of the 16 alerts firing now/);
    expect((within(dialog).getByRole('button', { name: /Create silence/ }) as HTMLButtonElement).disabled).toBe(true);
    // Edited matchers no longer claim to be "on worker-5".
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).not.toContain('on worker-5');
  });

  it('Undo from the success toast asks before expiring', async () => {
    const { useUIStore } = await import('../../../store/uiStore');
    const dialog = await openSuggestedSilence();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit matchers' }));
    fireEvent.change(within(dialog).getByLabelText('Matchers'), { target: { value: 'node="worker-5", alertname="KubeletDown"' } });
    const confirm = within(dialog).getByRole('button', { name: /Create silence/ });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const toast = useUIStore.getState().toasts.find((t) => t.title?.startsWith('Silence created'))!;
    act(() => { toast.action!.onClick(); });
    const ask = await screen.findByRole('dialog');
    expect(within(ask).getByText('Expire silence?')).toBeTruthy();
    expect(h.writes().filter((w) => w.method === 'DELETE')).toHaveLength(0);
    fireEvent.click(within(ask).getByRole('button', { name: 'Expire' }));
    await waitFor(() => expect(h.writes().some((w) => w.method === 'DELETE' && w.url.endsWith('/silence/sil-1'))).toBe(true));
  });

  it('rows on the node propose the silence; Dismiss hides the suggestion', async () => {
    renderAt();
    expect((await screen.findAllByRole('button', { name: /Pulse proposes 2 hours/ })).length).toBe(3);
    // worker-6 is schedulable: its alert keeps the plain Silence button.
    expect(screen.getAllByRole('button', { name: /^Silence$/ }).length).toBeGreaterThanOrEqual(3);
    fireEvent.click(within(screen.getByTestId('silence-suggestion')).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('silence-suggestion')).toBeNull();
  });
});
