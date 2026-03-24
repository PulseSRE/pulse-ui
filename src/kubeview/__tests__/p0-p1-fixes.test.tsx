/**
 * Tests for P0 and P1 fixes from architecture/PM/design review.
 *
 * P0: ConfirmDialog focus, Command Palette paths, keyboard shortcuts getState(),
 *     namespace-scoped API, targeted cache invalidation, no native confirm()
 * P1: Icon registry, bulk delete parallel, discovery TTL, IssueRow severity,
 *     skeleton loading, autoDetectColumns stability, consistent data fetching
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src/kubeview');

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(SRC, relativePath), 'utf-8');
}

// ===== P0: ConfirmDialog focuses Cancel for danger =====

import { ConfirmDialog } from '../components/feedback/ConfirmDialog';

describe('P0: ConfirmDialog focus behavior', () => {
  it('focuses Cancel button for danger variant', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete resource?"
        description="This cannot be undone."
        variant="danger"
      />
    );
    const cancelButton = screen.getByText('Cancel');
    expect(document.activeElement).toBe(cancelButton);
  });

  it('focuses Confirm button for warning variant', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Start update?"
        description="This will restart nodes."
        confirmLabel="Start Update"
        variant="warning"
      />
    );
    const confirmButton = screen.getByText('Start Update');
    expect(document.activeElement).toBe(confirmButton);
  });

  it('does not render when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete?"
        description="Gone forever."
      />
    );
    expect(screen.queryByText('Delete?')).toBeNull();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog open={true} onClose={onClose} onConfirm={vi.fn()} title="Delete?" description="Sure?" />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on Escape when loading', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog open={true} onClose={onClose} onConfirm={vi.fn()} title="Delete?" description="Sure?" loading={true} />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ===== P0: useKeyboardShortcuts uses getState() =====

describe('P0: useKeyboardShortcuts uses getState()', () => {
  it('reads state at event time, not via reactive subscription', () => {
    const source = readSrc('hooks/useKeyboardShortcuts.ts');

    // Should use getState() for reading state at event time
    expect(source).toContain('useUIStore.getState()');

    // Should NOT destructure from useUIStore() (which subscribes to full store)
    expect(source).not.toMatch(/const\s*\{[^}]*\}\s*=\s*useUIStore\(\)/);

    // Should have empty dependency array
    expect(source).toContain('}, []);');
  });
});

// ===== P0: No native confirm() =====

describe('P0: No native confirm() calls', () => {
  it('AdminView uses ConfirmDialog not native confirm()', () => {
    // ConfirmDialog usage has been extracted into admin sub-components (UpdatesTab, SnapshotsTab)
    const adminSource = readSrc('views/AdminView.tsx');
    const adminCodeLines = adminSource.split('\n').filter(l => !l.trim().startsWith('//'));
    const hasNativeConfirm = adminCodeLines.some(l => /[^.]\bconfirm\s*\(/.test(l) && !l.includes('onConfirm') && !l.includes('confirmDialog') && !l.includes('confirmLabel') && !l.includes('confirmButtonRef'));
    expect(hasNativeConfirm).toBe(false);

    // Sub-components that handle confirmations must import ConfirmDialog
    const updatesSource = readSrc('views/admin/UpdatesTab.tsx');
    expect(updatesSource).toContain("import { ConfirmDialog }");
    const snapshotsSource = readSrc('views/admin/SnapshotsTab.tsx');
    expect(snapshotsSource).toContain("import { ConfirmDialog }");
  });

  it('ClusterConfig uses ConfirmDialog not native confirm()', () => {
    const source = readSrc('components/ClusterConfig.tsx');
    const codeLines = source.split('\n').filter(l => !l.trim().startsWith('//'));
    const hasNativeConfirm = codeLines.some(l => /[^.]\bconfirm\s*\(/.test(l) && !l.includes('onConfirm') && !l.includes('confirmDialog') && !l.includes('confirmLabel') && !l.includes('confirmButtonRef'));
    expect(hasNativeConfirm).toBe(false);
    expect(source).toContain("import { ConfirmDialog }");
  });
});

// ===== P0: Command Palette items have paths =====

describe('P0: Command Palette action/query items have paths', () => {
  it('action mode items have path properties', () => {
    const source = readSrc('components/CommandPalette.tsx');
    // Action items should be type 'nav' with path, not dead-end 'action' type
    expect(source).not.toMatch(/type:\s*'action'\s*as\s*const/);

    // Scale, restart, delete items should have path
    const scaleMatch = source.match(/id:\s*'scale'[\s\S]*?path:\s*'([^']+)'/);
    expect(scaleMatch).not.toBeNull();
    expect(scaleMatch![1]).toContain('/r/');

    const deleteMatch = source.match(/id:\s*'delete'[\s\S]*?path:\s*'([^']+)'/);
    expect(deleteMatch).not.toBeNull();
  });

  it('query mode items have path properties', () => {
    const source = readSrc('components/CommandPalette.tsx');

    const failingMatch = source.match(/id:\s*'failing-pods'[\s\S]*?path:\s*'([^']+)'/);
    expect(failingMatch).not.toBeNull();
    expect(failingMatch![1]).toBe('/pulse');

    const memoryMatch = source.match(/id:\s*'high-memory'[\s\S]*?path:\s*'([^']+)'/);
    expect(memoryMatch).not.toBeNull();
  });
});

// ===== P0: Namespace-scoped API calls =====

describe('P0: Namespace-scoped API calls', () => {
  it('PulseView passes namespace to useK8sListWatch for pods', () => {
    const source = readSrc('views/PulseView.tsx');
    expect(source).toContain("useK8sListWatch({ apiPath: '/api/v1/pods', namespace: nsFilter }");
  });

  it('PulseView does not pass namespace for cluster-scoped resources', () => {
    const source = readSrc('views/PulseView.tsx');
    // Nodes and operators are cluster-scoped, should not have namespace
    expect(source).toMatch(/useK8sListWatch\(\{\s*apiPath:\s*'\/api\/v1\/nodes'\s*\}\)/);
  });
});

// ===== P0: Targeted cache invalidation =====

describe('P0: Targeted cache invalidation', () => {
  it('TableView invalidates specific apiPath', () => {
    const source = readSrc('views/TableView.tsx');
    expect(source).not.toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['k8s',\s*'list'\]\s*\}\)/);
    expect(source).toContain("queryKey: ['k8s', 'list', apiPath]");
  });

  it('DetailView invalidates specific listApiPath', () => {
    const source = readSrc('views/DetailView.tsx');
    expect(source).not.toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['k8s',\s*'list'\]\s*\}\)/);
    expect(source).toContain("queryKey: ['k8s', 'list', listApiPath]");
  });
});

// ===== P0: hasGitOps variable ordering =====

describe('P0: ProductionReadiness hasGitOps ordering', () => {
  it('hasGitOps is declared before it is used', () => {
    const source = readSrc('components/ProductionReadiness.tsx');
    const declLine = source.indexOf('const hasGitOps = ');
    const useLine = source.indexOf("status: hasGitOps ?");
    expect(declLine).toBeGreaterThan(-1);
    expect(useLine).toBeGreaterThan(-1);
    expect(declLine).toBeLessThan(useLine);
  });
});

// ===== P1: Icon registry =====

describe('P1: Icon registry replaces import * as Icons', () => {
  it('no component files use import * as Icons', () => {
    const files = ['components/CommandPalette.tsx', 'components/ResourceBrowser.tsx', 'components/TabBar.tsx'];
    for (const file of files) {
      const source = readSrc(file);
      expect(source).not.toContain('import * as Icons');
    }
  });

  it('icon registry exports getResourceIcon', async () => {
    const { getResourceIcon } = await import('../engine/iconRegistry');
    expect(typeof getResourceIcon).toBe('function');
    const icon = getResourceIcon('Box');
    expect(icon).toBeDefined();
  });
});

// ===== P1: Bulk delete parallel =====

describe('P1: Bulk delete is parallel', () => {
  it('uses Promise.allSettled not sequential loop', () => {
    const source = readSrc('views/TableView.tsx');
    expect(source).toContain('Promise.allSettled');
    // Should NOT have a sequential for loop with await k8sDelete
    expect(source).not.toMatch(/for\s*\(let\s+idx[\s\S]*?await\s+k8sDelete/);
  });
});

// ===== P1: Skeleton loading =====

describe('P1: Skeleton loading in core views', () => {
  it('TableView uses skeleton animation', () => {
    const source = readSrc('views/TableView.tsx');
    expect(source).toContain('animate-pulse');
    expect(source).not.toMatch(/>Loading\.\.\.</);
  });

  it('DetailView uses skeleton animation', () => {
    const source = readSrc('views/DetailView.tsx');
    expect(source).toContain('animate-pulse');
    expect(source).not.toMatch(/>Loading\.\.\.</);
  });
});

// ===== P1: Discovery cache TTL =====

describe('P1: Discovery cache TTL', () => {
  it('exports invalidateDiscoveryCache', async () => {
    const { invalidateDiscoveryCache } = await import('../engine/discovery');
    expect(typeof invalidateDiscoveryCache).toBe('function');
    expect(() => invalidateDiscoveryCache()).not.toThrow();
  });

  it('has a CACHE_TTL constant', () => {
    const source = readSrc('engine/discovery.ts');
    expect(source).toContain('CACHE_TTL');
    expect(source).toMatch(/5\s*\*\s*60\s*\*\s*1000/); // 5 minutes
  });
});

// ===== P1: Consistent data fetching =====

describe('P1: Consistent useK8sListWatch usage', () => {
  it('WorkloadsView uses useK8sListWatch', () => {
    const source = readSrc('views/WorkloadsView.tsx');
    expect(source).toContain('useK8sListWatch');
    expect(source).not.toContain("from '@tanstack/react-query'");
  });

  it('BuildsView uses useK8sListWatch for core resources', () => {
    const source = readSrc('views/BuildsView.tsx');
    expect(source).toContain("useK8sListWatch({ apiPath: '/apis/build.openshift.io/v1/builds'");
    expect(source).toContain("useK8sListWatch({ apiPath: '/apis/build.openshift.io/v1/buildconfigs'");
  });
});

// ===== P1: Issue severity colors =====

describe('P1: Issue severity-based colors', () => {
  it('Pulse report uses severity-based colors for attention items', () => {
    const source = readSrc('views/pulse/ReportTab.tsx');
    expect(source).toContain("severity === 'critical'");
    expect(source).toContain('text-red-400');
    expect(source).toContain('text-amber-400');
  });
});

// ===== P1: Page header consistency =====

describe('P1: Consistent page headers', () => {
  it('WelcomeView does not use text-4xl', () => {
    const source = readSrc('views/WelcomeView.tsx');
    expect(source).not.toContain('text-4xl');
  });

  it('TableView uses text-2xl for page header', () => {
    const source = readSrc('views/TableView.tsx');
    expect(source).toContain('text-2xl font-bold');
  });
});

// ===== P1: Operator catalog pagination =====

describe('P1: Operator catalog Show More', () => {
  it('does not hard-cap at 60 items', () => {
    const source = readSrc('views/OperatorCatalogView.tsx');
    expect(source).not.toContain('.slice(0, 60)');
    expect(source).toContain('visibleCount');
    expect(source).toContain('Show more');
  });
});

// ===== P1: Responsive CommandBar =====

describe('P1: CommandBar improvements', () => {
  it('uses responsive search width', () => {
    const source = readSrc('components/CommandBar.tsx');
    expect(source).toContain('w-48');
    expect(source).toContain('md:w-72');
  });

  it('fetches real user identity', () => {
    const source = readSrc('components/CommandBar.tsx');
    expect(source).toContain('user.openshift.io');
    expect(source).toContain('clusterInfo?.username');
  });
});

// ===== P1: autoDetectColumns memoization =====

describe('P1: autoDetectColumns memoization', () => {
  it('uses columnStructureKey for stable memoization', () => {
    const source = readSrc('views/TableView.tsx');
    expect(source).toContain('columnStructureKey');
    // Columns depend on columnStructureKey, not stampedResources directly
    expect(source).toMatch(/getColumnsForResource\(gvrKey, isNamespaced, stampedResources\)/);
    expect(source).toMatch(/\[gvrKey, isNamespaced, columnStructureKey\]/);
  });
});

// ===== P1: Helm catalog labeling =====

describe('P1: Helm catalog uses real repos', () => {
  it('fetches charts from HelmChartRepository CRDs', () => {
    const source = readSrc('views/create/HelmTab.tsx');
    expect(source).toContain('helmchartrepositories');
    expect(source).toContain('HelmChartRepository');
  });
});
