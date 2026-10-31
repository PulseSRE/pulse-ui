// @vitest-environment jsdom
/**
 * Identity actions: grant and revoke bindings, who-can checks, group
 * create/delete/membership — exact requests, confirmations, failures, and
 * the shared "too many cluster-admins" definition.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { clickWhenEnabled, createHarness, json, k8sStatus } from '../../../__tests__/actionHarness';
import { AccessPanel, accessReviewBody, grantBody } from '../AccessPanel';
import { CreateGroupButton, GroupMemberControls } from '../GroupActions';
import { RevokeBindingButton } from '../../../components/rbac/RevokeBinding';
import { clusterAdminSubjects, tooManyClusterAdmins, CLUSTER_ADMIN_LIMIT } from '../../../engine/clusterAdmins';
import type { ClusterRoleBinding } from '../../../engine/types';

const h = createHarness();
beforeEach(() => h.setup());
afterEach(() => { cleanup(); h.teardown(); });

const crb = (name: string, role: string, subjects: Array<{ kind: string; name: string; namespace?: string }>): ClusterRoleBinding => ({
  apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRoleBinding',
  metadata: { name, uid: `uid-${name}` }, roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: role }, subjects,
} as ClusterRoleBinding);

describe('shared cluster-admin definition', () => {
  it('counts non-system subjects of every kind on non-system bindings, and flags more than the limit', () => {
    const subjects = clusterAdminSubjects([
      crb('admins', 'cluster-admin', [{ kind: 'User', name: 'alice' }, { kind: 'Group', name: 'ops' }, { kind: 'ServiceAccount', name: 'ci', namespace: 'build' }]),
      crb('system:masters-binding', 'cluster-admin', [{ kind: 'Group', name: 'system:masters' }]),
      crb('openshift-x', 'cluster-admin', [{ kind: 'User', name: 'bob' }]),
      crb('more', 'cluster-admin', [{ kind: 'User', name: 'system:admin' }, { kind: 'ServiceAccount', name: 'op', namespace: 'openshift-monitoring' }]),
      crb('viewers', 'view', [{ kind: 'User', name: 'carol' }]),
    ]);
    expect(subjects.map((s) => `${s.kind}/${s.name}`)).toEqual(['User/alice', 'Group/ops', 'ServiceAccount/ci']);
    expect(tooManyClusterAdmins(subjects)).toBe(false);
    expect(tooManyClusterAdmins([...subjects, { kind: 'User', name: 'dave', binding: 'x' }])).toBe(CLUSTER_ADMIN_LIMIT === 3);
  });
});

const NAMESPACES = [{ metadata: { name: 'shop' } }, { metadata: { name: 'team-b' } }] as never[];
const CLUSTER_ROLES = [{ metadata: { name: 'view' } }, { metadata: { name: 'edit' } }, { metadata: { name: 'admin' } }] as never[];

describe('Grant access', () => {
  it('creates a RoleBinding with the chosen role and subject after confirmation', async () => {
    h.renderUi(<AccessPanel clusterRoles={CLUSTER_ROLES} roles={[]} namespaces={NAMESPACES} clusterRoleBindings={[]} roleBindings={[]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Binding namespace' }), { target: { value: 'shop' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'edit' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Subject name' }), { target: { value: 'alice' } });
    expect((screen.getByRole('textbox', { name: 'Binding name' }) as HTMLInputElement).value).toBe('alice-edit');
    await clickWhenEnabled('Grant');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Creates RoleBinding in shop alice-edit binding ClusterRole edit to User alice.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Grant' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0]).toMatchObject({
      method: 'POST',
      path: '/apis/rbac.authorization.k8s.io/v1/namespaces/shop/rolebindings',
      body: {
        kind: 'RoleBinding', metadata: { name: 'alice-edit', namespace: 'shop' },
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'edit' },
        subjects: [{ kind: 'User', apiGroup: 'rbac.authorization.k8s.io', name: 'alice' }],
      },
    });
  });

  it('a cluster-wide ServiceAccount grant builds a ClusterRoleBinding', () => {
    const { path, body } = grantBody({ scope: 'cluster', namespace: '', roleKind: 'ClusterRole', roleName: 'view', subjectKind: 'ServiceAccount', subjectName: 'ci', subjectNamespace: 'build', bindingName: 'ci-view' });
    expect(path).toBe('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings');
    expect(body).toMatchObject({ kind: 'ClusterRoleBinding', metadata: { name: 'ci-view' }, subjects: [{ kind: 'ServiceAccount', name: 'ci', namespace: 'build' }] });
  });

  it('shows a refused grant in the dialog', async () => {
    h.state.handler = (r) => (r.method === 'POST' && r.path.endsWith('/rolebindings') ? k8sStatus(403, 'rolebindings.rbac.authorization.k8s.io is forbidden: attempt to grant extra privileges') : json({}));
    h.renderUi(<AccessPanel clusterRoles={CLUSTER_ROLES} roles={[]} namespaces={NAMESPACES} clusterRoleBindings={[]} roleBindings={[]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Binding namespace' }), { target: { value: 'shop' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'admin' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Subject name' }), { target: { value: 'bob' } });
    await clickWhenEnabled('Grant');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Grant' }));
    expect(await screen.findByText(/attempt to grant extra privileges/)).toBeTruthy();
  });

  it('is disabled without permission to create RoleBindings', async () => {
    h.state.denied.add('create rolebindings');
    h.renderUi(<AccessPanel clusterRoles={CLUSTER_ROLES} roles={[]} namespaces={NAMESPACES} clusterRoleBindings={[]} roleBindings={[]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Binding namespace' }), { target: { value: 'shop' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'edit' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Subject name' }), { target: { value: 'alice' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Grant' }).getAttribute('title')).toMatch(/do not have permission/));
    expect((screen.getByRole('button', { name: 'Grant' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Revoke', () => {
  it('lists every subject that loses access and deletes the binding with a uid precondition', async () => {
    h.renderUi(<RevokeBindingButton binding={{ kind: 'ClusterRoleBinding', name: 'admins', uid: 'uid-admins', roleRef: { kind: 'ClusterRole', name: 'cluster-admin' }, subjects: [{ kind: 'User', name: 'alice' }, { kind: 'Group', name: 'ops' }] }} />);
    await clickWhenEnabled('Revoke ClusterRoleBinding admins');
    const dialog = await screen.findByRole('dialog');
    expect(within(within(dialog).getByRole('list', { name: 'Subjects losing access' })).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['User alice', 'Group ops']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete binding' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0]).toMatchObject({ method: 'DELETE', path: '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/admins', body: { preconditions: { uid: 'uid-admins' } } });
  });

  it('the bindings list hides system bindings by default and filters by subject', async () => {
    h.renderUi(<AccessPanel clusterRoles={[]} roles={[]} namespaces={[]} roleBindings={[{ metadata: { name: 'dev-edit', namespace: 'shop', uid: 'u1' }, roleRef: { kind: 'ClusterRole', name: 'edit' }, subjects: [{ kind: 'User', name: 'dev' }] } as never]}
      clusterRoleBindings={[crb('system:basic-user', 'system:basic-user', [{ kind: 'Group', name: 'system:authenticated' }]), crb('admins', 'cluster-admin', [{ kind: 'User', name: 'alice' }])]} />);
    expect(screen.getByRole('button', { name: 'Revoke ClusterRoleBinding admins' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke RoleBinding dev-edit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /system:basic-user/ })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter bindings' }), { target: { value: 'dev' } });
    expect(screen.queryByRole('button', { name: 'Revoke ClusterRoleBinding admins' })).toBeNull();
  });
});

describe('Who can', () => {
  it('posts a SubjectAccessReview and says the answer', async () => {
    h.state.handler = (r) => (r.path === '/apis/authorization.k8s.io/v1/subjectaccessreviews' ? json({ status: { allowed: false, reason: 'no RBAC policy matched' } }) : json({}));
    h.renderUi(<AccessPanel clusterRoles={[]} roles={[]} namespaces={[]} clusterRoleBindings={[]} roleBindings={[]} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Check user' }), { target: { value: 'alice' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Check verb' }), { target: { value: 'delete' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Check API group' }), { target: { value: 'apps' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Check resource' }), { target: { value: 'deployments' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Check namespace' }), { target: { value: 'shop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect((await screen.findByRole('status')).textContent).toBe('alice cannot delete deployments.apps in shop — no RBAC policy matched');
    expect(h.writes()[0].body).toEqual(accessReviewBody({ verb: 'delete', group: 'apps', resource: 'deployments', namespace: 'shop', user: 'alice', groups: '' }));
    expect(h.writes()[0].body.spec).toEqual({ resourceAttributes: { verb: 'delete', group: 'apps', resource: 'deployments', namespace: 'shop' }, user: 'alice' });
  });

  it('shows a failed review instead of an answer', async () => {
    h.state.handler = () => k8sStatus(403, 'subjectaccessreviews.authorization.k8s.io is forbidden');
    h.renderUi(<AccessPanel clusterRoles={[]} roles={[]} namespaces={[]} clusterRoleBindings={[]} roleBindings={[]} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Check user' }), { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/subjectaccessreviews.authorization.k8s.io is forbidden/)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Groups', () => {
  it('creates a group', async () => {
    h.renderUi(<CreateGroupButton />);
    fireEvent.change(screen.getByRole('textbox', { name: 'New group name' }), { target: { value: 'sre' } });
    await clickWhenEnabled(/Create group/);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0]).toMatchObject({ method: 'POST', path: '/apis/user.openshift.io/v1/groups', body: { kind: 'Group', metadata: { name: 'sre' }, users: [] } });
  });

  it('adds and removes members with the full list and the read resourceVersion', async () => {
    const group = { metadata: { name: 'sre', uid: 'g1', resourceVersion: '9' }, users: ['alice', 'bob'] };
    h.renderUi(<GroupMemberControls group={group} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'User to add to sre' }), { target: { value: 'carol' } });
    await clickWhenEnabled('Add member');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    await clickWhenEnabled('Remove bob from sre');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove member' }));
    await waitFor(() => expect(h.writes()).toHaveLength(2));
    expect(h.writes().map((w) => [w.method, w.path, w.body])).toEqual([
      ['PATCH', '/apis/user.openshift.io/v1/groups/sre', { metadata: { resourceVersion: '9' }, users: ['alice', 'bob', 'carol'] }],
      ['PATCH', '/apis/user.openshift.io/v1/groups/sre', { metadata: { resourceVersion: '9' }, users: ['alice'] }],
    ]);
  });

  it('a concurrent edit (409) is reported, not overwritten', async () => {
    h.state.handler = () => k8sStatus(409, 'Operation cannot be fulfilled on groups.user.openshift.io "sre": the object has been modified');
    h.renderUi(<GroupMemberControls group={{ metadata: { name: 'sre', resourceVersion: '9' }, users: ['alice'] }} />);
    await clickWhenEnabled('Delete group sre');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete group' }));
    expect(await screen.findByText(/the object has been modified/)).toBeTruthy();
  });
});
