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

describe.each([[403, 'Permission denied (403)'], [500, 'Request failed (500)']] as const)('Admin › Updates readiness with its reads failing (%i)', (status, reason) => {
  it('says "Could not check" with the reason, never a pass or "Ready"', async () => {
    renderWithFailedRequests(<AdminView />, {
      status,
      route: '/admin?tab=updates',
      routes: { '/apis/config.openshift.io/v1/clusterversions': list([clusterVersion]) },
    });
    const pdb = await screen.findByTestId('readiness-pdbs');
    for (const id of ['pdbs', 'etcd-backup', 'nodes', 'operators', 'csrs', 'cp-certs', 'etcd-health']) {
      await waitFor(() => expect(screen.getByTestId(`readiness-${id}`).getAttribute('data-status'), id).toBe('unknown'));
      expect(screen.getByTestId(`readiness-${id}`).textContent, id).toMatch(new RegExp(`Could not check: (.*: )?${reason.replace(/[()]/g, '\\$&')}`));
    }
    expect(pdb.textContent).toContain(`PodDisruptionBudgets: ${reason}`);
    await waitFor(() => expect(screen.getByTestId('readiness-alerts').getAttribute('data-status')).toBe('unknown'));
    expect(screen.getByTestId('upgrade-readiness').getAttribute('data-verdict')).toBe('unknown');
    expect(document.body.textContent).not.toMatch(/Ready to update|0\/0|operators 0\/0/);
    // Only what follows from the ClusterVersion that did load may pass: its channel, and that a z-stream removes no API.
    const passing = [...document.querySelectorAll('[data-testid^="readiness-"][data-status="passed"]')].map((e) => e.getAttribute('data-testid'));
    expect(passing.sort()).toEqual(['readiness-channel', 'readiness-removed-apis']);
    expectNoAllClear();
  });
});

describe('Admin › Updates readiness while reads are in flight', () => {
  it('shows "Checking…", not a pass, for every check that needs a read', async () => {
    mockFetchRoutes({ '/apis/config.openshift.io/v1/clusterversions': list([clusterVersion]) });
    // Everything but ClusterVersion hangs.
    const base = globalThis.fetch as unknown as (u: RequestInfo | URL, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn((u: RequestInfo | URL, i?: RequestInit) => String(u).includes('/clusterversions') ? base(u, i) : new Promise(() => {})));
    renderWithClient(<AdminView />, { route: '/admin?tab=updates' });
    await screen.findByTestId('readiness-pdbs');
    for (const id of ['nodes', 'operators', 'pdbs', 'etcd-backup', 'csrs', 'cp-certs', 'alerts']) {
      const row = screen.getByTestId(`readiness-${id}`);
      expect(row.getAttribute('data-status'), id).toBe('checking');
      expect(row.textContent, id).toContain('Checking');
    }
    expect(screen.getByTestId('upgrade-readiness').getAttribute('data-verdict')).toBe('checking');
  });
});

describe('Admin › Updates readiness happy path', () => {
  it('a 404 on the backup APIs is "no Backup resource", unknown; empty lists are a real answer', async () => {
    mockFetchRoutes({
      '/apis/config.openshift.io/v1/clusterversions': list([clusterVersion]),
      '/apis/operator.openshift.io/v1alpha1/etcdbackups': { status: 404, body: { kind: 'Status', code: 404 } },
      '/apis/config.openshift.io/v1alpha1/backups': { status: 404, body: { kind: 'Status', code: 404 } },
      '/apis/policy/v1/poddisruptionbudgets': list([]),
      '/api/v1/pods': list([]),
      '/api/v1/nodes': list([{ metadata: { name: 'm1', uid: 'm1' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } }]),
      '/apis/machineconfiguration.openshift.io/v1/machineconfigpools': list([]),
    });
    renderWithClient(<AdminView />, { route: '/admin?tab=updates' });
    // A row moves into the "passed" list when it passes, so it is looked up again each time.
    const pdb = () => screen.getByTestId('readiness-pdbs');
    await waitFor(() => expect(pdb().getAttribute('data-status')).toBe('passed'));
    expect(pdb().textContent).toContain('No PodDisruptionBudget with 0 disruptions allowed covers a pod on a node that will drain');
    await waitFor(() => expect(screen.getByTestId('readiness-etcd-backup').getAttribute('data-status')).toBe('unknown'));
    expect(screen.getByTestId('readiness-etcd-backup').textContent).toContain("No Backup resource (API not enabled); a cluster-backup.sh CronJob can't be detected here");
    expect(screen.queryByRole('button', { name: 'Take backup now' })).toBeNull();
  });
});

describe('Admin › Updates Recheck', () => {
  it('re-reads every readiness read: alerts, PDBs, pods, CSRs, certificates, etcd, backups and the removed-API reads', async () => {
    const fetchMock = mockFetchRoutes({
      '/apis/config.openshift.io/v1/clusterversions': list([clusterVersion]),
      '/api/v1/alerts': { body: { data: { alerts: [] } } },
      '/apis/policy/v1/poddisruptionbudgets': list([]),
      '/api/v1/pods': list([]),
      '/api/v1/nodes': list([]),
      '/certificatesigningrequests': list([]),
      '/secrets?fieldSelector': list([]),
      'openshift-etcd/pods': list([]),
      '/etcdbackups': list([]),
      '/v1alpha1/backups': list([]),
      '/apirequestcounts': list([]),
      '/configmaps/admin-gates': { body: { data: {} } },
      '/configmaps/admin-acks': { body: { data: {} } },
    });
    renderWithClient(<AdminView />, { route: '/admin?tab=updates' });
    const keys = ['/api/v1/alerts', '/apis/policy/v1/poddisruptionbudgets', '/api/kubernetes/api/v1/pods', '/certificatesigningrequests', 'secrets?fieldSelector', 'openshift-etcd/pods', '/etcdbackups', '/v1alpha1/backups', '/apirequestcounts', 'admin-gates', 'admin-acks'];
    const count = (k: string) => fetchMock.mock.calls.filter(([u]) => String(u).includes(k)).length;
    await waitFor(() => { for (const k of keys) expect(count(k), k).toBeGreaterThan(0); });
    await waitFor(() => expect(screen.getByTestId('readiness-counts').textContent).toMatch(/checked/));
    const before = Object.fromEntries(keys.map((k) => [k, count(k)]));
    fireEvent.click(screen.getByRole('button', { name: 'Recheck' }));
    await waitFor(() => { for (const k of keys) expect(count(k), k).toBeGreaterThan(before[k]); });
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

describe('Admin › Overview while reads are in flight', () => {
  it('shows "—", not "No identity providers configured" or "0 quotas, 0 limits"', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderWithClient(<AdminView />, { route: '/admin' });
    expect(screen.queryByText('No identity providers configured')).toBeNull();
    expect(document.body.textContent).not.toMatch(/0 quotas, 0 limits/);
    expect(screen.getByText('Quotas / Limit Ranges').parentElement!.textContent).toContain('\u2014');
  });
});

describe('Admin › Overview on a cluster without ClusterVersion (404)', () => {
  it('is not a load failure', async () => {
    const fetchMock = mockFetchRoutes({
      '/apis/config.openshift.io/v1/clusterversions': { status: 404, body: { kind: 'Status', code: 404 } },
      '/api/v1/nodes': list([]),
      '/apis/config.openshift.io/v1/clusteroperators': list([]),
    }, 404);
    renderWithClient(<AdminView />, { route: '/admin' });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/clusterversions'))).toBe(true));
    // Let the 404 settle into the query before asserting the banner is absent.
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText('Failed to load cluster data')).toBeNull();
  });

  it('a 403 on ClusterVersion is a load failure', async () => {
    mockFetchRoutes({ '/api/v1/nodes': list([]), '/apis/config.openshift.io/v1/clusteroperators': list([]) }, 403);
    renderWithClient(<AdminView />, { route: '/admin' });
    // Names the read that failed, says why, and that the overview is incomplete.
    const title = await screen.findByText('ClusterVersion could not be loaded — the overview below is incomplete', {}, { timeout: 3000 });
    expect(title.closest('[role="alert"]')!.textContent).toMatch(/Permission denied|do not have permission/);
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

describe('Operator catalog while Subscriptions load', () => {
  it('shows "Installed (—)", not "Installed (0)"', async () => {
    const base = mockFetchRoutes({ '/apis/packages.operators.coreos.com/v1/packagemanifests': list([pkg('loki-operator')]) }) as unknown as (u: RequestInfo | URL, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn((u: RequestInfo | URL, i?: RequestInit) => String(u).includes('/subscriptions') ? new Promise(() => {}) : base(u, i)));
    renderWithClient(<OperatorCatalogView />, { route: '/operators' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /All \(1\)/ })).toBeTruthy());
    expect(screen.getByRole('tab', { name: /Installed \(\u2014\)/ })).toBeTruthy();
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

describe('Software › Installed without OLM (Subscriptions 404)', () => {
  it('says "No operators installed", with no error', async () => {
    mockFetchRoutes({
      '/apis/operators.coreos.com/v1alpha1/subscriptions': { status: 404, body: { kind: 'Status', code: 404 } },
      '/apis/apps/v1/deployments': list([]),
      '/apis/apps/v1/statefulsets': list([]),
    });
    renderWithClient(<InstalledTab />, { route: '/software' });
    await waitFor(() => expect(screen.getByText('No operators installed')).toBeTruthy());
    expect(screen.queryByText('Installed operators could not be listed')).toBeNull();
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

describe('Admin › Updates on OpenShift 5 (live cluster: 5.0.1 on fast-5.0)', () => {
  const cv5 = {
    metadata: { name: 'version', uid: 'cv5' },
    spec: { channel: 'fast-5.0', clusterID: 'abc' },
    status: {
      desired: { version: '5.0.1' },
      history: [{ state: 'Completed', version: '5.0.1', startedTime: '2026-11-01T00:00:00Z' }],
      conditions: [{ type: 'RetrievedUpdates', status: 'True' }, { type: 'Progressing', status: 'False' }],
      conditionalUpdates: [{ release: { version: '5.1.0', image: 'quay.io/x@sha256:2' }, risks: [{ name: 'R', message: 'm', url: 'https://example.com' }], conditions: [{ type: 'Recommended', status: 'False' }] }],
    },
  };
  const routes = (version: MockRoute) => ({
    '/apis/config.openshift.io/v1/clusterversions': list([cv5]),
    '/apirequestcounts': list([{ metadata: { name: 'widgets.v1beta1.example.io' }, status: { removedInRelease: '1.34', requestCount: 0 } }]),
    '/configmaps/admin-gates': { body: { data: {} } },
    '/configmaps/admin-acks': { body: { data: {} } },
    '/api/kubernetes/version': version,
  });

  it('checks removed APIs for 5.1 against the cluster\'s real Kubernetes version, not "not known"', async () => {
    mockFetchRoutes(routes({ body: { gitVersion: 'v1.33.2' } }));
    renderWithClient(<AdminView />, { route: '/admin?tab=updates' });
    await waitFor(() => expect(screen.getByTestId('readiness-removed-apis').getAttribute('data-status')).toBe('passed'));
    expect(screen.getByTestId('readiness-removed-apis').textContent).toContain('Kubernetes 1.34 (OpenShift 5.1)');
    expect(document.body.textContent).not.toMatch(/Kubernetes version shipped with 5\.1 is not known/);
  });

  it('says /version could not be read, when it could not', async () => {
    mockFetchRoutes(routes({ status: 403, body: { kind: 'Status', code: 403 } }));
    renderWithClient(<AdminView />, { route: '/admin?tab=updates' });
    await waitFor(() => expect(screen.getByTestId('readiness-removed-apis').getAttribute('data-status')).toBe('unknown'));
    expect(screen.getByTestId('readiness-removed-apis').textContent).toMatch(/Kubernetes version could not be read/);
  });
});
