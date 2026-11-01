// @vitest-environment jsdom
/**
 * Admin and Software pages with their reads really failing: the real
 * useK8sListWatch / k8sList / k8sFetch run against a fetch that answers 403
 * or 500 (only the watch socket is stubbed). A failed read must show as an
 * error or "unknown", never as zero, "none configured" or a pass.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';

vi.mock('../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));

import { mockFetchRoutes, renderWithClient, renderWithFailedRequests, expectNoAllClear, type MockRoute } from './helpers/honestStates';
import AdminView from '../views/AdminView';
import OperatorCatalogView from '../views/OperatorCatalogView';
import { InstalledTab } from '../views/create/InstalledTab';
import { HelmTab } from '../views/create/HelmTab';

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const list = (items: unknown[]): MockRoute => ({ body: { items } });
const ns = (name: string) => ({ metadata: { name, uid: name } });

// notAfter = Feb 1 2024 (expired). Its cert-manager annotation claims 2099:
// the certificate itself is authoritative, and both places must agree.
const EXPIRED_CRT = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJXRENCL3FBREFnRUNBaFF1ZEVuQ3RKSkFIUXc1KzNpb0oyeXkvd1pvdVRBS0JnZ3Foa2pPUFFRREFqQVMKTVJBd0RnWURWUVFEREFkbGVIQnBjbVZrTUI0WERUSTBNREV3TVRBd01EQXdNRm9YRFRJME1ESXdNVEF3TURBdwpNRm93RWpFUU1BNEdBMVVFQXd3SFpYaHdhWEpsWkRCWk1CTUdCeXFHU000OUFnRUdDQ3FHU000OUF3RUhBMElBCkJNK2gveFZoZXNxaWxJa3JoYit1OC9JVmJTdkhuWEsyelE1UStJOHl0QndxS2Y1OFE2SGZySTRyVjJaSTF0TFQKQkN0OE5LbEJtbHBsbmVSaWxicCt2aXFqTWpBd01CMEdBMVVkRGdRV0JCUTRpUGM3aDE1M3ZXcGlYTUR1cWI5eQorNjBLanpBUEJnTlZIUk1CQWY4RUJUQURBUUgvTUFvR0NDcUdTTTQ5QkFNQ0Ewa0FNRVlDSVFEeFpqOC9paGFNCjVCdG5OOEFlWkc4eDNnUXlzdkQxbEhySFFJSHY3bnpvRHdJaEFLTlJpaGJWYldTeVZGZnpldTVOV0FRTmpaRC8KNnNoUFZ2bWRIWWF1RmxOZQotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tCg==';

const clusterVersion = {
  metadata: { name: 'version' },
  spec: { channel: 'stable-4.16', clusterID: 'abc' },
  status: {
    desired: { version: '4.16.1' },
    history: [{ state: 'Completed', version: '4.16.1', startedTime: '2025-01-01T00:00:00Z' }],
    availableUpdates: [{ version: '4.16.2', image: 'quay.io/x@sha256:1' }],
    conditions: [{ type: 'RetrievedUpdates', status: 'True' }],
  },
};

describe.each([403, 500])('Admin › Quotas with quota and LimitRange reads failing (%i)', (status) => {
  it('shows the errors and "—", not zero quotas and every namespace "unprotected"', async () => {
    renderWithFailedRequests(<AdminView />, {
      status,
      route: '/admin?tab=quotas',
      routes: { '/api/v1/namespaces': list([ns('shop'), ns('web')]) },
    });
    await waitFor(() => expect(screen.getByText('ResourceQuotas could not be read')).toBeTruthy());
    expect(screen.getByText('LimitRanges could not be read')).toBeTruthy();
    const card = screen.getByTestId('unprotected-card');
    expect(card.textContent).toContain('—');
    expect(card.textContent).toMatch(/unknown/);
    expect(screen.queryByText(/Unprotected Namespaces/)).toBeNull();
    expect(screen.queryByText('No resource quotas configured')).toBeNull();
    expect(screen.queryByText('No limit ranges configured')).toBeNull();
    expect(screen.getByRole('tab', { name: /Quotas \(—\)/ })).toBeTruthy();
    expectNoAllClear();
  });
});

describe('Admin › Quotas happy path', () => {
  it('lists the namespaces that really have no quota or limit range', async () => {
    mockFetchRoutes({
      '/api/v1/namespaces': list([ns('shop'), ns('web')]),
      '/api/v1/resourcequotas': list([{ metadata: { name: 'q', namespace: 'shop', uid: 'q' }, spec: { hard: { pods: '10' } }, status: { used: { pods: '2' } } }]),
      '/api/v1/limitranges': list([]),
    });
    renderWithClient(<AdminView />, { route: '/admin?tab=quotas' });
    await waitFor(() => expect(screen.getByText('Unprotected Namespaces (1)')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'web' })).toBeTruthy();
    expect(screen.getByTestId('unprotected-card').textContent).toContain('1');
    expect(screen.getByText('No limit ranges configured')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe.each([[403, 'Permission denied (403)'], [500, 'Request failed (500)']] as const)('Admin › Updates pre-update checklist with PDB/backup reads failing (%i)', (status, reason) => {
  it('says "Could not check", not "No multi-replica user deployments" / "No automated backup configured"', async () => {
    renderWithFailedRequests(<AdminView />, {
      status,
      route: '/admin?tab=updates',
      routes: { '/apis/config.openshift.io/v1/clusterversions': list([clusterVersion]) },
    });
    const pdb = await screen.findByTestId('precheck-PodDisruptionBudgets');
    await waitFor(() => expect(pdb.getAttribute('data-status')).toBe('unknown'));
    expect(pdb.textContent).toContain(`Could not check: ${reason}`);
    const backup = screen.getByTestId('precheck-Etcd backup');
    await waitFor(() => expect(backup.getAttribute('data-status')).toBe('unknown'));
    expect(backup.textContent).toContain(`Could not check: ${reason}`);
    expect(document.body.textContent).not.toMatch(/No multi-replica user deployments|No automated backup configured|Backup schedule configured/);
  });
});

describe('Admin › Updates pre-update checklist happy path', () => {
  it('a 404 on Backups is "no automated backup", and empty lists are a real answer', async () => {
    mockFetchRoutes({
      '/apis/config.openshift.io/v1/clusterversions': list([clusterVersion]),
      '/apis/config.openshift.io/v1alpha1/backups': { status: 404, body: { kind: 'Status', code: 404 } },
      '/apis/policy/v1/poddisruptionbudgets': list([]),
      '/apis/apps/v1/deployments': list([]),
    });
    renderWithClient(<AdminView />, { route: '/admin?tab=updates' });
    const pdb = await screen.findByTestId('precheck-PodDisruptionBudgets');
    await waitFor(() => expect(pdb.textContent).toContain('No multi-replica user deployments'));
    expect(pdb.getAttribute('data-status')).toBe('pass');
    const backup = screen.getByTestId('precheck-Etcd backup');
    await waitFor(() => expect(backup.textContent).toContain('No automated backup configured'));
    expect(backup.getAttribute('data-status')).toBe('warn');
  });
});

describe.each([403, 500])('Admin › Operators with the ClusterOperator list failing (%i)', (status) => {
  it('shows the error and "—" tiles, not 0/0/0', async () => {
    renderWithFailedRequests(<AdminView />, { status, route: '/admin?tab=operators' });
    await waitFor(() => expect(screen.getByText('ClusterOperators could not be read')).toBeTruthy());
    const tile = (label: string) => screen.getByText(label, { selector: 'span' }).closest('div')!.parentElement!;
    for (const label of ['Available', 'Degraded', 'Progressing']) {
      expect(tile(label).textContent, label).toContain('—');
      expect(tile(label).textContent, label).not.toMatch(/\d/);
    }
    expect(document.body.textContent).not.toMatch(/operators healthy/);
  });
});

describe('Admin › Operators happy path', () => {
  const op = (name: string, conds: Record<string, string>) => ({
    metadata: { name, uid: name },
    status: { conditions: Object.entries(conds).map(([type, s]) => ({ type, status: s })) },
  });

  it('counts the operators read', async () => {
    mockFetchRoutes({ '/apis/config.openshift.io/v1/clusteroperators': list([op('dns', { Available: 'True', Degraded: 'False' }), op('etcd', { Available: 'True', Degraded: 'False' })]) });
    renderWithClient(<AdminView />, { route: '/admin?tab=operators' });
    await waitFor(() => expect(screen.getByText(/All 2 operators healthy/)).toBeTruthy());
  });

  it('does not say "no unavailable operators" when one is unavailable', async () => {
    mockFetchRoutes({ '/apis/config.openshift.io/v1/clusteroperators': list([op('dns', { Available: 'True' }), op('etcd', { Available: 'False', Degraded: 'False' })]) });
    renderWithClient(<AdminView />, { route: '/admin?tab=operators' });
    await waitFor(() => expect(screen.getByText('etcd')).toBeTruthy());
    expect(screen.queryByText(/operators healthy/)).toBeNull();
  });
});

describe.each([403, 500])('Admin › Overview with Ingress, OAuth, events and certificate reads failing (%i)', (status) => {
  it('shows "Could not read" and load errors, not "Self-signed" or hidden panels', async () => {
    renderWithFailedRequests(<AdminView />, { status, route: '/admin' });
    await waitFor(() => expect(screen.getByText('Recent warning events could not be read')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Certificate expiry could not be checked')).toBeTruthy());
    const row = screen.getByText('Default Certificate').parentElement!;
    await waitFor(() => expect(row.textContent).toContain('Could not read'));
    expect(screen.queryByText('Self-signed')).toBeNull();
    expect(screen.queryByText('No identity providers configured')).toBeNull();
    expect(screen.getByText('Identity providers could not be read')).toBeTruthy();
    expect(screen.getByText('Quotas / Limit Ranges').parentElement!.textContent).toContain('Could not read');
    expect(document.body.textContent).not.toMatch(/0 quotas, 0 limits/);
  });
});

describe('Admin › Overview happy path', () => {
  it('a readable Ingress config without a custom certificate is "Self-signed"', async () => {
    mockFetchRoutes({ '/apis/config.openshift.io/v1/ingresses/cluster': { body: { metadata: { name: 'cluster' }, spec: { domain: 'apps.example.com' } } } });
    renderWithClient(<AdminView />, { route: '/admin' });
    await waitFor(() => expect(screen.getByText('Self-signed')).toBeTruthy());
    expect(screen.getByText('apps.example.com')).toBeTruthy();
  });
});

describe('Certificates: the Overview count and the Certificates tab agree', () => {
  it('"N certs expiring" opens a list that contains them, system namespaces included', async () => {
    const secret = {
      type: 'kubernetes.io/tls',
      metadata: { name: 'router-certs', namespace: 'openshift-ingress', uid: 'rc', annotations: { 'cert-manager.io/certificate-expiry': '2099-01-01T00:00:00Z' } },
      data: { 'tls.crt': EXPIRED_CRT },
    };
    mockFetchRoutes({ '/api/v1/secrets': list([secret]) });
    renderWithClient(<AdminView />, { route: '/admin' });
    await waitFor(() => expect(screen.getByText('1 cert expiring within 30 days')).toBeTruthy());
    fireEvent.click(screen.getByText(/View certificates/));
    await waitFor(() => expect(screen.getByText('TLS Certificates (1)')).toBeTruthy());
    expect(screen.getByText('router-certs')).toBeTruthy();
    expect(screen.queryByText('No certificates match the current filters')).toBeNull();
    // The certificate's own notAfter wins over the annotation.
    expect(screen.getByText(/expired \d+d ago/)).toBeTruthy();
  });

  it('the Certificates tab shows a 403 as an error, not an empty list', async () => {
    renderWithFailedRequests(<AdminView />, { status: 403, route: '/admin?tab=certificates' });
    await waitFor(() => expect(screen.getByText('Failed to load certificates')).toBeTruthy());
    expect(screen.queryByText(/TLS Certificates \(0\)/)).toBeNull();
  });
});

const pkg = (name: string) => ({
  metadata: { name },
  status: { catalogSource: 'redhat-operators', defaultChannel: 'stable', channels: [{ name: 'stable', currentCSVDesc: { displayName: name, version: '1.0.0', description: name } }] },
});

describe.each([403, 500])('Operator catalog with Subscriptions failing (%i)', (status) => {
  it('shows the error and "Installed (—)", not "Installed (0)"', async () => {
    renderWithFailedRequests(<OperatorCatalogView />, {
      status,
      route: '/operators',
      routes: { '/apis/packages.operators.coreos.com/v1/packagemanifests': list([pkg('loki-operator')]) },
    });
    await waitFor(() => expect(screen.getByText(/Installed operators could not be read/)).toBeTruthy());
    expect(screen.getByRole('tab', { name: /Installed \(—\)/ })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Installed \(0\)/ })).toBeNull();
  });
});

describe('Operator catalog happy path', () => {
  it('a 404 on Subscriptions (no OLM) is a real zero, with no error', async () => {
    mockFetchRoutes({
      '/apis/packages.operators.coreos.com/v1/packagemanifests': list([pkg('loki-operator')]),
      '/apis/operators.coreos.com/v1alpha1/subscriptions': { status: 404, body: { kind: 'Status', code: 404 } },
    });
    renderWithClient(<OperatorCatalogView />, { route: '/operators' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /Installed \(0\)/ })).toBeTruthy());
    expect(screen.queryByText(/Installed operators could not be read/)).toBeNull();
  });
});

describe.each([403, 500])('Software › Installed with every list failing (%i)', (status) => {
  it('shows an error per section, not "No operators installed"', async () => {
    renderWithFailedRequests(<InstalledTab />, { status, route: '/software' });
    await waitFor(() => expect(screen.getByText('Installed operators could not be listed')).toBeTruthy());
    expect(screen.getByText('Deployments could not be listed')).toBeTruthy();
    expect(screen.getByText('StatefulSets could not be listed')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/No operators installed|No deployments found|No statefulsets found/);
  });
});

describe('Software › Installed happy path', () => {
  it('lists operators from every namespace, platform ones included', async () => {
    mockFetchRoutes({
      '/apis/operators.coreos.com/v1alpha1/subscriptions': list([{ metadata: { name: 'loki', namespace: 'openshift-operators-redhat', uid: 's1' }, spec: { name: 'loki-operator', channel: 'stable' }, status: { state: 'AtLatestKnown' } }]),
      '/apis/apps/v1/deployments': list([]),
      '/apis/apps/v1/statefulsets': list([]),
    });
    renderWithClient(<InstalledTab />, { route: '/software' });
    await waitFor(() => expect(screen.getByText('loki-operator')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('No deployments found')).toBeTruthy());
    expect(screen.getByText('No statefulsets found')).toBeTruthy();
  });
});

const INDEX_YAML = 'apiVersion: v1\nentries:\n  redis:\n  - name: redis\n    version: 1.2.3\n    description: Redis chart\n';

describe.each([403, 500])('Software › Helm with the repository list and index fetch failing (%i)', (status) => {
  it('shows both errors instead of silently showing only the default repo with no charts', async () => {
    mockFetchRoutes({ 'index.yaml': { status: 503, body: 'unavailable' } }, status);
    renderWithClient(<HelmTab />, { route: '/software?tab=helm' });
    await waitFor(() => expect(screen.getByText(/Cluster chart repositories could not be listed/)).toBeTruthy());
    const alert = screen.getByText(/Cluster chart repositories could not be listed/).closest('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain(status === 403 ? 'Permission denied (403)' : `(${status}`);
    await waitFor(() => expect(screen.getByText('Charts from 1 repository could not be loaded')).toBeTruthy());
    expect(screen.getByText('index.yaml returned 503')).toBeTruthy();
    expect(screen.getByText('No charts could be loaded')).toBeTruthy();
  });
});

describe('Software › Helm happy path', () => {
  it('a 404 on HelmChartRepositories is no cluster repos; the default repo index loads', async () => {
    mockFetchRoutes({
      '/apis/helm.openshift.io/v1beta1/helmchartrepositories': { status: 404, body: { kind: 'Status', code: 404 } },
      'index.yaml': { body: INDEX_YAML },
    });
    renderWithClient(<HelmTab />, { route: '/software?tab=helm' });
    await waitFor(() => expect(screen.getByText('redis')).toBeTruthy());
    expect(screen.queryByText(/could not be listed; only the default/)).toBeNull();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
    const repoRow = screen.getByText('openshift-charts').closest('div.flex.items-center.justify-between') as HTMLElement;
    expect(within(repoRow).getByText('1 chart')).toBeTruthy();
  });
});
