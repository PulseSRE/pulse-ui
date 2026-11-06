// @vitest-environment jsdom
/**
 * After saving a ConfigMap in the YAML editor (which shows the diff), the
 * consumers that keep the old values until restarted are named and a restart
 * of them is offered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const editorProps: { current: any } = { current: null };
vi.mock('../../components/yaml/YamlEditor', () => ({
  default: (props: any) => {
    editorProps.current = props;
    return <textarea data-testid="editor" readOnly={props.readOnly} value={props.value} onChange={(e) => props.onChange(e.target.value)} />;
  },
}));
vi.mock('../../components/yaml/DryRunPanel', () => ({ DryRunPanel: () => null }));
const goSpy = vi.fn();
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => goSpy }));
vi.mock('../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: true, isLoading: false }) }));
vi.mock('../../hooks/useArgoCD', () => ({ useArgoSyncInfo: () => undefined }));
vi.mock('../../store/argoCDStore', () => ({ useArgoCDStore: (sel: any) => sel({ available: false }) }));
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign((sel: any) => sel({ addToast: vi.fn() }), { getState: () => ({ impersonateUser: '', impersonateGroups: [], addToast: vi.fn() }) }),
}));

import YamlEditorView from '../YamlEditorView';

const helmDeployment = {
  apiVersion: 'apps/v1', kind: 'Deployment',
  metadata: {
    name: 'checkout', namespace: 'shop', resourceVersion: '5',
    labels: { 'app.kubernetes.io/managed-by': 'Helm', 'helm.sh/chart': 'checkout-3.2.1' },
    annotations: { 'meta.helm.sh/release-name': 'checkout', 'meta.helm.sh/release-namespace': 'shop' },
  },
  spec: { replicas: 3 },
};
const configMap = { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'api-cfg', namespace: 'shop', resourceVersion: '1' }, data: { a: '1' } };
const user = {
  apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'api', namespace: 'shop' },
  spec: { selector: { matchLabels: { app: 'api' } }, template: { metadata: { labels: { app: 'api' } }, spec: { containers: [{ name: 'api', envFrom: [{ configMapRef: { name: 'api-cfg' } }] }] } } },
};

let object: any = helmDeployment;
let releaseStatus = 200;
const writes: Array<{ method: string; url: string }> = [];

beforeEach(() => {
  object = helmDeployment;
  releaseStatus = 200;
  writes.length = 0;
  goSpy.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    if (method !== 'GET') {
      writes.push({ method, url });
      return new Response(JSON.stringify(object), { status: 200 });
    }
    if (url.includes('/secrets?labelSelector=')) {
      return releaseStatus === 200 ? new Response(JSON.stringify({ items: [] }), { status: 200 }) : new Response(JSON.stringify({ message: 'secrets is forbidden' }), { status: releaseStatus });
    }
    if (url.endsWith('/deployments/checkout') || url.endsWith('/configmaps/api-cfg')) return new Response(JSON.stringify(object), { status: 200 });
    if (url.endsWith('/namespaces/shop/deployments')) return new Response(JSON.stringify({ items: [user] }), { status: 200 });
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderEditor(gvrKey: string, name: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><YamlEditorView gvrKey={gvrKey} namespace="shop" name={name} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('YAML editor save of a ConfigMap', () => {
  it('after saving a ConfigMap, offers to restart the consumers that keep old values', async () => {
    object = configMap;
    renderEditor('v1/configmaps', 'api-cfg');
    await screen.findByTestId('editor');
    editorProps.current.onChange(`${editorProps.current.value}\n# x`);
    const save = screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    const offer = await screen.findByTestId('saved-consumers-offer');
    expect(offer.textContent).toMatch(/Deployment api read api-cfg at start and keep the old values until restarted/);
    fireEvent.click(screen.getByRole('button', { name: /Review a restart of 1/ }));
    expect(await screen.findByRole('dialog', { name: 'Restart the 1 consumer of api-cfg?' })).toBeTruthy();
  });
});
