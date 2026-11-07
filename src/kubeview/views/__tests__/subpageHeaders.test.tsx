// @vitest-environment jsdom
/**
 * Resource subpages (Logs, Metrics, YAML; Create and Node logs are covered in
 * their own files) had no <h1> and four different "back"s. Each now has one
 * <h1>, a breadcrumb to its parent and a back link named for where it goes.
 * A read that answers 404 is NotFound; a 403 or 500 stays LoadError.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';

const go = vi.fn();
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => go }));
vi.mock('../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: true, isLoading: false }) }));
vi.mock('../../hooks/useArgoCD', () => ({ useArgoSyncInfo: () => undefined }));
vi.mock('../../store/argoCDStore', () => ({ useArgoCDStore: (sel: any) => sel({ available: false }) }));
vi.mock('../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false, isError: false }) }));
vi.mock('../../components/yaml/YamlEditor', () => ({ default: () => <div data-testid="editor" /> }));
vi.mock('../../components/yaml/DryRunPanel', () => ({ DryRunPanel: () => null }));
vi.mock('../../components/logs/LogStream', () => ({ default: () => <div data-testid="log-stream" /> }));
vi.mock('../../components/logs/MultiContainerLogs', () => ({ default: () => null }));
vi.mock('../../components/logs/MultiPodLogs', () => ({ default: () => null }));
vi.mock('../../components/metrics/AutoMetrics', () => ({ getMetricsForResource: () => [], resolveQuery: (q: string) => q, formatYAxisValue: String }));

import LogsView from '../LogsView';
import MetricsView from '../MetricsView';
import YamlEditorView from '../YamlEditorView';
import { registerCluster, resetConnections } from '../../engine/clusterConnection';
import { useFleetStore } from '../../store/fleetStore';

let qc: QueryClient;
let search = '';
let status = 200;

beforeEach(() => {
  status = 200;
  search = '';
  go.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (status !== 200) return new Response(JSON.stringify({ message: `status ${status}` }), { status });
    if (url.includes('/pods/web-1')) {
      return new Response(JSON.stringify({ kind: 'Pod', metadata: { name: 'web-1', namespace: 'shop' }, spec: { containers: [{ name: 'app' }] }, status: {} }), { status: 200 });
    }
    if (url.includes('/log')) return new Response('line', { status: 200 });
    return new Response(JSON.stringify({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'web', namespace: 'shop' } }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); qc?.clear(); vi.unstubAllGlobals(); });

function renderAt(ui: React.ReactNode) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/x${search}`]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function crumbs() {
  return within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole('link')
    .map((a) => [a.getAttribute('aria-label') ?? a.textContent, a.getAttribute('href')]);
}

describe('subpage headers', () => {
  it('pod Logs: <h1>, Workloads › Pods › web-1 › Logs, back to pod web-1', async () => {
    renderAt(<LogsView namespace="shop" podName="web-1" />);
    await screen.findByTestId('log-stream');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Logs: web-1']);
    expect(crumbs()).toEqual([
      ['Back to pod web-1', '/r/v1~pods/shop/web-1'],
      ['Workloads', '/workloads'],
      ['Pods', '/r/v1~pods?ns=shop'],
      ['web-1', '/r/v1~pods/shop/web-1'],
    ]);
    const back = screen.getByRole('link', { name: 'Back to pod web-1' });
    expect(fireEvent.click(back, { metaKey: true })).toBe(true);
    expect(go).not.toHaveBeenCalled();
    expect(fireEvent.click(back)).toBe(false);
    expect(go).toHaveBeenCalledWith('/r/v1~pods/shop/web-1', 'web-1');
  });

  it('workload Logs: back to the deployment, not history', () => {
    search = '?selector=app%3Dweb&kind=Deployment';
    renderAt(<LogsView namespace="shop" podName="web" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Logs: web');
    expect(screen.getByRole('link', { name: 'Back to deployment web' }).getAttribute('href')).toBe('/r/apps~v1~deployments/shop/web');
  });

  it('build Logs: back to the build', () => {
    search = '?kind=Build';
    renderAt(<LogsView namespace="shop" podName="api-3" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Build logs: api-3');
    expect(screen.getByRole('link', { name: 'Back to build api-3' }).getAttribute('href')).toBe('/r/build.openshift.io~v1~builds/shop/api-3');
  });

  it('Metrics: <h1>, breadcrumb and a named back (it had none)', () => {
    renderAt(<MetricsView gvrKey="apps/v1/deployments" namespace="shop" name="web" />);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Metrics: web']);
    expect(crumbs().map(([label]) => label)).toEqual(['Back to deployment web', 'Workloads', 'Deployments', 'web']);
    fireEvent.click(screen.getByRole('link', { name: 'Deployments' }));
    expect(go).toHaveBeenCalledWith('/r/apps~v1~deployments?ns=shop', 'Deployments (shop)');
    expect(screen.getByRole('button', { name: '6h' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('cluster-scoped Metrics: the back link uses `_` for the namespace', () => {
    renderAt(<MetricsView gvrKey="v1/nodes" name="worker-1" />);
    expect(screen.getByRole('link', { name: 'Back to node worker-1' }).getAttribute('href')).toBe('/r/v1~nodes/_/worker-1');
    expect(crumbs().map(([label]) => label)).toEqual(['Back to node worker-1', 'Compute', 'Nodes', 'worker-1']);
  });

  it('YAML: <h1>, breadcrumb and back to the resource (it opened a tab with no name)', async () => {
    renderAt(<YamlEditorView gvrKey="apps/v1/deployments" namespace="shop" name="web" />);
    await screen.findByTestId('editor');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Edit YAML: web']);
    expect(crumbs().map(([label]) => label)).toEqual(['Back to deployment web', 'Workloads', 'Deployments', 'web']);
  });
});

describe('YAML after a cluster switch mid-edit', () => {
  afterEach(() => { resetConnections(); useFleetStore.setState({ activeClusterId: 'local' }); });

  it('the badge names the cluster the YAML came from, and the banner says where the links go', async () => {
    registerCluster({ id: 'east', name: 'prod-east', connectionType: 'acm-proxy', target: 'east' });
    useFleetStore.setState({ activeClusterId: 'local' });
    renderAt(<YamlEditorView gvrKey="apps/v1/deployments" namespace="shop" name="web" />);
    await screen.findByTestId('editor');
    act(() => { useFleetStore.setState({ activeClusterId: 'east' }); });
    // Fed the active cluster, this would read prod-east.
    expect(screen.getByTitle('Cluster').textContent).toBe('Local Cluster');
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('This YAML was loaded from Local Cluster');
    expect(banner.textContent).toContain('the links above open the object on prod-east');
  });
});

describe('a failed read on a subpage: NotFound for 404, LoadError otherwise', () => {
  it('YAML 404 → NotFound naming the cluster and namespace, with the list as the way out; the header stays', async () => {
    status = 404;
    renderAt(<YamlEditorView gvrKey="apps/v1/deployments" namespace="shop" name="web" />);
    const nf = await screen.findByTestId('not-found');
    expect(within(nf).getByRole('heading', { level: 2 }).textContent).toBe('Deployment web not found');
    expect(nf.textContent).toContain('Looked on cluster Local Cluster in namespace shop.');
    expect(within(nf).getByRole('link', { name: 'Go to Deployments in shop' }).getAttribute('href')).toBe('/r/apps~v1~deployments?ns=shop');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // Back and the trail no longer point at the object that is not there.
    expect(screen.getByRole('link', { name: 'Back to Deployments' }).getAttribute('href')).toBe('/r/apps~v1~deployments?ns=shop');
    expect(screen.queryByRole('link', { name: 'Back to deployment web' })).toBeNull();
    expect(crumbs().map(([, href]) => href)).not.toContain('/r/apps~v1~deployments/shop/web');
  });

  it.each([403, 500])('YAML %i → LoadError with Retry, not NotFound', async (s) => {
    status = s;
    renderAt(<YamlEditorView gvrKey="apps/v1/deployments" namespace="shop" name="web" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load web');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(screen.queryByTestId('not-found')).toBeNull();
  });

  it('pod Logs 404 → NotFound with a link to the namespace\'s pods', async () => {
    status = 404;
    renderAt(<LogsView namespace="shop" podName="web-1" />);
    const nf = await screen.findByTestId('not-found');
    expect(nf.textContent).toContain('Pod web-1 not found');
    expect(within(nf).getByRole('link', { name: 'Go to pods in shop' }).getAttribute('href')).toBe('/r/v1~pods?ns=shop');
    expect(screen.getByRole('link', { name: 'Back to Pods' }).getAttribute('href')).toBe('/r/v1~pods?ns=shop');
    expect(crumbs().map(([, href]) => href)).not.toContain('/r/v1~pods/shop/web-1');
  });

  it.each([403, 500])('pod Logs %i → LoadError, not NotFound', async (s) => {
    status = s;
    renderAt(<LogsView namespace="shop" podName="web-1" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load pod web-1');
    expect(screen.queryByTestId('not-found')).toBeNull();
  });
});
