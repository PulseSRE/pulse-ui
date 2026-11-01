// @vitest-environment jsdom
/**
 * The GitOps wizard resumes at the first step not done. It used to jump to
 * Verification once any four steps were done, skipping "Create Apps".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const k8sGet = vi.fn();
vi.mock('../../engine/query', async (orig) => ({ ...(await orig<object>()), k8sGet: (...a: unknown[]) => k8sGet(...a) }));

import { useGitOpsSetupStore } from '../gitopsSetupStore';
import { useArgoCDStore } from '../argoCDStore';

beforeEach(() => {
  k8sGet.mockReset();
  useArgoCDStore.setState({ detected: true, available: true, applications: [] } as never);
});

describe('GitOps wizard resume', () => {
  it('resumes at "first-app" when operator, git, selection and export are done but no app exists', async () => {
    k8sGet.mockResolvedValue({});
    useGitOpsSetupStore.setState({
      exportSelections: { clusterName: 'prod', categoryIds: ['rbac'], namespaces: [], exportMode: 'pr' },
      exportSummary: { resourceCount: 3, categories: ['rbac'], namespaces: [], clusterName: 'prod' },
    } as never);
    await useGitOpsSetupStore.getState().detectCompletedSteps();
    expect(useGitOpsSetupStore.getState().currentStep).toBe('first-app');
  });

  it('is done only when an Application exists too', async () => {
    k8sGet.mockResolvedValue({});
    useArgoCDStore.setState({ applications: [{ metadata: { name: 'a' } }] } as never);
    await useGitOpsSetupStore.getState().detectCompletedSteps();
    expect(useGitOpsSetupStore.getState().currentStep).toBe('done');
  });

  it('resumes at git config when the config Secret cannot be read', async () => {
    k8sGet.mockRejectedValue(new Error('404'));
    useGitOpsSetupStore.setState({ exportSelections: { clusterName: '', categoryIds: [], namespaces: [], exportMode: 'pr' }, exportSummary: null } as never);
    await useGitOpsSetupStore.getState().detectCompletedSteps();
    expect(useGitOpsSetupStore.getState().currentStep).toBe('git-config');
  });
});
