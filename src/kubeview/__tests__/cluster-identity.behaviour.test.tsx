// @vitest-environment jsdom
/**
 * Never read from one cluster and write to another (Wave 4).
 *
 * These render real views against a mocked fetch with two clusters
 * registered ("local" and a remote "prod-east" behind the ACM proxy) and
 * assert the exact requests sent and what the user sees — including when
 * the active cluster changes between loading something and acting on it.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// CodeMirror does not run in jsdom: a textarea with the same contract.
vi.mock('../components/yaml/YamlEditor', () => ({
  default: ({ value, onChange, onSave }: { value: string; onChange: (v: string) => void; onSave: () => void }) => (
    <div>
      <textarea aria-label="yaml" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={onSave}>Ctrl+S</button>
    </div>
  ),
}));

import { getAllConnections, getClusterBase, registerCluster, resetConnections } from '../engine/clusterConnection';
import { useFleetStore } from '../store/fleetStore';
import { useUIStore } from '../store/uiStore';
import { useArgoCDStore } from '../store/argoCDStore';
import YamlEditorView from '../views/YamlEditorView';
import LogsView from '../views/LogsView';
import MultiPodLogs from '../components/logs/MultiPodLogs';
import MultiContainerLogs from '../components/logs/MultiContainerLogs';
import MetricsView from '../views/MetricsView';
import AlertsView from '../views/AlertsView';
import { ArgoSyncBadge } from '../components/ArgoSyncBadge';
import { assertActiveCluster, ClusterChangedError } from '../engine/pendingCluster';

const REMOTE = 'prod-east';
let REMOTE_BASE = '';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
let handler: Handler;
const fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => Promise.resolve(handler(String(input), init)));

function json(body: unknown, status = 200, statusText = 'OK') {
  return new Response(JSON.stringify(body), { status, statusText, headers: { 'content-type': 'application/json' } });
}
function text(body: string, status = 200, statusText = 'OK') {
  return new Response(body, { status, statusText });
}
function calls() {
  return fetchMock.mock.calls.map(([u, init]) => ({
    url: String(u),
    method: (init as RequestInit | undefined)?.method ?? 'GET',
    headers: ((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string>,
    body: (init as RequestInit | undefined)?.body,
  }));
}

function setActive(id: string) {
  act(() => { useFleetStore.getState().setActiveCluster(id); });
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetConnections();
  registerCluster({ id: REMOTE, name: 'Prod East', connectionType: 'acm-proxy', target: 'prod-east' });
  REMOTE_BASE = getClusterBase(REMOTE);
  useFleetStore.setState({ activeClusterId: 'local', clusters: getAllConnections() });
  useUIStore.setState({ impersonateUser: '', impersonateGroups: [] });
  useArgoCDStore.getState().reset();
  fetchMock.mockClear();
  handler = () => json({});
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetConnections();
});

const DEPLOY_PATH = '/apis/apps/v1/namespaces/shop/deployments/web';
const deployment = { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'web', namespace: 'shop', resourceVersion: '7' }, spec: { replicas: 2 } };

describe('YamlEditorView pins the cluster it loaded from', () => {
  it('loads from and saves to the active remote cluster, with impersonation', async () => {
    setActive(REMOTE);
    useUIStore.setState({ impersonateUser: 'alice' });
    handler = (url, init) => (init.method === 'PUT' ? json({ ...deployment, spec: { replicas: 3 } }) : json(deployment));

    renderWithClient(<YamlEditorView gvrKey="apps/v1/deployments" namespace="shop" name="web" />);
    const editor = await screen.findByLabelText('yaml');
    fireEvent.change(editor, { target: { value: (editor as HTMLTextAreaElement).value.replace('replicas: 2', 'replicas: 3') } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(calls().some(c => c.method === 'PUT')).toBe(true));
    const get = calls().find(c => c.method === 'GET')!;
    const put = calls().find(c => c.method === 'PUT')!;
    expect(get.url).toBe(`${REMOTE_BASE}${DEPLOY_PATH}`);
    expect(put.url).toBe(`${REMOTE_BASE}${DEPLOY_PATH}`);
    expect(put.headers['Impersonate-User']).toBe('alice');
    expect(String(put.body)).toContain('replicas: 3');
  });

  it('refuses to save after the active cluster changed since load, and says why', async () => {
    setActive(REMOTE);
    handler = () => json(deployment);

    renderWithClient(<YamlEditorView gvrKey="apps/v1/deployments" namespace="shop" name="web" />);
    const editor = await screen.findByLabelText('yaml');
    fireEvent.change(editor, { target: { value: (editor as HTMLTextAreaElement).value.replace('replicas: 2', 'replicas: 9') } });

    setActive('local');

    // The banner explains, and the Save button is disabled.
    expect(await screen.findByText(/This YAML was loaded from/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(true);

    // The keyboard shortcut path is refused too, with a clear message.
    fireEvent.click(screen.getByText('Ctrl+S'));
    expect(await screen.findByText(/Not saved: this YAML was loaded from Prod East, but the active cluster is now Local Cluster/)).toBeTruthy();
    expect(calls().filter(c => c.method === 'PUT')).toEqual([]);
    // The object was never re-read from the new cluster behind the user's edits.
    expect(calls().filter(c => c.url.endsWith(DEPLOY_PATH)).map(c => c.url)).toEqual([`${REMOTE_BASE}${DEPLOY_PATH}`]);
  });

  it('shows the server error when the save is forbidden', async () => {
    handler = (_url, init) => (init.method === 'PUT'
      ? json({ kind: 'Status', message: 'deployments.apps "web" is forbidden: User "bob" cannot update' }, 403, 'Forbidden')
      : json(deployment));

    renderWithClient(<YamlEditorView gvrKey="apps/v1/deployments" namespace="shop" name="web" />);
    const editor = await screen.findByLabelText('yaml');
    fireEvent.change(editor, { target: { value: (editor as HTMLTextAreaElement).value.replace('replicas: 2', 'replicas: 4') } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    expect((await screen.findAllByText(/cannot update/)).length).toBeGreaterThan(0);
    expect(calls().find(c => c.method === 'PUT')!.url).toBe(`/api/kubernetes${DEPLOY_PATH}`);
  });
});

describe('logs are fetched from the active cluster with impersonation', () => {
  it('pod logs: reads the pod and its logs from the remote cluster', async () => {
    setActive(REMOTE);
    useUIStore.setState({ impersonateUser: 'alice' });
    handler = (url) => (url.includes('/log?')
      ? text('2026-10-30T10:00:00Z hello from prod-east')
      : json({ spec: { containers: [{ name: 'app' }] }, status: { containerStatuses: [{ name: 'app', state: { running: {} } }] } }));

    renderWithClient(<LogsView namespace="shop" podName="web-1" />);
    expect(await screen.findByText(/hello from prod-east/)).toBeTruthy();

    const urls = calls();
    expect(urls[0].url).toBe(`${REMOTE_BASE}/api/v1/namespaces/shop/pods/web-1`);
    expect(urls.some(c => c.url.startsWith(`${REMOTE_BASE}/api/v1/namespaces/shop/pods/web-1/log?`))).toBe(true);
    expect(urls.every(c => c.url.startsWith(REMOTE_BASE))).toBe(true);
    expect(urls.every(c => c.headers['Impersonate-User'] === 'alice')).toBe(true);
  });

  it('pod logs: a forbidden pod read says so', async () => {
    handler = () => json({ message: 'pods "web-1" is forbidden' }, 403, 'Forbidden');
    renderWithClient(<LogsView namespace="shop" podName="web-1" />);
    expect(await screen.findByText(/Failed to load pod/)).toBeTruthy();
  });

  it('merged pod logs: shows each pod that failed and why, alongside the pods that worked', async () => {
    setActive(REMOTE);
    useUIStore.setState({ impersonateUser: 'alice' });
    handler = (url) => {
      if (url.includes('/pods/web-a/log')) return text('2026-10-30T10:00:00Z line from a');
      if (url.includes('/pods/web-b/log')) return json({ message: 'pods "web-b" is forbidden: User "alice" cannot get resource "pods/log"' }, 403, 'Forbidden');
      if (url.includes('/pods/web-c/log')) return text('boom', 500, 'Internal Server Error');
      return json({});
    };

    renderWithClient(<MultiPodLogs namespace="shop" podNames={['web-a', 'web-b', 'web-c']} />);
    expect(await screen.findByText(/line from a/)).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('web-b');
    expect(alert.textContent).toContain('403 Forbidden: pods "web-b" is forbidden');
    expect(alert.textContent).toContain('web-c');
    expect(alert.textContent).toContain('500 Internal Server Error: boom');
    expect(calls().every(c => c.url.startsWith(`${REMOTE_BASE}/api/v1/namespaces/shop/pods/`))).toBe(true);
    expect(calls().every(c => c.headers['Impersonate-User'] === 'alice')).toBe(true);

    // Refresh fetches again.
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('merged container logs: a 500 is reported, not shown as "No logs found"', async () => {
    handler = () => text('', 500, 'Internal Server Error');
    renderWithClient(
      <MultiContainerLogs
        namespace="shop"
        podName="web-1"
        containers={[{ name: 'app', type: 'container', state: 'running' }, { name: 'proxy', type: 'container', state: 'running' }]}
      />,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('container app');
    expect(alert.textContent).toContain('container proxy');
    expect(screen.queryByText('No logs found')).toBeNull();
    expect(calls().map(c => c.url)).toEqual([
      '/api/kubernetes/api/v1/namespaces/shop/pods/web-1/log?container=app&tailLines=500&timestamps=true',
      '/api/kubernetes/api/v1/namespaces/shop/pods/web-1/log?container=proxy&tailLines=500&timestamps=true',
    ]);
  });
});

describe('Prometheus/Alertmanager data is local-cluster only', () => {
  it('metrics: hidden with an explanation while a remote cluster is active, and nothing is requested', async () => {
    setActive(REMOTE);
    renderWithClient(<MetricsView gvrKey="apps/v1/deployments" namespace="shop" name="web" />);
    expect(screen.getByText('Metrics are available for the local cluster only')).toBeTruthy();
    expect(screen.getByText(/hidden for Prod East/)).toBeTruthy();
    expect(calls().filter(c => c.url.includes('/api/prometheus'))).toEqual([]);
  });

  it('metrics: on the local cluster a failed query says it failed instead of "No data"', async () => {
    handler = () => text('upstream down', 503, 'Service Unavailable');
    renderWithClient(<MetricsView gvrKey="apps/v1/deployments" namespace="shop" name="web" />);
    expect((await screen.findAllByText('Failed to fetch metrics')).length).toBeGreaterThan(0);
    expect(calls()[0].url.startsWith('/api/prometheus/api/v1/query_range?')).toBe(true);
  });

  it('alerts: a remote cluster gets an explanation, and neither Prometheus nor Alertmanager is called', async () => {
    setActive(REMOTE);
    renderWithClient(<AlertsView />);
    expect(screen.getByText('Alerts and silences are available for the local cluster only')).toBeTruthy();
    expect(calls()).toEqual([]);
  });
});

describe('Argo CD detection follows the active cluster', () => {
  it('a Detail-page badge detects Argo CD itself, and again after a cluster switch', async () => {
    const apps = { items: [] };
    handler = () => json(apps);
    renderWithClient(<ArgoSyncBadge kind="Deployment" namespace="shop" name="web" />);
    await waitFor(() => expect(calls().some(c => c.url === '/api/kubernetes/apis/argoproj.io/v1alpha1')).toBe(true));

    setActive(REMOTE);
    await waitFor(() => expect(calls().some(c => c.url === `${REMOTE_BASE}/apis/argoproj.io/v1alpha1`)).toBe(true));
  });
});

describe('pending actions carry the cluster they were created on', () => {
  it('assertActiveCluster refuses once the active cluster has changed', () => {
    setActive(REMOTE);
    expect(() => assertActiveCluster(REMOTE, 'Removing kubeadmin')).not.toThrow();
    setActive('local');
    expect(() => assertActiveCluster(REMOTE, 'Removing kubeadmin')).toThrow(ClusterChangedError);
    expect(() => assertActiveCluster(REMOTE, 'Removing kubeadmin')).toThrow(/Removing kubeadmin was not run: it was prepared on Prod East, but the active cluster is now Local Cluster/);
  });
});
