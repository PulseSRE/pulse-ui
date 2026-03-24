/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useArgoCDStore } from '../store/argoCDStore';
import { ResourceHistoryPanel } from '../views/argocd/ResourceHistoryPanel';

vi.mock('../hooks/useNavigateTab', () => ({
  useNavigateTab: () => vi.fn(),
}));

function buildStoreState(apps: any[]) {
  const cache = new Map();
  for (const app of apps) {
    for (const r of app.status?.resources || []) {
      const key = `${r.kind}/${r.namespace || '_'}/${r.name}`;
      cache.set(key, {
        appName: app.metadata.name,
        appNamespace: app.metadata.namespace || '',
        syncStatus: r.status || 'Unknown',
        repoURL: app.spec?.source?.repoURL,
        path: app.spec?.source?.path,
        revision: app.status?.sync?.revision,
      });
    }
  }
  return { available: true, applications: apps, resourceCache: cache };
}

describe('ResourceHistoryPanel', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useArgoCDStore.setState({ available: false, applications: [], resourceCache: new Map() });
  });

  it('renders nothing when ArgoCD is not available', () => {
    useArgoCDStore.setState({ available: false, resourceCache: new Map(), applications: [] });

    const { container } = render(
      <MemoryRouter>
        <ResourceHistoryPanel kind="Deployment" namespace="default" name="my-app" />
      </MemoryRouter>
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when resource is not managed by ArgoCD', () => {
    useArgoCDStore.setState({ available: true, resourceCache: new Map(), applications: [] });

    const { container } = render(
      <MemoryRouter>
        <ResourceHistoryPanel kind="Deployment" namespace="default" name="unmanaged" />
      </MemoryRouter>
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when parent app has no history', () => {
    const app = {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'Application',
      metadata: { name: 'frontend', namespace: 'openshift-gitops', uid: 'a1' },
      spec: { source: { repoURL: 'https://github.com/org/repo', path: 'apps/frontend' }, destination: { server: 'https://kubernetes.default.svc', namespace: 'default' }, project: 'default' },
      status: {
        sync: { status: 'Synced', revision: 'abc1234' },
        health: { status: 'Healthy' },
        resources: [{ group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'default', name: 'my-deploy', status: 'Synced' }],
        history: [],
      },
    };

    useArgoCDStore.setState(buildStoreState([app]));

    const { container } = render(
      <MemoryRouter>
        <ResourceHistoryPanel kind="Deployment" namespace="default" name="my-deploy" />
      </MemoryRouter>
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders sync history entries with commit SHAs and timestamps', () => {
    const app = {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'Application',
      metadata: { name: 'frontend', namespace: 'openshift-gitops', uid: 'a1' },
      spec: { source: { repoURL: 'https://github.com/org/repo', path: 'apps/frontend' }, destination: { server: 'https://kubernetes.default.svc', namespace: 'default' }, project: 'default' },
      status: {
        sync: { status: 'Synced', revision: 'abc1234def5678' },
        health: { status: 'Healthy' },
        resources: [{ group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'default', name: 'my-deploy', status: 'Synced' }],
        history: [
          { id: 1, revision: 'aaa1111bbb2222', deployedAt: '2026-03-20T10:00:00Z' },
          { id: 2, revision: 'ccc3333ddd4444', deployedAt: '2026-03-22T15:00:00Z' },
        ],
      },
    };

    useArgoCDStore.setState(buildStoreState([app]));

    render(
      <MemoryRouter>
        <ResourceHistoryPanel kind="Deployment" namespace="default" name="my-deploy" />
      </MemoryRouter>
    );

    // Should show the "Sync History" heading
    expect(screen.getByText('Sync History')).toBeDefined();

    // Should show short SHAs
    expect(screen.getByText('aaa1111')).toBeDefined();
    expect(screen.getByText('ccc3333')).toBeDefined();

    // Should show app name in the subheading
    expect(screen.getByText(/via frontend/)).toBeDefined();
  });

  it('renders commit links for GitHub repos', () => {
    const app = {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'Application',
      metadata: { name: 'backend', namespace: 'openshift-gitops', uid: 'a2' },
      spec: { source: { repoURL: 'https://github.com/org/repo.git', path: 'apps/backend' }, destination: { server: 'https://kubernetes.default.svc', namespace: 'default' }, project: 'default' },
      status: {
        sync: { status: 'Synced', revision: 'fff9999' },
        health: { status: 'Healthy' },
        resources: [{ group: '', version: 'v1', kind: 'Service', namespace: 'default', name: 'my-svc', status: 'Synced' }],
        history: [
          { id: 1, revision: 'eee8888fff0000', deployedAt: '2026-03-21T12:00:00Z' },
        ],
      },
    };

    useArgoCDStore.setState(buildStoreState([app]));

    const { container } = render(
      <MemoryRouter>
        <ResourceHistoryPanel kind="Service" namespace="default" name="my-svc" />
      </MemoryRouter>
    );

    const link = container.querySelector('a[href*="github.com"]');
    expect(link).toBeDefined();
    expect(link?.getAttribute('href')).toBe('https://github.com/org/repo/commit/eee8888fff0000');
  });

  it('sorts history entries with most recent first', () => {
    const app = {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'Application',
      metadata: { name: 'frontend', namespace: 'openshift-gitops', uid: 'a1' },
      spec: { source: { repoURL: 'https://github.com/org/repo' }, destination: { server: 'https://kubernetes.default.svc', namespace: 'default' }, project: 'default' },
      status: {
        sync: { status: 'Synced', revision: 'latest' },
        health: { status: 'Healthy' },
        resources: [{ group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'default', name: 'sorted-deploy', status: 'Synced' }],
        history: [
          { id: 1, revision: '1111111aaaaaa', deployedAt: '2026-01-01T00:00:00Z' },
          { id: 2, revision: '2222222bbbbbb', deployedAt: '2026-03-01T00:00:00Z' },
        ],
      },
    };

    useArgoCDStore.setState(buildStoreState([app]));

    const { container } = render(
      <MemoryRouter>
        <ResourceHistoryPanel kind="Deployment" namespace="default" name="sorted-deploy" />
      </MemoryRouter>
    );

    const shas = container.querySelectorAll('.font-mono');
    const texts = Array.from(shas).map(el => el.textContent?.trim()).filter(Boolean);
    // Most recent (2222222) should appear before older (1111111)
    const idx2 = texts.indexOf('2222222');
    const idx1 = texts.indexOf('1111111');
    expect(idx2).toBeLessThan(idx1);
  });
});
