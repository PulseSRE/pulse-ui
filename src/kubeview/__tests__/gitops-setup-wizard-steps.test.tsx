/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateApplicationStep } from '../views/argocd/steps/CreateApplicationStep';
import { VerificationStep } from '../views/argocd/steps/VerificationStep';

// --- Mocks ---

const mockSetExportSummary = vi.fn();
const mockMarkComplete = vi.fn();
let mockSelectedCategories: string[] = [];
let mockSelectedNamespaces: string[] = [];
let mockExportSummary: {
  resourceCount: number;
  categories: string[];
  namespaces: string[];
  prUrl?: string;
  clusterName: string;
} | null = null;

vi.mock('../store/gitopsSetupStore', () => ({
  useGitOpsSetupStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      markStepComplete: mockMarkComplete,
      selectedCategories: mockSelectedCategories,
      selectedNamespaces: mockSelectedNamespaces,
      setExportSummary: mockSetExportSummary,
      exportSummary: mockExportSummary,
      setStep: vi.fn(),
    };
    return selector(state);
  },
}));

vi.mock('../store/argoCDStore', () => ({
  useArgoCDStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      namespace: 'openshift-gitops',
      available: true,
      applications: [
        { metadata: { name: 'test-app', namespace: 'openshift-gitops' } },
      ],
    };
    return selector(state);
  },
}));

vi.mock('../hooks/useGitOpsConfig', () => ({
  useGitOpsConfig: () => ({
    config: {
      provider: 'github',
      repoUrl: 'https://github.com/org/repo',
      baseBranch: 'main',
      token: 'test-token',
    },
    isConfigured: true,
    isLoading: false,
  }),
}));

vi.mock('../hooks/useNavigateTab', () => ({
  useNavigateTab: () => vi.fn(),
}));

vi.mock('../engine/gitProvider', () => ({
  createGitProvider: () => ({
    createBranch: vi.fn().mockResolvedValue(undefined),
    getFileContent: vi.fn().mockResolvedValue(null),
    createOrUpdateFile: vi.fn().mockResolvedValue(undefined),
    commitMultipleFiles: vi.fn().mockResolvedValue(undefined),
    createPullRequest: vi.fn().mockResolvedValue({ url: 'https://github.com/org/repo/pull/42', number: 42 }),
  }),
}));

vi.mock('../engine/query', () => ({
  k8sCreate: vi.fn().mockResolvedValue({}),
}));

vi.mock('../engine/errorToast', () => ({
  showErrorToast: vi.fn(),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
  );
}

describe('CreateApplicationStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedCategories = [];
    mockSelectedNamespaces = [];
    mockExportSummary = null;
  });

  afterEach(cleanup);

  it('renders single-app mode when no categories selected', () => {
    mockSelectedCategories = [];
    renderWithQuery(<CreateApplicationStep onComplete={vi.fn()} />);

    expect(screen.getAllByText('Create ArgoCD Application').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Create Application').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Application Name').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Path').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Destination Namespace').length).toBeGreaterThanOrEqual(1);
  });

  it('renders app-of-apps mode when categories are selected', () => {
    mockSelectedCategories = ['deployments', 'services'];
    mockSelectedNamespaces = ['default', 'production'];
    renderWithQuery(<CreateApplicationStep onComplete={vi.fn()} />);

    expect(screen.getAllByText('Create App-of-Apps').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('App-of-Apps Pattern').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Cluster Name').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Child Applications').length).toBeGreaterThanOrEqual(1);
  });

  it('generates correct number of child apps (categories x namespaces)', () => {
    mockSelectedCategories = ['deployments', 'services'];
    mockSelectedNamespaces = ['default', 'production'];
    renderWithQuery(<CreateApplicationStep onComplete={vi.fn()} />);

    // 2 categories x 2 namespaces = 4 child apps
    const buttons = screen.getAllByText(/Create App-of-Apps.*\d+ apps/);
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(buttons[0].textContent).toContain('4 apps');
  });

  it('shows YAML preview toggle', () => {
    renderWithQuery(<CreateApplicationStep onComplete={vi.fn()} />);
    expect(screen.getAllByText('Preview YAML').length).toBeGreaterThanOrEqual(1);
  });

  it('shows auto sync toggle in both modes', () => {
    mockSelectedCategories = ['deployments'];
    renderWithQuery(<CreateApplicationStep onComplete={vi.fn()} />);
    expect(screen.getAllByText('Auto Sync').length).toBeGreaterThanOrEqual(1);
  });

  it('defaults to single namespace when none selected for app-of-apps', () => {
    mockSelectedCategories = ['deployments'];
    mockSelectedNamespaces = [];
    renderWithQuery(<CreateApplicationStep onComplete={vi.fn()} />);

    // 1 category x 1 default namespace = 1 app
    const buttons = screen.getAllByText(/Create App-of-Apps.*\d+ apps/);
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(buttons[0].textContent).toContain('1 apps');
  });
});

describe('VerificationStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedCategories = [];
    mockSelectedNamespaces = [];
    mockExportSummary = null;
  });

  afterEach(cleanup);

  it('renders basic verification summary', () => {
    renderWithQuery(<VerificationStep onClose={vi.fn()} />);

    expect(screen.getAllByText('GitOps Setup Complete').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('OpenShift GitOps installed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('test-app').length).toBeGreaterThanOrEqual(1);
  });

  it('shows View in Git link when repo is configured', () => {
    renderWithQuery(<VerificationStep onClose={vi.fn()} />);

    const links = screen.getAllByText('View in Git');
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].closest('a')?.getAttribute('href')).toBe('https://github.com/org/repo');
  });

  it('shows export summary when present', () => {
    mockExportSummary = {
      resourceCount: 4,
      categories: ['deployments', 'services'],
      namespaces: ['default', 'production'],
      prUrl: 'https://github.com/org/repo/pull/42',
      clusterName: 'my-cluster',
    };
    renderWithQuery(<VerificationStep onClose={vi.fn()} />);

    expect(screen.getAllByText('Export Summary').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('my-cluster').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('deployments, services').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('default, production').length).toBeGreaterThanOrEqual(1);
  });

  it('shows PR link in export summary', () => {
    mockExportSummary = {
      resourceCount: 2,
      categories: ['deployments'],
      namespaces: ['default'],
      prUrl: 'https://github.com/org/repo/pull/42',
      clusterName: 'test-cluster',
    };
    renderWithQuery(<VerificationStep onClose={vi.fn()} />);

    const prLinks = screen.getAllByText('View Pull Request');
    expect(prLinks.length).toBeGreaterThanOrEqual(1);
    expect(prLinks[0].closest('a')?.getAttribute('href')).toBe('https://github.com/org/repo/pull/42');
  });

  it('shows Re-export Cluster button when export summary present', () => {
    mockExportSummary = {
      resourceCount: 2,
      categories: ['deployments'],
      namespaces: ['default'],
      clusterName: 'test-cluster',
    };
    renderWithQuery(<VerificationStep onClose={vi.fn()} />);

    expect(screen.getAllByText('Re-export Cluster').length).toBeGreaterThanOrEqual(1);
  });

  it('does not show Re-export or export summary without export data', () => {
    mockExportSummary = null;
    renderWithQuery(<VerificationStep onClose={vi.fn()} />);

    expect(screen.queryByText('Export Summary')).toBeNull();
    expect(screen.queryByText('Re-export Cluster')).toBeNull();
  });

  it('shows Create Another Application button', () => {
    renderWithQuery(<VerificationStep onClose={vi.fn()} />);
    expect(screen.getAllByText('Create Another Application').length).toBeGreaterThanOrEqual(1);
  });
});
