// @vitest-environment jsdom
/**
 * Deploy an app (Wave 15): one form, a dry run of every object, create in
 * dependency order with per-object results and a stop on the first failure,
 * then rollout and Route admission. Secrets are referenced by name and read
 * as metadata only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createHarness, clickWhenEnabled, json, k8sStatus, REMOTE, type Recorded } from '../../../__tests__/actionHarness';
import type { ResourceRegistry, ResourceType } from '../../../engine/discovery';

const discovery: { registry: ResourceRegistry | null } = { registry: null };
vi.mock('../../../hooks/useDiscovery', () => ({ useDiscovery: () => ({ resourceRegistry: discovery.registry, isLoading: false, error: null, apiGroups: [], refresh: () => undefined }) }));
vi.mock('../../../components/DeployProgress', () => ({ default: ({ name }: { name: string }) => <div data-testid="rollout">{name}</div> }));
const asked: Array<{ prompt: string }> = [];
vi.mock('../../../engine/askPulse', () => ({ askPulse: (prompt: string) => { asked.push({ prompt }); } }));

import { QuickDeployTab } from '../QuickDeployTab';
import { METADATA_LIST, METADATA_ONLY } from '../deployRunner';

// The form is large: filling every section takes a few seconds under jsdom on a loaded runner.
vi.setConfig({ testTimeout: 30_000 });

const h = createHarness();

function registry(groups: Array<[string, string]>): ResourceRegistry {
  return new Map(groups.map(([group, plural]) => [`${group}/${plural}`, { group, version: 'v1', plural, kind: plural, namespaced: true, verbs: [], shortNames: [] } as unknown as ResourceType]));
}
const OPENSHIFT = registry([['route.openshift.io', 'routes'], ['build.openshift.io', 'buildconfigs'], ['image.openshift.io', 'imagestreams'], ['apps', 'deployments']]);

let dryRun: (r: Recorded) => Response | undefined;
let create: (r: Recorded) => Response | undefined;
let quotas: Response | (() => Response);

beforeEach(() => {
  h.setup();
  asked.length = 0;
  discovery.registry = OPENSHIFT;
  dryRun = () => undefined;
  create = () => undefined;
  quotas = () => json({ items: [] });
  h.state.handler = (r) => {
    if (r.method === 'GET' && r.path === '/api/v1/namespaces') return json({ items: [{ metadata: { name: 'team-a' } }] });
    if (r.method === 'GET' && r.path.endsWith('/resourcequotas')) return typeof quotas === 'function' ? quotas() : quotas;
    if (r.method === 'GET' && r.path === '/apis/storage.k8s.io/v1/storageclasses') {
      return json({ items: [{ metadata: { name: 'gp3-csi', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } }, volumeBindingMode: 'WaitForFirstConsumer' }, { metadata: { name: 'efs-sc' } }] });
    }
    if (r.method === 'GET' && r.path === '/api/v1/namespaces/team-a/configmaps') return json({ items: [{ metadata: { name: 'api-cfg' } }] });
    if (r.method === 'GET' && r.path.startsWith('/api/v1/namespaces/team-a/secrets')) {
      if (r.path.includes('/secrets/')) return json({ metadata: { name: r.path.split('/').pop() } });
      return json({ items: [{ metadata: { name: 'api-db' } }, { metadata: { name: 'acme-quay' } }] });
    }
    if (r.method === 'GET' && r.path.startsWith('/api/v1/namespaces/team-a/configmaps/')) return json({ metadata: { name: 'api-cfg' } });
    if (r.method === 'GET' && r.path.startsWith('/apis/route.openshift.io/v1/routes?')) return json({ items: [] });
    if (r.method === 'GET' && r.path === '/apis/route.openshift.io/v1/namespaces/team-a/routes/api') {
      return json({ spec: { host: 'api.apps.example.com', tls: { termination: 'edge' } }, status: { ingress: [{ host: 'api.apps.example.com', conditions: [{ type: 'Admitted', status: 'True' }] }] } });
    }
    if (r.method === 'POST' && r.path.includes('dryRun=All')) return dryRun(r) ?? json(r.body, 201);
    if (r.method === 'POST') return create(r) ?? json({ ...r.body, metadata: { ...r.body.metadata, uid: `uid-${r.body.kind}` } }, 201);
    if (r.method === 'DELETE') return json({});
    return json({ items: [] });
  };
});
afterEach(() => { cleanup(); h.teardown(); });

const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}\\*?$`));
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });

async function fillBasics(opts: { replicas?: string } = {}) {
  h.renderUi(<QuickDeployTab />);
  type('Image', 'quay.io/acme/api:1.4');
  type('Name', 'api');
  fireEvent.change(await screen.findByRole('combobox', { name: 'Namespace' }), { target: { value: 'team-a' } });
  type('Container port', '8080');
  type('Replicas', opts.replicas ?? '2');
}

async function fillFull() {
  await fillBasics();
  fireEvent.click(screen.getByRole('button', { name: 'Add from ConfigMap' }));
  fireEvent.change(await screen.findByRole('combobox', { name: 'ConfigMap' }), { target: { value: 'api-cfg' } });
  await waitFor(() => expect(within(screen.getByRole('combobox', { name: 'ConfigMap' })).getByText('api-cfg')).toBeTruthy());
  fireEvent.change(screen.getByRole('combobox', { name: 'ConfigMap' }), { target: { value: 'api-cfg' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add from Secret' }));
  const secretSelect = await screen.findByRole('combobox', { name: 'Secret' });
  await waitFor(() => expect(within(secretSelect).getByText('api-db')).toBeTruthy());
  fireEvent.change(secretSelect, { target: { value: 'api-db' } });
  fireEvent.change(within(screen.getByTestId('env-1')).getByRole('combobox', { name: 'Use' }), { target: { value: 'key' } });
  fireEvent.change(within(screen.getByTestId('env-1')).getByLabelText(/^Key\*?$/), { target: { value: 'password' } });
  fireEvent.change(within(screen.getByTestId('env-1')).getByLabelText(/^Variable\ name\*?$/), { target: { value: 'DB_PASSWORD' } });
  fireEvent.click(screen.getByLabelText('New PVC'));
  type('Size', '10Gi');
  type('Mount path', '/data');
  type('Hostname', 'api.apps.example.com');
}

async function openDryRun() {
  await clickWhenEnabled('Dry run');
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('Dry run results, in create order');
  return dialog;
}

describe('Deploy an app form (DeployApp)', () => {
  it('lists what it creates, with a PDB for more than one replica and the config it uses', async () => {
    await fillFull();
    const plan = screen.getByTestId('deploy-plan').textContent!;
    expect(plan).toMatch(/PersistentVolumeClaim\/data-api.*10Gi default storage class · ReadWriteOnce/);
    expect(plan).toMatch(/Deployment\/api.*2 replicas · 2 probes · env from api-cfg, api-db · mounts data-api at \/data/);
    expect(plan).toMatch(/PodDisruptionBudget\/api.*minAvailable 1 · added because replicas > 1/);
    expect(plan).toMatch(/Service\/api.*8080 → 8080/);
    expect(plan).toMatch(/Route\/api.*api\.apps\.example\.com · edge TLS · redirect/);
    expect(plan).toMatch(/Uses existing ConfigMap api-cfg, Secret api-db/);
    expect(screen.getByText(/ReadWriteOnce with 2 replicas: all pods must run on one node/)).toBeTruthy();
  });

  it('reads Secrets as metadata only, so no Secret value reaches the browser', async () => {
    await fillFull();
    await openDryRun();
    const secretReads = h.state.requests.filter((r) => r.method === 'GET' && r.path.includes('/secrets'));
    expect(secretReads.length).toBeGreaterThan(0);
    for (const r of secretReads) expect([METADATA_LIST, METADATA_ONLY]).toContain(r.headers.Accept);
  });

  it('shows quota headroom, says when a quota needs a value the form leaves empty, and says when quota cannot be read', async () => {
    quotas = () => json({ items: [{ metadata: { name: 'team-quota' }, status: { hard: { 'requests.memory': '8Gi', 'limits.cpu': '4' }, used: { 'requests.memory': '7Gi', 'limits.cpu': '1' } } }] });
    await fillBasics();
    type('Memory request', '512Mi');
    const q = await screen.findByTestId('quota-headroom');
    await waitFor(() => expect(q.textContent).toMatch(/requests\.memory 8\.0 Gi of 8\.0 Gi after deploy/));
    expect(q.textContent).toMatch(/The quota limits limits\.cpu, so every pod must set it/);
    expect(q.textContent).toMatch(/Fits, but the next rollout \(one extra pod\) would exceed requests\.memory/);
    cleanup();
    quotas = () => k8sStatus(403, 'forbidden');
    await fillBasics();
    expect((await screen.findByTestId('quota-headroom')).textContent).toBe("Quota: Could not check — you can't read ResourceQuota in team-a.");
  });

  it('hides Git with the reason when the cluster does not serve builds; with builds it creates ImageStream, BuildConfig and a triggered Deployment', async () => {
    discovery.registry = registry([['route.openshift.io', 'routes']]);
    h.renderUi(<QuickDeployTab />);
    expect(screen.getByTestId('git-unavailable').textContent).toMatch(/does not serve build\.openshift\.io/);
    expect((screen.getByLabelText(/Git repository \(build/) as HTMLInputElement).disabled).toBe(true);
    cleanup();

    discovery.registry = OPENSHIFT;
    h.renderUi(<QuickDeployTab />);
    fireEvent.click(screen.getByLabelText(/Git repository \(build/));
    type('Git repository', 'https://github.com/acme/api.git');
    type('Builder image', 'nodejs:20-ubi9');
    type('Name', 'api');
    fireEvent.change(await screen.findByRole('combobox', { name: 'Namespace' }), { target: { value: 'team-a' } });
    type('Container port', '8080');
    expect(screen.getByTestId('deploy-plan').textContent).toMatch(/ImageStream\/api.*BuildConfig\/api.*builds https:\/\/github\.com\/acme\/api\.git with nodejs:20-ubi9.*Deployment\/api/);
    const dialog = await openDryRun();
    fireEvent.click(within(dialog).getByLabelText(/I have read the \d+ items? Pulse could not check/));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Create 5 objects/ }));
    await waitFor(() => expect(h.writes().filter((w) => !w.path.includes('dryRun')).length).toBe(5));
    const dep = h.writes().find((w) => w.path === '/apis/apps/v1/namespaces/team-a/deployments')!.body;
    expect(JSON.parse(dep.metadata.annotations['image.openshift.io/triggers'])).toEqual([{ from: { kind: 'ImageStreamTag', name: 'api:latest' }, fieldPath: 'spec.template.spec.containers[?(@.name=="api")].image' }]);
    const bc = h.writes().find((w) => w.path === '/apis/build.openshift.io/v1/namespaces/team-a/buildconfigs')!.body;
    expect(bc.spec.strategy.sourceStrategy.from).toEqual({ kind: 'ImageStreamTag', namespace: 'openshift', name: 'nodejs:20-ubi9' });
  });

  it('without a Route API the Route is not offered and not created', async () => {
    discovery.registry = registry([['apps', 'deployments']]);
    await fillBasics({ replicas: '1' });
    expect(screen.getByText(/does not serve route\.openshift\.io, so no Route can be created/)).toBeTruthy();
    expect(screen.getByTestId('deploy-plan').textContent).not.toMatch(/Route\//);
  });

  it('disables Dry run with the reason when you cannot create Deployments (RBAC)', async () => {
    h.state.denied.add('create deployments');
    await fillBasics();
    await waitFor(() => expect(screen.getByText('You do not have permission to create Deployments in team-a.')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Dry run' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Ask Pulse sends the form as context on the local cluster, and is off on a remote one', async () => {
    await fillBasics();
    fireEvent.change(screen.getByLabelText('Question for Pulse'), { target: { value: 'Are 2 replicas enough?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(asked[0].prompt).toMatch(/Are 2 replicas enough\?[\s\S]*kind: Deployment[\s\S]*name: api/);
    cleanup();
    h.setActive(REMOTE);
    h.renderUi(<QuickDeployTab />);
    expect(screen.getByTestId('deploy-ask-note').textContent).toBe('Pulse AI answers about the local cluster only.');
    expect((screen.getByLabelText('Question for Pulse') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('Dry run and create (DeployDryRun)', () => {
  it('dry-runs every object in create order, then creates them in that order and reports rollout and Route admission', async () => {
    await fillFull();
    const dialog = await openDryRun();
    const dry = h.writes().filter((w) => w.path.includes('dryRun=All')).map((w) => w.path);
    expect(dry.sort()).toEqual([
      '/api/v1/namespaces/team-a/persistentvolumeclaims?dryRun=All',
      '/api/v1/namespaces/team-a/services?dryRun=All',
      '/apis/apps/v1/namespaces/team-a/deployments?dryRun=All',
      '/apis/policy/v1/namespaces/team-a/poddisruptionbudgets?dryRun=All',
      '/apis/route.openshift.io/v1/namespaces/team-a/routes?dryRun=All',
    ]);
    expect(h.writes().every((w) => w.path.includes('dryRun=All'))).toBe(true);
    expect(within(dialog).getByTestId('result-Deployment').textContent).toMatch(/Would create.*Deployment\/api/);
    const checks = within(dialog).getByTestId('extra-checks').textContent!;
    expect(checks).toMatch(/Passed ConfigMap api-cfg exists in team-a/);
    expect(checks).toMatch(/Passed Secret api-db exists in team-a/);
    expect(checks).toMatch(/Warning ReadWriteOnce volume with 2 replicas/);
    expect(checks).toMatch(/Could not check Volume binding: the default storage class binds when the first pod is scheduled/);
    expect(checks).toMatch(/Passed No other Route uses api\.apps\.example\.com/);
    expect(dialog.textContent).toMatch(/Undo.*Delete app api: removes these 5 objects; the PVC is kept unless you choose/);

    fireEvent.click(within(dialog).getByLabelText(/I have read the \d+ items? Pulse could not check/));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 5 objects' }));
    await within(dialog).findByTestId('rollout');
    const created = h.writes().filter((w) => !w.path.includes('dryRun')).map((w) => w.path);
    expect(created).toEqual([
      '/api/v1/namespaces/team-a/persistentvolumeclaims',
      '/apis/apps/v1/namespaces/team-a/deployments',
      '/apis/policy/v1/namespaces/team-a/poddisruptionbudgets',
      '/api/v1/namespaces/team-a/services',
      '/apis/route.openshift.io/v1/namespaces/team-a/routes',
    ]);
    const dep = h.writes().find((w) => w.path === '/apis/apps/v1/namespaces/team-a/deployments')!.body;
    const c = dep.spec.template.spec.containers[0];
    expect(c.envFrom).toEqual([{ configMapRef: { name: 'api-cfg' } }]);
    expect(c.env).toEqual([{ name: 'DB_PASSWORD', valueFrom: { secretKeyRef: { name: 'api-db', key: 'password' } } }]);
    expect(c.readinessProbe).toEqual({ httpGet: { path: '/', port: 8080 }, periodSeconds: 10, timeoutSeconds: 2, failureThreshold: 3 });
    expect(c.startupProbe).toBeUndefined();
    expect(dep.spec.template.spec.volumes).toEqual([{ name: 'data', persistentVolumeClaim: { claimName: 'data-api' } }]);
    const route = h.writes().find((w) => w.path === '/apis/route.openshift.io/v1/namespaces/team-a/routes')!.body;
    expect(route.spec).toEqual({ host: 'api.apps.example.com', to: { kind: 'Service', name: 'api' }, port: { targetPort: '8080-tcp' }, tls: { termination: 'edge', insecureEdgeTerminationPolicy: 'Redirect' } });
    const status = await within(dialog).findByTestId('route-status');
    await waitFor(() => expect(status.textContent).toMatch(/Route admitted by the router · https:\/\/api\.apps\.example\.com/));
    expect(status.textContent).toMatch(/Route answers: not checked/);
  });

  it('a dry-run rejection and a claimed hostname are "would fail" and keep Create off', async () => {
    dryRun = (r) => (r.path.includes('/routes?') ? k8sStatus(422, 'Route.route.openshift.io "api" is invalid: spec.host: Invalid value') : undefined);
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'GET' && r.path.startsWith('/apis/route.openshift.io/v1/routes?')
      ? json({ items: [{ metadata: { name: 'api', namespace: 'shop' } }] }) : base(r));
    await fillFull();
    const dialog = await openDryRun();
    expect(within(dialog).getByTestId('result-Route').textContent).toMatch(/Would fail.*spec\.host: Invalid value/);
    expect(within(dialog).getByTestId('extra-checks').textContent).toMatch(/Would fail Host api\.apps\.example\.com is already claimed by Route api in namespace shop \(HostAlreadyClaimed\)/);
    expect((within(dialog).getByRole('button', { name: 'Create 5 objects' }) as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.textContent).toMatch(/Create turns on when every object passes/);
    // Back to form sends nothing more.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to form' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.writes().filter((w) => !w.path.includes('dryRun'))).toHaveLength(0);
  });

  it('a missing ConfigMap fails the check instead of passing', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'GET' && r.path === '/api/v1/namespaces/team-a/configmaps/api-cfg' ? k8sStatus(404, 'not found') : base(r));
    await fillFull();
    const dialog = await openDryRun();
    expect(within(dialog).getByTestId('extra-checks').textContent).toMatch(/Would fail ConfigMap api-cfg does not exist in team-a: the pods would not start/);
    expect((within(dialog).getByRole('button', { name: 'Create 5 objects' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('stops at the first failed create (403), lists what was created and deletes it on request, keeping the PVC', async () => {
    create = (r) => (r.path.endsWith('/services') ? k8sStatus(403, 'services is forbidden: User "alice" cannot create services') : undefined);
    await fillFull();
    const dialog = await openDryRun();
    fireEvent.click(within(dialog).getByLabelText(/I have read the \d+ items? Pulse could not check/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 5 objects' }));
    const failed = await within(dialog).findByTestId('create-failed');
    expect(within(dialog).getByTestId('result-Service').textContent).toMatch(/Failed.*You are not allowed to create Service here: services is forbidden/);
    expect(within(dialog).getByTestId('result-Route').textContent).toMatch(/Not created/);
    expect(h.writes().some((w) => w.path === '/apis/route.openshift.io/v1/namespaces/team-a/routes')).toBe(false);
    expect(failed.textContent).toMatch(/Already created: PersistentVolumeClaim\/data-api, Deployment\/api, PodDisruptionBudget\/api/);
    fireEvent.click(within(failed).getByRole('button', { name: 'Delete the 3 created objects' }));
    const cleanupList = await within(dialog).findByTestId('cleanup-results');
    // Each delete is conditioned on the uid the create returned, so a same-named replacement is never deleted.
    expect(h.writes().filter((w) => w.method === 'DELETE').map((w) => [w.path, w.body.preconditions])).toEqual([
      ['/apis/policy/v1/namespaces/team-a/poddisruptionbudgets/api', { uid: 'uid-PodDisruptionBudget' }],
      ['/apis/apps/v1/namespaces/team-a/deployments/api', { uid: 'uid-Deployment' }],
    ]);
    expect(cleanupList.textContent).toMatch(/PersistentVolumeClaim\/data-api: kept/);
  });

  it('a 409 on create is reported per object', async () => {
    create = (r) => (r.path.endsWith('/deployments') ? k8sStatus(409, 'deployments.apps "api" already exists') : undefined);
    await fillBasics({ replicas: '1' });
    const dialog = await openDryRun();
    fireEvent.click(within(dialog).getByLabelText(/I have read the \d+ items? Pulse could not check/));
    fireEvent.click(within(dialog).getByRole('button', { name: /Create \d objects/ }));
    await within(dialog).findByTestId('create-failed');
    expect(within(dialog).getByTestId('result-Deployment').textContent).toMatch(/Failed.*Deployment api already exists/);
  });

  it('without permission to create Routes, Create stays off and says so (RBAC)', async () => {
    h.state.denied.add('create routes');
    await fillFull();
    const dialog = await openDryRun();
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe('You do not have permission to create Route in team-a.'));
    expect((within(dialog).getByRole('button', { name: 'Create 5 objects' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses to create when the active cluster changed after the dry run', async () => {
    await fillBasics({ replicas: '1' });
    const dialog = await openDryRun();
    h.setActive(REMOTE);
    fireEvent.click(within(dialog).getByLabelText(/I have read the \d+ items? Pulse could not check/));
    fireEvent.click(within(dialog).getByRole('button', { name: /Create \d objects/ }));
    expect(await within(dialog).findByText(/was not run/)).toBeTruthy();
    expect(h.writes().filter((w) => !w.path.includes('dryRun'))).toHaveLength(0);
  });
});

describe('review follow-ups (DeployDryRun)', () => {
  it('a cluster switch in the middle of create stops there, still lists what was created, and cleans up by uid once back', async () => {
    create = (r) => {
      if (r.path.endsWith('/poddisruptionbudgets')) {
        // The user switches cluster while the third object is being created.
        setTimeout(() => h.setActive(REMOTE), 0);
      }
      return undefined;
    };
    await fillFull();
    const dialog = await openDryRun();
    fireEvent.click(within(dialog).getByLabelText(/I have read the \d+ items? Pulse could not check/));
    // Slow the PDB answer so the switch lands before the Service.
    const base = h.state.handler;
    h.state.handler = async (r) => {
      if (r.method === 'POST' && r.path.endsWith('/poddisruptionbudgets')) {
        const res = base(r);
        await new Promise((ok) => setTimeout(ok, 20));
        return res;
      }
      return base(r);
    };
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 5 objects' }));
    const failed = await within(dialog).findByTestId('create-failed');
    expect(within(dialog).getByText(/was not run: it was prepared on/)).toBeTruthy();
    expect(failed.textContent).toMatch(/Stopped before Service\/api.*Not attempted: Service\/api, Route\/api/);
    expect(failed.textContent).toMatch(/Already created: PersistentVolumeClaim\/data-api, Deployment\/api, PodDisruptionBudget\/api/);
    expect(h.writes().some((w) => w.path === '/api/v1/namespaces/team-a/services')).toBe(false);
    h.setActive('local');
    fireEvent.click(within(failed).getByRole('button', { name: 'Delete the 3 created objects' }));
    await within(dialog).findByTestId('cleanup-results');
    expect(h.writes().filter((w) => w.method === 'DELETE').map((w) => w.body.preconditions.uid)).toEqual(['uid-PodDisruptionBudget', 'uid-Deployment']);
  });

  it('an object that could not be dry-run keeps Create off and Step 1 not done', async () => {
    dryRun = (r) => (r.path.includes('/services?') ? (() => { throw new TypeError('Failed to fetch'); })() : undefined);
    await fillBasics({ replicas: '1' });
    const dialog = await openDryRun();
    expect(within(dialog).getByTestId('result-Service').textContent).toMatch(/Could not check.*Could not check: Failed to fetch/);
    expect(within(dialog).getByText(/Dry run · \d+ not checked/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: /Create \d objects/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByTestId('create-blocked').textContent).toBe('1 object could not be dry-run.');
  });

  it('unchecked items need an explicit acknowledgement', async () => {
    await fillBasics({ replicas: '1' });
    const dialog = await openDryRun();
    expect(within(dialog).getByTestId('extra-checks').textContent).toMatch(/Could not check Pod admission \(SCC \/ Pod Security\)/);
    expect(within(dialog).getByTestId('extra-checks').textContent).toMatch(/Could not check Image pull: quay\.io\/acme\/api:1\.4/);
    const create = within(dialog).getByRole('button', { name: /Create \d objects/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(within(dialog).getByTestId('create-blocked').textContent).toBe('Confirm that you have read what was not checked.');
    fireEvent.click(within(dialog).getByLabelText(/I have read the \d+ items? Pulse could not check/));
    await waitFor(() => expect(create.disabled).toBe(false));
    expect(dialog.textContent).toMatch(/acting as /);
  });

  it('shows dry-run Warning headers on the object', async () => {
    dryRun = (r) => (r.path.includes('/deployments?') ? new Response(JSON.stringify(r.body), { status: 201, headers: { 'content-type': 'application/json', Warning: '299 - "would violate PodSecurity \\"restricted:latest\\": allowPrivilegeEscalation != false"' } }) : undefined);
    await fillBasics({ replicas: '1' });
    const dialog = await openDryRun();
    expect(within(dialog).getByTestId('result-Deployment').textContent).toMatch(/Warning: would violate PodSecurity "restricted:latest"/);
  });

  it('a create with no answer is "may exist", and cleanup deletes it only once it is recognised as Pulse\'s', async () => {
    create = (r) => (r.path.endsWith('/services') ? (() => { throw new TypeError('Failed to fetch'); })() : undefined);
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'GET' && r.path === '/api/v1/namespaces/team-a/services/api'
      ? json({ metadata: { name: 'api', uid: 'uid-svc-maybe', creationTimestamp: new Date().toISOString(), labels: { 'app.kubernetes.io/managed-by': 'openshiftpulse' } } })
      : base(r));
    await fillBasics({ replicas: '1' });
    const dialog = await openDryRun();
    fireEvent.click(within(dialog).getByLabelText(/I have read the \d+ items? Pulse could not check/));
    fireEvent.click(within(dialog).getByRole('button', { name: /Create \d objects/ }));
    const failed = await within(dialog).findByTestId('create-failed');
    expect(within(dialog).getByTestId('result-Service').textContent).toMatch(/No answer from the API server, so it may or may not exist/);
    expect(failed.textContent).toMatch(/No answer for Service\/api: it may or may not exist/);
    fireEvent.click(within(failed).getByRole('button', { name: 'Delete the 2 created objects' }));
    await within(dialog).findByTestId('cleanup-results');
    expect(h.writes().filter((w) => w.method === 'DELETE').map((w) => [w.path, w.body.preconditions.uid])).toEqual([
      ['/api/v1/namespaces/team-a/services/api', 'uid-svc-maybe'],
      ['/apis/apps/v1/namespaces/team-a/deployments/api', 'uid-Deployment'],
    ]);
  });

  it('a delete refused because the object was replaced (uid mismatch) is reported, not hidden', async () => {
    create = (r) => (r.path.endsWith('/services') ? k8sStatus(403, 'services is forbidden') : undefined);
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'DELETE' ? k8sStatus(409, 'Precondition failed: UID in precondition: uid-Deployment, UID in object meta: other') : base(r));
    await fillBasics({ replicas: '1' });
    const dialog = await openDryRun();
    fireEvent.click(within(dialog).getByLabelText(/I have read the \d+ items? Pulse could not check/));
    fireEvent.click(within(dialog).getByRole('button', { name: /Create \d objects/ }));
    fireEvent.click(within(await within(dialog).findByTestId('create-failed')).getByRole('button', { name: 'Delete the 1 created object' }));
    expect((await within(dialog).findByTestId('cleanup-results')).textContent).toBe('Deployment/api: not deleted: the object there now is not the one Pulse created');
  });

  it('a quota the pods would exceed blocks Create, with the numbers', async () => {
    quotas = () => json({ items: [{ metadata: { name: 'q' }, status: { hard: { 'requests.cpu': '1', 'requests.memory': '1Gi' }, used: { 'requests.cpu': '900m', 'requests.memory': '0' } } }] });
    await fillBasics({ replicas: '1' });
    type('CPU request', '500m');
    type('Memory request', '128Mi');
    await waitFor(() => expect(screen.getByTestId('quota-headroom').textContent).toMatch(/Over quota: requests\.cpu/));
    const dialog = await openDryRun();
    expect(within(dialog).getByTestId('confirm-quota').textContent).toMatch(/requests\.cpu: 1\.4 of 1 — over quota/);
    expect(within(dialog).getByTestId('confirm-quota').textContent).toMatch(/requests\.memory: 128 Mi of 1\.0 Gi/);
    fireEvent.click(within(dialog).getByLabelText(/I have read the \d+ items? Pulse could not check/));
    expect((within(dialog).getByRole('button', { name: /Create \d objects/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByTestId('create-blocked').textContent).toBe('The pods would not fit the namespace quota.');
  });
});

describe('dry run on a cluster that is no longer active', () => {
  it('shows the dry-run error instead of results', async () => {
    const { DeployDryRunDialog } = await import('../DeployDryRunDialog');
    const { emptyForm } = await import('../../../engine/deployApp');
    const f = { ...emptyForm('team-a'), name: 'api', source: { type: 'image' as const, image: 'quay.io/a/b:1', pullSecret: '' }, port: '8080' };
    h.renderUi(<DeployDryRunDialog clusterId={REMOTE} form={f} onClose={() => undefined} onEditHostname={() => undefined} />);
    expect(await screen.findByText('The dry run could not run')).toBeTruthy();
    expect(screen.getByText(/was not run: it was prepared on/)).toBeTruthy();
    expect(screen.queryByText('Dry run results, in create order')).toBeNull();
    expect(h.writes()).toHaveLength(0);
  });
});
