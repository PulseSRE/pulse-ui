// @vitest-environment jsdom
/**
 * Delete with related objects: what is offered and kept (and why), PVCs
 * unchecked with the data loss stated, an unreadable kind shown as "Could not
 * check", type-the-name confirm, a dry run of everything before any delete,
 * workload-first deletes with a result per object, 403/409 handling, RBAC,
 * cancel, and the Helm-owned variant pointing to the release uninstall.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within, render, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { releaseSecret } from '../../../views/create/__tests__/helmTestUtils';
import { DeleteRelatedDialog } from '../DeleteRelatedDialog';
import { installFetch, setAllow, respond, writes, json, renderWithProviders, calls } from './actionHarness';
import type { K8sResource } from '../../../engine/renderers';

const NS = '/api/v1/namespaces/shop';
const APPS = '/apis/apps/v1/namespaces/shop';
const tmpl = (app: string, spec: object = {}) => ({ metadata: { labels: { app } }, spec: { containers: [{ name: app }], ...spec } });
const legacy = {
  apiVersion: 'apps/v1', kind: 'Deployment',
  metadata: { name: 'storefront-legacy', namespace: 'shop', uid: 'u-legacy' },
  spec: { template: tmpl('storefront-legacy', {
    containers: [{ name: 'web', envFrom: [{ configMapRef: { name: 'storefront-legacy-cfg' } }, { configMapRef: { name: 'shop-feature-flags' } }] }],
    volumes: [{ name: 'up', persistentVolumeClaim: { claimName: 'uploads' } }],
  }) },
} as unknown as K8sResource;
const storefront = { metadata: { name: 'storefront', namespace: 'shop' }, spec: { template: tmpl('storefront', { containers: [{ name: 's', envFrom: [{ configMapRef: { name: 'shop-feature-flags' } }] }] }) } };

const ALLOW = Object.fromEntries(['deployments', 'services', 'routes', 'horizontalpodautoscalers', 'poddisruptionbudgets', 'networkpolicies', 'configmaps', 'secrets', 'persistentvolumeclaims'].map((r) => [`delete/${r}`, true]));

// The ConfigMap list and single-object read answers (tests override these).
let cmList = 200;
let cmGet = 200;
beforeEach(() => {
  cmList = 200;
  cmGet = 200;
  installFetch();
  setAllow(ALLOW);
  respond((c) => {
    if (c.method !== 'GET') return undefined;
    if (c.path === `${APPS}/deployments`) return json({ kind: 'DeploymentList', apiVersion: 'apps/v1', items: [legacy, storefront] });
    if (c.path === `${NS}/services`) return json({ kind: 'ServiceList', apiVersion: 'v1', items: [{ metadata: { name: 'storefront-legacy', uid: 'u-svc' }, spec: { selector: { app: 'storefront-legacy' } } }] });
    if (c.path === '/apis/route.openshift.io/v1/namespaces/shop/routes') return json({ items: [{ metadata: { name: 'storefront-legacy', uid: 'u-route' }, spec: { host: 'legacy.shop.example.com', to: { kind: 'Service', name: 'storefront-legacy' } } }] });
    if (c.path === '/apis/networking.k8s.io/v1/namespaces/shop/networkpolicies') return json({ kind: 'Status', message: 'networkpolicies is forbidden', code: 403 }, 403);
    if (c.path === `${NS}/persistentvolumeclaims`) return json({ items: [{ metadata: { name: 'uploads', uid: 'u-pvc' }, spec: { volumeName: 'pv-9' }, status: { capacity: { storage: '14Gi' } } }] });
    if (c.path === `${NS}/configmaps` && cmList !== 200) return json({ kind: 'Status', message: 'configmaps is forbidden', code: cmList }, cmList);
    if (c.path === `${NS}/configmaps/storefront-legacy-cfg`) {
      return cmGet === 200 ? json({ kind: 'PartialObjectMetadata', metadata: { name: 'storefront-legacy-cfg', uid: 'u-cfg-get' } }) : json({ kind: 'Status', message: 'forbidden', code: cmGet }, cmGet);
    }
    if (c.path === `${NS}/configmaps`) return json({ kind: 'PartialObjectMetadataList', items: [{ metadata: { name: 'storefront-legacy-cfg', uid: 'u-cfg' } }, { metadata: { name: 'shop-feature-flags', uid: 'u-ff' } }] });
    if (c.path.startsWith(`${NS}/secrets?labelSelector=`) && c.path.includes('checkout')) {
      return json({ items: [releaseSecret('checkout', 'shop', 7, 'deployed', '3.2.1', {}, 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: checkout\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: checkout\n')] });
    }
    if (c.path === '/api/v1/persistentvolumes/pv-9') return json({ metadata: { name: 'pv-9' }, spec: { persistentVolumeReclaimPolicy: 'Delete' } });
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const RBAC = { group: 'apps', plural: 'deployments' };
const box = (dialog: HTMLElement, name: RegExp) => within(dialog).getByRole('checkbox', { name }) as HTMLInputElement;

async function open(onDeleted = vi.fn()) {
  renderWithProviders(<DeleteRelatedDialog workload={legacy} workloadRbac={RBAC} onClose={() => {}} onDeleted={onDeleted} />);
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('checkbox', { name: /^Service storefront-legacy$/ });
  return dialog;
}
async function typeAndConfirm(dialog: HTMLElement, label: RegExp) {
  fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: 'storefront-legacy' } });
  const btn = within(dialog).getByRole('button', { name: label }) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  fireEvent.click(btn);
}

describe('DeleteRelatedDialog', () => {
  it('offers what exists only for the workload, keeps shared objects, and leaves the PVC unchecked with its data loss', async () => {
    const dialog = await open();
    expect(box(dialog, /^Service storefront-legacy$/).checked).toBe(true);
    expect(box(dialog, /^Route storefront-legacy$/).checked).toBe(true);
    expect(box(dialog, /ConfigMap storefront-legacy-cfg/).checked).toBe(true);
    const shared = box(dialog, /ConfigMap shop-feature-flags/);
    expect(shared.checked).toBe(false);
    expect(shared.disabled).toBe(true);
    expect(within(dialog).getByText(/Kept: also used by Deployment storefront/)).toBeTruthy();
    const pvc = box(dialog, /PersistentVolumeClaim uploads/);
    expect(pvc.checked).toBe(false);
    expect(pvc.disabled).toBe(false);
    expect(within(dialog).getByText(/destroys 14Gi of data for good: the volume's reclaim policy is Delete/)).toBeTruthy();
    expect(within(dialog).getByText('Could not check NetworkPolicies: you cannot list NetworkPolicies in shop.')).toBeTruthy();
    expect(within(dialog).getByTestId('delete-summary').textContent).toBe('Deployment + 3 related objects · 1 PVC kept');
  });

  it('needs the typed name; dry-runs everything, then deletes the workload first and reports each object', async () => {
    const onDeleted = vi.fn();
    const dialog = await open(onDeleted);
    expect((within(dialog).getByRole('button', { name: 'Delete 4 objects' }) as HTMLButtonElement).disabled).toBe(true);
    await typeAndConfirm(dialog, /Delete 4 objects/);
    await within(dialog).findByRole('region', { name: 'Delete results' });
    expect(writes().map((w) => w.path)).toEqual([
      `${APPS}/deployments/storefront-legacy?dryRun=All`,
      `${NS}/services/storefront-legacy?dryRun=All`,
      '/apis/route.openshift.io/v1/namespaces/shop/routes/storefront-legacy?dryRun=All',
      `${NS}/configmaps/storefront-legacy-cfg?dryRun=All`,
      `${APPS}/deployments/storefront-legacy`,
      `${NS}/services/storefront-legacy`,
      '/apis/route.openshift.io/v1/namespaces/shop/routes/storefront-legacy',
      `${NS}/configmaps/storefront-legacy-cfg`,
    ]);
    expect(writes()[4].body).toMatchObject({ preconditions: { uid: 'u-legacy' }, propagationPolicy: 'Background' });
    // The ConfigMap, read metadata-only, is deleted with its uid as a precondition.
    expect(writes()[7].body).toMatchObject({ preconditions: { uid: 'u-cfg' } });
    const cmList = calls.find((c) => c.method === 'GET' && c.path === `${NS}/configmaps`);
    expect(cmList).toBeTruthy();
    expect(writes().some((w) => w.path.includes('persistentvolumeclaims'))).toBe(false);
    expect(within(dialog).getAllByText('Deleted')).toHaveLength(4);
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(onDeleted).toHaveBeenCalled();
  });

  it('a failed dry run deletes nothing', async () => {
    respond((c) => (c.method === 'DELETE' && c.path === `${NS}/services/storefront-legacy?dryRun=All` ? json({ kind: 'Status', message: 'denied by policy', code: 422 }, 422) : undefined));
    const dialog = await open();
    await typeAndConfirm(dialog, /Delete 4 objects/);
    expect(await within(dialog).findByText(/The dry run failed, so nothing was deleted\. Service storefront-legacy: denied by policy/)).toBeTruthy();
    expect(writes().filter((w) => !w.path.includes('dryRun'))).toEqual([]);
  });

  it('a 403 on a related object is reported for that object; the rest still go', async () => {
    respond((c) => (c.method === 'DELETE' && c.path === `${NS}/services/storefront-legacy` ? json({ kind: 'Status', message: 'services "storefront-legacy" is forbidden', code: 403 }, 403) : undefined));
    const dialog = await open();
    await typeAndConfirm(dialog, /Delete 4 objects/);
    const results = await within(dialog).findByRole('region', { name: 'Delete results' });
    await waitFor(() => expect(within(results).getAllByRole('listitem')).toHaveLength(4));
    expect(within(results).getByText(/Failed: Permission denied: services "storefront-legacy" is forbidden/)).toBeTruthy();
    expect(within(results).getAllByText('Deleted')).toHaveLength(3);
  });

  it('a 409 on the workload stops: the related objects are not deleted', async () => {
    respond((c) => (c.method === 'DELETE' && c.path === `${APPS}/deployments/storefront-legacy` ? json({ kind: 'Status', message: 'Precondition failed: UID mismatch', code: 409 }, 409) : undefined));
    const dialog = await open();
    await typeAndConfirm(dialog, /Delete 4 objects/);
    const results = await within(dialog).findByRole('region', { name: 'Delete results' });
    expect(within(results).getByText(/Failed: The object changed since this page loaded it/)).toBeTruthy();
    expect(within(results).getAllByText(/Not deleted: the Deployment could not be deleted/)).toHaveLength(3);
    expect(writes().filter((w) => !w.path.includes('dryRun')).map((w) => w.path)).toEqual([`${APPS}/deployments/storefront-legacy`]);
  });

  it('RBAC: without delete on Services the Service cannot be chosen; without delete on the workload nothing can be confirmed', async () => {
    setAllow({ ...ALLOW, 'delete/services': false });
    const dialog = await open();
    await waitFor(() => expect(box(dialog, /^Service storefront-legacy$/).disabled).toBe(true));
    expect(within(dialog).getByText(/You cannot delete Services in shop/)).toBeTruthy();
    cleanup();
    setAllow({ ...ALLOW, 'delete/deployments': false });
    const d2 = await open();
    fireEvent.change(within(d2).getByLabelText(/to confirm/), { target: { value: 'storefront-legacy' } });
    expect(await within(d2).findByText('You do not have permission to delete deployments in shop.')).toBeTruthy();
    expect((within(d2).getByRole('button', { name: /^Delete \d object/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('cancel writes nothing', async () => {
    const onClose = vi.fn();
    renderWithProviders(<DeleteRelatedDialog workload={legacy} workloadRbac={RBAC} onClose={onClose} />);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('a Helm-owned workload points to the release uninstall first; "delete only" deletes only the workload', async () => {
    const helm = { ...legacy, metadata: { ...legacy.metadata, name: 'checkout', labels: { 'app.kubernetes.io/managed-by': 'Helm' }, annotations: { 'meta.helm.sh/release-name': 'checkout', 'meta.helm.sh/release-namespace': 'shop' } } } as unknown as K8sResource;
    renderWithProviders(<DeleteRelatedDialog workload={helm} workloadRbac={RBAC} onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Managed by Helm release checkout \(revision 7\)/)).toBeTruthy();
    expect(within(dialog).getByText(/the release's 1 other object behind/)).toBeTruthy();
    expect(within(dialog).getByText(/the next helm upgrade recreates it/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete only the Deployment…' }));
    expect(within(screen.getByRole('dialog')).queryByRole('region', { name: 'Related objects' })).toBeNull();
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(/to confirm/), { target: { value: 'checkout' } });
    const btn = within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete 1 object' }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes().map((w) => w.path)).toEqual([`${APPS}/deployments/checkout?dryRun=All`, `${APPS}/deployments/checkout`]);
  });

  it('the Helm variant\'s "Uninstall release" opens the release uninstall', async () => {
    const helm = { ...legacy, metadata: { ...legacy.metadata, name: 'checkout', labels: { 'app.kubernetes.io/managed-by': 'Helm' }, annotations: { 'meta.helm.sh/release-name': 'checkout' } } } as unknown as K8sResource;
    renderWithProviders(<DeleteRelatedDialog workload={helm} workloadRbac={RBAC} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall release checkout…' }));
    expect(screen.getByTestId('location').textContent).toBe('/software?tab=helm&release=checkout&releaseNs=shop&action=uninstall');
    expect(writes()).toEqual([]);
  });

  it('a Deployment that only claims Helm ownership (the release does not list it) is treated as not Helm-managed', async () => {
    const forged = { ...legacy, metadata: { ...legacy.metadata, labels: { 'app.kubernetes.io/managed-by': 'Helm' }, annotations: { 'meta.helm.sh/release-name': 'checkout' } } } as unknown as K8sResource;
    renderWithProviders(<DeleteRelatedDialog workload={forged} workloadRbac={RBAC} onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByTestId('helm-claim-note')).toBeTruthy();
    expect(within(dialog).getByTestId('helm-claim-note').textContent).toMatch(/release checkout in shop does not list it/);
    expect(await within(dialog).findByRole('checkbox', { name: /^Service storefront-legacy$/ })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /Uninstall release/ })).toBeNull();
  });

  it('warns when a controller owns the workload', async () => {
    const owned = { ...legacy, metadata: { ...legacy.metadata, ownerReferences: [{ kind: 'AppOperatorCR', name: 'shop', controller: true }] } } as unknown as K8sResource;
    renderWithProviders(<DeleteRelatedDialog workload={owned} workloadRbac={RBAC} onClose={() => {}} />);
    expect(await screen.findByText(/managed by AppOperatorCR shop: its controller will probably create it again/)).toBeTruthy();
  });

  it('a refetch keeps the user\'s choices (regression)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><DeleteRelatedDialog workload={legacy} workloadRbac={RBAC} onClose={() => {}} /></MemoryRouter></QueryClientProvider>);
    const dialog = await screen.findByRole('dialog');
    const svc = await within(dialog).findByRole('checkbox', { name: /^Service storefront-legacy$/ }) as HTMLInputElement;
    fireEvent.click(svc);
    fireEvent.click(box(dialog, /PersistentVolumeClaim uploads/));
    expect(svc.checked).toBe(false);
    const listsBefore = calls.filter((c) => c.path === `${NS}/services`).length;
    await act(async () => { await qc.invalidateQueries(); });
    await waitFor(() => expect(calls.filter((c) => c.path === `${NS}/services`).length).toBeGreaterThan(listsBefore));
    await waitFor(() => expect(box(dialog, /^Service storefront-legacy$/).checked).toBe(false));
    expect(box(dialog, /PersistentVolumeClaim uploads/).checked).toBe(true);
  });

  it('a ConfigMap whose list was forbidden: its uid is read first, and the delete carries it', async () => {
    cmList = 403;
    // Forbidden list: nothing is chosen by default; choose it by hand.
    const dialog = await open();
    const cfg = box(dialog, /^ConfigMap storefront-legacy-cfg$/);
    await waitFor(() => expect(cfg.disabled).toBe(false));
    fireEvent.click(cfg);
    await typeAndConfirm(dialog, /Delete 4 objects/);
    await within(dialog).findByRole('region', { name: 'Delete results' });
    const cmDeletes = writes().filter((w) => w.path.startsWith(`${NS}/configmaps/storefront-legacy-cfg`));
    expect(cmDeletes).toHaveLength(2);
    for (const w of cmDeletes) expect(w.body).toMatchObject({ preconditions: { uid: 'u-cfg-get' } });
  });

  it('when that single read fails too, the row is "Could not check" and never deleted', async () => {
    cmList = 403;
    cmGet = 403;
    const dialog = await open();
    const cfg = box(dialog, /^ConfigMap storefront-legacy-cfg$/);
    await waitFor(() => expect(cfg.disabled).toBe(true));
    expect(within(dialog).getAllByText(/Could not check: its uid could not be read/).length).toBeGreaterThan(0);
    await typeAndConfirm(dialog, /Delete 3 objects/);
    await within(dialog).findByRole('region', { name: 'Delete results' });
    expect(writes().some((w) => w.path.includes('/configmaps/'))).toBe(false);
    expect(writes().every((w) => w.body?.preconditions?.uid)).toBe(true);
  });

  it('Cancel calls onCancel (not onClose) when given', async () => {
    const onClose = vi.fn(); const onCancel = vi.fn();
    renderWithProviders(<DeleteRelatedDialog workload={legacy} workloadRbac={RBAC} onClose={onClose} onCancel={onCancel} />);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
