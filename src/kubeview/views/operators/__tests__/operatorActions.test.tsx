// @vitest-environment jsdom
/**
 * OLM install and management: the install reuses the namespace's
 * OperatorGroup (no TooManyOperatorGroups), takes its mode from the CSV's
 * installModes and its approval strategy from the form; installed operators
 * can change channel, switch approval and approve a pending InstallPlan.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { clickWhenEnabled, createHarness, json, k8sStatus, REMOTE } from '../../../__tests__/actionHarness';
import { InstallOperatorForm, type InstallablePackage } from '../InstallOperatorForm';
import { ManageSubscription } from '../ManageSubscription';
import { planOperatorGroup, upgradeAvailable } from '../../../engine/olm';

const h = createHarness();
beforeEach(() => h.setup());
afterEach(() => { cleanup(); h.teardown(); });

const OG_PATH = (ns: string) => `/apis/operators.coreos.com/v1/namespaces/${ns}/operatorgroups`;

const PKG: InstallablePackage = {
  name: 'loki-operator',
  displayName: 'Loki Operator',
  source: 'redhat-operators',
  sourceNamespace: 'openshift-marketplace',
  defaultChannel: 'stable-6.1',
  channels: [{ name: 'stable-6.1', version: '6.1.0', installModes: [
    { type: 'OwnNamespace', supported: true }, { type: 'SingleNamespace', supported: true },
    { type: 'MultiNamespace', supported: false }, { type: 'AllNamespaces', supported: true },
  ] }],
  suggestedNamespace: 'team-logs',
};

describe('planOperatorGroup', () => {
  const modes = [{ type: 'AllNamespaces', supported: true }, { type: 'OwnNamespace', supported: false }];
  it('reuses the one existing group when its mode is supported', () => {
    expect(planOperatorGroup({ packageName: 'x', ns: 'a', mode: 'AllNamespaces', existing: [{ metadata: { name: 'g' }, spec: {} }], supportedModes: modes }))
      .toEqual({ action: 'reuse', name: 'g', mode: 'AllNamespaces' });
  });
  it('refuses when the existing group installs in an unsupported mode, or there are two groups', () => {
    expect(planOperatorGroup({ packageName: 'x', ns: 'a', mode: 'AllNamespaces', existing: [{ metadata: { name: 'g' }, spec: { targetNamespaces: ['a'] } }], supportedModes: modes }).action).toBe('refuse');
    expect(planOperatorGroup({ packageName: 'x', ns: 'a', mode: 'AllNamespaces', existing: [{ metadata: { name: 'g1' } }, { metadata: { name: 'g2' } }], supportedModes: modes }).action).toBe('refuse');
  });
  it('flags an upgrade when OLM resolved a newer CSV than the installed one', () => {
    expect(upgradeAvailable({ metadata: { name: 's', namespace: 'n' }, status: { installedCSV: 'op.v1', currentCSV: 'op.v2', state: 'UpgradePending' } })).toBe('op.v2');
    expect(upgradeAvailable({ metadata: { name: 's', namespace: 'n' }, status: { installedCSV: 'op.v2', currentCSV: 'op.v2', state: 'AtLatestKnown' } })).toBeNull();
  });
});

describe('InstallOperatorForm', () => {
  it('reuses the namespace OperatorGroup and creates only the Subscription, with Manual approval', async () => {
    h.state.handler = (r) => {
      if (r.method === 'GET' && r.path === OG_PATH('team-logs')) return json({ items: [{ metadata: { name: 'existing-og', namespace: 'team-logs' }, spec: { targetNamespaces: ['team-logs'] } }] });
      if (r.method === 'POST' && r.path === '/api/v1/namespaces') return k8sStatus(409, 'namespaces "team-logs" already exists');
      return json({});
    };
    const installed: string[] = [];
    h.renderUi(<InstallOperatorForm pkg={PKG} onInstalled={(i) => installed.push(i.ns)} />);

    expect(await screen.findByText('Reuses OperatorGroup existing-og already in team-logs (OwnNamespace).')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Manual/ }));
    await clickWhenEnabled(/Install/);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Reuses OperatorGroup existing-og.*with Manual update approval/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }));

    await waitFor(() => expect(installed).toEqual(['team-logs']));
    const posts = h.writes().map((w) => `${w.method} ${w.path}`);
    expect(posts).toEqual([
      'POST /api/v1/namespaces',
      'POST /apis/operators.coreos.com/v1alpha1/namespaces/team-logs/subscriptions',
    ]);
    expect(h.writes()[1].body.spec).toEqual({
      channel: 'stable-6.1', name: 'loki-operator', source: 'redhat-operators', sourceNamespace: 'openshift-marketplace', installPlanApproval: 'Manual',
    });
  });

  it('creates an OperatorGroup in the chosen install mode when the namespace has none', async () => {
    h.state.handler = (r) => (r.method === 'GET' ? json({ items: [] }) : json({}));
    h.renderUi(<InstallOperatorForm pkg={PKG} onInstalled={() => {}} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Only the install namespace/ }));
    await screen.findByText(/Creates OperatorGroup loki-operator-group in team-logs \(OwnNamespace, watching team-logs\)/);
    await clickWhenEnabled(/Install/);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(h.writes()).toHaveLength(3));
    const og = h.writes()[1];
    expect(og.path).toBe(OG_PATH('team-logs'));
    expect(og.body).toMatchObject({ kind: 'OperatorGroup', metadata: { name: 'loki-operator-group' }, spec: { targetNamespaces: ['team-logs'] } });
  });

  it('will not install when the existing OperatorGroup mode is unsupported, and says why', async () => {
    const allOnly = { ...PKG, channels: [{ name: 'stable-6.1', installModes: [{ type: 'AllNamespaces', supported: true }, { type: 'OwnNamespace', supported: false }] }] };
    h.state.handler = (r) => (r.method === 'GET' ? json({ items: [{ metadata: { name: 'own' }, spec: { targetNamespaces: ['team-logs'] } }] }) : json({}));
    h.renderUi(<InstallOperatorForm pkg={allOnly} onInstalled={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/OperatorGroup own, which installs operators in OwnNamespace mode/));
    expect((screen.getByRole('button', { name: /Install/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a failed Subscription create in the dialog', async () => {
    h.state.handler = (r) => {
      if (r.method === 'GET') return json({ items: [] });
      if (r.path.endsWith('/subscriptions')) return k8sStatus(403, 'subscriptions.operators.coreos.com is forbidden');
      return json({});
    };
    h.renderUi(<InstallOperatorForm pkg={PKG} onInstalled={() => {}} />);
    await clickWhenEnabled(/Install/);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Install' }));
    expect(await screen.findByText(/subscriptions.operators.coreos.com is forbidden/)).toBeTruthy();
  });
});

describe('ManageSubscription', () => {
  const sub = {
    metadata: { name: 'loki-operator', namespace: 'team-logs' },
    spec: { channel: 'stable-6.0', installPlanApproval: 'Manual' },
    status: { installedCSV: 'loki.v6.0.3', currentCSV: 'loki.v6.0.4', state: 'UpgradePending', installPlanRef: { name: 'install-abc' } },
  };
  const plan = { metadata: { name: 'install-abc', namespace: 'team-logs' }, spec: { approved: false, approval: 'Manual', clusterServiceVersionNames: ['loki.v6.0.4'] }, status: { phase: 'RequiresApproval' } };
  const channels = [{ name: 'stable-6.0' }, { name: 'stable-6.1' }];

  it('shows the waiting upgrade and approves the InstallPlan with spec.approved=true', async () => {
    h.renderUi(<ManageSubscription sub={sub} installPlan={plan} channels={channels} displayName="Loki" />);
    expect(screen.getByText(/Upgrade available: loki.v6.0.4/)).toBeTruthy();
    await clickWhenEnabled('Approve');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0]).toMatchObject({
      method: 'PATCH',
      path: '/apis/operators.coreos.com/v1alpha1/namespaces/team-logs/installplans/install-abc',
      body: { spec: { approved: true } },
      headers: expect.objectContaining({ 'Content-Type': 'application/merge-patch+json' }),
    });
  });

  it('changes the channel and switches approval with merge patches on the Subscription', async () => {
    h.renderUi(<ManageSubscription sub={sub} installPlan={null} channels={channels} displayName="Loki" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Channel' }), { target: { value: 'stable-6.1' } });
    await clickWhenEnabled('Change channel');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    await clickWhenEnabled('Switch to Automatic');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(h.writes()).toHaveLength(2));
    const path = '/apis/operators.coreos.com/v1alpha1/namespaces/team-logs/subscriptions/loki-operator';
    expect(h.writes().map((w) => [w.path, w.body])).toEqual([
      [path, { spec: { channel: 'stable-6.1' } }],
      [path, { spec: { installPlanApproval: 'Automatic' } }],
    ]);
  });

  it('refuses a change prepared on another cluster', async () => {
    h.renderUi(<ManageSubscription sub={sub} installPlan={plan} channels={channels} displayName="Loki" />);
    await clickWhenEnabled('Approve');
    await screen.findByRole('dialog');
    h.setActive(REMOTE);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/was not run/)).toBeTruthy();
    expect(h.writes()).toHaveLength(0);
  });

  it('disables InstallPlan approval without patch permission', async () => {
    h.state.denied.add('patch installplans');
    h.renderUi(<ManageSubscription sub={sub} installPlan={plan} channels={channels} displayName="Loki" />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true));
  });
});

import OperatorCatalogView from '../../OperatorCatalogView';
import { useLocation } from 'react-router-dom';

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; }

describe('Operator detail is in the URL', () => {
  const manifest = {
    metadata: { name: 'loki-operator' },
    status: {
      catalogSource: 'redhat-operators', catalogSourceNamespace: 'openshift-marketplace', defaultChannel: 'stable-6.1', provider: { name: 'Red Hat' },
      channels: [{ name: 'stable-6.1', currentCSV: 'loki.v6.1.0', currentCSVDesc: { displayName: 'Loki Operator', description: 'Logs', icon: [], version: '6.1.0', provider: { name: 'Red Hat' }, installModes: [{ type: 'AllNamespaces', supported: true }] } }],
    },
  };
  beforeEach(() => {
    h.state.handler = (r) => (r.path.startsWith('/apis/packages.operators.coreos.com') ? json({ items: [manifest] }) : json({ items: [] }));
  });

  it('opens the detail from ?pkg= and Back to catalog removes it', async () => {
    h.renderUi(<><OperatorCatalogView /><Where /></>, '/operators?pkg=loki-operator');
    expect(await screen.findByRole('heading', { name: 'Loki Operator' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back to catalog/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/operators'));
  });

  it('selecting an operator from the grid puts ?pkg= in the URL', async () => {
    h.renderUi(<><OperatorCatalogView /><Where /></>, '/operators');
    fireEvent.click(await screen.findByRole('button', { name: /Loki Operator/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/operators?pkg=loki-operator'));
  });
});
