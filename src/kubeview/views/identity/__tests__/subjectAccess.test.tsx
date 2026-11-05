// @vitest-environment jsdom
/**
 * Wave 16 — subject page and "Remove access": binding chains (direct and
 * through groups), effective permissions computed by impersonating the
 * subject, and the removal dialog's exact requests, dry run, per-object
 * results, RBAC gating, concurrency refusal, cluster pinning and the
 * self-lockout guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createHarness, json, k8sStatus, REMOTE, type Recorded } from '../../../__tests__/actionHarness';
import { SubjectAccessPage } from '../SubjectAccessView';
import { SELF_LOCKOUT_PHRASE, SIGN_OUT_PHRASE } from '../RemoveAccessDialog';
import {
  accessChains, adminClusterRoles, clusterAdminPaths, membershipsOf, removeSubjectsPatch, removeGroupMemberPatch, ruleAllows, summarizeRules,
} from '../../../engine/subjectAccess';
import { impersonationsFor } from '../../../engine/rulesReview';

vi.mock('../../../engine/askPulse', () => ({ askPulse: vi.fn() }));

const h = createHarness();
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => h.setup());
afterEach(() => { cleanup(); h.teardown(); });

const RBAC = 'rbac.authorization.k8s.io';
const ALICE = { kind: 'User', apiGroup: RBAC, name: 'alice' };
const BOB = { kind: 'User', apiGroup: RBAC, name: 'bob' };

const rb = (ns: string, name: string, role: string, subjects: unknown[]) => ({
  kind: 'RoleBinding', metadata: { name, namespace: ns, uid: `uid-${name}`, resourceVersion: `rv-${name}` }, roleRef: { apiGroup: RBAC, kind: 'ClusterRole', name: role }, subjects,
});
const crb = (name: string, role: string, subjects: unknown[]) => ({
  kind: 'ClusterRoleBinding', metadata: { name, uid: `uid-${name}`, resourceVersion: `rv-${name}` }, roleRef: { apiGroup: RBAC, kind: 'ClusterRole', name: role }, subjects,
});

const RBS = [
  rb('shop', 'alice-admin', 'admin', [ALICE]),
  rb('monitoring', 'grafana-viewers', 'view', [BOB, ALICE, { kind: 'User', apiGroup: RBAC, name: 'carol' }]),
  rb('payments', 'payments-devs-edit', 'edit', [{ kind: 'Group', apiGroup: RBAC, name: 'payments-devs' }]),
];
const CRBS = [
  crb('oncall-node-reader', 'node-reader', [{ kind: 'Group', apiGroup: RBAC, name: 'oncall' }]),
  crb('self-provisioners', 'self-provisioner', [{ kind: 'Group', apiGroup: RBAC, name: 'system:authenticated:oauth' }]),
  crb('erin-admin', 'cluster-admin', [{ kind: 'User', apiGroup: RBAC, name: 'erin' }, ALICE]),
];
const GROUPS = [
  { metadata: { name: 'payments-devs', resourceVersion: 'g1' }, users: ['carol', 'alice', 'dan'] },
  { metadata: { name: 'oncall', resourceVersion: 'g2' }, users: ['alice'] },
];

let CLUSTER_ROLES: unknown[] = [];
beforeEach(() => { CLUSTER_ROLES = [{ metadata: { name: 'cluster-admin' }, rules: [{ verbs: ['*'], apiGroups: ['*'], resources: ['*'] }] }]; });

function cluster(over: Partial<Record<string, (r: Recorded) => Response | undefined>> = {}) {
  h.state.handler = (r) => {
    for (const [prefix, fn] of Object.entries(over)) if (r.path.startsWith(prefix)) { const res = fn!(r); if (res) return res; }
    if (r.method === 'GET' && r.path === '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings') return json({ items: CRBS });
    if (r.method === 'GET' && r.path === '/apis/rbac.authorization.k8s.io/v1/rolebindings') return json({ items: RBS });
    if (r.method === 'GET' && r.path === '/apis/user.openshift.io/v1/groups') return json({ items: GROUPS });
    if (r.method === 'GET' && r.path === '/apis/user.openshift.io/v1/users/alice') return json({ metadata: { name: 'alice', uid: 'u-alice' }, identities: ['corp-ldap:alice'] });
    if (r.method === 'GET' && r.path === '/apis/user.openshift.io/v1/users/~') return json({ metadata: { name: 'erin' }, groups: [] });
    if (r.method === 'GET' && r.path === '/apis/oauth.openshift.io/v1/oauthaccesstokens') return json({ items: [{ metadata: { name: 'sha256~tok1', uid: 't1' }, userName: 'alice' }, { metadata: { name: 'sha256~other', uid: 't2' }, userName: 'bob' }] });
    if (r.method === 'GET' && r.path === '/apis/rbac.authorization.k8s.io/v1/clusterroles') return json({ items: CLUSTER_ROLES });
    if (r.method === 'GET' && r.path === '/apis/user.openshift.io/v1/identities/corp-ldap%3Aalice') return json({ metadata: { name: 'corp-ldap:alice', uid: 'id-uid-1' } });
    if (r.url.startsWith('/api/agent/rbac/ledger')) return json({ id: 1 });
    if (r.path === '/apis/authorization.k8s.io/v1/selfsubjectrulesreviews') {
      return json({ status: { resourceRules: [{ verbs: ['get', 'list'], apiGroups: [''], resources: ['pods'] }], nonResourceRules: [], incomplete: false } });
    }
    return json({});
  };
}

const realWrites = () => h.writes().filter((w) => !w.path.includes('reviews') && !w.url.startsWith('/api/agent'));
const ledgerPosts = () => h.writes().filter((w) => w.url.startsWith('/api/agent/rbac/ledger'));
function confirmWith(dialog: HTMLElement, name = 'alice') {
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), { target: { value: 'offboarding' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: `Type ${name} to confirm` }), { target: { value: name } });
}

describe('access chains and patches', () => {
  it('finds direct bindings, bindings through Group objects and through virtual groups', () => {
    const chains = accessChains({ kind: 'User', name: 'alice' }, CRBS as never, RBS as never, GROUPS);
    const lines = chains.map((c) => `${c.via ? `${c.via.group} > ` : ''}${c.binding.kind} ${c.binding.namespace ?? ''}/${c.binding.name}`);
    expect(lines).toEqual([
      'ClusterRoleBinding /erin-admin',
      'RoleBinding shop/alice-admin',
      'RoleBinding monitoring/grafana-viewers',
      'payments-devs > RoleBinding payments/payments-devs-edit',
      'oncall > ClusterRoleBinding /oncall-node-reader',
      'system:authenticated:oauth > ClusterRoleBinding /self-provisioners',
    ]);
    expect(chains.find((c) => c.binding.name === 'grafana-viewers')!.indexes).toEqual([1]);
  });

  it('a ServiceAccount matches both as ServiceAccount and as its system:serviceaccount username', () => {
    const chains = accessChains({ kind: 'ServiceAccount', namespace: 'payments', name: 'deployer' }, [] as never, [
      rb('payments', 'a', 'edit', [{ kind: 'ServiceAccount', name: 'deployer' }]),
      rb('payments', 'b', 'view', [{ kind: 'User', name: 'system:serviceaccount:payments:deployer' }]),
      rb('other', 'c', 'view', [{ kind: 'ServiceAccount', name: 'deployer' }]),
    ] as never, []);
    expect(chains.map((c) => c.binding.name)).toEqual(['a', 'b']);
  });

  it('removes subjects highest index first, each guarded by a test of the exact subject', () => {
    const subjects = [BOB, ALICE, BOB, ALICE] as never[];
    expect(removeSubjectsPatch(subjects, [1, 3])).toEqual([
      { op: 'test', path: '/subjects/3', value: ALICE }, { op: 'remove', path: '/subjects/3' },
      { op: 'test', path: '/subjects/1', value: ALICE }, { op: 'remove', path: '/subjects/1' },
    ]);
    expect(removeGroupMemberPatch('alice', 1)).toEqual([{ op: 'test', path: '/users/1', value: 'alice' }, { op: 'remove', path: '/users/1' }]);
  });

  it('counts cluster-admin paths before and after a removal plan', () => {
    const crbs = [crb('a', 'cluster-admin', [{ kind: 'User', name: 'me' }]), crb('b', 'cluster-admin', [{ kind: 'Group', name: 'admins' }])] as never;
    expect(clusterAdminPaths('me', ['admins'], crbs)).toBe(2);
    const plan = { subject: { kind: 'User' as const, name: 'me' }, deletedBindings: new Set(['ClusterRoleBinding//a']), removedSubjects: new Map(), leftGroups: new Set(['admins']) };
    expect(clusterAdminPaths('me', ['admins'], crbs, plan)).toBe(0);
    // Someone else leaving "admins" does not change my paths.
    expect(clusterAdminPaths('me', ['admins'], crbs, { ...plan, subject: { kind: 'User', name: 'bob' } })).toBe(1);
  });

  it('matches rules exactly and summarises them in words', () => {
    expect(ruleAllows({ verbs: ['get'], apiGroups: [''], resources: ['secrets'] }, 'get', '', 'secrets')).toBe(true);
    expect(ruleAllows({ verbs: ['get'], apiGroups: [''], resources: ['secrets'] }, '*', '', 'secrets')).toBe(false);
    expect(ruleAllows({ verbs: ['*'], apiGroups: ['apps'], resources: ['*'] }, 'delete', 'apps', 'deployments')).toBe(true);
    expect(ruleAllows({ verbs: ['*'], apiGroups: ['apps'], resources: ['*'] }, 'delete', '', 'secrets')).toBe(false);
    expect(summarizeRules([{ verbs: ['*'], apiGroups: ['*'], resources: ['*'] }])).toBe('all verbs on all resources');
  });

  it('impersonates the user alone and once per group; a ServiceAccount once', () => {
    expect(impersonationsFor({ kind: 'User', name: 'alice' }, ['oncall', 'system:authenticated', 'system:authenticated:oauth'])).toEqual([
      { user: 'alice' }, { user: 'alice', group: 'oncall' }, { user: 'alice', group: 'system:authenticated:oauth' },
    ]);
    expect(impersonationsFor({ kind: 'ServiceAccount', namespace: 'p', name: 'd' }, ['system:serviceaccounts'])).toEqual([{ user: 'system:serviceaccount:p:d' }]);
  });
});

describe('subject page', () => {
  it('shows each chain and computes effective permissions by impersonating, one review per group', async () => {
    cluster();
    h.renderUi(<SubjectAccessPage subject={{ kind: 'User', name: 'alice' }} />);
    const chains = await screen.findByRole('list', { name: 'Access chains' });
    expect(within(chains).getByText('RoleBinding shop/alice-admin')).toBeTruthy();
    expect(within(chains).getByText('alice is the only subject')).toBeTruthy();
    expect(within(chains).getByText('shared with bob, carol')).toBeTruthy();
    expect(within(chains).getByText('Group payments-devs')).toBeTruthy();
    expect(within(chains).getByText('every user signed in through OAuth · ends when sign-in ends')).toBeTruthy();

    await waitFor(() => expect(screen.getAllByText('get, list on pods').length).toBe(3));
    expect(screen.getByTestId('rules-review-note').textContent).toMatch(/^Computed by impersonating alice: a read-only SelfSubjectRulesReview in each namespace, run as alice alone and in each of payments-devs, oncall, system:authenticated:oauth, combined\./);
    const reviews = h.state.requests.filter((r) => r.path === '/apis/authorization.k8s.io/v1/selfsubjectrulesreviews');
    // 3 namespaces × (alone + 3 groups)
    expect(reviews).toHaveLength(12);
    expect(reviews.every((r) => r.headers['Impersonate-User'] === 'alice')).toBe(true);
    expect(new Set(reviews.map((r) => r.headers['Impersonate-Group'] ?? '(none)'))).toEqual(new Set(['(none)', 'payments-devs', 'oncall', 'system:authenticated:oauth']));
    expect(new Set(reviews.map((r) => r.body.spec.namespace))).toEqual(new Set(['monitoring', 'payments', 'shop']));
    expect(screen.getByTestId('api-actions-unavailable').textContent).toMatch(/^Not available/);
  });

  it('an incomplete review is "Could not check", not the rules it did return', async () => {
    cluster({ '/apis/authorization.k8s.io/v1/selfsubjectrulesreviews': (r) => (r.body.spec.namespace === 'shop'
      ? json({ status: { resourceRules: [{ verbs: ['get'], apiGroups: [''], resources: ['pods'] }], incomplete: true, evaluationError: 'webhook authorizer not evaluated' } }) : undefined) });
    h.renderUi(<SubjectAccessPage subject={{ kind: 'User', name: 'alice' }} />);
    expect(await screen.findByText(/Could not check — the rules review came back incomplete: webhook authorizer not evaluated/)).toBeTruthy();
  });

  it('without impersonate permission it says it could not check and sends no review', async () => {
    cluster();
    h.state.denied.add('impersonate users');
    h.renderUi(<SubjectAccessPage subject={{ kind: 'User', name: 'alice' }} />);
    expect((await screen.findByTestId('rules-review-denied')).textContent).toMatch(/Could not check: this needs permission to impersonate alice/);
    expect(h.state.requests.some((r) => r.path.endsWith('selfsubjectrulesreviews'))).toBe(false);
  });

  it('a 403 on bindings is an error, never "no bindings"', async () => {
    cluster({ '/apis/rbac.authorization.k8s.io/v1/rolebindings': (r) => (r.method === 'GET' ? k8sStatus(403, 'rolebindings is forbidden') : undefined) });
    h.renderUi(<SubjectAccessPage subject={{ kind: 'User', name: 'alice' }} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not read RoleBindings — the access shown below is incomplete/);
    expect(screen.queryByRole('list', { name: 'Access chains' })).toBeNull();
    expect(screen.queryByText(/No RoleBinding or ClusterRoleBinding names/)).toBeNull();
  });
});

async function openRemove() {
  h.renderUi(<SubjectAccessPage subject={{ kind: 'User', name: 'alice' }} />);
  await screen.findByRole('list', { name: 'Access chains' });
  fireEvent.click(screen.getByRole('button', { name: /Remove access…/ }));
  const dialog = await screen.findByRole('dialog');
  // Every row's permission has resolved and sign-in objects are listed.
  await within(dialog).findByText('Delete 1 OAuth access token');
  return dialog;
}

const confirmButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: /^Remove access \(/ });

describe('Remove access', () => {
  it('lists every change, dry-runs them all, then sends the exact requests and reports each', async () => {
    cluster();
    const dialog = await openRemove();
    // erin is acting and keeps her own cluster-admin, so no self-lockout phrase.
    expect(within(dialog).queryByText(/your own last cluster-admin/)).toBeNull();
    await waitFor(() => expect(confirmButton(dialog).textContent).toBe('Remove access (8 changes)'));
    expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(true);
    confirmWith(dialog);
    await waitFor(() => expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirmButton(dialog));
    await within(dialog).findByText('Results');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Download previous versions' })).toBeTruthy());

    const writes = realWrites();
    const dry = writes.filter((w) => w.url.includes('dryRun=All'));
    const real = writes.filter((w) => !w.url.includes('dryRun=All'));
    expect(dry).toHaveLength(8);
    expect(real).toHaveLength(8);
    // Every dry run happens before the first real write.
    expect(writes.findIndex((w) => !w.url.includes('dryRun=All'))).toBe(8);
    const byPath = (p: string) => real.find((w) => w.path === p)!;
    // shared binding: subject removed by index, guarded by a test of the exact subject
    expect(byPath('/apis/rbac.authorization.k8s.io/v1/namespaces/monitoring/rolebindings/grafana-viewers')).toMatchObject({
      method: 'PATCH', headers: { 'Content-Type': 'application/json-patch+json' },
      body: [{ op: 'test', path: '/subjects/1', value: ALICE }, { op: 'remove', path: '/subjects/1' }],
    });
    // only subject: the binding is deleted, conditional on the version read
    expect(byPath('/apis/rbac.authorization.k8s.io/v1/namespaces/shop/rolebindings/alice-admin')).toMatchObject({
      method: 'DELETE', body: { preconditions: { uid: 'uid-alice-admin', resourceVersion: 'rv-alice-admin' } },
    });
    expect(byPath('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/erin-admin').body).toEqual([{ op: 'test', path: '/subjects/1', value: ALICE }, { op: 'remove', path: '/subjects/1' }]);
    expect(byPath('/apis/user.openshift.io/v1/groups/payments-devs').body).toEqual([{ op: 'test', path: '/users/1', value: 'alice' }, { op: 'remove', path: '/users/1' }]);
    expect(byPath('/apis/user.openshift.io/v1/groups/oncall').body).toEqual([{ op: 'test', path: '/users/0', value: 'alice' }, { op: 'remove', path: '/users/0' }]);
    expect(byPath('/apis/user.openshift.io/v1/users/alice').method).toBe('DELETE');
    expect(byPath('/apis/user.openshift.io/v1/identities/corp-ldap%3Aalice')).toMatchObject({ method: 'DELETE', body: { preconditions: { uid: 'id-uid-1' } } });
    expect(byPath('/apis/user.openshift.io/v1/users/alice').body.preconditions).toEqual({ uid: 'u-alice' });
    expect(byPath('/apis/oauth.openshift.io/v1/oauthaccesstokens/sha256~tok1').body.preconditions).toEqual({ uid: 't1' });
    // Every write is recorded with the reason and the version it produced (deletes: the version deleted).
    await waitFor(() => expect(ledgerPosts()).toHaveLength(8));
    const posts = ledgerPosts().map((p) => p.body);
    expect(posts.every((b) => b.reason === 'offboarding')).toBe(true);
    expect(posts.find((b) => b.name === 'alice-admin')).toMatchObject({ verb: 'delete', kind: 'RoleBinding', namespace: 'shop', resource_version: 'rv-alice-admin' });
    expect(posts.find((b) => b.name === 'payments-devs')).toMatchObject({ verb: 'patch', kind: 'Group' });
    expect(byPath('/apis/oauth.openshift.io/v1/oauthaccesstokens/sha256~tok1').method).toBe('DELETE');
    // bob's token is not touched
    expect(writes.some((w) => w.path.includes('sha256~other'))).toBe(false);
  });

  it('cancel sends nothing', async () => {
    cluster();
    const dialog = await openRemove();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(realWrites()).toHaveLength(0);
  });

  it('a refused dry run changes nothing and says which object', async () => {
    cluster({ '/apis/user.openshift.io/v1/groups/oncall': (r) => (r.method === 'PATCH' ? k8sStatus(403, 'groups "oncall" is forbidden') : undefined) });
    const dialog = await openRemove();
    confirmWith(dialog);
    await waitFor(() => expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirmButton(dialog));
    expect(await within(dialog).findByText(/The dry run refused 1 of 8 changes, so nothing was changed/)).toBeTruthy();
    expect(within(dialog).getByTestId('result-group/oncall').textContent).toMatch(/Permission denied: groups "oncall" is forbidden/);
    expect(realWrites().filter((w) => !w.url.includes('dryRun=All'))).toHaveLength(0);
  });

  it('a concurrent change (failed test op, 422) or 409 is reported per object; the others still apply', async () => {
    cluster({ '/apis/rbac.authorization.k8s.io/v1/namespaces/monitoring/rolebindings/grafana-viewers': (r) => (r.method === 'PATCH' && !r.url.includes('dryRun') ? k8sStatus(422, 'the server rejected our request: test operation failed') : undefined) });
    const dialog = await openRemove();
    confirmWith(dialog);
    await waitFor(() => expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirmButton(dialog));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Download previous versions' })).toBeTruthy());
    const id = 'result-RoleBinding/monitoring/grafana-viewers';
    expect(within(dialog).getByTestId(id).textContent).toMatch(/The object changed since this page loaded it, so nothing was changed/);
    expect(realWrites().filter((w) => !w.url.includes('dryRun=All'))).toHaveLength(8);
  });

  it('a binding the viewer may not change is shown as such and not sent', async () => {
    cluster();
    h.state.denied.add('patch rolebindings');
    h.state.denied.add('delete rolebindings');
    const dialog = await openRemove();
    expect(within(dialog).getAllByText("You can't change rolebindings in shop; this one is left unchanged.").length).toBe(1);
    await waitFor(() => expect(confirmButton(dialog).textContent).toBe('Remove access (6 changes)'));
    confirmWith(dialog);
    await waitFor(() => expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirmButton(dialog));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Download previous versions' })).toBeTruthy());
    expect(realWrites().some((w) => w.path.includes('/rolebindings/'))).toBe(false);
  });

  it("removing the viewer's own last cluster-admin path needs the extra phrase", async () => {
    cluster({ '/apis/user.openshift.io/v1/users/~': () => json({ metadata: { name: 'alice' }, groups: ['payments-devs', 'oncall'] }) });
    const dialog = await openRemove();
    expect(await within(dialog).findByText(/This removes your own last cluster-admin access/)).toBeTruthy();
    confirmWith(dialog);
    await new Promise((r) => setTimeout(r, 50));
    expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type the phrase to remove your own cluster-admin' }), { target: { value: SELF_LOCKOUT_PHRASE } });
    // alice is also deleting her own tokens here, which signs her out
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type the phrase to sign yourself out' }), { target: { value: SIGN_OUT_PHRASE } });
    await waitFor(() => expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(false));
    // Leaving erin-admin unchanged keeps the path, and the warning goes away.
    fireEvent.click(within(within(dialog).getByTestId('row-ClusterRoleBinding//erin-admin')).getByRole('radio', { name: 'Leave unchanged' }));
    await waitFor(() => expect(within(dialog).queryByText(/your own last cluster-admin/)).toBeNull());
  });

  it('switching cluster after opening refuses to send anything', async () => {
    cluster();
    const dialog = await openRemove();
    confirmWith(dialog);
    h.setActive(REMOTE);
    expect(await within(dialog).findByText(/The active cluster changed since this dialog opened/)).toBeTruthy();
    expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(true);
    expect(realWrites()).toHaveLength(0);
  });

  it('an agent without the write ledger (404) still removes access and says it was not recorded', async () => {
    cluster({ '/api/agent/rbac/ledger': () => k8sStatus(404, 'Not Found') });
    const dialog = await openRemove();
    confirmWith(dialog);
    await waitFor(() => expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirmButton(dialog));
    expect((await within(dialog).findByTestId('ledger-note', {}, { timeout: 10000 })).textContent).toMatch(/has no write ledger/);
    expect(realWrites().filter((w) => !w.url.includes('dryRun=All'))).toHaveLength(8);
  });

  it('the reason is required', async () => {
    cluster();
    const dialog = await openRemove();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type alice to confirm' }), { target: { value: 'alice' } });
    await new Promise((r) => setTimeout(r, 50));
    expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a */*/* ClusterRole held through a group counts as cluster-admin for the self-lockout check', async () => {
    CLUSTER_ROLES = [...CLUSTER_ROLES, { metadata: { name: 'super-ops' }, rules: [{ verbs: ['*'], apiGroups: ['*'], resources: ['*'] }] }];
    const crbs = [...CRBS.filter((b) => b.metadata.name !== 'erin-admin'), crb('oncall-super', 'super-ops', [{ kind: 'Group', apiGroup: RBAC, name: 'oncall' }])];
    cluster({
      '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings': (r) => (r.method === 'GET' ? json({ items: crbs }) : undefined),
      '/apis/user.openshift.io/v1/users/~': () => json({ metadata: { name: 'alice' }, groups: ['oncall'] }),
    });
    const dialog = await openRemove();
    // alice (acting) leaves oncall, her only path to an admin-equivalent role
    expect(await within(dialog).findByText(/This removes your own last cluster-admin access/)).toBeTruthy();
    // keeping the membership removes the warning
    fireEvent.click(within(within(dialog).getByTestId('row-group/oncall')).getByRole('checkbox'));
    await waitFor(() => expect(within(dialog).queryByText(/your own last cluster-admin/)).toBeNull());
    expect(adminClusterRoles([{ metadata: { name: 'x' }, rules: [{ verbs: ['*'], nonResourceURLs: ['*'] }] }, { metadata: { name: 'y' }, rules: [{ verbs: ['*'], apiGroups: [''], resources: ['*'] }] }])).toEqual(new Set(['cluster-admin', 'x']));
  });

  it('deleting your own OAuth tokens warns that it signs you out and needs the phrase', async () => {
    cluster({ '/apis/user.openshift.io/v1/users/~': () => json({ metadata: { name: 'alice' }, groups: [] }) });
    const dialog = await openRemove();
    expect((await within(dialog).findByTestId('signs-me-out')).textContent).toMatch(/This signs you out/);
    confirmWith(dialog);
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type the phrase to remove your own cluster-admin' }), { target: { value: SELF_LOCKOUT_PHRASE } });
    await new Promise((r) => setTimeout(r, 50));
    expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type the phrase to sign yourself out' }), { target: { value: SIGN_OUT_PHRASE } });
    await waitFor(() => expect((confirmButton(dialog) as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('OAuth group', () => {
  it('system:authenticated:oauth is assumed only for users who sign in through OAuth', () => {
    expect(membershipsOf({ kind: 'User', name: 'svc' }, [], { oauth: false }).map((m) => m.group)).toEqual(['system:authenticated']);
    expect(membershipsOf({ kind: 'User', name: 'a' }, [], { oauth: true }).map((m) => m.group)).toEqual(['system:authenticated', 'system:authenticated:oauth']);
  });

  it('when the User cannot be read the page says the result may overstate', async () => {
    cluster({ '/apis/user.openshift.io/v1/users/alice': () => k8sStatus(403, 'forbidden') });
    h.renderUi(<SubjectAccessPage subject={{ kind: 'User', name: 'alice' }} />);
    expect((await screen.findByTestId('oauth-assumed')).textContent).toMatch(/^May overstate/);
  });
});
