// @vitest-environment jsdom
/**
 * The YAML editor on a Helm-owned object: a banner says which release owns
 * it, the editor is read-only and Save disabled until "Edit here anyway"
 * (which warns about drift), and the release values / rollback links open the
 * release.
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
import { releaseSecret } from '../create/__tests__/helmTestUtils';

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
let listed = 'checkout';
const writes: Array<{ method: string; url: string }> = [];

beforeEach(() => {
  object = helmDeployment;
  releaseStatus = 200;
  listed = 'checkout';
  writes.length = 0;
  goSpy.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    if (method !== 'GET') {
      writes.push({ method, url });
      return new Response(JSON.stringify(object), { status: 200 });
    }
    if (url.includes('/secrets?labelSelector=')) {
      return releaseStatus === 200 ? new Response(JSON.stringify({ items: [releaseSecret('checkout', 'shop', 7, 'deployed', '3.2.1', {}, `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${listed}\n`)] }), { status: 200 }) : new Response(JSON.stringify({ message: 'secrets is forbidden' }), { status: releaseStatus });
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

describe('Helm ownership guard', () => {
  it('banner, read-only and Save disabled until "Edit here anyway", which warns about drift', async () => {
    renderEditor('apps/v1/deployments', 'checkout');
    const banner = await screen.findByRole('note', { name: 'Helm ownership' });
    expect(banner.textContent).toMatch(/Managed by Helm release checkout; hand edits are overwritten on the next upgrade/);
    await waitFor(() => expect(banner.textContent).toMatch(/Chart nginx-3\.2\.1 · revision 7 \(deployed\) · detected from label app\.kubernetes\.io\/managed-by: Helm/));
    expect(editorProps.current.readOnly).toBe(true);
    // Even with a change, Save stays off and Cmd+S writes nothing.
    editorProps.current.onChange(`${editorProps.current.value}\n# x`);
    await waitFor(() => expect((screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(true));
    editorProps.current.onSave();
    expect(writes).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit here anyway' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Editing here creates drift.*the next helm upgrade or rollback reverts this edit/);
    await waitFor(() => expect(editorProps.current.readOnly).toBe(false));
    const save = screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].method).toBe('PUT');
  });

  it('"Edit release values" and "Roll back the release…" open the release', async () => {
    renderEditor('apps/v1/deployments', 'checkout');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit release values' }));
    expect(goSpy).toHaveBeenLastCalledWith('/software?tab=helm&release=checkout&releaseNs=shop&action=values', 'Helm checkout');
    fireEvent.click(screen.getByRole('button', { name: 'Roll back the release…' }));
    expect(goSpy).toHaveBeenLastCalledWith('/software?tab=helm&release=checkout&releaseNs=shop&action=rollback', 'Helm checkout');
  });

  it('a release record that cannot be read is said, not hidden', async () => {
    releaseStatus = 403;
    renderEditor('apps/v1/deployments', 'checkout');
    expect(await screen.findByText(/The release record could not be read, so its revision and status are unknown/)).toBeTruthy();
  });

  it('an object that claims Helm ownership but is not in the release: said, and not locked', async () => {
    listed = 'something-else';
    renderEditor('apps/v1/deployments', 'checkout');
    expect(await screen.findByTestId('helm-claim-note')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('note', { name: 'Helm ownership' })).toBeNull());
    expect(editorProps.current.readOnly).toBe(false);
  });

  it('a resource without Helm ownership has no banner and saves as before', async () => {
    object = configMap;
    renderEditor('v1/configmaps', 'api-cfg');
    await screen.findByTestId('editor');
    expect(screen.queryByRole('note', { name: 'Helm ownership' })).toBeNull();
    expect(editorProps.current.readOnly).toBe(false);
  });

});
