// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import type { ClusterVersion } from '../../../engine/types';
import type { UpdatesTabProps } from '../UpdatesTab';

// --- Mocks ---

vi.mock('../../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = { addToast: vi.fn() };
    return selector(state);
  },
}));

vi.mock('../../../engine/query', () => ({
  k8sPatch: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../engine/errorToast', () => ({
  showErrorToast: vi.fn(),
}));

import { UpdatesTab } from '../UpdatesTab';

// --- Helpers ---

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderTab(props: Partial<UpdatesTabProps> = {}) {
  const defaults: UpdatesTabProps = {
    clusterVersion: null,
    cvVersion: '4.15.3',
    cvChannel: 'stable-4.15',
    platform: 'AWS',
    availableUpdates: [],
    isUpdating: false,
    operators: [],
    nodes: [],
    deployments: [],
    pdbs: [],
    etcdBackupExists: false,
    isHyperShift: false,
    ...props,
  };

  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <UpdatesTab {...defaults} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeClusterVersion(overrides: Partial<ClusterVersion> = {}): ClusterVersion {
  return {
    apiVersion: 'config.openshift.io/v1',
    kind: 'ClusterVersion',
    metadata: { name: 'version', uid: 'cv-1', creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: { clusterID: 'cluster-abc-123', channel: 'stable-4.15' },
    status: {
      conditions: [],
      history: [],
    },
    ...overrides,
  };
}

function makeNode(name: string, ready = true) {
  return {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: { name, uid: `node-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
    status: {
      conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
    },
  };
}

function makeOperator(name: string, degraded = false) {
  return {
    apiVersion: 'config.openshift.io/v1',
    kind: 'ClusterOperator',
    metadata: { name, uid: `co-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
    status: {
      conditions: [
        { type: 'Available', status: degraded ? 'False' : 'True' },
        { type: 'Degraded', status: degraded ? 'True' : 'False' },
      ],
    },
  };
}

describe('UpdatesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders current version info', () => {
    renderTab({ cvVersion: '4.15.3', cvChannel: 'stable-4.15', platform: 'AWS' });

    expect(screen.getByText('Current Version')).toBeDefined();
    expect(screen.getByText('4.15.3')).toBeDefined();
    expect(screen.getByText('stable-4.15')).toBeDefined();
    expect(screen.getByText('AWS')).toBeDefined();
  });

  it('shows cluster ID from clusterVersion spec', () => {
    renderTab({ clusterVersion: makeClusterVersion({ spec: { clusterID: 'my-cluster-id' } }) });
    expect(screen.getByText('my-cluster-id')).toBeDefined();
  });

  it('shows up-to-date message when no updates available', () => {
    renderTab({ availableUpdates: [] });
    expect(screen.getByText('Cluster is up to date')).toBeDefined();
  });

  it('renders available updates with version numbers', () => {
    renderTab({
      availableUpdates: [
        { version: '4.15.5' },
        { version: '4.15.4' },
      ],
    });

    expect(screen.getByText('4.15.5')).toBeDefined();
    expect(screen.getByText('4.15.4')).toBeDefined();
    expect(screen.getByText('Recommended')).toBeDefined();
  });

  it('shows known risks badge on updates with risks', () => {
    renderTab({
      availableUpdates: [
        { version: '4.15.5', risks: [{ name: 'risk1', message: 'may break things' }] },
      ],
    });

    expect(screen.getByText('1 known risk')).toBeDefined();
  });

  it('shows update duration estimate based on node count', () => {
    const nodes = [makeNode('node-1'), makeNode('node-2'), makeNode('node-3')];
    renderTab({
      availableUpdates: [{ version: '4.15.5' }],
      nodes: nodes as any,
    });

    expect(screen.getByText(/~30 minutes/)).toBeDefined();
    expect(screen.getByText(/3 nodes/)).toBeDefined();
  });

  it('shows confirmation dialog when Update button is clicked', () => {
    renderTab({ availableUpdates: [{ version: '4.15.5' }] });

    fireEvent.click(screen.getByText('Update'));
    expect(screen.getByText(/Start cluster update to 4.15.5/)).toBeDefined();
    expect(screen.getByText('Start Update')).toBeDefined();
  });

  // Regression: reported "I clicked cluster update but nothing is happening".
  // Root cause: the PATCH used JSON merge-patch semantics, which merges
  // nested objects field-by-field rather than replacing them — sending just
  // { version } left any pre-existing spec.desiredUpdate.image on the live
  // object untouched. ClusterVersion's desiredUpdate.image is authoritative
  // over .version when both are set, so a stale image paired with a new
  // version made the whole update silently a no-op (CVO logs "Update work
  // is equal to current target; no change required" and never starts),
  // while the UI still showed a success toast because the PATCH itself
  // succeeded. Confirmed live on a real cluster: exactly this mismatch.
  it('sends both version and image together so a merge-patch cannot reintroduce a stale image', async () => {
    const { k8sPatch } = await import('../../../engine/query');
    renderTab({
      availableUpdates: [{ version: '4.21.28', image: 'quay.io/openshift-release-dev/ocp-release@sha256:newdigest' }],
    });

    fireEvent.click(screen.getByText('Update'));
    fireEvent.click(screen.getByText('Start Update'));

    await vi.waitFor(() => {
      expect(k8sPatch).toHaveBeenCalledWith(
        '/apis/config.openshift.io/v1/clusterversions/version',
        { spec: { desiredUpdate: { version: '4.21.28', image: 'quay.io/openshift-release-dev/ocp-release@sha256:newdigest' } } },
        'application/merge-patch+json',
      );
    });
  });

  it('refuses to patch (and never silently no-ops) when an available update has no image', async () => {
    const { k8sPatch } = await import('../../../engine/query');
    const { showErrorToast } = await import('../../../engine/errorToast');
    vi.mocked(k8sPatch).mockClear();
    renderTab({
      availableUpdates: [{ version: '4.21.28' }], // no image field
    });

    fireEvent.click(screen.getByText('Update'));
    fireEvent.click(screen.getByText('Start Update'));

    await vi.waitFor(() => {
      expect(showErrorToast).toHaveBeenCalled();
    });
    expect(k8sPatch).not.toHaveBeenCalled();
  });

  it('shows channel change UI when Change button is clicked', () => {
    renderTab({ cvVersion: '4.15.3', cvChannel: 'stable-4.15' });

    fireEvent.click(screen.getByText('Change'));
    // Should now show a select element and Save/Cancel buttons
    expect(screen.getByText('Save')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('hides channel edit on Cancel', () => {
    renderTab({ cvVersion: '4.15.3', cvChannel: 'stable-4.15' });

    fireEvent.click(screen.getByText('Change'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.getByText('Change')).toBeDefined();
  });

  it('shows failing condition banner', () => {
    const cv = makeClusterVersion({
      status: {
        conditions: [
          { type: 'Failing', status: 'True', message: 'Cluster operator etcd is degraded' },
        ],
        history: [],
      },
    });

    renderTab({ clusterVersion: cv });
    expect(screen.getByText('Update Failing')).toBeDefined();
    expect(screen.getByText('Cluster operator etcd is degraded')).toBeDefined();
  });

  it('shows progressing condition banner', () => {
    const cv = makeClusterVersion({
      status: {
        conditions: [
          { type: 'Progressing', status: 'True', message: 'Working towards 4.15.5' },
        ],
        history: [],
      },
    });

    renderTab({ clusterVersion: cv });
    expect(screen.getByText('Update in Progress')).toBeDefined();
    expect(screen.getByText('Working towards 4.15.5')).toBeDefined();
  });

  it('renders update history entries', () => {
    const cv = makeClusterVersion({
      status: {
        conditions: [],
        history: [
          { state: 'Completed', version: '4.15.3', startedTime: '2026-01-01T00:00:00Z', completionTime: '2026-01-01T00:45:00Z' },
          { state: 'Completed', version: '4.15.2', startedTime: '2025-12-15T00:00:00Z', completionTime: '2025-12-15T00:30:00Z' },
        ],
      },
    });

    renderTab({ clusterVersion: cv });
    expect(screen.getByText('Update History')).toBeDefined();
    // 4.15.3 appears both as current version and in history
    expect(screen.getAllByText('4.15.3').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('4.15.2')).toBeDefined();
    expect(screen.getByText('45min')).toBeDefined();
    expect(screen.getAllByText('Completed').length).toBe(2);
  });

  it('shows pre-update checklist when updates are available', () => {
    const nodes = [makeNode('node-1'), makeNode('node-2')];
    const operators = [makeOperator('console'), makeOperator('dns')];

    renderTab({
      availableUpdates: [{ version: '4.15.5' }],
      nodes: nodes as any,
      operators: operators as any,
      cvChannel: 'stable-4.15',
      etcdBackupExists: true,
    });

    expect(screen.getByText('Pre-Update Checklist')).toBeDefined();
    expect(screen.getByText('All nodes ready')).toBeDefined();
    expect(screen.getByText('No degraded operators')).toBeDefined();
    expect(screen.getByText('Stable update channel')).toBeDefined();
    expect(screen.getByText('Etcd backup')).toBeDefined();
    expect(screen.getByText('PodDisruptionBudgets')).toBeDefined();
  });

  it('shows checklist failures for degraded operators', () => {
    const operators = [makeOperator('etcd', true)];

    renderTab({
      availableUpdates: [{ version: '4.15.5' }],
      operators: operators as any,
    });

    expect(screen.getByText(/1 degraded: etcd/)).toBeDefined();
  });

  it('shows checklist failures for unready nodes', () => {
    const nodes = [makeNode('node-1', true), makeNode('node-2', false)];

    renderTab({
      availableUpdates: [{ version: '4.15.5' }],
      nodes: nodes as any,
    });

    expect(screen.getByText(/1\/2 ready/)).toBeDefined();
  });

  it('shows operator update progress when isUpdating is true', () => {
    const operators = [
      makeOperator('console'),
      makeOperator('dns'),
    ];

    renderTab({ isUpdating: true, operators: operators as any });

    expect(screen.getByText('Operator Update Progress')).toBeDefined();
    expect(screen.getByText('console')).toBeDefined();
    expect(screen.getByText('dns')).toBeDefined();
  });

  it('does not show operator progress when isUpdating is false', () => {
    renderTab({ isUpdating: false, operators: [makeOperator('console')] as any });
    expect(screen.queryByText('Operator Update Progress')).toBeNull();
  });

  it('hides pre-update checklist when no updates are available', () => {
    renderTab({ availableUpdates: [] });
    expect(screen.queryByText('Pre-Update Checklist')).toBeNull();
  });

  it('shows etcd backup managed by hosting provider for HyperShift', () => {
    renderTab({
      availableUpdates: [{ version: '4.15.5' }],
      isHyperShift: true,
    });

    expect(screen.getByText('Managed by hosting provider')).toBeDefined();
  });
});
