// @vitest-environment jsdom
/**
 * Identity & Access with list reads failing. A 403 on users used to read
 * "Users 0" and "No users found"; a failed ClusterRoleBinding list read "No
 * subjects have cluster-admin privileges", and audit checks passed on lists
 * they never saw.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

import { renderWithFailedRequests, expectNoAllClear } from './helpers/honestStates';
import IdentityView from '../views/IdentityView';

const ok = (items: unknown[]) => ({ body: { items } });
const ALL_OK = {
  '/apis/user.openshift.io/v1/users': ok([{ metadata: { name: 'alice', uid: 'u1' } }]),
  '/apis/user.openshift.io/v1/groups': ok([{ metadata: { name: 'devs', uid: 'g1' }, users: ['alice'] }]),
  '/api/v1/serviceaccounts': ok([]),
  '/apis/rbac.authorization.k8s.io/v1/clusterroles': ok([]),
  '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings': ok([
    { metadata: { name: 'ops-admin', uid: 'b1' }, roleRef: { name: 'cluster-admin' }, subjects: [{ kind: 'User', name: 'alice' }] },
  ]),
  '/apis/rbac.authorization.k8s.io/v1/roles': ok([]),
  '/apis/rbac.authorization.k8s.io/v1/rolebindings': ok([]),
  '/api/v1/namespaces': ok([]),
  '/apis/config.openshift.io/v1/oauths/cluster': { body: { spec: { identityProviders: [{ name: 'htpasswd' }] } } },
  '/apis/oauth.openshift.io/v1/oauthaccesstokens': ok([{ metadata: { name: 't' }, userName: 'alice' }]),
  '/api/v1/namespaces/kube-system/secrets/kubeadmin': { status: 404, body: {} },
};

function without(...paths: string[]) {
  const r: Record<string, unknown> = { ...ALL_OK };
  for (const p of paths) delete r[p];
  return r as typeof ALL_OK;
}

beforeEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/identity'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('IdentityView with failed reads', () => {
  it.each([403, 500])('users failing with %i: "—" not 0, an error not "No users found", inactive-users not passed', async (status) => {
    renderWithFailedRequests(<IdentityView />, { status, routes: without('/apis/user.openshift.io/v1/users') });
    expect(await screen.findByText('Users could not be loaded')).toBeTruthy();
    expect(screen.queryByText('No users found')).toBeNull();
    expect(screen.getByText(/Could not read users/)).toBeTruthy();
    expect(screen.getByText(/Could not check — users could not be read/)).toBeTruthy();
    expectNoAllClear();
  });

  it.each([403, 500])('cluster role bindings failing with %i: cluster-admin holders unknown, audits not passed', async (status) => {
    renderWithFailedRequests(<IdentityView />, { status, routes: without('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings') });
    await waitFor(() => expect(screen.getAllByText(/Could not check — cluster role bindings could not be read/)).toHaveLength(2));
    // The Identity audit has no score while checks are unknown.
    expect(screen.getByText(/could not be checked/)).toBeTruthy();
    expect(screen.queryByText('100%')).toBeNull();

    fireEvent.click(screen.getByText('Roles & bindings →'));
    expect(await screen.findByText(/cluster-admin holders are unknown/)).toBeTruthy();
    expect(screen.queryByText('No subjects have cluster-admin privileges.')).toBeNull();
    expect(screen.getByText(/RBAC Health Audit could not run — cluster role bindings could not be read/)).toBeTruthy();
    expect(screen.queryByText('RBAC Health Audit')).toBeNull();
  });

  it('groups failing: the groups check is unknown, not "No groups configured"', async () => {
    renderWithFailedRequests(<IdentityView />, { status: 403, routes: without('/apis/user.openshift.io/v1/groups') });
    expect(await screen.findByText(/Could not check — groups could not be read/)).toBeTruthy();
    fireEvent.click(screen.getAllByText('Groups')[0]);
    expect(await screen.findByText('Groups could not be loaded')).toBeTruthy();
    expect(screen.queryByText('No groups found')).toBeNull();
  });

  it('shows real counts, the audit score and the cluster-admin holder when every read succeeds', async () => {
    renderWithFailedRequests(<IdentityView />, { status: 404, routes: ALL_OK });
    expect(await screen.findByRole('button', { name: 'alice' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/\d+%/)).toBeTruthy());
    expect(screen.queryByText(/could not be checked/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByText('Roles & bindings →'));
    expect(await screen.findByText('RBAC Health Audit')).toBeTruthy();
    expect(screen.getByText('Cluster Admin Subjects (1)')).toBeTruthy();
  });
});
