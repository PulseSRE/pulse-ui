/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: any) => any) => {
    const state = { addToast: vi.fn(), selectedNamespace: '*' };
    return selector(state);
  }, { getState: () => ({ impersonateUser: '', impersonateGroups: [] }) }),
}));

vi.mock('../../../engine/query', () => ({
  k8sList: vi.fn().mockResolvedValue([]),
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sPatch: vi.fn().mockResolvedValue({}),
  getImpersonationHeaders: vi.fn().mockReturnValue({}),
}));

import { ApplicationsTab } from '../ApplicationsTab';

const baseApp = {
  apiVersion: 'argoproj.io/v1alpha1' as const,
  kind: 'Application' as const,
  metadata: { name: 'test-app', namespace: 'openshift-gitops', uid: '1' },
  spec: {
    source: { repoURL: 'https://github.com/org/repo.git', path: 'k8s' },
    destination: { server: 'https://kubernetes.default.svc', namespace: 'production' },
    project: 'default',
  },
  status: {
    sync: { status: 'Synced' as const },
    health: { status: 'Healthy' as const },
    resources: [],
    conditions: [] as Array<{ type: string; message: string; lastTransitionTime?: string }>,
  },
};

describe('ApplicationsTab', () => {
  const go = vi.fn();
  const onSync = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows empty state when no applications', () => {
    render(<ApplicationsTab applications={[]} syncing={null} onSync={onSync} go={go} />);
    expect(screen.getByText('No ArgoCD Applications found')).toBeDefined();
  });

  it('renders application name and sync status', () => {
    render(<ApplicationsTab applications={[baseApp]} syncing={null} onSync={onSync} go={go} />);
    expect(screen.getByText('test-app')).toBeDefined();
    expect(screen.getByText('Synced')).toBeDefined();
  });

  it('shows condition timeline when expanded with lastTransitionTime', () => {
    const appWithConditions = {
      ...baseApp,
      metadata: { ...baseApp.metadata, name: 'cond-app', uid: 'c1' },
      status: {
        ...baseApp.status,
        conditions: [
          { type: 'SyncError', message: 'Failed to sync resource', lastTransitionTime: new Date(Date.now() - 300_000).toISOString() },
          { type: 'OrphanedResourceWarning', message: 'Found orphaned resources', lastTransitionTime: new Date(Date.now() - 600_000).toISOString() },
        ],
      },
    };

    const { container } = render(<ApplicationsTab applications={[appWithConditions]} syncing={null} onSync={onSync} go={go} />);

    // Click the row to expand
    const row = within(container).getAllByText('cond-app')[0].closest('button[class*="cursor-pointer"]')!;
    fireEvent.click(row);

    // Check condition timeline is visible
    // One conditions list (a timeline), not a list and a timeline of the same data.
    expect(within(container).getAllByText('Conditions')).toHaveLength(1);
    expect(within(container).queryByText('Condition Timeline')).toBeNull();
    expect(within(container).getAllByText(/SyncError/)).toHaveLength(1);
    expect(within(container).getAllByText(/OrphanedResourceWarning/)).toHaveLength(1);
  });

  it('does not show condition timeline if no lastTransitionTime', () => {
    const appWithConditionsNoTime = {
      ...baseApp,
      metadata: { ...baseApp.metadata, name: 'notime-app', uid: 'n1' },
      status: {
        ...baseApp.status,
        conditions: [
          { type: 'SyncError', message: 'Failed to sync resource' },
        ],
      },
    };

    const { container } = render(<ApplicationsTab applications={[appWithConditionsNoTime]} syncing={null} onSync={onSync} go={go} />);

    // Click the row to expand
    const row = within(container).getByText('notime-app').closest('button[class*="cursor-pointer"]')!;
    fireEvent.click(row);

    // Conditions section should show, but not the timeline
    expect(within(container).getAllByText('Conditions').length).toBeGreaterThanOrEqual(1);
    expect(within(container).queryByText('Condition Timeline')).toBeNull();
  });

  it('sorts condition timeline by lastTransitionTime descending', () => {
    const now = Date.now();
    const appWithConditions = {
      ...baseApp,
      metadata: { ...baseApp.metadata, name: 'sort-app', uid: 's1' },
      status: {
        ...baseApp.status,
        conditions: [
          { type: 'OlderCondition', message: 'older', lastTransitionTime: new Date(now - 3600_000).toISOString() },
          { type: 'NewerCondition', message: 'newer', lastTransitionTime: new Date(now - 60_000).toISOString() },
        ],
      },
    };

    const { container } = render(<ApplicationsTab applications={[appWithConditions]} syncing={null} onSync={onSync} go={go} />);
    const row = within(container).getByText('sort-app').closest('button[class*="cursor-pointer"]')!;
    fireEvent.click(row);

    // Find the Condition Timeline container and check order within it
    const timelineLabel = within(container).getByText('Conditions');
    const timelineContainer = timelineLabel.parentElement!;
    const timelineText = timelineContainer.textContent || '';
    const newerIdx = timelineText.indexOf('NewerCondition');
    const olderIdx = timelineText.indexOf('OlderCondition');
    expect(newerIdx).toBeGreaterThan(-1);
    expect(olderIdx).toBeGreaterThan(-1);
    expect(newerIdx).toBeLessThan(olderIdx);
  });
});

describe('ApplicationsTab empty state links', () => {
  afterEach(cleanup);

  it('"Import YAML" opens the Application create page, not a Pod snippet', () => {
    const go = vi.fn();
    render(<ApplicationsTab applications={[]} syncing={null} onSync={vi.fn()} go={go} />);
    fireEvent.click(screen.getByText('Import YAML'));
    expect(go).toHaveBeenCalledWith('/create/argoproj.io~v1alpha1~applications', 'Import YAML');
  });
});
