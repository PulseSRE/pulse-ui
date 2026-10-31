/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { GitOpsActionDialog } from '../components/GitOpsActionDialog';
import type { ArgoSyncInfo } from '../engine/types';

// Mock useGitOpsConfig
vi.mock('../hooks/useGitOpsConfig', () => ({
  useGitOpsConfig: () => ({
    config: { provider: 'github', repoUrl: 'https://github.com/org/repo', baseBranch: 'main', token: 'test-token' },
    isConfigured: true,
    isLoading: false,
  }),
}));

// Mock gitProvider
vi.mock('../engine/gitProvider', () => ({
  createGitProvider: () => ({
    createBranch: vi.fn().mockResolvedValue(undefined),
    getFileContent: vi.fn().mockResolvedValue(null),
    createOrUpdateFile: vi.fn().mockResolvedValue(undefined),
    createPullRequest: vi.fn().mockResolvedValue({ url: 'https://github.com/org/repo/pull/42', number: 42 }),
  }),
}));

const defaultSyncInfo: ArgoSyncInfo = {
  appName: 'frontend',
  appNamespace: 'openshift-gitops',
  syncStatus: 'Synced',
  revision: 'abc1234',
  repoURL: 'https://github.com/org/repo',
  path: 'apps/frontend',
};

function renderDialog(props: Partial<React.ComponentProps<typeof GitOpsActionDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const defaultProps = {
    open: true,
    resourceKind: 'Deployment',
    resourceName: 'my-app',
    resourceNamespace: 'default',
    yamlContent: 'apiVersion: apps/v1\nkind: Deployment',
    syncInfo: defaultSyncInfo,
    onApply: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...props,
  };
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GitOpsActionDialog {...defaultProps} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GitOpsActionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when not open', () => {
    const { container } = renderDialog({ open: false });
    expect(container.innerHTML).toBe('');
  });

  it('renders three action buttons when open', () => {
    renderDialog();
    expect(screen.getByText('Apply Now + Create PR')).toBeDefined();
    expect(screen.getByText('Create PR Only')).toBeDefined();
    expect(screen.getByText('Apply Only')).toBeDefined();
  });

  it('shows resource name and ArgoCD app name', () => {
    renderDialog();
    expect(screen.getAllByText(/Deployment\/my-app/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/frontend/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows Recommended badge on Apply + PR option', () => {
    renderDialog();
    expect(screen.getAllByText(/Recommended/).length).toBeGreaterThanOrEqual(1);
  });

  it('Apply Only button is clickable and describes drift risk', () => {
    renderDialog();
    const buttons = screen.getAllByRole('button');
    const applyOnlyBtn = buttons.find(b => b.textContent?.includes('Apply Only') && b.textContent?.includes('drift'));
    expect(applyOnlyBtn).toBeDefined();
    expect(applyOnlyBtn?.disabled).toBeFalsy();
  });

  it('shows drift warning on Apply Only option', () => {
    renderDialog();
    expect(screen.getAllByText(/cause drift/).length).toBeGreaterThanOrEqual(1);
  });
});
