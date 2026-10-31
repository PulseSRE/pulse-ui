// @vitest-environment jsdom
/**
 * Alerts: silences in every state with edit/recreate/expire, Pending and
 * Silenced stats that filter to what they count, a rule detail drawer, and
 * a templated PrometheusRule create.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createHarness, json } from '../../../__tests__/actionHarness';

const visited: string[] = [];
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => (p: string) => visited.push(p) }));
vi.mock('../../../components/metrics/Sparkline', () => ({ MetricCard: () => null }));
const askPulse = vi.fn();
vi.mock('../../../engine/askPulse', () => ({ askPulse: (...a: unknown[]) => askPulse(...a) }));

import AlertsView from '../../AlertsView';

const h = createHarness();
// AlertsView reads its tab from window.location.
function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return h.renderUi(<AlertsView />, path);
}
const now = Date.now();
const iso = (ms: number) => new Date(now + ms).toISOString();

const RULES = {
  status: 'success',
  data: { groups: [{
    name: 'kubernetes-apps',
    file: '/etc/prometheus/rules/x.yaml',
    rules: [
      { type: 'alerting', name: 'KubePodCrashLooping', query: 'max_over_time(kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"}[5m]) >= 1', duration: 900, state: 'firing', health: 'ok',
        labels: { severity: 'warning' }, annotations: { summary: 'Pod is crash looping.' },
        alerts: [
          { labels: { alertname: 'KubePodCrashLooping', namespace: 'shop', pod: 'web-1', severity: 'warning' }, annotations: {}, state: 'firing', activeAt: iso(-600000), value: '1' },
          { labels: { alertname: 'KubePodCrashLooping', namespace: 'shop', pod: 'web-2', severity: 'warning' }, annotations: {}, state: 'pending', activeAt: iso(-60000), value: '1' },
        ] },
      { type: 'alerting', name: 'Watchdog', query: 'vector(1)', duration: 0, state: 'firing', health: 'ok', labels: { severity: 'none' }, annotations: {},
        alerts: [{ labels: { alertname: 'Watchdog', severity: 'none' }, annotations: {}, state: 'firing', activeAt: iso(-1e7), value: '1' }] },
    ],
  }] },
};

const SILENCES = [
  { id: 'act-1', status: { state: 'active' }, matchers: [{ name: 'alertname', value: 'Watchdog', isRegex: false }], startsAt: iso(-3600000), endsAt: iso(3600000), createdBy: 'ops', comment: 'watchdog noise' },
  { id: 'pen-1', status: { state: 'pending' }, matchers: [{ name: 'namespace', value: 'shop', isRegex: false }], startsAt: iso(3600000), endsAt: iso(7200000), createdBy: 'ops', comment: 'maintenance window' },
  { id: 'exp-1', status: { state: 'expired' }, matchers: [{ name: 'alertname', value: 'Old', isRegex: false }], startsAt: iso(-7200000), endsAt: iso(-3600000), createdBy: 'ops', comment: 'old one' },
];

beforeEach(() => {
  h.setup();
  visited.length = 0;
  askPulse.mockClear();
  h.state.handler = (r) => {
    if (r.url.includes('/api/v1/rules')) return json(RULES);
    if (r.url.endsWith('/api/alertmanager/api/v2/silences') && r.method === 'GET') return json(SILENCES);
    if (r.path === '/apis/user.openshift.io/v1/users/~') return json({ metadata: { name: 'alice' } });
    if (r.path === '/apis/monitoring.coreos.com/v1/prometheusrules') return json({ items: [{ metadata: { name: 'kube-apps', namespace: 'openshift-monitoring' }, spec: { groups: [{ name: 'kubernetes-apps', rules: [{ alert: 'KubePodCrashLooping' }] }] } }] });
    return json({});
  };
});
afterEach(() => { cleanup(); h.teardown(); });

describe('Alerts stats filter to what they count', () => {
  it('Pending shows only pending alerts; Silenced only silenced alerts', async () => {
    renderAt('/alerts');
    await screen.findAllByText('KubePodCrashLooping');
    fireEvent.click(screen.getByText('Pending').closest('button')!);
    expect(await screen.findByText('Showing pending alerts only')).toBeTruthy();
    expect(screen.getAllByText('pending').length).toBeGreaterThan(0);
    expect(screen.queryByText('Watchdog')).toBeNull();

    fireEvent.click(screen.getByText('Silenced').closest('button')!);
    expect(await screen.findByText('Showing silenced alerts only')).toBeTruthy();
    expect(screen.getByText('Watchdog')).toBeTruthy(); // silenced by act-1
    expect(screen.queryByText('KubePodCrashLooping')).toBeNull();
  });
});

describe('Silences', () => {
  it('lists active, pending and expired silences separately', async () => {
    renderAt('/alerts?tab=silences');
    expect(await screen.findByText('watchdog noise')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /pending \(1\)/ }));
    expect(await screen.findByText('maintenance window')).toBeTruthy();
    expect(screen.getByText(/Starts:/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /expired \(1\)/ }));
    expect(await screen.findByText('old one')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Expire silence old one/ })).toBeNull();
  });

  it('editing an active silence POSTs it with its id after a confirmation', async () => {
    renderAt('/alerts?tab=silences');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit silence watchdog noise' }));
    expect(screen.getByText('Edit Silence')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update Silence' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Replaces the existing silence on Alertmanager that mutes every alert matching alertname="Watchdog"/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0]).toMatchObject({ method: 'POST', url: '/api/alertmanager/api/v2/silences' });
    expect(h.writes()[0].body).toMatchObject({ id: 'act-1', matchers: [{ name: 'alertname', value: 'Watchdog', isRegex: false }], comment: 'watchdog noise', createdBy: 'alice' });
  });

  it('recreating an expired silence creates a new one (no id) once a duration is chosen', async () => {
    renderAt('/alerts?tab=silences');
    fireEvent.click(await screen.findByRole('tab', { name: /expired/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Recreate silence old one' }));
    fireEvent.click(screen.getByRole('button', { name: '2h' }));
    // The header button opens a blank form; the form's own submit is the last "Create Silence".
    const submits = screen.getAllByRole('button', { name: 'Create Silence' });
    fireEvent.click(submits[submits.length - 1]);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0].body.id).toBeUndefined();
    expect(h.writes()[0].body.matchers).toEqual([{ name: 'alertname', value: 'Old', isRegex: false }]);
  });

  it('expire sends DELETE for that silence; a refusal stays in the dialog', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'DELETE' ? new Response('silence not found', { status: 404 }) : base(r));
    renderAt('/alerts?tab=silences');
    fireEvent.click(await screen.findByRole('button', { name: 'Expire silence watchdog noise' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Ends the silence "watchdog noise" now \(alertname="Watchdog"\)/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Expire' }));
    expect(await within(dialog).findByText('silence not found')).toBeTruthy();
    expect(h.writes()[0]).toMatchObject({ method: 'DELETE', url: '/api/alertmanager/api/v2/silence/act-1' });
  });

  it('Silence on an alert row opens the form prefilled from its labels', async () => {
    renderAt('/alerts');
    const silenceButtons = await screen.findAllByRole('button', { name: /^Silence$/ });
    fireEvent.click(silenceButtons[0]);
    expect(await screen.findByText('New Silence')).toBeTruthy();
    const values = screen.getAllByPlaceholderText('Value').map((i) => (i as HTMLInputElement).value);
    expect(values).toContain('KubePodCrashLooping');
  });
});

describe('Rule detail', () => {
  it('opens a drawer with expression, labels, annotations, the defining PrometheusRule and Investigate', async () => {
    renderAt('/alerts?tab=rules');
    fireEvent.click(await screen.findByRole('button', { name: 'Rule KubePodCrashLooping' }));
    const drawer = await screen.findByRole('dialog', { name: 'KubePodCrashLooping' });
    expect(within(drawer).getByLabelText('Rule expression').textContent).toContain('CrashLoopBackOff');
    expect(within(drawer).getByText('Pod is crash looping.')).toBeTruthy();
    expect(within(drawer).getByText(/fires after 15m/)).toBeTruthy();
    fireEvent.click(await within(drawer).findByRole('button', { name: /Edit rule YAML/ }));
    expect(visited).toContain('/yaml/monitoring.coreos.com~v1~prometheusrules/openshift-monitoring/kube-apps');
    fireEvent.click(within(drawer).getByRole('button', { name: /Investigate with Pulse/ }));
    expect(askPulse.mock.calls[0][0]).toMatch(/Investigate the alert rule KubePodCrashLooping/);
  });

  it('says when no PrometheusRule defines the rule', async () => {
    renderAt('/alerts?tab=rules');
    fireEvent.click(await screen.findByRole('button', { name: 'Rule Watchdog' }));
    expect(await screen.findByText(/No PrometheusRule object defines this rule/)).toBeTruthy();
  });

  it('Create alert rule opens the YAML create flow with the PrometheusRule template', async () => {
    renderAt('/alerts?tab=rules');
    fireEvent.click(await screen.findByRole('button', { name: /Create alert rule/ }));
    expect(visited).toEqual(['/create/monitoring.coreos.com~v1~prometheusrules?template=prometheus-rule&namespace=default']);
  });
});
