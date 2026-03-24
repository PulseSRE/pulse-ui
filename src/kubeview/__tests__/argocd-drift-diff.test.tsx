/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DriftTab } from '../views/argocd/DriftTab';
import type { ArgoApplication } from '../engine/types';

vi.mock('../hooks/useNavigateTab', () => ({
  useNavigateTab: () => vi.fn(),
}));

// Mock ResourceDiffPanel to avoid needing QueryClient
vi.mock('../views/argocd/ResourceDiffPanel', () => ({
  ResourceDiffPanel: ({ resource, appName }: { resource: any; appName: string }) => (
    <div data-testid={`diff-panel-${resource.name}`}>
      Diff for {resource.name} via {appName}
    </div>
  ),
}));

function makeOutOfSyncApp(name: string): ArgoApplication {
  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: { name, namespace: 'openshift-gitops', uid: `app-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: {
      source: { repoURL: 'https://github.com/org/repo', path: `apps/${name}` },
      destination: { server: 'https://kubernetes.default.svc', namespace: 'default' },
      project: 'default',
    },
    status: {
      sync: { status: 'OutOfSync', revision: 'abc1234' },
      health: { status: 'Healthy' },
      resources: [
        { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'default', name: `${name}-deploy`, status: 'OutOfSync' },
        { group: '', version: 'v1', kind: 'Service', namespace: 'default', name: `${name}-svc`, status: 'Synced' },
      ],
    },
  };
}

describe('DriftTab - View button and ResourceDiffPanel', () => {
  const go = vi.fn();
  const onSync = vi.fn();

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows View button on out-of-sync resources when expanded', () => {
    const apps = [makeOutOfSyncApp('frontend')];

    render(
      <MemoryRouter>
        <DriftTab applications={apps} onSync={onSync} syncing={null} go={go} />
      </MemoryRouter>
    );

    // Expand the app card
    fireEvent.click(screen.getByText('frontend'));

    // Should show View button for out-of-sync resource
    const viewButtons = screen.getAllByText('View');
    expect(viewButtons.length).toBeGreaterThan(0);
  });

  it('toggles ResourceDiffPanel when View button is clicked', () => {
    const apps = [makeOutOfSyncApp('frontend')];

    render(
      <MemoryRouter>
        <DriftTab applications={apps} onSync={onSync} syncing={null} go={go} />
      </MemoryRouter>
    );

    // Expand the app card
    fireEvent.click(screen.getByText('frontend'));

    // Click the View button
    const viewButton = screen.getByText('View');
    fireEvent.click(viewButton);

    // Should show the diff panel
    expect(screen.getByTestId('diff-panel-frontend-deploy')).toBeDefined();
    expect(screen.getByText('Diff for frontend-deploy via frontend')).toBeDefined();

    // Click again to hide
    fireEvent.click(viewButton);
    expect(screen.queryByTestId('diff-panel-frontend-deploy')).toBeNull();
  });

  it('does not show View button for synced resources', () => {
    const apps = [makeOutOfSyncApp('backend')];

    render(
      <MemoryRouter>
        <DriftTab applications={apps} onSync={onSync} syncing={null} go={go} />
      </MemoryRouter>
    );

    // Expand the app card
    fireEvent.click(screen.getByText('backend'));

    // Synced resources are hidden ("X synced resources (hidden)")
    expect(screen.getByText(/1 synced resource/)).toBeDefined();
  });

  it('renders all-in-sync message when no apps are out of sync', () => {
    const syncedApp: ArgoApplication = {
      ...makeOutOfSyncApp('synced'),
      status: {
        sync: { status: 'Synced', revision: 'abc' },
        health: { status: 'Healthy' },
        resources: [],
      },
    };

    render(
      <MemoryRouter>
        <DriftTab applications={[syncedApp]} onSync={onSync} syncing={null} go={go} />
      </MemoryRouter>
    );

    expect(screen.getByText('All applications are in sync')).toBeDefined();
  });
});
