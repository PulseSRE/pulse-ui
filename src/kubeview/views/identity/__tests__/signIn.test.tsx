// @vitest-environment jsdom
/**
 * Wave 16 — Identity & Access › Sign-in: provider edits conditional on the
 * resourceVersion read, dry run first, and htpasswd users hashed in the
 * browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import bcrypt from 'bcryptjs';
import { clickWhenEnabled, createHarness, json, k8sStatus, REMOTE, type Recorded } from '../../../__tests__/actionHarness';
import { SignInTab, OAUTH_PATH, ANOTHER_WAY_PHRASE, lockoutRisks } from '../SignInTab';
import { fromBase64, parseHtpasswd, upsertHtpasswd, validateHtpasswdPassword } from '../../../engine/htpasswd';

const h = createHarness();
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => h.setup());
afterEach(() => { cleanup(); h.teardown(); });

const OAUTH = { metadata: { name: 'cluster', resourceVersion: '4711' }, spec: { identityProviders: [{ name: 'corp-ldap', type: 'LDAP', mappingMethod: 'claim' }, { name: 'local', type: 'HTPasswd', mappingMethod: 'claim', htpasswd: { fileData: { name: 'htpass-local' } } }] } };

function signInCluster(over: (r: Recorded) => Response | undefined = () => undefined) {
  h.state.handler = (r) => {
    const o = over(r); if (o) return o;
    if (r.method === 'GET' && r.path === OAUTH_PATH) return json(OAUTH);
    if (r.method === 'GET' && r.path === '/apis/config.openshift.io/v1/clusteroperators/authentication') return json({ status: { conditions: [{ type: 'Available', status: 'True' }, { type: 'Progressing', status: 'False' }, { type: 'Degraded', status: 'False' }] } });
    if (r.method === 'GET' && r.path === '/api/v1/namespaces/openshift-config/secrets/htpass-local') {
      return json({ metadata: { name: 'htpass-local', resourceVersion: '88' }, data: { htpasswd: btoa('alice:$2y$10$abcdefghijklmnopqrstuuJ4b0Z3dqkAqLqY0fXJ9z1n2H3pQ1aBi\n') } });
    }
    return json({});
  };
}

describe('Sign-in', () => {
  it('removes a provider with a patch conditional on the resourceVersion read, dry run first', async () => {
    signInCluster();
    h.renderUi(<SignInTab />);
    expect((await screen.findByTestId('signin-health')).textContent).toBe('Authentication operator: Available');
    await clickWhenEnabled('Remove provider corp-ldap');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('local')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove provider' }));
    await waitFor(() => expect(h.writes()).toHaveLength(2));
    const [dry, real] = h.writes();
    expect(dry.url).toMatch(/oauths\/cluster\?dryRun=All$/);
    expect(real).toMatchObject({ method: 'PATCH', path: OAUTH_PATH, headers: { 'Content-Type': 'application/merge-patch+json' } });
    expect(real.body).toEqual({ metadata: { resourceVersion: '4711' }, spec: { identityProviders: [OAUTH.spec.identityProviders[1]] } });
  });

  it('a 409 (changed since read) stays in the dialog and nothing else is sent', async () => {
    signInCluster((r) => (r.method === 'PATCH' ? k8sStatus(409, 'the object has been modified') : undefined));
    h.renderUi(<SignInTab />);
    await clickWhenEnabled('Remove provider corp-ldap');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove provider' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/The object changed since this page loaded it/);
    expect(h.writes()).toHaveLength(1);
  });

  it('cancel sends nothing; without patch permission the editor is read-only', async () => {
    signInCluster();
    h.renderUi(<SignInTab />);
    await clickWhenEnabled('Remove provider corp-ldap');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.writes()).toHaveLength(0);
    cleanup();
    h.state.denied.add('patch oauths');
    h.renderUi(<SignInTab />);
    expect(await screen.findByText(/You do not have permission to change the OAuth configuration/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Remove provider corp-ldap' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds an HTPasswd provider with a new Secret whose user is bcrypt-hashed in the browser', async () => {
    signInCluster();
    h.renderUi(<SignInTab />);
    await clickWhenEnabled(/Add identity provider/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Provider name' }), { target: { value: 'team' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'HTPasswd Secret name' }), { target: { value: 'htpass-team' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'First user' }), { target: { value: 'bob' } });
    fireEvent.change(screen.getByLabelText('First user password'), { target: { value: 's3cret-pass' } });
    await clickWhenEnabled('Review');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/hashed in this browser with bcrypt; only the hash is sent/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add provider' }));
    await waitFor(() => expect(h.writes()).toHaveLength(4), { timeout: 10000 });
    const [drySecret, dryOauth, secret, oauth] = h.writes();
    expect(drySecret.url).toMatch(/secrets\?dryRun=All$/);
    expect(dryOauth.url).toMatch(/oauths\/cluster\?dryRun=All$/);
    expect(secret).toMatchObject({ method: 'POST', path: '/api/v1/namespaces/openshift-config/secrets', body: { metadata: { name: 'htpass-team', namespace: 'openshift-config' }, type: 'Opaque' } });
    const file = fromBase64(secret.body.data.htpasswd);
    const [entry] = parseHtpasswd(file);
    expect(entry.user).toBe('bob');
    expect(entry.hash.startsWith('$2y$10$')).toBe(true);
    expect(bcrypt.compareSync('s3cret-pass', entry.hash)).toBe(true);
    expect(JSON.stringify(h.state.requests)).not.toContain('s3cret-pass');
    expect(oauth.body).toEqual({ metadata: { resourceVersion: '4711' }, spec: { identityProviders: [...OAUTH.spec.identityProviders, { name: 'team', mappingMethod: 'claim', type: 'HTPasswd', htpasswd: { fileData: { name: 'htpass-team' } } }] } });
  });

  it('adds a user to an existing htpasswd Secret, keeping the others, conditional on its version', async () => {
    signInCluster();
    h.renderUi(<SignInTab />);
    await clickWhenEnabled('Add or reset user');
    fireEvent.change(screen.getByRole('textbox', { name: 'Username for htpass-local' }), { target: { value: 'carol' } });
    fireEvent.change(screen.getByLabelText('Password for htpass-local'), { target: { value: 'pw-carol' } });
    await clickWhenEnabled('Review');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Adds carol to Secret openshift-config\/htpass-local \(1 → 2 users\)/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(h.writes()).toHaveLength(2), { timeout: 10000 });
    const real = h.writes()[1];
    expect(h.writes()[0].url).toMatch(/htpass-local\?dryRun=All$/);
    expect(real.body.metadata).toEqual({ resourceVersion: '88' });
    const entries = parseHtpasswd(fromBase64(real.body.data.htpasswd));
    expect(entries.map((e) => e.user)).toEqual(['alice', 'carol']);
    expect(entries[0].hash).toBe('$2y$10$abcdefghijklmnopqrstuuJ4b0Z3dqkAqLqY0fXJ9z1n2H3pQ1aBi');
    expect(bcrypt.compareSync('pw-carol', entries[1].hash)).toBe(true);
  });

  it('replaces an existing user in place', () => {
    const r = upsertHtpasswd('a:1\nb:2\n', 'a', '3');
    expect(r).toEqual({ text: 'a:3\nb:2\n', replaced: true, users: 2 });
  });

  it('a failed OAuth read is an error, not "no providers"', async () => {
    h.state.handler = (r) => (r.path === OAUTH_PATH ? k8sStatus(403, 'oauths is forbidden') : json({}));
    h.renderUi(<SignInTab />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/identity providers are unknown/);
    expect(screen.queryByText(/No identity providers configured/)).toBeNull();
  });

  it('keeps comment and malformed lines when rewriting a file', () => {
    expect(upsertHtpasswd('# team\nalice:1\nbroken-line\n\nbob:2\n', 'bob', '3').text).toBe('# team\nalice:1\nbroken-line\n\nbob:3\n');
  });

  it('refuses passwords longer than 72 bytes, which bcrypt would cut', () => {
    expect(validateHtpasswdPassword('x'.repeat(72))).toBeNull();
    expect(validateHtpasswdPassword('é'.repeat(37))).toMatch(/At most 72 bytes/);
  });
});

const KUBEADMIN = '/api/v1/namespaces/kube-system/secrets/kubeadmin';

describe('Sign-in lockout guard', () => {
  it('names each risk', () => {
    expect(lockoutRisks('local', [], 'absent', []).risks).toEqual([
      'No identity provider will be left: nobody can sign in through OAuth.',
      'The kubeadmin Secret is gone, so there is no kubeadmin login to fall back to.',
    ]);
    expect(lockoutRisks('corp-ldap', [{ name: 'local', type: 'HTPasswd' }], 'present', ['corp-ldap:alice']).risks).toEqual(['You signed in through corp-ldap: your next sign-in will fail.']);
    expect(lockoutRisks('corp-ldap', [{ name: 'local', type: 'HTPasswd' }], 'present', ['local:alice']).risks).toEqual([]);
    expect(lockoutRisks('x', [{ name: 'y', type: 'LDAP' }], 'unknown', null).risks).toHaveLength(2);
  });

  it('removing the provider you signed in through is red and needs its name typed', async () => {
    signInCluster((r) => (r.path === '/apis/user.openshift.io/v1/users/~' ? json({ metadata: { name: 'alice' }, identities: ['corp-ldap:alice'] }) : undefined));
    h.renderUi(<SignInTab />);
    await clickWhenEnabled('Remove provider corp-ldap');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('idp-lockout').textContent).toMatch(/You signed in through corp-ldap/);
    // kubeadmin was read metadata-only
    expect(h.state.requests.find((r) => r.path === KUBEADMIN)!.headers.Accept).toMatch(/PartialObjectMetadata/);
    const confirm = within(dialog).getByRole('button', { name: 'Remove provider' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Type corp-ldap to confirm'), { target: { value: 'corp-ldap' } });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    expect(within(dialog).queryByLabelText(`Type "${ANOTHER_WAY_PHRASE}"`)).toBeNull();
  });

  it('removing the last provider with no kubeadmin also needs "I have another way to sign in"', async () => {
    const one = { ...OAUTH, spec: { identityProviders: [OAUTH.spec.identityProviders[0]] } };
    signInCluster((r) => (r.method === 'GET' && r.path === OAUTH_PATH ? json(one) : r.path === KUBEADMIN ? k8sStatus(404, 'not found') : undefined));
    h.renderUi(<SignInTab />);
    await clickWhenEnabled('Remove provider corp-ldap');
    const dialog = await screen.findByRole('dialog');
    const text = within(dialog).getByTestId('idp-lockout').textContent!;
    expect(text).toMatch(/No identity provider will be left/);
    expect(text).toMatch(/kubeadmin Secret is gone/);
    const confirm = within(dialog).getByRole('button', { name: 'Remove provider' }) as HTMLButtonElement;
    fireEvent.change(within(dialog).getByLabelText('Type corp-ldap to confirm'), { target: { value: 'corp-ldap' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(`Type "${ANOTHER_WAY_PHRASE}"`), { target: { value: ANOTHER_WAY_PHRASE } });
    await waitFor(() => expect(confirm.disabled).toBe(false));
  });

  it('kubeadmin that could not be checked counts as a risk', async () => {
    signInCluster((r) => (r.path === KUBEADMIN ? k8sStatus(403, 'forbidden') : undefined));
    h.renderUi(<SignInTab />);
    await clickWhenEnabled('Remove provider local');
    expect((await screen.findByTestId('idp-lockout')).textContent).toMatch(/could not check whether the kubeadmin login still exists/);
  });

  it('no risk: a plain confirmation, no typing', async () => {
    signInCluster();
    h.renderUi(<SignInTab />);
    await clickWhenEnabled('Remove provider corp-ldap');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('idp-lockout')).toBeNull();
    expect((within(dialog).getByRole('button', { name: 'Remove provider' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Sign-in failure paths', () => {
  async function openAddUser() {
    h.renderUi(<SignInTab />);
    await clickWhenEnabled('Add or reset user');
    fireEvent.change(screen.getByRole('textbox', { name: 'Username for htpass-local' }), { target: { value: 'carol' } });
    fireEvent.change(screen.getByLabelText('Password for htpass-local'), { target: { value: 'pw-carol' } });
    await clickWhenEnabled('Review');
    return screen.findByRole('dialog');
  }

  it('the password field is cleared as soon as the dialog opens, so cancel leaves nothing behind', async () => {
    signInCluster();
    const dialog = await openAddUser();
    expect((screen.getByLabelText('Password for htpass-local') as HTMLInputElement).value).toBe('');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.writes()).toHaveLength(0);
  });

  it('a refused dry run sends no real write and says why', async () => {
    signInCluster((r) => (r.method === 'PATCH' && r.url.includes('dryRun') ? k8sStatus(422, 'Secret "htpass-local" is invalid') : undefined));
    const dialog = await openAddUser();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect((await within(dialog).findByRole('alert', {}, { timeout: 10000 })).textContent).toMatch(/is invalid/);
    expect(h.writes()).toHaveLength(1);
  });

  it('a 403 on the write stays in the dialog', async () => {
    signInCluster((r) => (r.method === 'PATCH' && !r.url.includes('dryRun') ? k8sStatus(403, 'secrets "htpass-local" is forbidden') : undefined));
    const dialog = await openAddUser();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect((await within(dialog).findByRole('alert', {}, { timeout: 10000 })).textContent).toMatch(/Permission denied: secrets "htpass-local" is forbidden/);
  });

  it('without permission on Secrets in openshift-config the htpasswd form cannot be submitted', async () => {
    signInCluster();
    h.state.denied.add('patch secrets');
    h.renderUi(<SignInTab />);
    await clickWhenEnabled('Add or reset user');
    expect(await screen.findByText('You do not have permission to read and change Secrets in openshift-config.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Username for htpass-local' }), { target: { value: 'carol' } });
    fireEvent.change(screen.getByLabelText('Password for htpass-local'), { target: { value: 'pw' } });
    expect((screen.getByRole('button', { name: /Review/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('switching cluster after opening refuses to send anything', async () => {
    signInCluster();
    h.renderUi(<SignInTab />);
    await clickWhenEnabled('Remove provider corp-ldap');
    const dialog = await screen.findByRole('dialog');
    h.setActive(REMOTE);
    // Either the dialog refuses ("cluster changed") or the page reloads for the new
    // cluster and the dialog closes with it; in no case is the local OAuth written.
    const btn = within(dialog).queryByRole('button', { name: 'Remove provider' });
    if (btn && document.body.contains(btn)) fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 100));
    if (document.body.contains(dialog)) expect(within(dialog).getByRole('alert').textContent).toMatch(/cluster/i);
    expect(h.writes()).toHaveLength(0);
  });
});
