/**
 * @vitest-environment jsdom
 */
/**
 * "Go to Admin → GitOps" named a page that does not exist. The repository is
 * configured in the GitOps setup wizard's Git step, so the dialog links there.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import React from 'react';

vi.mock('../hooks/useGitOpsConfig', () => ({
  useGitOpsConfig: () => ({ config: null, isConfigured: false, isLoading: false }),
}));

import { GitOpsActionDialog } from '../components/GitOpsActionDialog';
import { useGitOpsSetupStore } from '../store/gitopsSetupStore';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}</span>;
}

describe('GitOpsActionDialog without a Git provider', () => {
  afterEach(cleanup);

  it('links to the Git step of the setup wizard on /gitops', () => {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/yaml/apps~v1~deployments/shop/web']}>
          <Routes>
            <Route path="*" element={<><Where /><GitOpsActionDialog open resourceKind="Deployment" resourceName="web" resourceNamespace="shop" yamlContent="kind: Deployment" syncInfo={{ appName: 'a', appNamespace: 'openshift-gitops', syncStatus: 'Synced', revision: 'r', repoURL: 'https://x', path: 'p' } as never} onApply={vi.fn()} onClose={onClose} /></>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/Admin → GitOps/)).toBeNull();
    fireEvent.click(screen.getByText('Configure a Git repository'));
    expect(screen.getByTestId('where').textContent).toBe('/gitops');
    expect(useGitOpsSetupStore.getState().wizardOpen).toBe(true);
    expect(useGitOpsSetupStore.getState().currentStep).toBe('git-config');
    expect(onClose).toHaveBeenCalled();
  });
});
