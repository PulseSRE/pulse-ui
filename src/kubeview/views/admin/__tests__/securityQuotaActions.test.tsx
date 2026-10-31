// @vitest-environment jsdom
/**
 * Security: default-deny NetworkPolicy from an unprotected namespace, remove
 * a cluster-admin binding. Quotas: inline edit of hard limits and prefilled
 * ResourceQuota/LimitRange creates. Certificates: rotate a service-ca
 * serving certificate. Templates: the create flow opens them prefilled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { clickWhenEnabled, createHarness, json, k8sStatus } from '../../../__tests__/actionHarness';

vi.mock('../../../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
const visited: string[] = [];
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => (p: string) => visited.push(p) }));

import SecurityView from '../../SecurityView';
import { QuotasTab, quotaHardPatch } from '../QuotasTab';
import { CertificatesTab } from '../CertificatesTab';
import { renderCreateTemplate, createTemplateUrl } from '../../../engine/createTemplates';

const h = createHarness();
beforeEach(() => { h.setup(); visited.length = 0; });
afterEach(() => { cleanup(); h.teardown(); });

describe('SecurityView actions', () => {
  beforeEach(() => {
    h.state.handler = (r) => {
      if (r.method !== 'GET') return json({});
      if (r.path.startsWith('/api/v1/namespaces')) return json({ items: [{ metadata: { name: 'shop' } }, { metadata: { name: 'openshift-monitoring' } }] });
      if (r.path.startsWith('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings')) return json({ items: [{
        metadata: { name: 'shop-admins', uid: 'uid-shop-admins' },
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'cluster-admin' },
        subjects: [{ kind: 'User', name: 'alice' }, { kind: 'User', name: 'bob' }],
      }] });
      return json({ items: [] });
    };
  });

  it('offers a prefilled default-deny NetworkPolicy for a namespace without one', async () => {
    h.renderUi(<SecurityView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create default-deny NetworkPolicy in shop' }));
    expect(visited).toEqual(['/create/networking.k8s.io~v1~networkpolicies?template=default-deny&namespace=shop']);
  });

  it('removes a cluster-admin binding after naming everyone who loses access', async () => {
    h.renderUi(<SecurityView />);
    const buttons = await screen.findAllByRole('button', { name: 'Remove binding ClusterRoleBinding shop-admins' });
    await waitFor(() => expect((buttons[0] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('User alice')).toBeTruthy();
    expect(within(dialog).getByText('User bob')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete binding' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0]).toMatchObject({ method: 'DELETE', path: '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/shop-admins' });
  });
});

describe('Templates', () => {
  it('prefill the namespace and refuse an invalid one', () => {
    expect(renderCreateTemplate('default-deny', 'shop')).toContain('namespace: shop\nspec:\n');
    expect(renderCreateTemplate('default-deny', 'shop')).toContain('podSelector: {}');
    expect(renderCreateTemplate('default-deny', 'Bad NS')).toBeNull();
    expect(renderCreateTemplate('nope', 'shop')).toBeNull();
    expect(createTemplateUrl('limit-range', 'shop')).toBe('/create/v1~limitranges?template=limit-range&namespace=shop');
  });
});

const quota = {
  apiVersion: 'v1', kind: 'ResourceQuota',
  metadata: { name: 'compute', namespace: 'shop', uid: 'q1', resourceVersion: '77' },
  spec: { hard: { 'requests.cpu': '4', pods: '20' } },
  status: { used: { 'requests.cpu': '1', pods: '3' } },
};

describe('QuotasTab', () => {
  beforeEach(() => {
    h.state.handler = (r) => (r.method === 'GET' && r.path === '/api/v1/namespaces'
      ? json({ items: [{ metadata: { name: 'shop' } }, { metadata: { name: 'empty' } }] })
      : json({}));
  });

  it('edits hard limits inline and sends a merge patch with the change, the removal and the resourceVersion', async () => {
    h.renderUi(<QuotasTab quotas={[quota as never]} limitRanges={[]} go={(p) => visited.push(p)} />);
    await clickWhenEnabled('Edit quota compute');
    fireEvent.change(screen.getByRole('textbox', { name: 'Limit for requests.cpu' }), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove pods' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['requests.cpu: 4 → 8', 'pods: 20 → (removed)']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update quota' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0]).toMatchObject({
      method: 'PATCH',
      path: '/api/v1/namespaces/shop/resourcequotas/compute',
      body: { metadata: { resourceVersion: '77' }, spec: { hard: { 'requests.cpu': '8', pods: null } } },
    });
  });

  it('a conflicting edit is reported in the dialog', async () => {
    h.state.handler = (r) => (r.method === 'PATCH' ? k8sStatus(409, 'the object has been modified; please apply your changes to the latest version') : json({ items: [] }));
    h.renderUi(<QuotasTab quotas={[quota as never]} limitRanges={[]} go={() => {}} />);
    await clickWhenEnabled('Edit quota compute');
    fireEvent.change(screen.getByRole('textbox', { name: 'Limit for pods' }), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Update quota' }));
    expect(await screen.findByText(/apply your changes to the latest version/)).toBeTruthy();
  });

  it('unprotected namespaces link to prefilled ResourceQuota and LimitRange creates', async () => {
    h.renderUi(<QuotasTab quotas={[quota as never]} limitRanges={[]} go={(p) => visited.push(p)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create ResourceQuota in empty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create LimitRange in empty' }));
    expect(visited).toEqual([
      '/create/v1~resourcequotas?template=resource-quota&namespace=empty',
      '/create/v1~limitranges?template=limit-range&namespace=empty',
    ]);
  });

  it('quotaHardPatch only sends what changed', () => {
    expect(quotaHardPatch({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' }, '5')).toEqual({ metadata: { resourceVersion: '5' }, spec: { hard: { b: '3', c: '4' } } });
  });
});

describe('CertificatesTab rotate', () => {
  const svcCa = {
    apiVersion: 'v1', kind: 'Secret', type: 'kubernetes.io/tls',
    metadata: { name: 'api-tls', namespace: 'shop', uid: 'sec-1', creationTimestamp: '2026-01-01T00:00:00Z',
      annotations: { 'service.beta.openshift.io/originating-service-name': 'api', 'service.beta.openshift.io/expiry': '2027-01-01T00:00:00Z' } },
    data: {},
  };
  beforeEach(() => {
    h.state.handler = (r) => (r.method === 'GET' && r.path.startsWith('/api/v1/secrets') ? json({ items: [svcCa] }) : json({ items: [] }));
  });

  it('links the owning Service and rotates by deleting the secret (uid precondition) after confirmation', async () => {
    h.renderUi(<CertificatesTab go={(p) => visited.push(p)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Service/api' }));
    expect(visited).toEqual(['/r/v1~services/shop/api']);
    await clickWhenEnabled('Rotate api-tls');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/service-ca operator then issues a new serving certificate for Service api/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete and re-issue' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0]).toMatchObject({ method: 'DELETE', path: '/api/v1/namespaces/shop/secrets/api-tls', body: { preconditions: { uid: 'sec-1' } } });
  });

  it('rotation is disabled without delete permission on secrets', async () => {
    h.state.denied.add('delete secrets');
    h.renderUi(<CertificatesTab go={() => {}} />);
    const btn = await screen.findByRole('button', { name: 'Rotate api-tls' });
    await waitFor(() => expect(btn.getAttribute('title')).toMatch(/do not have permission/));
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('the load error has a retry that reloads', async () => {
    let fail = true;
    h.state.handler = (r) => (r.path.startsWith('/api/v1/secrets') ? (fail ? k8sStatus(403, 'secrets is forbidden') : json({ items: [svcCa] })) : json({ items: [] }));
    h.renderUi(<CertificatesTab go={() => {}} />);
    expect(await screen.findByText('Failed to load certificates')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('api-tls')).toBeTruthy();
  });
});
