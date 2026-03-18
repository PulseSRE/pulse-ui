// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
  useClusterStore: (selector: any) => {
    const state = { resourceRegistry: new Map() };
    return selector(state);
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

function renderCreateView(props: { gvrKey: string } = { gvrKey: 'v1/pods' }) {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CreateView {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----

describe('CreateView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default fetch mock for Helm releases query
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders 4 tabs: Quick Deploy, Helm Charts, Templates, Import YAML', () => {
    renderCreateView();

    expect(screen.getByText('Quick Deploy')).toBeDefined();
    expect(screen.getByText('Helm Charts')).toBeDefined();
    expect(screen.getByText('Templates')).toBeDefined();
    expect(screen.getByText('Import YAML')).toBeDefined();
  });

  it('renders Create heading and description', () => {
    renderCreateView();

    expect(screen.getByText('Create')).toBeDefined();
    expect(screen.getByText(/Deploy an application, install a Helm chart/)).toBeDefined();
  });

  it('shows Quick Deploy form fields', () => {
    renderCreateView();

    // Click Quick Deploy tab (Installed is now default)
    fireEvent.click(screen.getByText('Quick Deploy'));
    expect(screen.getByText('Application Name')).toBeDefined();
    expect(screen.getByText('Container Image')).toBeDefined();
    expect(screen.getByText('Container Port')).toBeDefined();
    expect(screen.getByText('Replicas')).toBeDefined();
  });

  it('has required indicators on name and image fields', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Quick Deploy'));

    // Both "Application Name" and "Container Image" have required * markers
    const requiredMarkers = document.querySelectorAll('.text-red-400');
    expect(requiredMarkers.length).toBeGreaterThanOrEqual(2);
  });

  it('shows Deploy button in Quick Deploy tab', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Quick Deploy'));

    expect(screen.getByText('Deploy')).toBeDefined();
  });

  it('shows quick example buttons (nginx, httpd, redis)', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Quick Deploy'));

    expect(screen.getByText('Quick Examples')).toBeDefined();
    expect(screen.getByText('nginx')).toBeDefined();
    expect(screen.getByText('httpd')).toBeDefined();
    expect(screen.getByText('redis')).toBeDefined();
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

    // Start at Installed (default), switch to Quick Deploy
    fireEvent.click(screen.getByText('Quick Deploy'));
    expect(screen.getByText('Application Name')).toBeDefined();

    // Switch to Helm Charts
    fireEvent.click(screen.getByText('Helm Charts'));
    expect(screen.getByPlaceholderText('Search charts...')).toBeDefined();

    // Switch to Templates
    fireEvent.click(screen.getByText('Templates'));
    expect(screen.getByText('Workloads')).toBeDefined();

    // Switch to Import YAML
    fireEvent.click(screen.getByText('Import YAML'));
    expect(screen.getByText('Paste from Clipboard')).toBeDefined();

    // Switch back to Quick Deploy
    fireEvent.click(screen.getByText('Quick Deploy'));
    expect(screen.getByText('Application Name')).toBeDefined();
  });

  it('populates form fields when clicking quick example', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Quick Deploy'));

    // Click nginx example
    fireEvent.click(screen.getByText(/Nginx web server/));

    // Check that the input fields are populated
    const nameInput = screen.getByPlaceholderText('my-app') as HTMLInputElement;
    const imageInput = screen.getByPlaceholderText(/nginx|quay.io/) as HTMLInputElement;

    expect(nameInput.value).toBe('nginx');
    expect(imageInput.value).toBe('nginxinc/nginx-unprivileged:latest');
  });

  it('shows Helm chart catalog with chart names', () => {
    renderCreateView();

    fireEvent.click(screen.getByText('Helm Charts'));

    expect(screen.getByText('postgresql')).toBeDefined();
    expect(screen.getByText('redis')).toBeDefined();
    expect(screen.getByText('mongodb')).toBeDefined();
    expect(screen.getByText('kafka')).toBeDefined();
    expect(screen.getByText('grafana')).toBeDefined();
  });

  it('shows search input in Helm Charts tab', () => {
    renderCreateView();

    fireEvent.click(screen.getByText('Helm Charts'));

    expect(screen.getByPlaceholderText('Search charts...')).toBeDefined();
  });

  it('shows namespace info in Quick Deploy', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Quick Deploy'));

    expect(screen.getByText('default')).toBeDefined();
  });

  // ===== Quick Deploy: Env Vars =====

  it('shows Add Variable button in Quick Deploy', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Quick Deploy'));
    expect(screen.getByText('Environment Variables')).toBeDefined();
    expect(screen.getByText('Add Variable')).toBeDefined();
  });

  it('adds env var row when Add Variable is clicked', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Quick Deploy'));
    fireEvent.click(screen.getByText('Add Variable'));
    expect(screen.getByPlaceholderText('NAME')).toBeDefined();
    expect(screen.getByPlaceholderText('value')).toBeDefined();
  });

  it('can add multiple env vars', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Quick Deploy'));
    fireEvent.click(screen.getByText('Add Variable'));
    fireEvent.click(screen.getByText('Add Variable'));
    const nameInputs = screen.getAllByPlaceholderText('NAME');
    expect(nameInputs.length).toBe(2);
  });

  // ===== Quick Deploy: Resource Limits =====

  it('has collapsible Resource Limits section', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Quick Deploy'));
    expect(screen.getByText(/Resource Limits/)).toBeDefined();
    // Initially collapsed — no CPU/Memory fields visible
    expect(screen.queryByPlaceholderText('100m')).toBeNull();
  });

  it('shows resource limit fields when expanded', () => {
    renderCreateView();
    fireEvent.click(screen.getByText('Quick Deploy'));
    fireEvent.click(screen.getByText(/Resource Limits/));
    expect(screen.getByText('CPU Request')).toBeDefined();
    expect(screen.getByText('CPU Limit')).toBeDefined();
    expect(screen.getByText('Memory Request')).toBeDefined();
    expect(screen.getByText('Memory Limit')).toBeDefined();
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
    expect(screen.getByText('Operators')).toBeDefined();
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
    expect(screen.getByText(/Does not look like YAML/)).toBeDefined();
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
});
