// @vitest-environment jsdom
/**
 * Wave 16 — Identity & Access › Sign-in: provider edits conditional on the
 * resourceVersion read, dry run first, and htpasswd users hashed in the
 * browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import bcrypt from 'bcryptjs';
import { clickWhenEnabled, createHarness, json, k8sStatus, type Recorded } from '../../../__tests__/actionHarness';
import { SignInTab, OAUTH_PATH } from '../SignInTab';
import { fromBase64, parseHtpasswd, upsertHtpasswd } from '../../../engine/htpasswd';

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
});
