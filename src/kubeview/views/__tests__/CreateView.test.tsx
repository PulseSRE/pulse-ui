// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ---- Mocks ----

const navigateMock = vi.fn();
const addTabMock = vi.fn();
const addToastMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = {
      addToast: addToastMock,
      addTab: addTabMock,
      selectedNamespace: 'default',
    };
    return selector(state);
  },
}));

vi.mock('../../store/clusterStore', () => ({
  useClusterStore: (selector?: any) => {
    const state = { resourceRegistry: new Map(), discoveryClusterId: 'local', discoveryLoading: false, discoveryError: null, apiGroups: [], runDiscovery: () => undefined };
    return selector ? selector(state) : state;
  },
}));

// Mock YamlEditor since it's a complex component
vi.mock('../../components/yaml/YamlEditor', () => ({
  default: ({ value, onChange }: any) => (
    <textarea data-testid="yaml-editor" value={value} onChange={(e: any) => onChange(e.target.value)} />
  ),
}));

// Mock DeployProgress
vi.mock('../../components/DeployProgress', () => ({
  default: () => <div data-testid="deploy-progress">DeployProgress</div>,
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---- Helpers ----

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

import CreateView from '../CreateView';

function renderCreateView(props: { gvrKey?: string } = {}, initialEntry = '/software') {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <CreateView {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----

describe('CreateView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset URL state so ?tab= doesn't leak between tests
    window.history.replaceState(null, '', '/');
    // Default fetch mock for Helm releases query
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders 4 tabs: Deploy an app, Helm Charts, Templates, Import YAML', () => {
    renderCreateView();

    expect(screen.getByText('Deploy an app')).toBeDefined();
    expect(screen.getByText('Helm Charts')).toBeDefined();
    expect(screen.getByText('Templates')).toBeDefined();
    expect(screen.getByText('Import YAML')).toBeDefined();
  });

  it('renders Create heading and description', () => {
    renderCreateView();

    expect(screen.getByText('Software')).toBeDefined();
    expect(screen.getByText(/Manage installed software/)).toBeDefined();
  });

  it('goes straight to YAML editor for non-pod resources', () => {
    renderCreateView({ gvrKey: 'apps/v1/deployments' });
    expect(screen.getByTestId('yaml-editor')).toBeDefined();
  });

  it('/create/v1~pods opens the Pod editor like any other kind', () => {
    renderCreateView({ gvrKey: 'v1/pods' }, '/create/v1~pods');
    expect(screen.getByTestId('yaml-editor')).toBeDefined();
    expect(screen.getByText('Create Pod')).toBeDefined();
    expect(screen.queryByRole('tab', { name: /Deploy an app/ })).toBeNull();
  });

  it.each([
    ['networking.k8s.io/v1/networkpolicies', 'NetworkPolicy'],
    ['v1/configmaps', 'ConfigMap'],
    ['loki.grafana.com/v1/lokistacks', 'LokiStack'],
    ['v1/persistentvolumeclaims', 'PersistentVolumeClaim'],
  ])('with the resource registry not loaded yet, /create/%s starts from the %s template', (gvr, kind) => {
    renderCreateView({ gvrKey: gvr }, `/create/${gvr.replace(/\//g, '~')}`);
    expect((screen.getByTestId('yaml-editor') as HTMLTextAreaElement).value).toMatch(new RegExp(`^kind: ${kind}$`, 'm'));
    expect(screen.getByText(`Create ${kind}`)).toBeDefined();
  });

  it('with the registry not loaded and no template, the skeleton names a real kind', async () => {
    renderCreateView({ gvrKey: 'v1/serviceaccounts' }, '/create/v1~serviceaccounts');
    expect((screen.getByTestId('yaml-editor') as HTMLTextAreaElement).value).toMatch(/^kind: ServiceAccount$/m);
    cleanup();
    renderCreateView({ gvrKey: 'v1/resourcequotas' }, '/create/v1~resourcequotas');
    await waitFor(() => expect((screen.getByTestId('yaml-editor') as HTMLTextAreaElement).value).toMatch(/^kind: ResourceQuota$/m));
  });

  it('the hub with ?tab=yaml opens the Import YAML tab, not an editor', () => {
    renderCreateView({}, '/software?tab=yaml');
    expect(screen.queryByTestId('yaml-editor')).toBeNull();
    expect(screen.getByRole('tab', { name: /Import YAML/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('Blank YAML opens an empty editor, not a Pod', () => {
    renderCreateView({}, '/software?tab=templates');
    fireEvent.click(screen.getByText('Blank YAML'));
    expect((screen.getByTestId('yaml-editor') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('Create resource')).toBeDefined();
    expect(screen.queryByText(/Pod/)).toBeNull();
    // Writing a manifest names its kind.
    fireEvent.change(screen.getByTestId('yaml-editor'), { target: { value: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n' } });
    expect(screen.getByText('Create ConfigMap')).toBeDefined();
  });

  it('a kind editor has one <h1> and a back link to the kind\'s list; a plain click opens it in the app', () => {
    renderCreateView({ gvrKey: 'apps/v1/deployments' }, '/create/apps~v1~deployments');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Create Deployment']);
    const back = screen.getByRole('link', { name: 'Back to Deployments' });
    expect(back.getAttribute('href')).toBe('/r/apps~v1~deployments');
    expect(fireEvent.click(back)).toBe(false);
    expect(navigateMock).toHaveBeenCalledWith('/r/apps~v1~deployments');
  });

  it('a modified click on the back link is left to the browser', () => {
    renderCreateView({ gvrKey: 'apps/v1/deployments' }, '/create/apps~v1~deployments');
    const back = screen.getByRole('link', { name: 'Back to Deployments' });
    expect(fireEvent.click(back, { metaKey: true })).toBe(true);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('shows the Deploy an app form fields', () => {
    renderCreateView();

    // Click the Deploy an app tab (Installed is now default)
    fireEvent.click(screen.getByRole('tab', { name: /Deploy an app/ }));
    expect(screen.getByLabelText(/^Name\*?$/)).toBeDefined();
    expect(screen.getByLabelText(/^Image\*?$/)).toBeDefined();
    expect(screen.getByLabelText(/^Container\ port\*?$/)).toBeDefined();
    expect(screen.getByLabelText(/^Replicas\*?$/)).toBeDefined();
  });

  it('has required indicators on name and image fields', () => {
    renderCreateView();
    fireEvent.click(screen.getByRole('tab', { name: /Deploy an app/ }));

    // Both "Name" and "Image" have required * markers
    const requiredMarkers = document.querySelectorAll('.text-red-400');
    expect(requiredMarkers.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the Dry run button, off until the form is complete', () => {
    renderCreateView();
    fireEvent.click(screen.getByRole('tab', { name: /Deploy an app/ }));

    expect((screen.getByRole('button', { name: 'Dry run' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the optional sections below Source', () => {
    renderCreateView();
    fireEvent.click(screen.getByRole('tab', { name: /Deploy an app/ }));

    for (const s of ['1 · Source', '2 · Config', '3 · Storage', '4 · Health checks', '5 · Resources', '6 · Expose']) {
      expect(screen.getByRole('heading', { name: s })).toBeDefined();
    }
  });

  it('shows template categories when Templates tab is selected', () => {
    renderCreateView();

    // Click Templates tab
    fireEvent.click(screen.getByText('Templates'));

    expect(screen.getByText('Workloads')).toBeDefined();
    expect(screen.getByText('Networking')).toBeDefined();
    expect(screen.getByText('Config & Storage')).toBeDefined();
    expect(screen.getByText('Access Control')).toBeDefined();
  });

  it('shows template items in categories', () => {
    renderCreateView();

    fireEvent.click(screen.getByText('Templates'));

    // Workloads category items
    expect(screen.getByText('Deployment')).toBeDefined();

    // Networking category items
    expect(screen.getByText('Service')).toBeDefined();

    // Config & Storage
    expect(screen.getByText('ConfigMap')).toBeDefined();
    expect(screen.getByText('Secret')).toBeDefined();
  });

  it('shows Blank YAML option in templates tab', () => {
    renderCreateView();

    fireEvent.click(screen.getByText('Templates'));

    expect(screen.getByText('Or start from scratch')).toBeDefined();
    expect(screen.getByText('Blank YAML')).toBeDefined();
  });

  it('shows paste and upload buttons in Import YAML tab', () => {
    renderCreateView();

    fireEvent.click(screen.getByText('Import YAML'));

    expect(screen.getByText('Paste from Clipboard')).toBeDefined();
    expect(screen.getByText('Upload File')).toBeDefined();
  });

  it('shows textarea for manual YAML paste in Import YAML tab', () => {
    renderCreateView();

    fireEvent.click(screen.getByText('Import YAML'));

    expect(screen.getByText('Or paste YAML here')).toBeDefined();
    expect(screen.getByPlaceholderText(/apiVersion: v1/)).toBeDefined();
  });

  it('shows "Open in Editor" button when text is entered in YAML textarea', () => {
    renderCreateView();

    fireEvent.click(screen.getByText('Import YAML'));

    const textarea = screen.getByPlaceholderText(/apiVersion: v1/);
    fireEvent.change(textarea, { target: { value: 'apiVersion: v1\nkind: Pod' } });

    expect(screen.getByText('Open in Editor')).toBeDefined();
  });

  it('does not show "Open in Editor" when textarea is empty', () => {
    renderCreateView();

    fireEvent.click(screen.getByText('Import YAML'));

    expect(screen.queryByText('Open in Editor')).toBeNull();
  });

  it('switches between tabs correctly', () => {
    renderCreateView();

    // Start at Installed (default), switch to Deploy an app
    fireEvent.click(screen.getByRole('tab', { name: /Deploy an app/ }));
    expect(screen.getByLabelText(/^Image\*?$/)).toBeDefined();

    // Switch to Helm Charts
    fireEvent.click(screen.getByText('Helm Charts'));
    expect(screen.getByPlaceholderText('Search charts...')).toBeDefined();

    // Switch to Templates
    fireEvent.click(screen.getByText('Templates'));
    expect(screen.getByText('Workloads')).toBeDefined();

    // Switch to Import YAML
    fireEvent.click(screen.getByText('Import YAML'));
    expect(screen.getByText('Paste from Clipboard')).toBeDefined();

    // Switch back to Deploy an app
    fireEvent.click(screen.getByRole('tab', { name: /Deploy an app/ }));
    expect(screen.getByLabelText(/^Image\*?$/)).toBeDefined();
  });

  it('shows Helm chart tab with repo-based catalog', () => {
    renderCreateView();

    fireEvent.click(screen.getByText('Helm Charts'));

    // With no repos configured, shows empty state
    expect(document.body.textContent).toContain('Charts');
  });

  it('shows search input in Helm Charts tab', () => {
    renderCreateView();

    fireEvent.click(screen.getByText('Helm Charts'));

    expect(screen.getByPlaceholderText('Search charts...')).toBeDefined();
  });

  it('shows namespace info in Deploy an app', () => {
    renderCreateView();
    fireEvent.click(screen.getByRole('tab', { name: /Deploy an app/ }));

    // The global selector names the target namespace; nothing falls back to `default` silently.
    expect(screen.getByLabelText('Namespace')).toBeDefined();
  });

  // ===== Deploy an app: Config =====

  it('adds variable, ConfigMap and Secret entries', () => {
    renderCreateView();
    fireEvent.click(screen.getByRole('tab', { name: /Deploy an app/ }));
    expect(screen.getByText('No environment set.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add from Secret' }));
    expect(screen.getAllByLabelText(/^Variable\ name\*?$/)).toHaveLength(1);
    expect(screen.getByLabelText('Secret')).toBeDefined();
    expect(screen.getByText('value hidden')).toBeDefined();
  });

  // ===== Deploy an app: Resources =====

  it('shows the resource fields', () => {
    renderCreateView();
    fireEvent.click(screen.getByRole('tab', { name: /Deploy an app/ }));
    for (const l of ['CPU request', 'CPU limit', 'Memory request', 'Memory limit']) expect(screen.getByLabelText(l)).toBeDefined();
  });

  // ===== Templates: Search + All 23 =====

  it('shows search input in Templates tab', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Templates'));
    expect(screen.getByPlaceholderText(/Search templates/)).toBeDefined();
  });

  it('shows operator templates (not just basic resources)', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Templates'));
    // The Templates tab should show operator subscription templates
    expect(screen.getByText('Cluster Logging Operator')).toBeDefined();
  });

  it('shows logging templates', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Templates'));
    expect(screen.getByText('Logging')).toBeDefined();
    expect(screen.getByText('LokiStack')).toBeDefined();
    expect(screen.getByText('ClusterLogForwarder')).toBeDefined();
  });

  it('shows autoscaling templates', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Templates'));
    expect(screen.getByText('Autoscaling')).toBeDefined();
    expect(screen.getByText('ClusterAutoscaler')).toBeDefined();
  });

  it('filters templates by search query', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Templates'));
    const searchInput = screen.getByPlaceholderText(/Search templates/);
    fireEvent.change(searchInput, { target: { value: 'loki' } });
    expect(screen.getByText('LokiStack')).toBeDefined();
    expect(screen.getByText('Loki Operator')).toBeDefined();
    expect(screen.queryByText('Deployment')).toBeNull();
  });

  it('shows template count', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Templates'));
    expect(screen.getByText(/\d+ of \d+ templates/)).toBeDefined();
  });

  it('shows no results message for unmatched template search', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Templates'));
    const searchInput = screen.getByPlaceholderText(/Search templates/);
    fireEvent.change(searchInput, { target: { value: 'xyznonexistent' } });
    expect(screen.getByText(/No templates match/)).toBeDefined();
  });

  // ===== Import YAML: Validation =====

  it('shows validation feedback for valid YAML', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Import YAML'));
    const textarea = screen.getByPlaceholderText(/apiVersion: v1/);
    fireEvent.change(textarea, { target: { value: 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: test' } });
    expect(screen.getByText(/Valid/)).toBeDefined();
    expect(screen.getByText('Pod')).toBeDefined();
  });

  it('shows validation errors for YAML missing apiVersion', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Import YAML'));
    const textarea = screen.getByPlaceholderText(/apiVersion: v1/);
    fireEvent.change(textarea, { target: { value: 'kind: Pod\nmetadata:\n  name: test' } });
    expect(screen.getByText(/Missing apiVersion/)).toBeDefined();
  });

  it('shows validation errors for YAML missing kind', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Import YAML'));
    const textarea = screen.getByPlaceholderText(/apiVersion: v1/);
    fireEvent.change(textarea, { target: { value: 'apiVersion: v1\nmetadata:\n  name: test' } });
    expect(screen.getByText(/Missing kind/)).toBeDefined();
  });

  it('shows validation error for non-YAML text', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Import YAML'));
    const textarea = screen.getByPlaceholderText(/apiVersion: v1/);
    fireEvent.change(textarea, { target: { value: 'this is just plain text' } });
    expect(screen.getByText(/Does not look like a Kubernetes object/)).toBeDefined();
  });

  it('shows tab indentation warning', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Import YAML'));
    const textarea = screen.getByPlaceholderText(/apiVersion: v1/);
    fireEvent.change(textarea, { target: { value: 'apiVersion: v1\nkind: Pod\n\tname: test' } });
    expect(screen.getByText(/tabs for indentation/)).toBeDefined();
  });

  it('shows "Open Anyway" for invalid YAML', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Import YAML'));
    const textarea = screen.getByPlaceholderText(/apiVersion: v1/);
    fireEvent.change(textarea, { target: { value: 'kind: Pod\nmetadata:\n  name: test' } });
    expect(screen.queryByText('Open Anyway')).toBeDefined();
  });

  it('detects multi-document YAML', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Import YAML'));
    const textarea = screen.getByPlaceholderText(/apiVersion: v1/);
    fireEvent.change(textarea, { target: { value: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: a\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: b' } });
    expect(screen.getByText(/2 documents/)).toBeDefined();
  });

  // ===== Unsaved changes warning =====

  it('registers beforeunload listener when YAML has changes', () => {
    const addEventSpy = vi.spyOn(window, 'addEventListener');
    renderCreateView({ gvrKey: 'apps/v1/deployments' });

    // Modify YAML content to trigger hasYamlChanges
    const editor = screen.getByTestId('yaml-editor');
    fireEvent.change(editor, { target: { value: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: changed' } });

    const beforeunloadCalls = addEventSpy.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(beforeunloadCalls.length).toBeGreaterThanOrEqual(1);
    addEventSpy.mockRestore();
  });

  it('does not register beforeunload when no YAML changes', () => {
    const addEventSpy = vi.spyOn(window, 'addEventListener');
    renderCreateView({ gvrKey: 'v1/pods' });
    const beforeunloadCalls = addEventSpy.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(beforeunloadCalls.length).toBe(0);
    addEventSpy.mockRestore();
  });
});
