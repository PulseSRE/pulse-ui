// @vitest-environment jsdom
/**
 * Wave 16 part 2 — RBAC change history from the agent (GET /rbac/changes):
 * diff against the previous version, "Restore previous" as the user (read
 * live, show the exact change, dry run, conditional PUT or re-create, reason
 * to the Pulse write ledger), and honest fallbacks when the agent has no
 * history, fails, or the cluster is remote.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { clickWhenEnabled, createHarness, json, k8sStatus, REMOTE, type Recorded } from '../../../__tests__/actionHarness';
import { RbacChangeHistory } from '../RbacChangeHistory';
import { compactDiff, escalationOnRestore, lineDiff, restoreRequest, type RbacChange, type RbacHistory } from '../../../engine/rbacHistory';

const h = createHarness();
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => h.setup());
afterEach(() => { cleanup(); h.teardown(); });

const ROLE_PATH = '/apis/rbac.authorization.k8s.io/v1/namespaces/payments/roles/secret-manager';
const before = { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: { name: 'secret-manager', namespace: 'payments' }, rules: [{ apiGroups: [''], resources: ['secrets'], verbs: ['get', 'list'] }] };
const after = { ...before, rules: [{ apiGroups: [''], resources: ['secrets'], verbs: ['get', 'list', 'delete', 'patch'] }] };

const change = (over: Partial<RbacChange> = {}): RbacChange => ({
  id: 7, kind: 'Role', namespace: 'payments', name: 'secret-manager', change: 'updated',
  observed_at: new Date(Date.now() - 3600_000).toISOString(), manager: 'kubectl-edit', operation: 'Update', manager_time: null,
  actor: null, previous_id: 6, before, after, ...over,
});

function history(changes: RbacChange[], over: Partial<RbacHistory> = {}): RbacHistory {
  return {
    history: { since: '2026-10-29T00:00:00Z', last_observed_at: new Date().toISOString(), last_error: null, kinds: [], unwatched: [], retention_days: 30, source: 'observed' },
    changes, ledger: [], hidden: 0, system_hidden: 0, ...over,
  };
}

function cluster(data: RbacHistory | Response, live: Response | (() => Response) = json({ ...after, metadata: { ...after.metadata, resourceVersion: '77', uid: 'u1', managedFields: [] } }), over: (r: Recorded) => Response | undefined = () => undefined) {
  h.state.handler = (r) => {
    const o = over(r); if (o) return o;
    if (r.url.startsWith('/api/agent/rbac/changes')) return data instanceof Response ? data : json(data);
    if (r.url.startsWith('/api/agent/rbac/ledger')) return json({ id: 1 });
    if (r.method === 'GET' && r.path === ROLE_PATH) return typeof live === 'function' ? live() : live;
    if (r.method === 'PUT' || r.method === 'POST') return json(r.body);
    return json({});
  };
}

const FALLBACK = <p>fallback list</p>;
const k8sWrites = () => h.writes().filter((w) => !w.url.startsWith('/api/agent'));
const ledgerPosts = () => h.writes().filter((w) => w.url.startsWith('/api/agent/rbac/ledger'));

describe('diff and restore helpers', () => {
  it('diffs objects by line and keeps only changed lines with context', () => {
    const d = lineDiff(before, after)!;
    expect(d.filter((l) => l.op === '+').map((l) => l.text.trim())).toEqual(['"list",', '"delete",', '"patch"']);
    expect(d.filter((l) => l.op === '-').map((l) => l.text.trim())).toEqual(['"list"']);
    expect(compactDiff(d, 0).some((l) => l.op === '…')).toBe(true);
  });

  it('restores an existing object with a PUT carrying the live resourceVersion; a gone one is re-created without ownerReferences', () => {
    const withOwner = { ...before, metadata: { ...before.metadata, ownerReferences: [{ uid: 'dead' }] } };
    expect(restoreRequest({ kind: 'Role', namespace: 'payments', name: 'secret-manager', before: withOwner }, { metadata: { resourceVersion: '77' } })).toEqual({
      method: 'PUT', path: ROLE_PATH,
      body: { ...before, metadata: { name: 'secret-manager', namespace: 'payments', resourceVersion: '77' } },
    });
    const post = restoreRequest({ kind: 'ClusterRoleBinding', namespace: '', name: 'old-ci-admin', before: { roleRef: { name: 'cluster-admin' }, metadata: { name: 'old-ci-admin', ownerReferences: [{}] } } }, null);
    expect(post.method).toBe('POST');
    expect(post.path).toBe('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings');
    expect(post.body.metadata).toEqual({ name: 'old-ci-admin' });
  });
});

describe('RBAC change history', () => {
  it('lists observed changes with who, the diff, and what the history cannot know', async () => {
    cluster(history([change(), change({ id: 8, kind: 'ClusterRoleBinding', namespace: '', name: 'old-ci-admin', change: 'deleted', after: null, actor: { name: 'erin', source: 'ui', at: '', ledger_id: 3, reason: 'offboarding' } })],
      { hidden: 2, system_hidden: 5, history: { ...history([]).history, unwatched: [{ kind: 'SecurityContextConstraints', reason: '403 Forbidden' }] } }));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    const list = await screen.findByRole('list', { name: 'RBAC changes' });
    const row = within(list).getByTestId('rbac-change-7');
    expect(row.textContent).toContain('Role payments/secret-manager');
    expect(row.textContent).toContain('by client kubectl-edit (person unknown)');
    expect(within(list).getByTestId('rbac-change-8').textContent).toContain('by erin via Pulse');
    fireEvent.click(within(row).getByRole('button', { name: 'Diff' }));
    const diff = within(row).getByLabelText('Diff of Role payments/secret-manager');
    expect(diff.textContent).toMatch(/\+\s+"delete",/);
    const coverage = screen.getByTestId('rbac-history-coverage').textContent!;
    expect(coverage).toMatch(/Pulse does not read the API server audit log/);
    expect(coverage).toMatch(/Not watched: SecurityContextConstraints \(403 Forbidden\)/);
    expect(coverage).toMatch(/2 changes are hidden because you cannot read those objects/);
    expect(screen.getByText(/Include platform objects \(5 hidden\)/)).toBeTruthy();
    expect(screen.queryByText('fallback list')).toBeNull();
  });

  it('restore reads the live object, shows the exact change, dry-runs, PUTs conditionally and records the reason', async () => {
    cluster(history([change()]));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    await screen.findByRole('list', { name: 'RBAC changes' });
    await clickWhenEnabled(/Restore previous/);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Change on restore').textContent).toMatch(/-\s+"delete",/);
    const confirm = within(dialog).getByRole('button', { name: 'Restore' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // reason required
    fireEvent.change(within(dialog).getByLabelText('Reason (saved in the Pulse write ledger)'), { target: { value: 'outside change window' } });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(ledgerPosts()).toHaveLength(1));
    const [dry, real] = k8sWrites();
    expect(dry).toMatchObject({ method: 'PUT', url: expect.stringMatching(/secret-manager\?dryRun=All$/) });
    expect(real).toMatchObject({ method: 'PUT', path: ROLE_PATH });
    expect(real.body.metadata.resourceVersion).toBe('77');
    expect(real.body.rules).toEqual(before.rules);
    expect(ledgerPosts()[0].body).toMatchObject({ verb: 'update', kind: 'Role', namespace: 'payments', name: 'secret-manager', reason: 'outside change window', resource_version: '77' });
    expect(ledgerPosts()[0].body.after.rules).toEqual(before.rules);
  });

  it('a deleted object is re-created', async () => {
    cluster(history([change({ change: 'deleted', after: null })]), () => k8sStatus(404, 'not found'));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    await clickWhenEnabled(/Restore previous/);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/no longer exists\. Re-creates it/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Reason (saved in the Pulse write ledger)'), { target: { value: 'deleted by mistake' } });
    // Re-creating a Role that reads Secrets is a grant, so it needs the name typed.
    expect(within(dialog).getByTestId('restore-escalation').textContent).toMatch(/read Secrets/);
    fireEvent.change(within(dialog).getByLabelText('Type secret-manager to grant this'), { target: { value: 'secret-manager' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(k8sWrites()).toHaveLength(2));
    expect(k8sWrites()[1]).toMatchObject({ method: 'POST', path: '/apis/rbac.authorization.k8s.io/v1/namespaces/payments/roles' });
  });

  it('a change made since (409) stays in the dialog; nothing is recorded', async () => {
    cluster(history([change()]), undefined, (r) => (r.method === 'PUT' && !r.url.includes('dryRun') ? k8sStatus(409, 'the object has been modified') : undefined));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    await clickWhenEnabled(/Restore previous/);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason (saved in the Pulse write ledger)'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/The object changed since this page loaded it/);
    expect(ledgerPosts()).toHaveLength(0);
  });

  it('a refused dry run (e.g. RBAC escalation) changes nothing', async () => {
    cluster(history([change()]), undefined, (r) => (r.method === 'PUT' && r.url.includes('dryRun') ? k8sStatus(403, 'attempting to grant RBAC permissions not currently held') : undefined));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    await clickWhenEnabled(/Restore previous/);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason (saved in the Pulse write ledger)'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/Permission denied: attempting to grant RBAC permissions not currently held/);
    expect(k8sWrites()).toHaveLength(1);
  });

  it('cancel sends nothing; without update/create permission Restore is disabled', async () => {
    cluster(history([change()]));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    await clickWhenEnabled(/Restore previous/);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(k8sWrites()).toHaveLength(0);
    cleanup();
    h.state.denied.add('update roles');
    h.state.denied.add('create roles');
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    const btn = await screen.findByRole('button', { name: /Restore previous/ });
    await waitFor(() => expect(btn.getAttribute('title')).toBe('You do not have permission to change roles'));
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('an agent without the endpoint (404) gets the creation-time list, labelled as such', async () => {
    cluster(k8sStatus(404, 'Not Found'));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    expect((await screen.findByTestId('rbac-history-absent')).textContent).toMatch(/does not keep RBAC change history, so only new bindings are listed/);
    expect(screen.getByText('fallback list')).toBeTruthy();
  });

  it('a failed history read (503) is an error, not the fallback and not "no changes"', async () => {
    cluster(json({ detail: 'RBAC history storage is unavailable' }, 503));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/RBAC change history could not be loaded.*503.*storage is unavailable/);
    expect(screen.queryByText('fallback list')).toBeNull();
    expect(screen.queryByText(/No changes observed/)).toBeNull();
  });

  it('on a remote cluster it does not ask the agent and says why', async () => {
    cluster(history([change()]));
    h.setActive(REMOTE);
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    expect((await screen.findByTestId('rbac-history-local-only')).textContent).toMatch(/local cluster only/);
    expect(h.state.requests.some((r) => r.url.startsWith('/api/agent'))).toBe(false);
  });

  it('a restore that grants more than the current version lists it and needs the name typed', async () => {
    const wide = { ...before, rules: [{ apiGroups: [''], resources: ['secrets'], verbs: ['get', 'list'] }, { apiGroups: ['rbac.authorization.k8s.io'], resources: ['roles'], verbs: ['escalate', 'bind'] }] };
    const liveNarrow = { ...before, rules: [{ apiGroups: [''], resources: ['pods'], verbs: ['get'] }], metadata: { ...before.metadata, resourceVersion: '77' } };
    cluster(history([change({ before: wide })]), json(liveNarrow));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    await clickWhenEnabled(/Restore previous/);
    const dialog = await screen.findByRole('dialog');
    const alert = within(dialog).getByTestId('restore-escalation').textContent!;
    expect(alert).toMatch(/read Secrets \(get,list\)/);
    expect(alert).toMatch(/escalate on roles/);
    expect(alert).toMatch(/bind on roles/);
    fireEvent.change(within(dialog).getByLabelText('Reason (saved in the Pulse write ledger)'), { target: { value: 'x' } });
    const confirm = within(dialog).getByRole('button', { name: 'Restore' }) as HTMLButtonElement;
    await new Promise((r) => setTimeout(r, 30));
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Type secret-manager to grant this'), { target: { value: 'secret-manager' } });
    await waitFor(() => expect(confirm.disabled).toBe(false));
  });

  it('a write 403 stays in the dialog and nothing is recorded', async () => {
    cluster(history([change()]), undefined, (r) => (r.method === 'PUT' && !r.url.includes('dryRun') ? k8sStatus(403, 'roles.rbac.authorization.k8s.io "secret-manager" is forbidden') : undefined));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    await clickWhenEnabled(/Restore previous/);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason (saved in the Pulse write ledger)'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/Permission denied: .*is forbidden/);
    expect(ledgerPosts()).toHaveLength(0);
  });

  it('switching cluster after opening sends nothing', async () => {
    cluster(history([change()]));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    await clickWhenEnabled(/Restore previous/);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason (saved in the Pulse write ledger)'), { target: { value: 'x' } });
    h.setActive(REMOTE);
    const btn = within(dialog).queryByRole('button', { name: 'Restore' });
    if (btn && document.body.contains(btn)) fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 100));
    if (document.body.contains(dialog)) expect(within(dialog).getByRole('alert').textContent).toMatch(/cluster/i);
    expect(k8sWrites()).toHaveLength(0);
  });

  it('says "Not observed yet" or "Could not check" rather than "No changes observed"', async () => {
    cluster(history([], { history: { ...history([]).history, since: null, last_observed_at: null } }));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    expect((await screen.findByTestId('rbac-history-empty')).textContent).toMatch(/^Not observed yet/);
    cleanup();
    cluster(history([], { history: { ...history([]).history, last_error: 'db down' } }));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    expect((await screen.findByTestId('rbac-history-empty')).textContent).toMatch(/^Could not check: the last observation failed \(db down\)/);
  });

  it('an unverified actor is labelled as such', async () => {
    cluster(history([change({ actor: { name: 'erin', verified: false, source: 'ui', at: '', ledger_id: 1, reason: '' } })]));
    h.renderUi(<RbacChangeHistory fallback={FALLBACK} />);
    expect((await screen.findByTestId('rbac-change-7')).textContent).toContain('by erin via Pulse (identity from the login proxy, not verified)');
  });
});

describe('restore keeps what the live object must keep', () => {
  it('keeps live ownerReferences on update and the live caBundle of each webhook', () => {
    const req = restoreRequest({ kind: 'Role', namespace: 'payments', name: 'secret-manager', before }, { metadata: { resourceVersion: '9', ownerReferences: [{ uid: 'live-owner' }] } });
    expect((req.body.metadata as Record<string, unknown>).ownerReferences).toEqual([{ uid: 'live-owner' }]);
    const hookBefore = { metadata: { name: 'gk' }, webhooks: [{ name: 'a', clientConfig: { caBundle: 'OLD', service: { name: 's' } }, rules: [] }] };
    const hookLive = { metadata: { resourceVersion: '3' }, webhooks: [{ name: 'a', clientConfig: { caBundle: 'NEW' } }] };
    const w = restoreRequest({ kind: 'ValidatingWebhookConfiguration', namespace: '', name: 'gk', before: hookBefore }, hookLive);
    expect(w.body.webhooks).toEqual([{ name: 'a', clientConfig: { caBundle: 'NEW', service: { name: 's' } }, rules: [] }]);
  });

  it('flags only what the restore adds', () => {
    expect(escalationOnRestore('ClusterRoleBinding', { roleRef: { name: 'view' }, subjects: [] }, { roleRef: { name: 'cluster-admin' }, subjects: [{ kind: 'User', name: 'bob' }] })).toEqual(['binds cluster-admin to User bob']);
    expect(escalationOnRestore('Role', { rules: [{ verbs: ['*'], apiGroups: ['*'], resources: ['*'] }] }, { rules: [{ verbs: ['*'], apiGroups: ['*'], resources: ['*'] }] })).toEqual([]);
  });
});
