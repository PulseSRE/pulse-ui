// @vitest-environment jsdom
/**
 * Helm release actions run through the same digest-pinned runner Job the
 * install path uses. Each test asserts the exact Job (helm arguments, values
 * Secret mount) created in the release's namespace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createHarness, clickWhenEnabled, json, k8sStatus, REMOTE } from '../../../__tests__/actionHarness';
import { HelmReleases } from '../HelmReleases';
import { gunzipSync } from 'zlib';
import { helmArgs, jobsBy, parseIndexForTest, previewHandler, releaseSecret, PLAIN_MANIFEST, SVC_TEMPLATE } from './helmTestUtils';

/** Files of a ustar archive by path (prefix + name). */
function untar(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let o = 0;
  while (o + 512 <= buf.length && buf[o] !== 0) {
    const field = (a: number, n: number) => buf.subarray(o + a, o + a + n).toString().replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12), 8);
    const prefix = field(345, 155);
    out[(prefix ? `${prefix}/` : '') + field(0, 100)] = buf.subarray(o + 512, o + 512 + size).toString();
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

vi.mock('../../../components/DeployProgress', () => ({ default: ({ name }: { name: string }) => <div data-testid="job-progress">{name}</div> }));

const h = createHarness();
const RUNNER = `quay.io/pulse/helm-runner@sha256:${'b'.repeat(64)}`;
const JOBS = '/apis/batch/v1/namespaces/team-a/jobs';
const ITEMS = [
  releaseSecret('shop', 'team-a', 1, 'superseded', '15.0.0'),
  releaseSecret('shop', 'team-a', 2, 'deployed', '15.1.0', { replicaCount: 2 }),
];
const CHARTS = [{ name: 'nginx', repoName: 'bitnami', repoUrl: 'https://charts.example.com', versions: ['15.3.0', '15.2.0', '15.1.0'] }];

beforeEach(() => {
  h.setup();
  (window as unknown as { __OPENSHIFTPULSE_CONFIG__?: unknown }).__OPENSHIFTPULSE_CONFIG__ = { helmInstall: { runnerImage: RUNNER } };
  h.state.handler = (r) => {
    if (r.method === 'GET' && r.path.includes('owner%3Dhelm')) return json({ items: ITEMS });
    if (r.method === 'POST' && r.path.endsWith('/secrets')) return json({ metadata: { name: `${r.body.metadata.generateName}x1` } });
    if (r.method === 'POST' && r.path === JOBS) return json({ metadata: { name: `helm-${r.body.spec.template.spec.containers[0].args[0]}-shop-abc12`, uid: 'job-uid-1' } });
    return json({});
  };
});
afterEach(() => { cleanup(); h.teardown(); delete (window as unknown as { __OPENSHIFTPULSE_CONFIG__?: unknown }).__OPENSHIFTPULSE_CONFIG__; });

/** Arguments of the action Job (not a preview's helm template Job). */
function jobArgs() {
  const job = h.writes().find((w) => w.method === 'POST' && w.path === JOBS && w.body.spec.template.spec.containers[0].args[0] !== 'template');
  return job?.body.spec.template.spec.containers[0].args;
}

/** Without pods/log the preview cannot run; the dialog offers to continue without one. */
async function continueWithoutPreview(dialog: HTMLElement) {
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Continue without a preview' }));
}

describe('Helm release actions', () => {
  it('rollback runs "helm rollback <release> <rev>" as a Job and shows its progress', async () => {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Roll back shop');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Revision' })).toHaveProperty('value', '1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Roll back' }));
    await waitFor(() => expect(jobArgs()).toEqual(['rollback', 'shop', '1', '--namespace', 'team-a', '--wait', '--timeout', '5m']));
    // The runner's ServiceAccount, Role and RoleBinding are applied first, in team-a.
    expect(h.writes().slice(0, 3).map((w) => `${w.method} ${w.path.split('?')[0]}`)).toEqual([
      'PATCH /api/v1/namespaces/team-a/serviceaccounts/openshiftpulse-helm-installer',
      'PATCH /apis/rbac.authorization.k8s.io/v1/namespaces/team-a/roles/openshiftpulse-helm-installer',
      'PATCH /apis/rbac.authorization.k8s.io/v1/namespaces/team-a/rolebindings/openshiftpulse-helm-installer',
    ]);
    expect((await screen.findByTestId('job-progress')).textContent).toBe('helm-rollback-shop-abc12');
  });

  it('upgrade picks a chart version and passes edited values through a mounted Secret, not the command line', async () => {
    h.state.handler = previewHandler(h.state.handler, { log: PLAIN_MANIFEST, records: { 'sh.helm.release.v1.shop.v2': ITEMS[1] } });
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Upgrade shop');
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Values') as HTMLTextAreaElement).value).toContain('replicaCount: 2');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Chart version' }), { target: { value: '15.2.0' } });
    fireEvent.change(within(dialog).getByLabelText('Values'), { target: { value: 'replicaCount: 4\n' } });
    await clickWhenEnabled('Preview');
    await within(dialog).findByTestId('helm-preview');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review changes' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Upgrade to 15.2.0' }));

    await waitFor(() => expect(jobArgs()).toBeDefined());
    const secret = h.writes().find((w) => w.path === '/api/v1/namespaces/team-a/secrets' && w.body.metadata.generateName === 'helm-values-shop-');
    expect(secret?.body.stringData).toEqual({ 'values.yaml': 'replicaCount: 4\n' });
    expect(jobArgs()).toEqual(['upgrade', 'shop', 'nginx', '--repo', 'https://charts.example.com', '--namespace', 'team-a', '--version', '15.2.0', '--reset-values', '--atomic', '-f', '/tmp/values/values.yaml', '--wait', '--timeout', '5m']);
    const spec = jobsBy(h.writes(), 'upgrade')[0].body.spec.template.spec;
    expect(spec.volumes).toContainEqual({ name: 'values', secret: { secretName: 'helm-values-shop-x1' } });
    expect(spec.containers[0].image).toBe(RUNNER);
    // The values Secret is owned by the Job, so it is garbage-collected with it.
    await waitFor(() => expect(h.writes().filter((w) => w.method === 'PATCH' && w.path === '/api/v1/namespaces/team-a/secrets/helm-values-shop-x1').map((w) => w.body))
      .toContainEqual({ metadata: { ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'helm-upgrade-shop-abc12', uid: 'job-uid-1' }] } }));
  });

  it('rejects invalid values YAML without sending anything', async () => {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Upgrade shop');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Values'), { target: { value: 'a: [unclosed' } });
    expect(within(dialog).getByText(/The values are not valid YAML/)).toBeTruthy();
    await clickWhenEnabled('Preview');
    expect(await within(dialog).findByText('Cannot preview yet')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Review changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.writes()).toHaveLength(0);
  });

  it('blocks uninstall, rollback, upgrade and edit values when the release has kinds the runner Role cannot manage', async () => {
    const withCrb = `${PLAIN_MANIFEST}---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: shop-reader
`;
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'GET' && r.path.includes('owner%3Dhelm')
      ? json({ items: [releaseSecret('shop', 'team-a', 1, 'superseded', '15.0.0', {}, withCrb), releaseSecret('shop', 'team-a', 2, 'deployed', '15.1.0', {}, withCrb)] })
      : base(r));
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    for (const action of ['Uninstall shop', 'Roll back shop', 'Upgrade shop', 'Edit values of shop']) {
      await clickWhenEnabled(action);
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('alert').textContent).toMatch(/contains ClusterRoleBinding, which the Helm runner's Role in team-a cannot manage/);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(h.writes()).toHaveLength(0);
  });

  it('asks which repository when several have a chart of that name, and says empty values reset to defaults', async () => {
    h.state.handler = previewHandler(h.state.handler, { log: PLAIN_MANIFEST, records: { 'sh.helm.release.v1.shop.v2': ITEMS[1] } });
    const twoRepos = [...CHARTS, { name: 'nginx', repoName: 'mirror', repoUrl: 'https://mirror.example.com', versions: ['15.0.0'] }];
    h.renderUi(<HelmReleases nsFilter={undefined} charts={twoRepos} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Upgrade shop');
    const dialog = await screen.findByRole('dialog');
    await clickWhenEnabled('Preview');
    expect(await within(dialog).findByText(/Choose the repository to upgrade nginx from/)).toBeTruthy();
    expect(h.writes()).toHaveLength(0);
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Repository' }), { target: { value: 'https://mirror.example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Values'), { target: { value: '' } });
    expect(within(dialog).getByText(/No values: the release is reset to the chart's defaults/)).toBeTruthy();
    await clickWhenEnabled('Preview');
    await within(dialog).findByTestId('helm-preview');
    // The template Job rendered from the chosen repository, with no values file.
    expect(jobsBy(h.writes(), 'template')[0].body.spec.template.spec.containers[0].args.slice(0, 6)).toEqual(['template', 'shop', 'nginx', '--repo', 'https://mirror.example.com', '--version']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review changes' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upgrade to 15.0.0' }));
    await waitFor(() => expect(jobArgs()).toEqual(['upgrade', 'shop', 'nginx', '--repo', 'https://mirror.example.com', '--namespace', 'team-a', '--version', '15.0.0', '--reset-values', '--atomic', '--wait', '--timeout', '5m']));
    // No values file: --reset-values makes the release use the chart's defaults, as the dialog says, instead of Helm reusing the previous values.
    expect(h.writes().some((w) => w.path.endsWith('/secrets') && w.body.metadata.generateName === 'helm-values-shop-')).toBe(false);
  });

  it('without a repository, Upgrade is unavailable and says why; Edit values upgrades with the chart stored in the release', async () => {
    h.state.denied.add('get pods/log');
    h.renderUi(<HelmReleases nsFilter={undefined} charts={[]} />);
    await screen.findByTestId('helm-release-shop');
    expect(screen.getByTestId('helm-no-repo-shop').textContent).toBe('No chart repository configured for upgrades');
    // Once the Job permission resolves, Edit values is enabled but Upgrade stays disabled with the reason.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Edit values of shop' }) as HTMLButtonElement).disabled).toBe(false));
    const upgrade = screen.getByRole('button', { name: 'Upgrade shop' }) as HTMLButtonElement;
    expect(upgrade.disabled).toBe(true);
    expect(upgrade.title).toMatch(/nginx is not in any configured chart repository\. Edit values still works/);

    await clickWhenEnabled('Edit values of shop');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/with the chart Helm stored in rev 2 \(nginx 15\.1\.0\), so no chart repository is needed/)).toBeTruthy();
    expect(within(dialog).queryByRole('combobox', { name: 'Chart version' })).toBeNull();
    expect((within(dialog).getByLabelText('Values') as HTMLTextAreaElement).value).toContain('replicaCount: 2');
    fireEvent.change(within(dialog).getByLabelText('Values'), { target: { value: 'replicaCount: 5\n' } });
    await continueWithoutPreview(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply values' }));

    await waitFor(() => expect(jobArgs()).toEqual(['upgrade', 'shop', '/tmp/chart/chart.tgz', '--namespace', 'team-a', '--reset-values', '--atomic', '-f', '/tmp/values/values.yaml', '--wait', '--timeout', '5m']));
    const secrets = h.writes().filter((w) => w.method === 'POST' && w.path === '/api/v1/namespaces/team-a/secrets');
    expect(secrets.map((w) => w.body.metadata.generateName)).toEqual(['helm-chart-shop-', 'helm-values-shop-']);
    expect(secrets[1].body.stringData).toEqual({ 'values.yaml': 'replicaCount: 5\n' });
    // The chart Secret holds a gzipped tar of the stored chart, rooted at nginx/.
    const files = untar(gunzipSync(Buffer.from(secrets[0].body.data['chart.tgz'], 'base64')));
    expect(Object.keys(files)).toEqual(['nginx/Chart.yaml', 'nginx/values.yaml', 'nginx/templates/svc.yaml', 'nginx/README.md']);
    expect(files['nginx/Chart.yaml']).toMatch(/name: nginx\nversion: 15\.1\.0/);
    expect(files['nginx/templates/svc.yaml']).toBe(SVC_TEMPLATE);
    const spec = h.writes().find((w) => w.path === JOBS)!.body.spec.template.spec;
    expect(spec.volumes).toContainEqual({ name: 'chart', secret: { secretName: 'helm-chart-shop-x1' } });
    expect(spec.volumes).toContainEqual({ name: 'values', secret: { secretName: 'helm-values-shop-x1' } });
    expect(spec.containers[0].volumeMounts).toContainEqual({ name: 'chart', mountPath: '/tmp/chart', readOnly: true });
    // Both Secrets are owned by the Job.
    await waitFor(() => expect(h.writes().filter((w) => w.method === 'PATCH' && w.path.startsWith('/api/v1/namespaces/team-a/secrets/')).map((w) => w.path))
      .toEqual(['/api/v1/namespaces/team-a/secrets/helm-chart-shop-x1', '/api/v1/namespaces/team-a/secrets/helm-values-shop-x1']));
    expect((await screen.findByTestId('job-progress')).textContent).toBe('helm-upgrade-shop-abc12');
  });

  it('Edit values says why it cannot run when the chart has subcharts Helm did not store', async () => {
    const base = h.state.handler;
    const deps = { dependencies: [{ name: 'redis', version: '19.x', repository: 'https://charts.example.com' }] };
    h.state.handler = (r) => (r.method === 'GET' && r.path.includes('owner%3Dhelm')
      ? json({ items: [releaseSecret('shop', 'team-a', 1, 'deployed', '15.1.0', {}, PLAIN_MANIFEST, deps)] })
      : base(r));
    h.renderUi(<HelmReleases nsFilter={undefined} charts={[]} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Edit values of shop');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/depends on redis, and Helm does not keep subcharts in the release record/)).toBeTruthy();
    expect(within(dialog).queryByLabelText('Values')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(h.writes()).toHaveLength(0);
  });

  it('a failed Edit values Job create is shown, and the Secrets made for it are removed', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'POST' && r.path === JOBS ? k8sStatus(403, 'jobs.batch is forbidden') : base(r));
    h.state.denied.add('get pods/log');
    h.renderUi(<HelmReleases nsFilter={undefined} charts={[]} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Edit values of shop');
    const dialog = await screen.findByRole('dialog');
    await continueWithoutPreview(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply values' }));
    expect(await screen.findByText('jobs.batch is forbidden')).toBeTruthy();
    expect(screen.getByText('The values upgrade was not started')).toBeTruthy();
    await waitFor(() => expect(h.writes().filter((w) => w.method === 'DELETE').map((w) => w.path).sort())
      .toEqual(['/api/v1/namespaces/team-a/secrets/helm-chart-shop-x1', '/api/v1/namespaces/team-a/secrets/helm-values-shop-x1']));
    expect(screen.queryByTestId('job-progress')).toBeNull();
  });

  it('Edit values refuses a release that rendered an undeclared subchart vendored in charts/', async () => {
    const vendored = `${PLAIN_MANIFEST}---
# Source: nginx/charts/redis/templates/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: shop-redis
`;
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'GET' && r.path.includes('owner%3Dhelm')
      ? json({ items: [releaseSecret('shop', 'team-a', 1, 'deployed', '15.1.0', {}, vendored)] })
      : base(r));
    h.renderUi(<HelmReleases nsFilter={undefined} charts={[]} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Edit values of shop');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/rendered the subchart redis \(vendored in charts\/\).*would delete everything they rendered/)).toBeTruthy();
    expect(within(dialog).queryByLabelText('Values')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(h.writes()).toHaveLength(0);
  });

  it('after a failed upgrade, Edit values starts from the deployed revision\'s chart and values and says so', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'GET' && r.path.includes('owner%3Dhelm')
      ? json({ items: [
        releaseSecret('shop', 'team-a', 1, 'deployed', '15.1.0', { replicaCount: 2 }),
        releaseSecret('shop', 'team-a', 2, 'failed', '15.2.0', { replicaCount: 9 }),
      ] })
      : base(r));
    h.state.denied.add('get pods/log');
    h.renderUi(<HelmReleases nsFilter={undefined} charts={[]} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Edit values of shop');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/chart Helm stored in rev 1 \(nginx 15\.1\.0\).*The latest revision, rev 2, is failed; this starts from rev 1, the deployed one/)).toBeTruthy();
    expect((within(dialog).getByLabelText('Values') as HTMLTextAreaElement).value).toBe('replicaCount: 2\n');
    await continueWithoutPreview(dialog);
    expect(within(dialog).getByText(/Undo/).nextSibling?.textContent).toMatch(/Roll back to revision 1 \(nginx 15\.1\.0\)/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply values' }));
    await waitFor(() => expect(jobArgs()).toBeDefined());
    const chart = h.writes().find((w) => w.method === 'POST' && w.body?.metadata?.generateName === 'helm-chart-shop-')!;
    const files = untar(gunzipSync(Buffer.from(chart.body.data['chart.tgz'], 'base64')));
    expect(files['nginx/Chart.yaml']).toMatch(/version: 15\.1\.0/);
  });

  it('Edit values is disabled without permission to create Secrets; Upgrade is not', async () => {
    h.state.denied.add('create secrets');
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Upgrade shop' }) as HTMLButtonElement).disabled).toBe(false));
    const edit = screen.getByRole('button', { name: 'Edit values of shop' }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe('You do not have permission to create Secrets in team-a');
  });

  it('labels Upgrade with the newest version the repository offers', async () => {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    expect(screen.getByRole('button', { name: 'Upgrade shop' }).textContent).toContain('Upgrade to 15.3.0');
    expect(screen.queryByTestId('helm-no-repo-shop')).toBeNull();
  });

  it('uninstall runs "helm uninstall" after a danger confirmation', async () => {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Uninstall shop');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/deletes the objects it recorded for rev 2 \(2 objects: Service, Deployment\)/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(jobArgs()).toEqual(['uninstall', 'shop', '--namespace', 'team-a', '--wait', '--timeout', '5m']));
  });

  it('shows a failed Job create in the dialog', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'POST' && r.path === JOBS ? k8sStatus(403, 'jobs.batch is forbidden') : base(r));
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Uninstall shop');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Uninstall' }));
    expect(await screen.findByText('jobs.batch is forbidden')).toBeTruthy();
    expect(screen.queryByTestId('job-progress')).toBeNull();
  });

  it('refuses without a digest-pinned runner image, before any request', async () => {
    (window as unknown as { __OPENSHIFTPULSE_CONFIG__?: unknown }).__OPENSHIFTPULSE_CONFIG__ = { helmInstall: { runnerImage: 'alpine/helm:latest' } };
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Uninstall shop');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Uninstall' }));
    expect(await screen.findByText(/digest-pinned/)).toBeTruthy();
    expect(h.writes()).toHaveLength(0);
  });

  it('refuses an action prepared on another cluster', async () => {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Uninstall shop');
    await screen.findByRole('dialog');
    h.setActive(REMOTE);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Uninstall' }));
    expect(await screen.findByText(/was not run/)).toBeTruthy();
    expect(h.writes()).toHaveLength(0);
  });

  it('disables actions without permission to create Jobs in the namespace', async () => {
    h.state.denied.add('create jobs');
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Uninstall shop' }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Upgrade shop' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('helm runner pieces', () => {
  it('upgrade args carry --reset-values unless reuse is chosen, so empty values mean chart defaults', () => {
    expect(helmArgs({ action: 'upgrade', releaseName: 'r', chartName: 'c', repoUrl: 'https://x' }, 'ns'))
      .toEqual(['upgrade', 'r', 'c', '--repo', 'https://x', '--namespace', 'ns', '--reset-values', '--wait', '--timeout', '5m']);
    expect(helmArgs({ action: 'upgrade-stored', releaseName: 'r', chartSecretName: 'cs' }, 'ns'))
      .toEqual(['upgrade', 'r', '/tmp/chart/chart.tgz', '--namespace', 'ns', '--reset-values', '--wait', '--timeout', '5m']);
    expect(helmArgs({ action: 'upgrade', releaseName: 'r', chartName: 'c', repoUrl: 'https://x', valuesMode: 'reuse', atomic: true, valuesSecretName: 's' }, 'ns'))
      .toEqual(['upgrade', 'r', 'c', '--repo', 'https://x', '--namespace', 'ns', '--reset-then-reuse-values', '--atomic', '-f', '/tmp/values/values.yaml', '--wait', '--timeout', '5m']);
  });

  it('template args render only: no --wait, the cluster version and API list, the stored chart for a values change', () => {
    expect(helmArgs({ action: 'template', releaseName: 'r', chart: { from: 'repo', chartName: 'c', repoUrl: 'https://x', version: '1.0.0' }, valuesSecretName: 's', kubeVersion: 'v1.31.4', apiVersions: ['v1', 'route.openshift.io/v1'] }, 'ns'))
      .toEqual(['template', 'r', 'c', '--repo', 'https://x', '--version', '1.0.0', '--namespace', 'ns', '-f', '/tmp/values/values.yaml', '--include-crds', '--kube-version', 'v1.31.4', '--api-versions', 'v1', '--api-versions', 'route.openshift.io/v1']);
    expect(helmArgs({ action: 'template', releaseName: 'r', chart: { from: 'stored', chartSecretName: 'cs' }, isUpgrade: true }, 'ns'))
      .toEqual(['template', 'r', '/tmp/chart/chart.tgz', '--namespace', 'ns', '--include-crds', '--is-upgrade']);
    expect(() => helmArgs({ action: 'install', releaseName: 'r', chartName: '--post-renderer=x', repoUrl: 'https://x' }, 'ns')).toThrow(/not a valid chart or release name/);
  });

  it('install args carry the chosen version and the values file', () => {
    expect(helmArgs({ action: 'install', releaseName: 'r', chartName: 'c', repoUrl: 'https://x', version: '1.2.3', valuesSecretName: 's' }, 'ns'))
      .toEqual(['install', 'r', 'c', '--repo', 'https://x', '--namespace', 'ns', '--version', '1.2.3', '-f', '/tmp/values/values.yaml', '--wait', '--timeout', '5m']);
  });

  it('the repo index parser keeps every version of a chart and ignores nested lists', () => {
    const charts = parseIndexForTest(`apiVersion: v1
entries:
  nginx:
  - apiVersion: v2
    appVersion: 1.27.0
    description: NGINX
    maintainers:
    - email: a@example.com
      name: someone
    name: nginx
    version: 15.3.0
  - apiVersion: v2
    name: nginx
    version: 15.2.0
  redis:
    - name: redis
      version: 19.0.0
generated: "2026-10-01"
`);
    expect(charts.map((c) => [c.name, c.version, c.versions, c.appVersion])).toEqual([
      ['nginx', '15.3.0', ['15.3.0', '15.2.0'], '1.27.0'],
      ['redis', '19.0.0', ['19.0.0'], ''],
    ]);
  });

  it('the repo index parser keeps each version\'s archive URL', () => {
    const charts = parseIndexForTest(`apiVersion: v1
entries:
  nginx:
  - name: nginx
    urls:
    - https://charts.example.com/nginx-15.3.0.tgz
    - https://mirror.example.com/nginx-15.3.0.tgz
    version: 15.3.0
  - name: nginx
    version: 15.2.0
    urls:
    - nginx-15.2.0.tgz
`);
    expect(charts[0].versions).toEqual(['15.3.0', '15.2.0']);
    expect(charts[0].urls).toEqual({ '15.3.0': 'https://charts.example.com/nginx-15.3.0.tgz', '15.2.0': 'nginx-15.2.0.tgz' });
  });
});

import { HelmTab } from '../HelmTab';
import { QuickDeployTab } from '../QuickDeployTab';

describe('Helm install and Quick Deploy target namespace', () => {
  const INDEX = `apiVersion: v1
entries:
  nginx:
  - name: nginx
    description: NGINX
    version: 15.3.0
  - name: nginx
    version: 15.2.0
`;
  beforeEach(() => {
    const base = h.state.handler;
    h.state.handler = (r) => {
      if (r.url.endsWith('/index.yaml')) return new Response(INDEX, { status: 200 });
      if (r.method === 'GET' && r.path === '/api/v1/namespaces') return json({ items: [{ metadata: { name: 'team-a' } }, { metadata: { name: 'team-b' } }] });
      return base(r);
    };
  });

  it('in all-namespaces mode the user picks the namespace; install runs the chosen version there', async () => {
    h.state.handler = previewHandler(h.state.handler, { log: PLAIN_MANIFEST });
    h.renderUi(<HelmTab />);
    fireEvent.click(await screen.findByRole('button', { name: /NGINX/ }));
    expect((screen.getByRole('button', { name: 'Install' }) as HTMLButtonElement).disabled).toBe(true); // no silent `default`, no install before a preview
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Namespace' }), { target: { value: 'team-b' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Chart version' }), { target: { value: '15.2.0' } });
    await clickWhenEnabled('Preview');
    await screen.findByTestId('helm-preview');
    await clickWhenEnabled('Install 2 objects');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/helm install my-nginx nginx --version 15.2.0.*as a Job in team-b/)).toBeTruthy();
    expect(within(dialog).getByTestId('install-confirm-summary').textContent).toMatch(/2 objects pass the dry run; no hooks run on install.*Undo: Uninstall the release/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install 2 objects' }));
    await waitFor(() => expect(jobsBy(h.writes(), 'install')).toHaveLength(1));
    const job = jobsBy(h.writes(), 'install')[0];
    expect(job.body.spec.template.spec.containers[0].args).toEqual(['install', 'my-nginx', 'nginx', '--repo', 'https://charts.openshift.io', '--namespace', 'team-b', '--version', '15.2.0', '--atomic', '--wait', '--timeout', '5m']);
  });

  it('Quick Deploy will not deploy in all-namespaces mode until a namespace is chosen', async () => {
    h.renderUi(<QuickDeployTab />);
    fireEvent.change(screen.getByPlaceholderText('my-app'), { target: { value: 'web' } });
    fireEvent.change(screen.getByPlaceholderText('nginx:latest or quay.io/org/image:tag'), { target: { value: 'nginx:1' } });
    expect((screen.getByRole('button', { name: /Deploy/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Namespace' }), { target: { value: 'team-a' } });
    fireEvent.click(screen.getByRole('button', { name: /Deploy/ }));
    await waitFor(() => expect(h.writes()[0]?.path).toBe('/apis/apps/v1/namespaces/team-a/deployments'));
  });
});
