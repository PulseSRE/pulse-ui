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
import { helmArgs, parseIndexForTest, releaseSecret } from './helmTestUtils';

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
    if (r.method === 'POST' && r.path.endsWith('/secrets')) return json({ metadata: { name: 'helm-values-shop-x1' } });
    if (r.method === 'POST' && r.path === JOBS) return json({ metadata: { name: `helm-${r.body.spec.template.spec.containers[0].args[0]}-shop-abc12` } });
    return json({});
  };
});
afterEach(() => { cleanup(); h.teardown(); delete (window as unknown as { __OPENSHIFTPULSE_CONFIG__?: unknown }).__OPENSHIFTPULSE_CONFIG__; });

function jobArgs() {
  const job = h.writes().find((w) => w.method === 'POST' && w.path === JOBS);
  return job?.body.spec.template.spec.containers[0].args;
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
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Upgrade shop');
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Values') as HTMLTextAreaElement).value).toContain('replicaCount: 2');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Chart version' }), { target: { value: '15.2.0' } });
    fireEvent.change(within(dialog).getByLabelText('Values'), { target: { value: 'replicaCount: 4\n' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upgrade' }));

    await waitFor(() => expect(jobArgs()).toBeDefined());
    const secret = h.writes().find((w) => w.path === '/api/v1/namespaces/team-a/secrets');
    expect(secret?.body.stringData).toEqual({ 'values.yaml': 'replicaCount: 4\n' });
    expect(jobArgs()).toEqual(['upgrade', 'shop', 'nginx', '--repo', 'https://charts.example.com', '--namespace', 'team-a', '--version', '15.2.0', '-f', '/tmp/values/values.yaml', '--wait', '--timeout', '5m']);
    const spec = h.writes().find((w) => w.path === JOBS)!.body.spec.template.spec;
    expect(spec.volumes).toContainEqual({ name: 'values', secret: { secretName: 'helm-values-shop-x1' } });
    expect(spec.containers[0].image).toBe(RUNNER);
  });

  it('rejects invalid values YAML without sending anything', async () => {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Upgrade shop');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Values'), { target: { value: 'a: [unclosed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upgrade' }));
    expect(await within(dialog).findByText('The values are not valid YAML')).toBeTruthy();
    expect(h.writes()).toHaveLength(0);
  });

  it('says upgrade is not possible when the chart is in no configured repository', async () => {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={[]} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Upgrade shop');
    expect(within(await screen.findByRole('dialog')).getByText(/not in any configured chart repository/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(h.writes()).toHaveLength(0);
  });

  it('uninstall runs "helm uninstall" after a danger confirmation', async () => {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={CHARTS} />);
    await screen.findByTestId('helm-release-shop');
    await clickWhenEnabled('Uninstall shop');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Every resource the chart created is deleted/)).toBeTruthy();
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
    h.renderUi(<HelmTab />);
    fireEvent.click(await screen.findByRole('button', { name: /NGINX/ }));
    const install = screen.getByRole('button', { name: 'Install' });
    expect((install as HTMLButtonElement).disabled).toBe(true); // no silent `default`
    fireEvent.change(await screen.findByRole('combobox', { name: 'Namespace' }), { target: { value: 'team-b' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Chart version' }), { target: { value: '15.2.0' } });
    fireEvent.click(install);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/helm install my-nginx nginx --version 15.2.0.*as a Job in team-b/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(h.writes().some((w) => w.path === '/apis/batch/v1/namespaces/team-b/jobs')).toBe(true));
    const job = h.writes().find((w) => w.path === '/apis/batch/v1/namespaces/team-b/jobs')!;
    expect(job.body.spec.template.spec.containers[0].args).toEqual(['install', 'my-nginx', 'nginx', '--repo', 'https://charts.openshift.io', '--namespace', 'team-b', '--version', '15.2.0', '--wait', '--timeout', '5m']);
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
