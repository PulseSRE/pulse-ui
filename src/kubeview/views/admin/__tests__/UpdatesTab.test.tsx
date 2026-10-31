// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import type { ClusterVersion, ClusterOperator, Node, MachineConfigPool, Pod } from '../../../engine/types';
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

let canPatch = true;
vi.mock('../../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: canPatch, isLoading: false }) }));

vi.mock('../../../engine/errorToast', () => ({
  showErrorToast: vi.fn(),
}));

import { UpdatesTab } from '../UpdatesTab';
import { k8sPatch } from '../../../engine/query';
import { showErrorToast } from '../../../engine/errorToast';
import { registerCluster, setActiveClusterId, unregisterCluster } from '../../../engine/clusterConnection';
import { idleClusterVersion, inFlightClusterVersion, operatorsMidUpdate, poolsMidUpdate } from '../../../__fixtures__/clusterVersionUpdates';

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
    machineConfigPools: [],
    pods: [],
    go: vi.fn(),
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
    canPatch = true;
  });

  afterEach(() => {
    cleanup();
  });

  it('shows cluster ID from clusterVersion spec', () => {
    renderTab({ clusterVersion: makeClusterVersion({ spec: { clusterID: 'my-cluster-id' } }) });
    expect(screen.getByText('my-cluster-id')).toBeDefined();
  });

  it('says update status is unknown, not "up to date", when ClusterVersion could not be read', () => {
    renderTab({ clusterVersion: null, availableUpdates: [] });
    expect(screen.queryByText('Cluster is up to date')).toBeNull();
    expect(screen.getByText('Update status unknown')).toBeDefined();
  });

  it('says update status is unknown when CVO could not retrieve updates', () => {
    renderTab({
      availableUpdates: [],
      clusterVersion: makeClusterVersion({ status: { conditions: [{ type: 'RetrievedUpdates', status: 'False', message: 'VersionNotFound' }], history: [] } as never }),
    });
    expect(screen.queryByText('Cluster is up to date')).toBeNull();
    expect(screen.getByText(/could not retrieve available updates: VersionNotFound/)).toBeDefined();
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

  it('shows the actual Degraded condition message on operators, not just a badge, and links to the operator detail page', () => {
    const go = vi.fn();
    const operators: ClusterOperator[] = [{
      apiVersion: 'config.openshift.io/v1', kind: 'ClusterOperator',
      metadata: { name: 'etcd', uid: 'co-etcd', creationTimestamp: '2026-01-01T00:00:00Z' },
      status: {
        conditions: [
          { type: 'Available', status: 'False' },
          { type: 'Degraded', status: 'True', message: 'EtcdMembersDegraded: 1 of 3 members are unhealthy' },
        ],
      },
    }];

    renderTab({ isUpdating: true, operators, go });

    expect(screen.getByText('EtcdMembersDegraded: 1 of 3 members are unhealthy')).toBeDefined();
    fireEvent.click(screen.getByText('etcd'));
    expect(go).toHaveBeenCalledWith('/r/config.openshift.io~v1~clusteroperators/_/etcd', 'etcd');
  });

  // Regression: this is the read-path counterpart to the stale-image write-path
  // fix (#50) — spec.desiredUpdate can also be set directly by other tooling
  // (e.g. `oc adm upgrade`), so the UI must still be able to detect and explain
  // a stuck/no-op update even when this app's own PATCH logic wasn't involved.
  it('shows a stuck-update banner with a working Re-apply button when spec.desiredUpdate silently no-ops', async () => {
    const cv = makeClusterVersion({
      spec: { desiredUpdate: { version: '4.21.28', image: 'quay.io/openshift-release-dev/ocp-release@sha256:oldimage' } },
      status: {
        desired: { version: '4.21.27', image: 'quay.io/openshift-release-dev/ocp-release@sha256:oldimage' },
        conditions: [{ type: 'Progressing', status: 'False', lastTransitionTime: new Date(Date.now() - 10 * 60000).toISOString() }],
        history: [],
      },
    });

    renderTab({
      clusterVersion: cv,
      availableUpdates: [{ version: '4.21.28', image: 'quay.io/openshift-release-dev/ocp-release@sha256:correct-new-image' }],
    });

    expect(screen.getByText(/Update appears stuck/)).toBeDefined();

    const { k8sPatch } = await import('../../../engine/query');
    fireEvent.click(screen.getByText('Re-apply update to 4.21.28'));
    fireEvent.click(screen.getByText('Start Update'));
    await vi.waitFor(() => {
      expect(k8sPatch).toHaveBeenCalledWith(
        '/apis/config.openshift.io/v1/clusterversions/version',
        { spec: { desiredUpdate: { version: '4.21.28', image: 'quay.io/openshift-release-dev/ocp-release@sha256:correct-new-image' } } },
        'application/merge-patch+json',
        'local',
      );
    });
  });

  it('does not show a stuck-update banner while a real update is progressing', () => {
    const cv = makeClusterVersion({
      spec: { desiredUpdate: { version: '4.21.28', image: 'sha256:new' } },
      status: {
        desired: { version: '4.21.27', image: 'sha256:old' },
        conditions: [{ type: 'Progressing', status: 'True', message: 'Working towards 4.21.28', lastTransitionTime: new Date().toISOString() }],
        history: [],
      },
    });
    renderTab({ clusterVersion: cv, isUpdating: true });
    expect(screen.queryByText(/Update appears stuck/)).toBeNull();
  });

  it('shows a PDB drain blocker when it has 0 disruptions allowed and covers a pod on a node mid-rollout', () => {
    const nodes: Node[] = [{
      apiVersion: 'v1', kind: 'Node',
      metadata: {
        name: 'worker-1', uid: 'node-worker-1', creationTimestamp: '2026-01-01T00:00:00Z',
        annotations: {
          'machineconfiguration.openshift.io/state': 'Working',
          'machineconfiguration.openshift.io/desiredConfig': 'rendered-worker-new',
          'machineconfiguration.openshift.io/currentConfig': 'rendered-worker-old',
        },
      },
      status: { conditions: [{ type: 'Ready', status: 'True' }] },
    }];
    const pods: Pod[] = [{
      apiVersion: 'v1', kind: 'Pod',
      metadata: { name: 'checkout-1', namespace: 'checkout', uid: 'pod-1', creationTimestamp: '2026-01-01T00:00:00Z', labels: { app: 'checkout' } },
      spec: { containers: [], nodeName: 'worker-1' },
    }];

    const go = vi.fn();
    renderTab({
      isUpdating: true,
      go,
      nodes,
      pdbs: [{
        apiVersion: 'policy/v1', kind: 'PodDisruptionBudget',
        metadata: { name: 'checkout-pdb', namespace: 'checkout', uid: 'pdb-1' },
        spec: { selector: { matchLabels: { app: 'checkout' } } },
        status: { disruptionsAllowed: 0 },
      }],
      pods,
    });

    expect(screen.getByText('Drain Blockers')).toBeDefined();
    // The blocker and the node in rollout open their objects.
    fireEvent.click(screen.getByRole('button', { name: 'checkout/checkout-pdb' }));
    expect(go).toHaveBeenCalledWith('/r/policy~v1~poddisruptionbudgets/checkout/checkout-pdb', 'checkout-pdb');
    fireEvent.click(screen.getByRole('button', { name: 'worker-1' }));
    expect(go).toHaveBeenCalledWith('/r/v1~nodes/_/worker-1', 'worker-1');
  });

  it('renders the current version, channel and platform', () => {
    renderTab({ cvVersion: '4.15.3', cvChannel: 'stable-4.15', platform: 'AWS' });
    expect(screen.getByText('Current Version')).toBeDefined();
    expect(screen.getAllByText('4.15.3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('stable-4.15').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('AWS')).toBeDefined();
  });

  it('says the cluster is up to date only when CVO retrieved updates and there are none', () => {
    renderTab({ availableUpdates: [], clusterVersion: makeClusterVersion({ status: { conditions: [{ type: 'RetrievedUpdates', status: 'True' }], history: [] } as never }) });
    expect(screen.getByText(/Cluster is up to date/)).toBeDefined();
  });

  describe('update graph', () => {
    function renderGraph(cv = idleClusterVersion(), extra: Partial<UpdatesTabProps> = {}) {
      return renderTab({ clusterVersion: cv, cvVersion: '4.16.3', cvChannel: 'stable-4.16', availableUpdates: cv.status!.availableUpdates!, ...extra });
    }

    it('draws current, installed path and every target coloured by state; nothing is called "Recommended" by position', () => {
      renderGraph();
      expect(screen.getByRole('img', { name: 'Current version 4.16.3' })).toBeDefined();
      expect(screen.getByRole('img', { name: 'Previously installed 4.15.20' })).toBeDefined();
      expect(screen.getByRole('button', { name: '4.16.8 — Recommended' })).toBeDefined();
      expect(screen.getByRole('button', { name: '4.17.2 — Recommended' })).toBeDefined();
      expect(screen.getByRole('button', { name: '4.17.1 — Conditional, 2 risks' })).toBeDefined();
      const edges = Array.from(document.querySelectorAll('[data-edge]')).map((e) => e.getAttribute('data-edge'));
      expect(edges.filter((e) => e === 'conditional')).toHaveLength(1);
      expect(edges.filter((e) => e === 'recommended')).toHaveLength(2);
      expect(edges.filter((e) => e === 'history')).toHaveLength(1);
    });

    it('selecting a conditional target lists its risks with names and links', () => {
      renderGraph();
      fireEvent.click(screen.getByRole('button', { name: '4.17.1 — Conditional, 2 risks' }));
      const panel = screen.getByRole('region', { name: 'Update target 4.17.1' });
      expect(panel.textContent).toContain('OVNInterconnectMigration');
      expect(panel.textContent).toContain('AROBrokenDNSMasq');
      expect(panel.textContent).toContain('Two risks apply to this cluster');
      const links = Array.from(panel.querySelectorAll('a')).map((a) => a.getAttribute('href'));
      expect(links).toEqual(['https://issues.redhat.com/browse/OCPBUGS-1', 'https://issues.redhat.com/browse/OCPBUGS-2']);
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
    it('a recommended target patches version and image together on the cluster it was requested on', async () => {
      renderGraph();
      fireEvent.click(screen.getByRole('button', { name: '4.16.8 — Recommended' }));
      fireEvent.click(screen.getByRole('button', { name: 'Update to 4.16.8' }));
      fireEvent.click(screen.getByText('Start Update'));
      await vi.waitFor(() => expect(k8sPatch).toHaveBeenCalledTimes(1));
      expect(k8sPatch).toHaveBeenCalledWith(
        '/apis/config.openshift.io/v1/clusterversions/version',
        { spec: { desiredUpdate: { version: '4.16.8', image: 'quay.io/ocp@sha256:bbb' } } },
        'application/merge-patch+json',
        'local',
      );
    });

    it('a conditional target needs every risk explicitly accepted, then sends acceptRisks (keeping earlier acceptances)', async () => {
      renderGraph(idleClusterVersion({ acceptRisks: [{ name: 'OlderRisk' }] }));
      fireEvent.click(screen.getByRole('button', { name: '4.17.1 — Conditional, 2 risks' }));
      fireEvent.click(screen.getByRole('button', { name: 'Review risks and update to 4.17.1' }));
      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toContain('Accept 2 risks and update to 4.17.1?');
      const risks = screen.getByRole('list', { name: 'Risks to accept' });
      expect(risks.textContent).toContain('OVNInterconnectMigration');
      expect(risks.textContent).toContain('AROBrokenDNSMasq');
      const confirm = screen.getByRole('button', { name: 'Accept risks and update' }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      fireEvent.click(confirm);
      expect(k8sPatch).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('checkbox'));
      expect(confirm.disabled).toBe(false);
      fireEvent.click(confirm);
      await vi.waitFor(() => expect(k8sPatch).toHaveBeenCalledTimes(1));
      expect(k8sPatch).toHaveBeenCalledWith(
        '/apis/config.openshift.io/v1/clusterversions/version',
        { spec: { desiredUpdate: {
          version: '4.17.1',
          image: 'quay.io/ocp@sha256:ccc',
          acceptRisks: [{ name: 'OlderRisk' }, { name: 'OVNInterconnectMigration' }, { name: 'AROBrokenDNSMasq' }],
        } } },
        'application/merge-patch+json',
        'local',
      );
    });

    it('a rejected patch is reported, not shown as started', async () => {
      vi.mocked(k8sPatch).mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
      renderGraph();
      fireEvent.click(screen.getByRole('button', { name: '4.16.8 — Recommended' }));
      fireEvent.click(screen.getByRole('button', { name: 'Update to 4.16.8' }));
      fireEvent.click(screen.getByText('Start Update'));
      await vi.waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Forbidden' }), 'Update failed'));
    });

    it('does not patch when the active cluster changed after the update was requested', async () => {
      registerCluster({ id: 'other', name: 'Other', connectionType: 'acm-proxy', target: 'other' });
      try {
        renderGraph();
        fireEvent.click(screen.getByRole('button', { name: '4.16.8 — Recommended' }));
        fireEvent.click(screen.getByRole('button', { name: 'Update to 4.16.8' }));
        setActiveClusterId('other');
        fireEvent.click(screen.getByText('Start Update'));
        await vi.waitFor(() => expect(showErrorToast).toHaveBeenCalled());
        expect(k8sPatch).not.toHaveBeenCalled();
      } finally {
        unregisterCluster('other');
      }
    });

    it('a blocked target explains Upgradeable=False and cannot be started', () => {
      renderGraph(idleClusterVersion({ upgradeableFalse: true }));
      fireEvent.click(screen.getByRole('button', { name: '4.17.2 — Blocked' }));
      expect((screen.getByRole('button', { name: 'Update to 4.17.2' }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(/minor-version updates are not allowed while the cluster reports Upgradeable=False/)).toBeDefined();
    });

    it('without permission to patch ClusterVersion the action is disabled and says why', () => {
      canPatch = false;
      renderGraph();
      fireEvent.click(screen.getByRole('button', { name: '4.16.8 — Recommended' }));
      expect((screen.getByRole('button', { name: 'Update to 4.16.8' }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('You do not have permission to patch the ClusterVersion.')).toBeDefined();
      expect(screen.queryByText('Change')).toBeNull();
    });

    it('labels the duration estimate as the last completed update', () => {
      renderGraph();
      fireEvent.click(screen.getByRole('button', { name: '4.16.8 — Recommended' }));
      expect(screen.getByText(/Estimated duration: ~80 min/)).toBeDefined();
      expect(screen.getByText(/based on the last completed update, to 4.16.3/)).toBeDefined();
    });

    it('history is a timeline with real durations, including 0-minute ones', () => {
      const cv = idleClusterVersion();
      cv.status!.history!.push({ state: 'Completed', version: '4.15.19', startedTime: '2026-06-01T10:00:00Z', completionTime: '2026-06-01T10:00:20Z' });
      renderGraph(cv);
      const history = screen.getByRole('region', { name: 'Update history' });
      expect(history.textContent).toContain('80 min');
      expect(history.textContent).toContain('45 min');
      expect(history.textContent).toContain('0 min');
    });

    it('in flight: overall bar from CVO, ClusterOperators at target, pool bars with links, targets from the release being installed', () => {
      const go = vi.fn();
      const cv = inFlightClusterVersion();
      renderTab({
        clusterVersion: cv, cvVersion: '4.16.8', isUpdating: true, availableUpdates: cv.status!.availableUpdates!,
        operators: operatorsMidUpdate, machineConfigPools: poolsMidUpdate, go,
      });
      const progress = screen.getByRole('region', { name: 'Update progress' });
      expect(progress.textContent).toContain('512 of 863 (59%)');
      expect(screen.getByRole('progressbar', { name: 'Overall update progress' }).getAttribute('aria-valuenow')).toBe('59');
      expect(progress.textContent).toContain('ClusterOperators at 4.16.8');
      expect(screen.getByRole('progressbar', { name: 'ClusterOperators at target version' }).getAttribute('aria-valuenow')).toBe('67');
      expect(progress.textContent).toContain('2/5 nodes updated');
      expect(screen.getByRole('progressbar', { name: 'MachineConfigPool worker rollout' }).getAttribute('aria-valuenow')).toBe('40');
      expect(progress.textContent).toContain('About 33 min remaining');
      expect(screen.getByRole('img', { name: 'Installing 4.16.8' })).toBeDefined();
      expect(screen.getByRole('button', { name: '4.16.10 — Recommended' })).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'worker' }));
      expect(go).toHaveBeenCalledWith('/r/machineconfiguration.openshift.io~v1~machineconfigpools/_/worker', 'worker');
      // Starting another update while one runs is not offered.
      fireEvent.click(screen.getByRole('button', { name: '4.16.10 — Recommended' }));
      expect((screen.getByRole('button', { name: 'Update to 4.16.10' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows Failing with its message', () => {
      const cv = idleClusterVersion();
      cv.status!.conditions!.push({ type: 'Failing', status: 'True', message: 'Cluster operator etcd is degraded' });
      renderGraph(cv);
      expect(screen.getByText('Update failing')).toBeDefined();
      expect(screen.getAllByText(/Cluster operator etcd is degraded/).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('channel picker', () => {
    it('offers the next minor channel (needed for a minor update) and eus only for even minors', () => {
      renderTab({ clusterVersion: idleClusterVersion(), cvVersion: '4.16.3', cvChannel: 'stable-4.16' });
      fireEvent.click(screen.getByText('Change'));
      const options = Array.from((screen.getByRole('combobox', { name: 'Update channel' }) as HTMLSelectElement).options).map((o) => o.value);
      expect(options).toContain('stable-4.17');
      expect(options).toContain('eus-4.16');
      expect(options).not.toContain('eus-4.17');
      expect(options).not.toContain('stable-4.15');
    });

    it('uses status.desired.channels when the release lists them, and patches the chosen channel', async () => {
      renderTab({ clusterVersion: idleClusterVersion({ channels: ['fast-4.16', 'stable-4.16', 'stable-4.17'] }), cvVersion: '4.16.3', cvChannel: 'stable-4.16' });
      fireEvent.click(screen.getByText('Change'));
      const select = screen.getByRole('combobox', { name: 'Update channel' }) as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.value)).toEqual(['fast-4.16', 'stable-4.16', 'stable-4.17']);
      fireEvent.change(select, { target: { value: 'stable-4.17' } });
      fireEvent.click(screen.getByText('Save'));
      await vi.waitFor(() => expect(k8sPatch).toHaveBeenCalledWith(
        '/apis/config.openshift.io/v1/clusterversions/version',
        { spec: { channel: 'stable-4.17' } },
        'application/merge-patch+json',
        'local',
      ));
    });

    it('Cancel closes the editor without patching', () => {
      renderTab({ cvVersion: '4.15.3', cvChannel: 'stable-4.15' });
      fireEvent.click(screen.getByText('Change'));
      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByText('Save')).toBeNull();
      expect(k8sPatch).not.toHaveBeenCalled();
    });
  });

  it('a target without a release image cannot be started (a version alone can silently no-op)', () => {
    renderTab({ clusterVersion: makeClusterVersion({ status: { conditions: [{ type: 'RetrievedUpdates', status: 'True' }], history: [] } as never }), availableUpdates: [{ version: '4.15.5' }] });
    fireEvent.click(screen.getByRole('button', { name: '4.15.5 — Recommended' }));
    expect((screen.getByRole('button', { name: 'Update to 4.15.5' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('The update service gave no release image for this version.')).toBeDefined();
  });

});
