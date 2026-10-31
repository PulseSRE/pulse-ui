// @vitest-environment jsdom
/**
 * Import YAML used to POST everything to the pods endpoint and took the first
 * `namespace:` anywhere in the text. Each document now goes to its own
 * collection (cluster-scoped kinds without a namespace), its namespace is
 * read from metadata.namespace, results are reported per document, and the
 * validation panel dry-runs against the same paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';

const addToast = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign((sel: any) => sel({ addToast, addTab: vi.fn(), selectedNamespace: 'team-a' }), {
    getState: () => ({ impersonateUser: '', impersonateGroups: [], addToast }),
  }),
}));
vi.mock('../../store/clusterStore', () => ({ useClusterStore: (sel: any) => sel({ resourceRegistry: new Map() }) }));
vi.mock('../../components/yaml/YamlEditor', () => ({
  default: ({ value, onChange }: any) => <textarea data-testid="yaml-editor" value={value} onChange={(e: any) => onChange(e.target.value)} />,
}));
vi.mock('./../create/InstalledTab', () => ({ InstalledTab: () => <div>installed-tab</div> }));

const calls: Array<{ method: string; url: string; body?: any }> = [];
let failOn: string | null = null;

beforeEach(() => {
  calls.length = 0;
  failOn = null;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    let body: any;
    try { body = init.body ? JSON.parse(String(init.body)) : undefined; } catch { body = String(init.body); }
    calls.push({ method, url, body });
    if (failOn && url.includes(failOn)) {
      return new Response(JSON.stringify({ message: 'configmaps "settings" already exists' }), { status: 409 });
    }
    if (method === 'POST') {
      const obj = typeof body === 'object' ? body : {};
      return new Response(JSON.stringify(obj), { status: 201 });
    }
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

import CreateView from '../CreateView';

const MANIFEST = `apiVersion: v1
kind: Namespace
metadata:
  name: shop
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: shop
spec:
  template:
    spec:
      containers:
        - name: app
          env:
            - name: TARGET
              value: x
          # a stray key that used to be taken as the namespace
      serviceAccountName: sa
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
data:
  namespace: not-this-one
`;

function Where() {
  return <div data-testid="where">{useLocation().pathname}{useLocation().search}</div>;
}
function GoTo({ to }: { to: string }) {
  const nav = useNavigate();
  return <button onClick={() => nav(to)}>go-{to}</button>;
}

function renderCreate(entry = '/create/v1~pods') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/create/:gvr" element={<><CreateView gvrKey="v1/pods" /><Where /><GoTo to="/create/v1~pods?tab=templates" /></>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function importText(text: string) {
  fireEvent.click(screen.getByText('Import YAML'));
  fireEvent.change(screen.getByPlaceholderText(/apiVersion: v1/), { target: { value: text } });
  fireEvent.click(screen.getByText('Open in Editor'));
}

describe('Import YAML', () => {
  it('shows the real kinds in the header, not "Pod"', () => {
    renderCreate();
    importText(MANIFEST);
    expect(screen.getByText('Create 3 resources')).toBeTruthy();
  });

  it('creates each document at its own path and reports each', async () => {
    renderCreate();
    importText(MANIFEST);
    fireEvent.click(screen.getByRole('button', { name: /Create$/ }));
    await screen.findByTestId('create-results');
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.url);
    expect(posts).toEqual([
      '/api/kubernetes/api/v1/namespaces',
      '/api/kubernetes/apis/apps/v1/namespaces/shop/deployments',
      '/api/kubernetes/api/v1/namespaces/team-a/configmaps',
    ]);
    expect(calls[0].body).toEqual({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'shop' } });
    expect(calls[1].body.kind).toBe('Deployment');
    expect(screen.getByText('Namespace shop created')).toBeTruthy();
    expect(screen.getByText('ConfigMap team-a/settings created')).toBeTruthy();
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Created 3 resources' }));
  });

  it('a single document navigates to what it created', async () => {
    renderCreate();
    importText('apiVersion: v1\nkind: Namespace\nmetadata:\n  name: shop\n');
    fireEvent.click(screen.getByRole('button', { name: /Create$/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/r/v1~namespaces/_/shop'));
    expect(calls.find((c) => c.method === 'POST')!.url).toBe('/api/kubernetes/api/v1/namespaces');
  });

  it('reports a document that failed without hiding the ones that worked', async () => {
    failOn = '/configmaps';
    renderCreate();
    importText(MANIFEST);
    fireEvent.click(screen.getByRole('button', { name: /Create$/ }));
    await screen.findByTestId('create-results');
    expect(screen.getByText('Deployment shop/web created')).toBeTruthy();
    expect(screen.getByText('ConfigMap team-a/settings: configmaps "settings" already exists')).toBeTruthy();
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', title: 'Created 2 of 3 resources' }));
  });

  it('validates each document against its own path', async () => {
    renderCreate();
    importText(MANIFEST);
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }));
    await waitFor(() => expect(calls.filter((c) => c.url.includes('dryRun=All')).length).toBe(3));
    const urls = calls.filter((c) => c.url.includes('dryRun=All')).map((c) => c.url).sort();
    expect(urls).toEqual([
      '/api/kubernetes/api/v1/namespaces/team-a/configmaps?dryRun=All',
      '/api/kubernetes/api/v1/namespaces?dryRun=All',
      '/api/kubernetes/apis/apps/v1/namespaces/shop/deployments?dryRun=All',
    ]);
  });
});

describe('Software tabs follow the URL', () => {
  it('a link to ?tab=templates switches the tab without remounting', () => {
    renderCreate('/create/v1~pods');
    expect(screen.getByText('installed-tab')).toBeTruthy();
    fireEvent.click(screen.getByText('go-/create/v1~pods?tab=templates'));
    expect(screen.queryByText('installed-tab')).toBeNull();
    expect(screen.getByRole('tab', { name: /Templates/ }).getAttribute('aria-selected')).toBe('true');
  });
});
