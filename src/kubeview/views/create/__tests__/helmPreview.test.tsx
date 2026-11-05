// @vitest-environment jsdom
/**
 * Helm preview before apply (Wave 15): chart defaults beside the overrides,
 * "helm template" through the same runner Job, an object-by-object diff and
 * dry run, hooks, and the upgrade diff confirmation with rollback as undo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { gzipSync } from 'zlib';
import { createHarness, clickWhenEnabled, json, k8sStatus, REMOTE } from '../../../__tests__/actionHarness';
import { HelmTab } from '../HelmTab';
import { HelmReleases } from '../HelmReleases';
import { tar } from '../../../engine/helmChartArchive';
import { jobsBy, previewHandler, releaseSecret, PLAIN_MANIFEST } from './helmTestUtils';

vi.mock('../../../components/DeployProgress', () => ({ default: ({ name }: { name: string }) => <div data-testid="job-progress">{name}</div> }));

const h = createHarness();
const RUNNER = `quay.io/pulse/helm-runner@sha256:${'c'.repeat(64)}`;
const enc = new TextEncoder();

const INDEX = `apiVersion: v1
entries:
  nginx:
  - name: nginx
    description: NGINX
    version: 15.3.0
    urls:
    - https://charts.openshift.io/nginx-15.3.0.tgz
`;

const INSTALL_RENDER = `WARNING: Kubernetes configuration file is group-readable.
---
# Source: nginx/templates/svc.yaml
apiVersion: v1
kind: Service
metadata:
  name: my-nginx
---
# Source: nginx/templates/deploy.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-nginx
spec:
  replicas: 2
---
# Source: nginx/templates/clusterrole.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: my-nginx-clusterrole
---
# Source: nginx/templates/cm.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-nginx-cfg
---
# Source: nginx/templates/hook.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: my-nginx-migrate
  annotations:
    helm.sh/hook: post-install
    helm.sh/hook-weight: "5"
    helm.sh/hook-delete-policy: before-hook-creation
---
# Source: nginx/templates/tests/test.yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-nginx-test
  annotations:
    helm.sh/hook: test
`;

function chartTgz(files: Record<string, string>) {
  return gzipSync(Buffer.from(tar(Object.entries(files).map(([path, s]) => ({ path, data: enc.encode(s) })))));
}

beforeEach(() => {
  h.setup();
  (window as unknown as { __OPENSHIFTPULSE_CONFIG__?: unknown }).__OPENSHIFTPULSE_CONFIG__ = { helmInstall: { runnerImage: RUNNER } };
});
afterEach(() => { cleanup(); h.teardown(); delete (window as unknown as { __OPENSHIFTPULSE_CONFIG__?: unknown }).__OPENSHIFTPULSE_CONFIG__; });

describe('Install preview (HelmInstall)', () => {
  let tgz: Response | (() => Response);
  beforeEach(() => {
    tgz = () => new Response(chartTgz({
      'nginx/Chart.yaml': 'name: nginx\nversion: 15.3.0\n',
      'nginx/values.yaml': '# Number of pods\nreplicaCount: 1\nservice:\n  type: ClusterIP\n',
      'nginx/values.schema.json': JSON.stringify({ type: 'object', additionalProperties: false, properties: { replicaCount: { type: 'integer' }, service: { type: 'object', properties: { type: { enum: ['ClusterIP', 'NodePort'] } } } } }),
      'nginx/charts/sub/values.yaml': 'sub: true\n',
    }), { status: 200 });
    h.state.handler = previewHandler((r) => {
      if (r.url.endsWith('/index.yaml')) return new Response(INDEX, { status: 200 });
      if (r.url.endsWith('.tgz')) return typeof tgz === 'function' ? tgz() : tgz;
      if (r.method === 'GET' && r.path === '/api/v1/namespaces') return json({ items: [{ metadata: { name: 'team-b' } }] });
      return json({ items: [] });
    }, {
      log: INSTALL_RENDER,
      dryRun: (r) => {
        if (r.path.includes('/services?')) return k8sStatus(403, 'services is forbidden');
        if (r.path.includes('/configmaps?')) return k8sStatus(409, 'configmaps "my-nginx-cfg" already exists');
        return undefined;
      },
      existing: { '/api/v1/namespaces/team-b/configmaps/my-nginx-cfg': { metadata: { name: 'my-nginx-cfg', annotations: { 'meta.helm.sh/release-name': 'other', 'meta.helm.sh/release-namespace': 'shop' } } } },
    });
  });

  async function openInstall() {
    h.renderUi(<HelmTab />);
    fireEvent.click(await screen.findByRole('button', { name: /NGINX/ }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Namespace' }), { target: { value: 'team-b' } });
    return screen.getByTestId('helm-install-panel');
  }

  it('shows the chart defaults and schema hints beside the overrides, marking overridden lines', async () => {
    const panel = await openInstall();
    const defaults = await within(panel).findByTestId('chart-defaults');
    expect(defaults.textContent).toContain('# Number of pods');
    expect(defaults.textContent).not.toContain('sub: true'); // the subchart's values are not the chart's
    fireEvent.change(within(panel).getByLabelText('Values'), { target: { value: 'replicaCount: two\nservice:\n  type: LoadBalancer\nfoo: 1\n' } });
    const hints = within(panel).getByTestId('schema-hints').textContent;
    expect(hints).toMatch(/replicaCount must be integer, not string/);
    expect(hints).toMatch(/service\.type must be one of "ClusterIP", "NodePort"/);
    expect(hints).toMatch(/foo is not a value this chart accepts/);
    const marked = [...defaults.querySelectorAll('[data-overridden]')].map((el) => el.textContent?.replace(/^\d+/, ''));
    expect(marked).toEqual(['replicaCount: 1', 'service:', '  type: ClusterIP']);
  });

  it('says when the chart defaults could not be downloaded, without blocking the preview', async () => {
    tgz = new Response('nope', { status: 404, statusText: 'Not Found' });
    const panel = await openInstall();
    expect((await within(panel).findByTestId('chart-defaults-error')).textContent).toMatch(/Chart defaults could not be loaded: https:\/\/charts\.openshift\.io\/nginx-15\.3\.0\.tgz returned 404/);
    await clickWhenEnabled('Preview');
    expect(await within(panel).findByTestId('helm-preview')).toBeTruthy();
  });

  it('renders in a token-less Job that touches no RBAC, dry-runs each object, and blocks Install on what would fail', async () => {
    const panel = await openInstall();
    await clickWhenEnabled('Preview');
    const preview = await within(panel).findByTestId('helm-preview');

    // The render Job: the runner image, the namespace's default ServiceAccount with no token, a short TTL.
    const [tpl] = jobsBy(h.writes(), 'template');
    expect(tpl.path).toBe('/apis/batch/v1/namespaces/team-b/jobs');
    const c = tpl.body.spec.template.spec;
    expect(c.serviceAccountName).toBe('default');
    expect(c.automountServiceAccountToken).toBe(false);
    expect(tpl.body.spec.ttlSecondsAfterFinished).toBe(60);
    expect(c.containers[0].image).toBe(RUNNER);
    expect(c.containers[0].command.slice(0, 2)).toEqual(['/bin/sh', '-c']);
    expect(c.containers[0].args).toEqual(['template', 'my-nginx', 'nginx', '--repo', 'https://charts.openshift.io', '--version', '15.3.0', '--namespace', 'team-b', '-f', '/tmp/values/values.yaml', '--include-crds', '--kube-version', 'v1.31.4', '--api-versions', 'v1', '--api-versions', 'apps/v1']);
    // No ServiceAccount, Role or RoleBinding is created or changed by a preview.
    expect(h.writes().filter((w) => /serviceaccounts|rbac\.authorization/.test(w.path))).toEqual([]);
    // Only the Job and its values Secret (owned by the Job, carrying a salt) are created.
    const jobName = tpl.body.metadata.name as string;
    expect(jobName).toMatch(/^helm-template-my-nginx-[a-z0-9]{5}$/);
    const secrets = h.writes().filter((w) => w.method === 'POST' && w.path === '/api/v1/namespaces/team-b/secrets');
    expect(secrets).toHaveLength(1);
    expect(secrets[0].body.metadata.ownerReferences).toEqual([{ apiVersion: 'batch/v1', kind: 'Job', name: jobName, uid: 'tpl-uid-1' }]);
    expect(Object.keys(secrets[0].body.stringData)).toEqual(['values.yaml', 'salt']);
    expect(c.volumes).toContainEqual({ name: 'values', secret: { secretName: secrets[0].body.metadata.name } });
    // The pod is found by the Job's uid; the Job is removed once its log is read, and nothing is installed.
    expect(h.state.requests.some((r) => r.path.includes('labelSelector=controller-uid%3Dtpl-uid-1'))).toBe(true);
    await waitFor(() => expect(h.writes().some((w) => w.method === 'DELETE' && w.path === `/apis/batch/v1/namespaces/team-b/jobs/${jobName}?propagationPolicy=Background`)).toBe(true));
    expect(jobsBy(h.writes(), 'install')).toHaveLength(0);
    // Each object was sent with dryRun=All.
    expect(h.writes().filter((w) => w.path.includes('dryRun=All')).map((w) => `${w.method} ${w.path}`).sort()).toEqual([
      'POST /api/v1/namespaces/team-b/configmaps?dryRun=All',
      'POST /api/v1/namespaces/team-b/services?dryRun=All',
      'POST /apis/apps/v1/namespaces/team-b/deployments?dryRun=All',
    ]);

    expect(within(preview).getByTestId('preview-counts').textContent).toBe('4added0changed0removed2would fail1could not check');
    expect(within(preview).getByTestId('preview-added-ClusterRole-my-nginx-clusterrole').textContent).toMatch(/Would fail.*cannot manage ClusterRole/);
    expect(within(preview).getByTestId('preview-added-ConfigMap-my-nginx-cfg').textContent).toMatch(/Would fail.*belongs to release other in shop/);
    expect(within(preview).getByTestId('preview-added-Service-my-nginx').textContent).toMatch(/Could not check: you are not allowed to dry-run Service here/);
    expect(within(preview).getByTestId('preview-added-Deployment-my-nginx').textContent).toMatch(/Dry run passed/);
    fireEvent.click(within(preview).getByRole('button', { name: 'View Deployment/my-nginx' }));
    expect(within(preview).getByLabelText('Manifest of Deployment/my-nginx').textContent).toContain('replicas: 2');
    expect(within(preview).getByTestId('preview-hooks').textContent).toMatch(/post-install · Job my-nginx-migrate · weight 5 · delete policy before-hook-creation/);
    expect(preview.textContent).toMatch(/1 test hook \(Pod my-nginx-test\) run only on helm test/);
    expect(preview.textContent).toMatch(/helm warned: WARNING: Kubernetes configuration file is group-readable/);

    const install = within(panel).getByRole('button', { name: 'Install' }) as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    expect(panel.textContent).toMatch(/Fix 2 items first: ClusterRole\/my-nginx-clusterrole, ConfigMap\/my-nginx-cfg/);
    expect(within(panel).queryByRole('button', { name: 'Install without a preview' })).toBeNull();
  });

  it('marks the preview out of date when the values change', async () => {
    h.state.handler = previewHandler(h.state.handler, { log: PLAIN_MANIFEST.replace(/shop/g, 'my-nginx') });
    const panel = await openInstall();
    await clickWhenEnabled('Preview');
    await within(panel).findByTestId('helm-preview');
    expect(within(panel).getByRole('button', { name: 'Install 2 objects' })).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText('Values'), { target: { value: 'replicaCount: 3\n' } });
    expect(within(panel).getByTestId('helm-preview').textContent).toMatch(/out of date: the inputs changed, preview again/);
    expect((within(panel).getByRole('button', { name: 'Install' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a failed render shows helm\'s error, removes the Job and does not offer installing anyway', async () => {
    h.state.handler = previewHandler(h.state.handler, { phase: 'Failed', log: 'Error: values don\'t meet the specifications of the schema(s) in the following chart(s):\nnginx:\n- replicaCount: Invalid type\n' });
    const panel = await openInstall();
    await clickWhenEnabled('Preview');
    const alert = await within(panel).findByText('The preview could not be made');
    expect(alert.parentElement!.textContent).toMatch(/Error: values don't meet the specifications of the schema/);
    // helm itself rejected the chart: installing anyway is not offered, and the Job was removed.
    expect(within(panel).queryByRole('button', { name: 'Install without a preview' })).toBeNull();
    expect((within(panel).getByRole('button', { name: 'Install' }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.writes().some((w) => w.method === 'DELETE' && w.path.includes('/jobs/helm-template-'))).toBe(true);
  });

  it('closing the install form mid-preview cancels it and deletes the Job', async () => {
    h.state.handler = previewHandler(h.state.handler, { log: '', pods: () => json({ items: [{ metadata: { name: 'helm-pod-1' }, status: { phase: 'Running' } }] }) });
    const panel = await openInstall();
    await clickWhenEnabled('Preview');
    await waitFor(() => expect(jobsBy(h.writes(), 'template')).toHaveLength(1));
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(h.writes().some((w) => w.method === 'DELETE' && w.path.includes('/jobs/helm-template-my-nginx-'))).toBe(true));
    expect(jobsBy(h.writes(), 'install')).toHaveLength(0);
  });

  it('shows rendered Secret values as hidden and dry-runs them with placeholders', async () => {
    h.state.handler = previewHandler(h.state.handler, { log: `---
apiVersion: v1
kind: Secret
metadata:
  name: my-nginx
data:
  password: "(redacted sha256:0123456789abcdef)"
` });
    const panel = await openInstall();
    await clickWhenEnabled('Preview');
    const preview = await within(panel).findByTestId('helm-preview');
    fireEvent.click(within(preview).getByRole('button', { name: 'View Secret/my-nginx' }));
    expect(within(preview).getByLabelText('Manifest of Secret/my-nginx').textContent).toContain('password: (redacted sha256:0123456789abcdef)');
    expect(h.writes().find((w) => w.path.includes('/secrets?dryRun=All'))!.body.data).toEqual({ password: 'cmVkYWN0ZWQ=' });
  });

  it.each([[403, 'jobs.batch is forbidden'], [409, 'jobs.batch "helm-install-my-nginx-abc12" already exists']])('an install Job create answered %s stays in the confirm and starts nothing', async (code, msg) => {
    const inner = previewHandler(h.state.handler, { log: PLAIN_MANIFEST.replace(/shop/g, 'my-nginx') });
    h.state.handler = (r) => (r.method === 'POST' && r.path.endsWith('/jobs') && r.body.spec.template.spec.containers[0].args[0] === 'install' ? k8sStatus(code, msg) : inner(r));
    const panel = await openInstall();
    await clickWhenEnabled('Preview');
    await within(panel).findByTestId('helm-preview');
    await clickWhenEnabled('Install 2 objects');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('install-who').textContent).toMatch(/^Cluster .+ · acting as /);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install 2 objects' }));
    expect(await within(dialog).findByText(msg)).toBeTruthy();
    expect(within(dialog).getByText('The install was not started')).toBeTruthy();
  });

  it('while permissions are being checked, Preview says so and no bypass is offered', async () => {
    const panel = await openInstall();
    expect(within(panel).queryByRole('button', { name: 'Install without a preview' })).toBeNull();
    // Without a namespace, neither.
    fireEvent.change(screen.getByRole('combobox', { name: 'Namespace' }), { target: { value: '' } });
    expect(within(panel).queryByRole('button', { name: 'Install without a preview' })).toBeNull();
  });

  it('when Jobs are denied, Preview is off and installing unpreviewed is not offered', async () => {
    h.state.denied.add('create jobs');
    const panel = await openInstall();
    await waitFor(() => expect(panel.textContent).toMatch(/You do not have permission to create Jobs in team-b/));
    expect(within(panel).queryByRole('button', { name: 'Install without a preview' })).toBeNull();
  });

  it('without permission to read pod logs the preview is disabled with the reason', async () => {
    h.state.denied.add('get pods/log');
    const panel = await openInstall();
    await waitFor(() => expect(panel.textContent).toMatch(/You do not have permission to read pod logs in team-b, where the preview's output is/));
    expect((within(panel).getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByRole('button', { name: 'Install without a preview' })).toBeTruthy();
    expect(h.writes()).toHaveLength(0);
  });
});

describe('Upgrade diff confirmation (HelmDiffConfirm)', () => {
  const JOBS = '/apis/batch/v1/namespaces/team-a/jobs';
  const REV1_MANIFEST = `---
# Source: nginx/templates/svc.yaml
apiVersion: v1
kind: Service
metadata:
  name: shop
`;
  const ITEMS = [
    releaseSecret('shop', 'team-a', 1, 'superseded', '15.0.0', {}, REV1_MANIFEST),
    releaseSecret('shop', 'team-a', 2, 'deployed', '15.1.0', { replicaCount: 2 }),
  ];
  const UPGRADE_RENDER = `---
# Source: nginx/templates/deploy.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop
spec:
  template:
    spec:
      containers:
      - name: nginx
        image: nginx:1.28
---
# Source: nginx/templates/np.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shop
---
# Source: nginx/templates/migrate.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: shop-migrate
  annotations:
    helm.sh/hook: pre-upgrade
    helm.sh/hook-delete-policy: before-hook-creation
`;
  const CHARTS = [{ name: 'nginx', repoName: 'bitnami', repoUrl: 'https://charts.example.com', versions: ['15.3.0', '15.1.0'] }];

  beforeEach(() => {
    h.state.handler = previewHandler((r) => {
      if (r.method === 'GET' && r.path.includes('owner%3Dhelm')) return json({ items: ITEMS });
      return json({});
    }, { log: UPGRADE_RENDER, records: { 'sh.helm.release.v1.shop.v1': ITEMS[0], 'sh.helm.release.v1.shop.v2': ITEMS[1] } });
  });

  async function previewUpgrade() {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Upgrade shop');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('Reuse values of the current release'));
    expect((within(dialog).getByLabelText('Values') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(within(dialog).getByLabelText('Values'), { target: { value: "image:\n  tag: '1.28'\n" } });
    await clickWhenEnabled('Preview');
    await within(dialog).findByTestId('helm-preview');
    return dialog;
  }

  it('reuse renders with the release values merged under the overrides; the confirm shows the diff, hooks, impact and rollback undo', async () => {
    const dialog = await previewUpgrade();
    const [tpl] = jobsBy(h.writes(), 'template');
    expect(tpl.body.spec.template.spec.containers[0].args).toEqual(expect.arrayContaining(['template', 'shop', 'nginx', '--version', '15.3.0', '--is-upgrade']));
    const previewValues = h.writes().find((w) => w.method === 'POST' && /^helm-preview-values-/.test(w.body?.metadata?.name ?? ''))!;
    expect(previewValues.body.stringData['values.yaml']).toBe("replicaCount: 2\nimage:\n  tag: '1.28'\n");
    // The Deployment that exists in the release is checked with a server-side apply dry run.
    expect(h.writes().some((w) => w.method === 'PATCH' && w.path === '/apis/apps/v1/namespaces/team-a/deployments/shop?dryRun=All&fieldManager=helm&force=true')).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Review changes' }));
    const confirm = await within(dialog).findByTestId('helm-diff-confirm');
    expect(within(dialog).getByRole('heading', { name: 'Upgrade shop from chart 15.1.0 to 15.3.0?' })).toBeTruthy();
    expect(dialog.textContent).toMatch(/revision 2 → 3 · values: reuse current \+ 1 change/);
    // Service/shop is in the release but no longer rendered: Helm deletes it.
    expect(within(confirm).getByTestId('preview-counts').textContent).toBe('1added1changed1removed0would fail0could not check');
    expect(within(confirm).getByTestId('preview-removed-Service-shop').textContent).toMatch(/Removed.*Helm deletes it/);
    expect(confirm.textContent).toMatch(/Dry run passed · admitted by the API server/);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Diff Deployment/shop' }));
    const diff = within(confirm).getByLabelText('Diff').textContent!;
    expect(diff).toMatch(/\+ +template:/);
    expect(diff).toMatch(/\+ .*image: nginx:1\.28/);
    expect(within(confirm).getByTestId('preview-hooks').textContent).toMatch(/pre-upgrade · Job shop-migrate · weight 0 · delete policy before-hook-creation/);
    expect(confirm.textContent).toMatch(/If a pre-upgrade hook fails, helm stops before changing anything else/);
    expect(confirm.textContent).toMatch(/Rolling restart of Deployment\/shop/);
    expect(confirm.textContent).toMatch(/Roll back to revision 2 \(nginx 15\.1\.0\)\. What the upgrade hooks did is not reversed/);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Upgrade to 15.3.0' }));
    await waitFor(() => expect(jobsBy(h.writes(), 'upgrade')).toHaveLength(1));
    expect(jobsBy(h.writes(), 'upgrade')[0].body.spec.template.spec.containers[0].args).toEqual(['upgrade', 'shop', 'nginx', '--repo', 'https://charts.example.com', '--namespace', 'team-a', '--version', '15.3.0', '--reset-then-reuse-values', '--atomic', '-f', '/tmp/values/values.yaml', '--wait', '--timeout', '5m']);
    // With --reset-then-reuse-values, only the overrides go to helm; it merges them itself.
    expect(h.writes().filter((w) => w.method === 'POST' && w.body?.metadata?.generateName === 'helm-values-shop-').at(-1)!.body.stringData['values.yaml']).toBe("image:\n  tag: '1.28'\n");
    expect((await screen.findByTestId('job-progress')).textContent).toBe('helm-upgrade-shop-abc12');
  });

  it('Back to values keeps the edit; cancel sends nothing beyond the preview', async () => {
    const dialog = await previewUpgrade();
    const before = h.writes().length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review changes' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Back to values' }));
    expect((within(dialog).getByLabelText('Values') as HTMLTextAreaElement).value).toBe("image:\n  tag: '1.28'\n");
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.writes().length).toBe(before);
    expect(jobsBy(h.writes(), 'upgrade')).toHaveLength(0);
  });

  it('a dry-run rejection blocks Review changes', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.path.includes('/networkpolicies?dryRun=All') ? k8sStatus(422, 'NetworkPolicy.networking.k8s.io "shop" is invalid: spec.podSelector: Required value') : base(r));
    const dialog = await previewUpgrade();
    expect(within(dialog).getByTestId('preview-added-NetworkPolicy-shop').textContent).toMatch(/Would fail.*spec\.podSelector: Required value/);
    expect((within(dialog).getByRole('button', { name: 'Review changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a 409 or 403 on the upgrade Job stays in the confirm and starts nothing', async () => {
    const base = h.state.handler;
    let answer = k8sStatus(409, 'jobs.batch "helm-upgrade-shop-abc12" already exists');
    h.state.handler = (r) => (r.method === 'POST' && r.path === JOBS && r.body.spec.template.spec.containers[0].args[0] === 'upgrade' ? answer : base(r));
    const dialog = await previewUpgrade();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review changes' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Upgrade to 15.3.0' }));
    expect(await within(dialog).findByText(/already exists/)).toBeTruthy();
    expect(within(dialog).getByText('The upgrade was not started')).toBeTruthy();
    answer = k8sStatus(403, 'jobs.batch is forbidden');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upgrade to 15.3.0' }));
    expect(await within(dialog).findByText('jobs.batch is forbidden')).toBeTruthy();
    expect(screen.queryByTestId('job-progress')).toBeNull();
  });

  it('refuses the upgrade when the active cluster changed after the preview', async () => {
    const dialog = await previewUpgrade();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review changes' }));
    h.setActive(REMOTE);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Upgrade to 15.3.0' }));
    expect(await within(dialog).findByText(/was not run/)).toBeTruthy();
    expect(jobsBy(h.writes(), 'upgrade')).toHaveLength(0);
  });

  it('Edit values previews with the chart stored in the release and shows its defaults', async () => {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={[]} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Edit values of shop');
    const dialog = await screen.findByRole('dialog');
    const defaults = within(dialog).getByTestId('chart-defaults');
    expect(defaults.textContent).toContain('replicaCount: 1');
    expect(defaults.querySelector('[data-overridden]')?.textContent).toMatch(/replicaCount: 1/);
    expect(dialog.textContent).toMatch(/from the chart stored in the release \(comments are not kept\)/);
    await clickWhenEnabled('Preview');
    await within(dialog).findByTestId('helm-preview');
    const [tpl] = jobsBy(h.writes(), 'template');
    expect(tpl.body.spec.template.spec.containers[0].args).toEqual(['template', 'shop', '/tmp/chart/chart.tgz', '--namespace', 'team-a', '-f', '/tmp/values/values.yaml', '--include-crds', '--is-upgrade', '--kube-version', 'v1.31.4', '--api-versions', 'v1', '--api-versions', 'apps/v1']);
    const chartSecret = h.writes().find((w) => w.method === 'POST' && /^helm-preview-chart-/.test(w.body?.metadata?.name ?? ''))!;
    expect(chartSecret.body.metadata.ownerReferences[0].uid).toBe('tpl-uid-1');
    expect(tpl.body.spec.template.spec.volumes).toContainEqual({ name: 'chart', secret: { secretName: chartSecret.body.metadata.name } });
  });

  it('without permission to create Jobs, Upgrade is disabled (RBAC)', async () => {
    h.state.denied.add('create jobs');
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Upgrade shop' }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole('button', { name: 'Upgrade shop' }).title).toBe('You do not have permission to create Jobs in team-a');
  });

  it('rollback shows what changes between the running revision and the target, from the release records', async () => {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Roll back shop');
    const dialog = await screen.findByRole('dialog');
    const diff = await within(dialog).findByTestId('rollback-diff');
    await waitFor(() => expect(within(diff).getByTestId('preview-removed-Deployment-shop')).toBeTruthy());
    expect(diff.textContent).toMatch(/rev 2 \(latest\) → rev 1/);
    expect(diff.textContent).toMatch(/1 object unchanged/);
    expect(diff.textContent).toMatch(/Hooks that will run: none on rollback/);
    expect(jobsBy(h.writes(), 'template')).toHaveLength(0); // no render needed
  });

  it('rollback says when a release record cannot be read instead of showing no changes', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.path.endsWith('/secrets/sh.helm.release.v1.shop.v1') ? k8sStatus(403, 'forbidden') : base(r));
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Roll back shop');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('The revisions could not be compared')).toBeTruthy();
    expect(within(dialog).queryByText(/Nothing changes/)).toBeNull();
  });
});
