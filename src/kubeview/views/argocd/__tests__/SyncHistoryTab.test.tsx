// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

vi.mock('../../../components/primitives/Card', () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
}));

vi.mock('../../../engine/gitUtils', () => ({
  buildCommitUrl: (repoURL: string, revision: string) => `${repoURL}/commit/${revision}`,
}));

vi.mock('../../../engine/dateUtils', () => ({
  timeAgo: () => '5m ago',
}));

import { SyncHistoryTab } from '../SyncHistoryTab';
import type { ArgoApplication } from '../../../engine/types';

function makeApp(name: string, history: any[] = []): ArgoApplication {
  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: { name, namespace: 'argocd', uid: `app-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: {
      source: { repoURL: 'https://github.com/org/repo', path: `apps/${name}`, targetRevision: 'main' },
      destination: { server: 'https://kubernetes.default.svc', namespace: 'default' },
      project: 'default',
    },
    status: {
      sync: { status: 'Synced', revision: 'abc1234' },
      health: { status: 'Healthy' },
      resources: [],
      history,
    },
  };
}

describe('SyncHistoryTab', () => {
  const go = vi.fn();
  afterEach(cleanup);

  it('shows empty state when no history', () => {
    render(<SyncHistoryTab applications={[]} go={go} />);
    expect(screen.getByText('No sync history available')).toBeDefined();
  });

  it('shows empty state when apps have no history', () => {
    render(<SyncHistoryTab applications={[makeApp('myapp')]} go={go} />);
    expect(screen.getByText('No sync history available')).toBeDefined();
  });

  it('renders history entries', () => {
    const app = makeApp('myapp', [
      { id: 1, revision: 'abc1234def5678901234567890abcdef12345678', deployedAt: '2026-01-15T10:00:00Z' },
    ]);
    render(<SyncHistoryTab applications={[app]} go={go} />);
    expect(screen.getByText('myapp')).toBeDefined();
    expect(screen.getByText('abc1234')).toBeDefined();
    expect(screen.getByText('5m ago')).toBeDefined();
  });

  it('renders commit URL as link when repoURL is available', () => {
    const app = makeApp('myapp', [
      { id: 1, revision: 'abc1234def5678901234567890abcdef12345678', deployedAt: '2026-01-15T10:00:00Z' },
    ]);
    render(<SyncHistoryTab applications={[app]} go={go} />);
    const link = screen.getByText('abc1234').closest('a');
    expect(link).toBeDefined();
    expect(link?.getAttribute('href')).toContain('/commit/');
  });

  it('navigates to app on click', () => {
    const app = makeApp('myapp', [
      { id: 1, revision: 'abc1234', deployedAt: '2026-01-15T10:00:00Z' },
    ]);
    render(<SyncHistoryTab applications={[app]} go={go} />);
    fireEvent.click(screen.getByText('myapp'));
    expect(go).toHaveBeenCalledWith(
      '/r/argoproj.io~v1alpha1~applications/argocd/myapp',
      'myapp',
    );
  });

  it('sorts entries by deployedAt descending', () => {
    const app = makeApp('myapp', [
      { id: 1, revision: 'aaa0000', deployedAt: '2026-01-10T10:00:00Z' },
      { id: 2, revision: 'bbb1111', deployedAt: '2026-01-20T10:00:00Z' },
    ]);
    const { container } = render(<SyncHistoryTab applications={[app]} go={go} />);
    const entries = container.querySelectorAll('[class*="flex items-center gap-3 px-4 py-3"]');
    // bbb1111 should come first (more recent)
    const allText = container.textContent || '';
    const idxB = allText.indexOf('bbb1111');
    const idxA = allText.indexOf('aaa0000');
    expect(idxB).toBeLessThan(idxA);
  });

  it('merges history from multiple apps', () => {
    const app1 = makeApp('app1', [
      { id: 1, revision: 'rev1111', deployedAt: '2026-01-15T10:00:00Z' },
    ]);
    const app2 = makeApp('app2', [
      { id: 1, revision: 'rev2222', deployedAt: '2026-01-16T10:00:00Z' },
    ]);
    render(<SyncHistoryTab applications={[app1, app2]} go={go} />);
    expect(screen.getByText('app1')).toBeDefined();
    expect(screen.getByText('app2')).toBeDefined();
  });
});
