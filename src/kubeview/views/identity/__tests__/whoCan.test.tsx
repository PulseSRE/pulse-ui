// @vitest-environment jsdom
/**
 * Wave 16 — "Who can" via ResourceAccessReview, with the binding chain
 * behind each subject, or an honest "not available".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { clickWhenEnabled, createHarness, json, k8sStatus, REMOTE, type Recorded } from '../../../__tests__/actionHarness';
import { WhoCanPanel, accessReviewRequest, splitResource } from '../WhoCanPanel';
import { askPulse } from '../../../engine/askPulse';

vi.mock('../../../engine/askPulse', () => ({ askPulse: vi.fn() }));

const h = createHarness();
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => { h.setup(); vi.mocked(askPulse).mockClear(); });
afterEach(() => { cleanup(); h.teardown(); });

const RBAC = 'rbac.authorization.k8s.io';
const NAMESPACES = [{ metadata: { name: 'payments' } }, { metadata: { name: 'shop' } }] as never[];
const DISCOVERY = { resources: [{ name: 'resourceaccessreviews' }, { name: 'localresourceaccessreviews' }, { name: 'subjectrulesreviews' }] };

function whoCanCluster(over: (r: Recorded) => Response | undefined = () => undefined) {
  h.state.handler = (req) => {
    // A remote cluster's requests go through its proxy base; answer them the same.
    const r = req.path.includes('/proxy/') ? { ...req, path: req.path.slice(req.path.indexOf('/proxy/') + 6) } : req;
    const o = over(r); if (o) return o;
    if (r.path === '/apis/authorization.openshift.io/v1') return json(DISCOVERY);
    if (r.path === '/apis/authorization.openshift.io/v1/namespaces/payments/localresourceaccessreviews') {
      return json({ users: ['frank', 'carol', 'system:serviceaccount:payments:deployer', 'system:serviceaccount:kube-system:namespace-controller'], groups: ['payments-devs', 'platform-admins', 'system:masters'] });
    }
    if (r.path === '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings') return json({ items: [
      { metadata: { name: 'platform-admins', creationTimestamp: '2025-03-02T00:00:00Z' }, roleRef: { kind: 'ClusterRole', name: 'cluster-admin' }, subjects: [{ kind: 'Group', apiGroup: RBAC, name: 'platform-admins' }] },
    ] });
    if (r.path === '/apis/rbac.authorization.k8s.io/v1/namespaces/payments/rolebindings') return json({ items: [
      { metadata: { name: 'payments-devs-edit', namespace: 'payments', creationTimestamp: '2026-01-10T00:00:00Z' }, roleRef: { kind: 'ClusterRole', name: 'edit' }, subjects: [{ kind: 'Group', apiGroup: RBAC, name: 'payments-devs' }] },
      { metadata: { name: 'frank-admin', namespace: 'payments', creationTimestamp: '2026-08-01T00:00:00Z' }, roleRef: { kind: 'ClusterRole', name: 'admin' }, subjects: [{ kind: 'User', apiGroup: RBAC, name: 'frank' }] },
      { metadata: { name: 'deployer-secrets', namespace: 'payments', creationTimestamp: '2026-11-05T02:14:00Z' }, roleRef: { kind: 'Role', name: 'secret-manager' }, subjects: [{ kind: 'ServiceAccount', name: 'deployer', namespace: 'payments' }] },
    ] });
    if (r.path === '/apis/rbac.authorization.k8s.io/v1/clusterroles') return json({ items: [
      { metadata: { name: 'cluster-admin' }, rules: [{ verbs: ['*'], apiGroups: ['*'], resources: ['*'] }] },
      { metadata: { name: 'admin' }, rules: [{ verbs: ['delete', 'get'], apiGroups: [''], resources: ['secrets'] }] },
      { metadata: { name: 'edit' }, rules: [{ verbs: ['delete'], apiGroups: [''], resources: ['secrets'] }] },
    ] });
    if (r.path === '/apis/rbac.authorization.k8s.io/v1/namespaces/payments/roles') return json({ items: [
      { metadata: { name: 'secret-manager', namespace: 'payments' }, rules: [{ verbs: ['get', 'list', 'delete', 'patch'], apiGroups: [''], resources: ['secrets'] }] },
    ] });
    if (r.path === '/apis/user.openshift.io/v1/groups') return json({ items: [
      { metadata: { name: 'payments-devs' }, users: ['alice', 'carol', 'dan'] },
      { metadata: { name: 'platform-admins' }, users: ['bob', 'erin'] },
    ] });
    return json({});
  };
}

async function ask() {
  h.renderUi(<WhoCanPanel namespaces={NAMESPACES} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Who can namespace' }), { target: { value: 'payments' } });
  await clickWhenEnabled('Check');
  return screen.findByTestId('who-can-result');
}

describe('Who can', () => {
  it('builds Local/ResourceAccessReview requests', () => {
    expect(splitResource('deployments.apps')).toEqual({ resource: 'deployments', group: 'apps' });
    expect(accessReviewRequest({ verb: 'delete', resource: 'secrets', namespace: '' }).path).toBe('/apis/authorization.openshift.io/v1/resourceaccessreviews');
  });

  it('lists every subject with the binding → role chain, hides system subjects behind a toggle', async () => {
    whoCanCluster();
    const result = await ask();
    const review = h.writes().find((w) => w.path.endsWith('localresourceaccessreviews'))!;
    expect(review.body).toEqual({ apiVersion: 'authorization.openshift.io/v1', kind: 'LocalResourceAccessReview', namespace: 'payments', verb: 'delete', resource: 'secrets', resourceAPIGroup: '', resourceName: '' });
    expect(within(result).getByRole('status').textContent).toMatch(/^4 subjects can delete secrets in payments/);
    const rows = within(result).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows.find((t) => t!.startsWith('Group payments-devs'))).toMatch(/alice, carol, dan.*RoleBinding payments\/payments-devs-edit.*ClusterRole edit/);
    expect(rows.find((t) => t!.startsWith('Group platform-admins'))).toMatch(/ClusterRoleBinding platform-admins.*ClusterRole cluster-admin· cluster-wide/);
    expect(rows.find((t) => t!.startsWith('User frank'))).toMatch(/RoleBinding payments\/frank-admin.*ClusterRole admin/);
    expect(rows.find((t) => t!.startsWith('ServiceAccount payments/deployer'))).toMatch(/Role secret-manager/);
    // carol is allowed only through payments-devs, so she appears on that row, not twice
    expect(rows.some((t) => t!.startsWith('User carol'))).toBe(false);
    const toggle = within(result).getByRole('button', { name: /2 system subjects also can/ });
    fireEvent.click(toggle);
    expect(within(result).getByText('Group system:masters')).toBeTruthy();
  });

  it('says "not available" when the cluster does not serve ResourceAccessReview, and sends no review', async () => {
    h.state.handler = (r) => (r.path === '/apis/authorization.openshift.io/v1' ? k8sStatus(404, 'not found') : json({}));
    h.renderUi(<WhoCanPanel namespaces={NAMESPACES} />);
    expect((await screen.findByTestId('who-can-unavailable')).textContent).toMatch(/^Not available on this cluster/);
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.writes()).toHaveLength(0);
  });

  it('a forbidden review is an error, not an empty list', async () => {
    whoCanCluster((r) => (r.path.endsWith('localresourceaccessreviews') ? k8sStatus(403, 'localresourceaccessreviews is forbidden') : undefined));
    h.renderUi(<WhoCanPanel namespaces={NAMESPACES} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Who can namespace' }), { target: { value: 'payments' } });
    await clickWhenEnabled('Check');
    expect((await screen.findByRole('alert')).textContent).toMatch(/The access review could not be run.*forbidden/);
    expect(screen.queryByTestId('who-can-result')).toBeNull();
  });

  it('asks the same question in chat with the namespace attached', async () => {
    whoCanCluster();
    const result = await ask();
    fireEvent.click(within(result).getByRole('button', { name: /Ask in chat/ }));
    expect(askPulse).toHaveBeenCalledWith('Who can delete secrets in payments?', { kind: 'Namespace', name: 'payments', gvr: 'v1~namespaces' });
  });

  it('on a remote cluster the review runs there but chat is disabled', async () => {
    whoCanCluster();
    h.setActive(REMOTE);
    const result = await ask();
    expect(h.writes().find((w) => w.path.endsWith('localresourceaccessreviews'))!.url).toContain('/prod-east/proxy/');
    const btn = within(result).getByRole('button', { name: /Ask in chat/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(within(result).getByText('Pulse AI answers about the local cluster only.')).toBeTruthy();
    fireEvent.click(btn);
    expect(askPulse).not.toHaveBeenCalled();
  });

  it('switching cluster drops the answer instead of showing it for the other cluster', async () => {
    whoCanCluster();
    await ask();
    h.setActive(REMOTE);
    await waitFor(() => expect(screen.queryByTestId('who-can-result')).toBeNull());
  });
});
