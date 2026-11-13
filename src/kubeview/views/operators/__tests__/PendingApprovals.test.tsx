// @vitest-environment jsdom
/**
 * "Needs approval" on /operators: every pending InstallPlan across namespaces,
 * from -> to, approved through the shared WriteConfirmDialog with a server dry
 * run and the reviewed resourceVersion as a precondition. Errors are errors,
 * not "nothing waiting"; superseded plans cannot be approved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createHarness, json, k8sStatus, REMOTE } from '../../../__tests__/actionHarness';
import { PendingApprovals } from '../PendingApprovals';
import { csvVersion, gitopsOwner, pendingApprovals, type InstallPlanLike, type SubscriptionLike } from '../../../engine/olm';
import { useTrustStore } from '../../../store/trustStore';
import OperatorCatalogView from '../../OperatorCatalogView';

const askPulse = vi.hoisted(() => vi.fn());
vi.mock('../../../engine/askPulse', () => ({ askPulse }));

const h = createHarness();
beforeEach(() => { h.setup(); useTrustStore.setState({ trustLevel: 1 }); askPulse.mockClear(); });
afterEach(() => { cleanup(); h.teardown(); });

const PLANS = '/apis/operators.coreos.com/v1alpha1/installplans';
const planPath = (ns: string, name: string) => `/apis/operators.coreos.com/v1alpha1/namespaces/${ns}/installplans/${name}`;

function plan(name: string, ns: string, over: Partial<{ approved: boolean; phase: string; csv: string; sub: string; rv: string; created: string }> = {}): InstallPlanLike {
  return {
    metadata: { name, namespace: ns, resourceVersion: over.rv ?? '1001', creationTimestamp: over.created ?? '2026-11-10T08:00:00Z', ownerReferences: [{ kind: 'Subscription', name: over.sub ?? 'es-operator' }] },
    spec: { approved: over.approved ?? false, approval: 'Manual', clusterServiceVersionNames: [over.csv ?? 'es-operator.v5.8.2'] },
    status: { phase: over.phase ?? 'RequiresApproval', plan: [{ resource: { kind: 'CustomResourceDefinition', name: 'x.y' } }, { resource: { kind: 'ClusterRole', name: 'r' } }] },
  };
}

function sub(name: string, ns: string, ref: string, installed = 'es-operator.v5.8.1'): SubscriptionLike {
  return { metadata: { name, namespace: ns }, spec: { name: 'elasticsearch-operator', channel: 'stable-5.8' }, status: { installedCSV: installed, installPlanRef: { name: ref } } };
}

const SUBS = [sub('es-operator', 'openshift-operators', 'install-new'), sub('loki', 'team-logs', 'install-loki', 'loki.v6.0.3')];
const PLAN_LIST = [
  plan('install-new', 'openshift-operators'),
  plan('install-old', 'openshift-operators', { rv: '900', created: '2026-11-01T08:00:00Z' }),
  plan('install-loki', 'team-logs', { sub: 'loki', csv: 'loki.v6.0.4', rv: '77' }),
  plan('install-done', 'openshift-operators', { approved: true, phase: 'Complete' }),
];

function serve(over: (r: { method: string; path: string }) => Response | undefined = () => undefined) {
  h.state.handler = (r) => over(r) ?? (r.method === 'GET' && r.path.startsWith(PLANS) ? json({ items: PLAN_LIST }) : json({}));
}

/** Approve inside the dialog once the dry run and permission check let it. */
async function approveIn(dialog: HTMLElement) {
  const btn = within(dialog).getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  fireEvent.click(btn);
}

describe('pendingApprovals', () => {
  it('keeps only unapproved, unfinished plans, oldest first, with from -> to and the current flag', () => {
    const rows = pendingApprovals(PLAN_LIST, SUBS);
    expect(rows.map((r) => r.plan.metadata.name)).toEqual(['install-old', 'install-new', 'install-loki']);
    const es = rows.find((r) => r.plan.metadata.name === 'install-new')!;
    expect(es).toMatchObject({ operator: 'elasticsearch-operator', channel: 'stable-5.8', installs: ['es-operator.v5.8.2'], replaces: ['es-operator.v5.8.1'], current: true, crdCount: 1, stepCount: 2 });
    expect(rows.find((r) => r.plan.metadata.name === 'install-old')!.current).toBe(false);
  });

  it('without Subscriptions the from-version and the current flag are unknown, not guessed', () => {
    const rows = pendingApprovals(PLAN_LIST, null);
    expect(rows.every((r) => r.current === null && r.replaces.length === 0)).toBe(true);
    expect(rows.find((r) => r.plan.metadata.name === 'install-loki')!.operator).toBe('loki');
  });

  it('reads versions and Argo CD tracking', () => {
    expect(csvVersion('loki-operator.v6.0.4')).toBe('6.0.4');
    expect(csvVersion('weird')).toBe('weird');
    expect(gitopsOwner({ metadata: { annotations: { 'argocd.argoproj.io/tracking-id': 'ops:operators.coreos.com/Subscription:ns/x' } } })).toBe('ops');
    expect(gitopsOwner({ metadata: { labels: { 'app.kubernetes.io/instance': 'cluster-config' } } })).toBe('cluster-config');
    expect(gitopsOwner({ metadata: {} })).toBeNull();
  });
});

describe('PendingApprovals', () => {
  it('lists every pending plan across namespaces with from -> to, and marks the superseded one', async () => {
    serve();
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={SUBS} />);
    const rows = await screen.findAllByTestId('pending-approval');
    expect(rows).toHaveLength(3);
    const old = rows.find((r) => r.textContent?.includes('install-old'))!;
    expect(old.textContent).toContain('Superseded');
    expect((within(old).getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    const loki = rows.find((r) => r.textContent?.includes('install-loki'))!;
    expect(loki.textContent).toMatch(/6\.0\.3.*6\.0\.4/);
    expect(loki.textContent).toContain('team-logs/install-loki');
    expect(screen.getByText(/OLM has no Deny/)).toBeTruthy();
  });

  it('approves with a server dry run first, then the patch held to the reviewed resourceVersion', async () => {
    serve();
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={SUBS} />);
    const loki = (await screen.findAllByTestId('pending-approval')).find((r) => r.textContent?.includes('install-loki'))!;
    fireEvent.click(within(loki).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/spec.approved: false/)).toBeTruthy();
    expect(within(dialog).getByText(/spec.approved: true/)).toBeTruthy();
    expect(within(dialog).getByText(/loki.v6.0.4/)).toBeTruthy();
    expect(within(dialog).getByText(/OLM cannot un-approve/)).toBeTruthy();
    await approveIn(dialog);
    await waitFor(() => expect(h.writes()).toHaveLength(2));
    const [dry, real] = h.writes();
    expect(dry).toMatchObject({ method: 'PATCH', path: `${planPath('team-logs', 'install-loki')}?dryRun=All` });
    expect(real).toMatchObject({
      method: 'PATCH',
      path: planPath('team-logs', 'install-loki'),
      body: { metadata: { resourceVersion: '77' }, spec: { approved: true } },
      headers: expect.objectContaining({ 'Content-Type': 'application/merge-patch+json' }),
    });
  });

  it('a failed dry run keeps Approve disabled and writes nothing', async () => {
    serve((r) => (r.method === 'PATCH' ? k8sStatus(403, 'installplans.operators.coreos.com "install-loki" is forbidden') : undefined));
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={SUBS} />);
    const loki = (await screen.findAllByTestId('pending-approval')).find((r) => r.textContent?.includes('install-loki'))!;
    fireEvent.click(within(loki).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('write-dry-run').textContent).toContain('Failed'));
    expect((within(dialog).getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.writes().every((w) => w.path.endsWith('?dryRun=All'))).toBe(true);
  });

  it('a plan changed since review (409) is reported in the dialog, not approved', async () => {
    serve((r) => (r.method === 'PATCH' && !r.path.endsWith('?dryRun=All') ? k8sStatus(409, 'the object has been modified') : undefined));
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={SUBS} />);
    const loki = (await screen.findAllByTestId('pending-approval')).find((r) => r.textContent?.includes('install-loki'))!;
    fireEvent.click(within(loki).getByRole('button', { name: 'Approve' }));
    await approveIn(await screen.findByRole('dialog'));
    await waitFor(() => expect(h.writes().length).toBe(2));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Not approved: The object changed since this page loaded it, so nothing was changed/);
  });

  it('refuses an approval prepared on another cluster', async () => {
    serve();
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={SUBS} />);
    const loki = (await screen.findAllByTestId('pending-approval')).find((r) => r.textContent?.includes('install-loki'))!;
    fireEvent.click(within(loki).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('write-dry-run').textContent).toContain('Passed'));
    h.setActive(REMOTE);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/was not run/)).toBeTruthy();
    expect(h.writes().filter((w) => !w.path.endsWith('?dryRun=All'))).toHaveLength(0);
  });

  it('observe mode and missing permission block the approval and say why', async () => {
    serve();
    useTrustStore.setState({ trustLevel: 0 });
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={SUBS} />);
    let loki = (await screen.findAllByTestId('pending-approval')).find((r) => r.textContent?.includes('install-loki'))!;
    fireEvent.click(within(loki).getByRole('button', { name: 'Approve' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('write-blocked').textContent).toContain('Observe mode');
    expect((within(dialog).getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    cleanup();

    useTrustStore.setState({ trustLevel: 1 });
    h.state.denied.add('patch installplans');
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={SUBS} />);
    loki = (await screen.findAllByTestId('pending-approval')).find((r) => r.textContent?.includes('install-loki'))!;
    fireEvent.click(within(loki).getByRole('button', { name: 'Approve' }));
    dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('write-blocked').textContent).toContain('do not have permission to patch InstallPlans in team-logs'));
    expect(h.writes()).toHaveLength(0);
  });

  it('a forbidden InstallPlan list is an error, never "nothing waiting"', async () => {
    serve((r) => (r.method === 'GET' && r.path.startsWith(PLANS) ? k8sStatus(403, 'installplans.operators.coreos.com is forbidden') : undefined));
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={SUBS} />);
    expect(await screen.findByText(/InstallPlans could not be read/)).toBeTruthy();
    expect(screen.queryByText(/No operator update is waiting/)).toBeNull();
  });

  it('says plainly when nothing is waiting, and notes unreadable Subscriptions', async () => {
    serve((r) => (r.method === 'GET' && r.path.startsWith(PLANS) ? json({ items: [] }) : undefined));
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={SUBS} />);
    expect(await screen.findByText('No operator update is waiting for approval.')).toBeTruthy();
    cleanup();
    serve();
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={null} subscriptionsError={new Error('forbidden')} />);
    expect(await screen.findByText(/Subscriptions could not be read/)).toBeTruthy();
    expect((await screen.findAllByTestId('pending-approval')).every((r) => !r.textContent?.includes('Superseded'))).toBe(true);
  });

  it('shows nothing when OLM is not installed (404)', async () => {
    serve((r) => (r.method === 'GET' && r.path.startsWith(PLANS) ? k8sStatus(404, 'not found') : undefined));
    const { container } = h.renderUi(<PendingApprovals clusterId="local" subscriptions={[]} />);
    await waitFor(() => expect(container.querySelector('#needs-approval')).toBeNull());
  });

  it('Ask Pulse on a row asks about that InstallPlan with it as context', async () => {
    serve();
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={SUBS} />);
    const loki = (await screen.findAllByTestId('pending-approval')).find((r) => r.textContent?.includes('install-loki'))!;
    fireEvent.click(within(loki).getByRole('button', { name: /Ask Pulse/ }));
    expect(askPulse).toHaveBeenCalledWith(
      expect.stringContaining('team-logs/install-loki'),
      { kind: 'InstallPlan', name: 'install-loki', namespace: 'team-logs', gvr: 'operators.coreos.com/v1alpha1/installplans' },
    );
  });

  it('the Inbox link (?view=approvals) scrolls to the list', async () => {
    serve();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    h.renderUi(<PendingApprovals clusterId="local" subscriptions={SUBS} highlight />);
    await screen.findAllByTestId('pending-approval');
    expect(scroll).toHaveBeenCalled();
  });
});

describe('Operators page', () => {
  it('shows Needs approval above the catalog, fed by the page Subscription list', async () => {
    h.state.handler = (r) => {
      if (r.method !== 'GET') return json({});
      if (r.path.startsWith(PLANS)) return json({ items: PLAN_LIST });
      if (r.path.startsWith('/apis/operators.coreos.com/v1alpha1/subscriptions')) return json({ items: SUBS });
      return json({ items: [] });
    };
    Element.prototype.scrollIntoView = vi.fn();
    h.renderUi(<OperatorCatalogView />, '/operators?view=approvals');
    expect(await screen.findByRole('heading', { name: 'Needs approval' })).toBeTruthy();
    const rows = await screen.findAllByTestId('pending-approval');
    expect(rows).toHaveLength(3);
    await waitFor(() => expect(rows.find((r) => r.textContent?.includes('install-new'))!.textContent).toMatch(/5\.8\.1.*5\.8\.2/));
  });
});
