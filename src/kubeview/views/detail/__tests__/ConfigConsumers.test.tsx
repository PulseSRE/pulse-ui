// @vitest-environment jsdom
/**
 * ConfigMap/Secret "Used by" and "Restart consumers", asserted on what the
 * user sees and the exact requests: how each consumer uses the object, a
 * failed read named as "Could not check" (never as "no consumers"), Secret
 * values never shown, and the restart confirm — order, dry run, sequential
 * patches, stop on first failure, RBAC, cancel, and the pinned cluster.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createHarness, json, k8sStatus, REMOTE, type Recorded } from '../../../__tests__/actionHarness';
import { KindSections } from '../KindSections';
import { RestartConsumersDialog } from '../RestartConsumersDialog';
import { findConsumers } from '../../../engine/configConsumers';
import type { K8sResource } from '../../../engine/renderers';

const h = createHarness();
const go = vi.fn();
const NS = '/apis/apps/v1/namespaces/payments';
const EDIT = '2026-11-02T13:58:00Z';

const cm = {
  apiVersion: 'v1', kind: 'ConfigMap',
  metadata: { name: 'api-cfg', namespace: 'payments', managedFields: [{ time: EDIT, operation: 'Update' }] },
  data: { CACHE_SIZE: '100000' },
} as unknown as K8sResource;

const dep = (name: string, containers: object[], volumes: object[] = []) => ({
  apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name, namespace: 'payments', generation: 3, resourceVersion: '7' },
  spec: { replicas: 1, selector: { matchLabels: { app: name } }, template: { metadata: { labels: { app: name } }, spec: { containers, volumes } } },
  status: { observedGeneration: 3, updatedReplicas: 1, availableReplicas: 1, replicas: 1 },
});
const api = dep('api', [{ name: 'api', env: [{ name: 'CACHE_SIZE', valueFrom: { configMapKeyRef: { name: 'api-cfg', key: 'CACHE_SIZE' } } }] }]);
const worker = dep('worker', [{ name: 'w', envFrom: [{ configMapRef: { name: 'api-cfg' } }] }]);
const sync = dep('pricing-sync', [{ name: 's', volumeMounts: [{ name: 'c', mountPath: '/etc/api-cfg' }] }], [{ name: 'c', configMap: { name: 'api-cfg' } }]);

function lists(over: (r: Recorded) => Response | undefined = () => undefined) {
  h.state.handler = (r) => {
    const o = over(r);
    if (o) return o;
    // Not an OpenShift cluster: DeploymentConfigs are not served.
    if (r.method === 'GET' && r.path.endsWith('/deploymentconfigs')) return k8sStatus(404, 'the server could not find the requested resource');
    if (r.method === 'GET' && r.path === `${NS}/deployments`) return json({ kind: 'DeploymentList', items: [api, worker, sync] });
    if (r.method === 'GET' && r.path === '/api/v1/namespaces/payments/pods') {
      return json({ items: [
        { metadata: { name: 'worker-1', labels: { app: 'worker' } }, status: { phase: 'Running', startTime: '2026-10-30T09:00:00Z' } },
        { metadata: { name: 'api-1', labels: { app: 'api' } }, status: { phase: 'Running', startTime: '2026-11-02T14:01:00Z' } },
      ] });
    }
    if (r.method === 'GET' && r.path === '/api/v1/namespaces/payments/services') return json({ items: [{ metadata: { name: 'api' }, spec: { selector: { app: 'api' } } }] });
    if (r.method === 'GET' && /\/deployments\/(api|worker)$/.test(r.path)) return json(r.path.endsWith('api') ? api : worker);
    return undefined;
  };
}

beforeEach(() => { h.setup(); lists(); });
afterEach(() => { cleanup(); h.teardown(); go.mockReset(); });

describe('Used by', () => {
  it('says per consumer how it uses the ConfigMap and when it picks up a change', async () => {
    h.renderUi(<KindSections resource={cm} go={go} />);
    const table = await screen.findByRole('table', { name: 'Workloads that use api-cfg' });
    const row = (n: string) => within(table).getByRole('button', { name: n }).closest('tr')!;
    await waitFor(() => expect(within(row('worker')).getByText(/1 of 1 on old values/)).toBeTruthy());
    expect(within(row('api')).getByText(/env CACHE_SIZE in api from key CACHE_SIZE via configMapKeyRef/)).toBeTruthy();
    expect(within(row('api')).getByText('Only after a restart')).toBeTruthy();
    expect(within(row('api')).getByText('1 on current values')).toBeTruthy();
    expect(within(row('worker')).getByText(/envFrom: all keys/)).toBeTruthy();
    expect(within(row('pricing-sync')).getByText('File updates in about 60s')).toBeTruthy();
    expect(within(row('pricing-sync')).getByText('Could not check if the app reloads it')).toBeTruthy();
    // DeploymentConfigs are not served here: not named as scanned, and not a failure.
    expect(screen.getByTestId('consumers-scope').textContent).toMatch(/Scanned 3 pod templates in payments \(Deployments, StatefulSets, DaemonSets, CronJobs, Jobs\)\. Not checked: bare Pods, ReplicationControllers, Ingress\/Route TLS/);
    expect(screen.queryByText(/Could not check DeploymentConfigs/)).toBeNull();
    fireEvent.click(within(table).getByRole('button', { name: 'worker' }));
    expect(go).toHaveBeenCalledWith('/r/apps~v1~deployments/payments/worker', 'worker');
  });

  it.each([403, 500])('a %s on one kind is "Could not check", and the list is not called complete', async (status) => {
    lists((r) => (r.path === `${NS}/statefulsets` ? k8sStatus(status, 'statefulsets.apps is forbidden') : undefined));
    h.renderUi(<KindSections resource={cm} go={go} />);
    expect(await screen.findByText('Could not check StatefulSets: this list may be incomplete')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'api' })).toBeTruthy();
    expect(screen.getByTestId('consumers-scope').textContent).not.toMatch(/StatefulSets/);
  });

  it('with every read failing it never says "no workload references it"', async () => {
    lists((r) => (r.method === 'GET' && /\/(deployments|statefulsets|daemonsets|cronjobs|jobs)$/.test(r.path) ? k8sStatus(403, 'forbidden') : undefined));
    h.renderUi(<KindSections resource={cm} go={go} />);
    expect(await screen.findByText(/No consumer found among the kinds that could be read/)).toBeTruthy();
    expect(screen.queryByText(/No workload in payments references/)).toBeNull();
    expect((screen.getByRole('button', { name: /Restart consumers/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a Secret: key names only, never a value', async () => {
    const secret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'db', namespace: 'payments' }, data: { password: btoa('hunter2') } } as unknown as K8sResource;
    const user = dep('api', [{ name: 'api', env: [{ name: 'DB_PASSWORD', valueFrom: { secretKeyRef: { name: 'db', key: 'password' } } }] }]);
    lists((r) => (r.path === `${NS}/deployments` ? json({ items: [user] }) : undefined));
    const { container } = h.renderUi(<KindSections resource={secret} go={go} />);
    expect(await screen.findByText(/env DB_PASSWORD in api from key password via secretKeyRef/)).toBeTruthy();
    expect(screen.getByText(/values are never read here/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/hunter2|aHVudGVyMg/);
  });

  it('the empty state names what was and was not checked', async () => {
    lists((r) => (r.path === `${NS}/deployments` ? json({ items: [] }) : undefined));
    h.renderUi(<KindSections resource={cm} go={go} />);
    expect(await screen.findByText(/No Deployments, StatefulSets, DaemonSets, CronJobs, Jobs in payments references this ConfigMap\. Not checked: bare Pods, ReplicationControllers, Ingress\/Route TLS, custom resources and operators, other namespaces\./)).toBeTruthy();
  });

  it('a Secret: a ServiceAccount pull secret makes its workloads consumers; an unreadable ServiceAccount list is "Could not check"', async () => {
    const secret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'quay-pull', namespace: 'payments' } } as unknown as K8sResource;
    lists((r) => (r.path === '/api/v1/namespaces/payments/serviceaccounts' ? json({ items: [{ metadata: { name: 'default' }, imagePullSecrets: [{ name: 'quay-pull' }] }] }) : undefined));
    h.renderUi(<KindSections resource={secret} go={go} />);
    expect((await screen.findAllByText('image pull secret of its ServiceAccount default')).length).toBe(3);
    cleanup();
    lists((r) => (r.path === '/api/v1/namespaces/payments/serviceaccounts' ? k8sStatus(403, 'serviceaccounts is forbidden') : undefined));
    h.renderUi(<KindSections resource={secret} go={go} />);
    expect(await screen.findByText(/Could not check ServiceAccounts \(their image pull secrets\): this list may be incomplete/)).toBeTruthy();
  });

  it('opens the restart confirm with only the consumers that need a restart', async () => {
    h.renderUi(<KindSections resource={cm} go={go} />);
    await screen.findByRole('button', { name: 'api' });
    fireEvent.click(screen.getByRole('button', { name: /Restart consumers/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Restart the 2 consumers of api-cfg?' });
    expect(within(dialog).queryByText('pricing-sync')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(h.writes().filter((w) => !w.path.includes('dryRun'))).toEqual([]);
  });
});

function renderRestart() {
  const consumers = findConsumers('ConfigMap', 'api-cfg', [api, worker] as unknown as K8sResource[]);
  return h.renderUi(<RestartConsumersDialog configKind="ConfigMap" configName="api-cfg" namespace="payments" consumers={consumers} onClose={() => {}} pollMs={1} />);
}
const realWrites = () => h.writes().filter((w) => !w.path.includes('dryRun'));

describe('Restart consumers', () => {
  it('dry-runs every patch, then restarts non-serving first and traffic-serving last, one at a time', async () => {
    renderRestart();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('restart-dry-run').textContent).toBe('Passed for all 2'));
    const rows = within(dialog).getAllByTestId(/restart-row-/).map((r) => r.getAttribute('data-testid'));
    expect(rows).toEqual(['restart-row-worker', 'restart-row-api']);
    expect(within(dialog).getByText(/serves traffic via api, last/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restart 2 Deployments' }));
    await waitFor(() => expect(within(dialog).getByTestId('restart-step-api').textContent).toMatch(/Done/));
    expect(h.writes().map((w) => `${w.method} ${w.path}`)).toEqual([
      `PATCH ${NS}/deployments/worker?dryRun=All`,
      `PATCH ${NS}/deployments/api?dryRun=All`,
      `PATCH ${NS}/deployments/worker`,
      `PATCH ${NS}/deployments/api`,
    ]);
    const patch = realWrites()[0];
    expect(patch.headers['Content-Type']).toBe('application/strategic-merge-patch+json');
    expect(Object.keys(patch.body.spec.template.metadata.annotations)).toEqual(['kubectl.kubernetes.io/restartedAt']);
    // The worker's rollout was read back before api was patched.
    const order = h.state.requests.map((r) => `${r.method} ${r.path}`);
    expect(order.indexOf(`GET ${NS}/deployments/worker`)).toBeLessThan(order.indexOf(`PATCH ${NS}/deployments/api`));
    expect(within(dialog).getByText('All restarts finished.')).toBeTruthy();
  });

  it('a failed dry run blocks the restart and nothing is written', async () => {
    lists((r) => (r.path === `${NS}/deployments/api?dryRun=All` ? k8sStatus(422, 'admission webhook denied the request') : undefined));
    renderRestart();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('restart-dry-run').textContent).toMatch(/Failed: api: admission webhook denied the request\. Nothing will be restarted/));
    expect((within(dialog).getByRole('button', { name: 'Restart 2 Deployments' }) as HTMLButtonElement).disabled).toBe(true);
    expect(realWrites()).toEqual([]);
  });

  it.each([
    [403, 'Permission denied'],
    [409, 'The object changed since this page loaded it'],
  ])('a %s on a restart stops the run; the rest are not restarted', async (status, text) => {
    lists((r) => (r.method === 'PATCH' && r.path === `${NS}/deployments/worker` ? k8sStatus(status, 'nope') : undefined));
    renderRestart();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('restart-dry-run').textContent).toBe('Passed for all 2'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restart 2 Deployments' }));
    await waitFor(() => expect(within(dialog).getByTestId('restart-step-worker').textContent).toMatch(new RegExp(`Restart failed: ${text}`)));
    expect(within(dialog).getByTestId('restart-step-api').textContent).toMatch(/Not restarted: an earlier restart failed/);
    expect(realWrites().map((w) => w.path)).toEqual([`${NS}/deployments/worker`]);
  });

  it('without permission to patch Deployments, nothing can be restarted and it says why', async () => {
    h.state.denied.add('patch deployments');
    renderRestart();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByText(/Not restarted: You do not have permission to patch deployments in payments/)).toHaveLength(2));
    expect((within(dialog).getByRole('button', { name: /Restart 0/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.writes()).toEqual([]);
  });

  it('refuses when the active cluster changed after it opened', async () => {
    renderRestart();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('restart-dry-run').textContent).toBe('Passed for all 2'));
    h.setActive(REMOTE);
    // Permission answers are re-read for the newly active cluster; the write is still refused.
    const btn = within(dialog).getByRole('button', { name: 'Restart 2 Deployments' }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    expect(await within(dialog).findByText(/was not run: it was prepared on/)).toBeTruthy();
    expect(realWrites()).toEqual([]);
  });

  it('closing the dialog mid-run stops it: the next workload is not restarted', async () => {
    // worker's rollout never finishes, so the run is waiting on it when the dialog closes.
    lists((r) => (r.method === 'GET' && r.path === `${NS}/deployments/worker` ? json({ ...worker, status: { observedGeneration: 3, updatedReplicas: 0, availableReplicas: 1, replicas: 2 } }) : undefined));
    const { unmount } = renderRestart();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('restart-dry-run').textContent).toBe('Passed for all 2'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restart 2 Deployments' }));
    await waitFor(() => expect(h.state.requests.some((r) => r.method === 'GET' && r.path === `${NS}/deployments/worker`)).toBe(true));
    unmount();
    const gets = h.state.requests.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(realWrites().map((w) => w.path)).toEqual([`${NS}/deployments/worker`]);
    // Polling stopped too.
    expect(h.state.requests.length - gets).toBeLessThanOrEqual(1);
  });

  it('a PDB the rollout can break needs an explicit acknowledgement', async () => {
    lists((r) => (r.path.endsWith('/poddisruptionbudgets') ? json({ items: [{ metadata: { name: 'api-pdb' }, spec: { selector: { matchLabels: { app: 'api' } }, minAvailable: 2 } }] }) : undefined));
    renderRestart();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('restart-dry-run').textContent).toBe('Passed for all 2'));
    const btn = within(dialog).getByRole('button', { name: 'Restart 2 Deployments' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /I understand and want to restart anyway/ }));
    expect(btn.disabled).toBe(false);
  });

  it('PDB and quota reads that fail are "Could not check", not a pass', async () => {
    lists((r) => (r.path.endsWith('/poddisruptionbudgets') || r.path.endsWith('/resourcequotas') ? k8sStatus(403, 'forbidden') : undefined));
    renderRestart();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('restart-quota').textContent).toBe('Could not check'));
    expect(within(within(dialog).getByTestId('restart-row-api')).getByText('Could not check')).toBeTruthy();
  });
});
