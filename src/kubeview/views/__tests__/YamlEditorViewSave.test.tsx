// @vitest-environment jsdom
/**
 * YAML editor: read-only without update permission (it used to be an "Edit"
 * page the user could not save), and every save path — header button, Cmd+S
 * and the diff preview — goes through the same Argo/GitOps check. Cmd+S and
 * the status-bar Save used to write directly to an Argo-managed resource.
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
vi.mock('../../components/GitOpsActionDialog', () => ({ GitOpsActionDialog: () => <div data-testid="gitops-dialog" /> }));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
let canUpdate = true;
vi.mock('../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: canUpdate, isLoading: false }) }));
let argoManaged = false;
vi.mock('../../hooks/useArgoCD', () => ({ useArgoSyncInfo: () => (argoManaged ? { appName: 'shop' } : undefined) }));
vi.mock('../../store/argoCDStore', () => ({ useArgoCDStore: (sel: any) => sel({ available: argoManaged }) }));
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign((sel: any) => sel({ addToast: vi.fn() }), { getState: () => ({ impersonateUser: '', impersonateGroups: [], addToast: vi.fn() }) }),
}));

import YamlEditorView from '../YamlEditorView';

const calls: Array<{ method: string; url: string }> = [];
let getStatus = 200;

beforeEach(() => {
  calls.length = 0;
  canUpdate = true;
  argoManaged = false;
  getStatus = 200;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url });
    if (method === 'GET') {
      return getStatus === 200
        ? new Response(JSON.stringify({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'app', namespace: 'shop' }, data: { a: '1' } }), { status: 200 })
        : new Response(JSON.stringify({ message: 'configmaps "app" is forbidden' }), { status: getStatus });
    }
    return new Response(JSON.stringify({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'app', namespace: 'shop' }, data: { a: '2' } }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderEditor() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><YamlEditorView gvrKey="v1/configmaps" namespace="shop" name="app" /></MemoryRouter>
    </QueryClientProvider>,
  );
}

async function edit() {
  const editor = await screen.findByTestId('editor');
  fireEvent.change(editor, { target: { value: (editor as HTMLTextAreaElement).value.replace("a: '1'", "a: '2'").replace('a: "1"', 'a: "2"') + '\n# changed' } });
}

describe('YamlEditorView', () => {
  it('is read-only without update permission', async () => {
    canUpdate = false;
    renderEditor();
    await screen.findByTestId('editor');
    expect(screen.getByText('View app')).toBeTruthy();
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    expect(editorProps.current.readOnly).toBe(true);
  });

  it('has one Save: the editor is told not to add its own', async () => {
    renderEditor();
    await screen.findByTestId('editor');
    expect(editorProps.current.hideStatusBarSave).toBe(true);
  });

  it('Cmd+S on an Argo-managed resource opens the GitOps dialog instead of writing', async () => {
    argoManaged = true;
    renderEditor();
    await edit();
    editorProps.current.onSave();
    expect(await screen.findByTestId('gitops-dialog')).toBeTruthy();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('Cmd+S on an unmanaged resource PUTs to the resource on the active cluster', async () => {
    renderEditor();
    await edit();
    editorProps.current.onSave();
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.url).toBe('/api/kubernetes/api/v1/namespaces/shop/configmaps/app');
  });

  it('a load failure offers a retry', async () => {
    getStatus = 403;
    renderEditor();
    expect(await screen.findByText('Could not load app')).toBeTruthy();
    getStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('editor')).toBeTruthy();
  });
});
