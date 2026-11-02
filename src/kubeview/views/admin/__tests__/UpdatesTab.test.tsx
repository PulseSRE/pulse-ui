// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import type { ClusterVersion, ClusterOperator, Node, MachineConfigPool, Pod } from '../../../engine/types';
import type { UpdatesTabProps } from '../UpdatesTab';

// --- Mocks ---

const addToastMock = vi.fn();
vi.mock('../../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = { addToast: addToastMock };
    return selector(state);
  },
}));

vi.mock('../../../engine/query', () => ({
  k8sPatch: vi.fn().mockResolvedValue({}),
  k8sCreate: vi.fn().mockResolvedValue({}),
  // Readiness reads answer empty lists; the username lookup answers "alice".
  k8sList: vi.fn().mockResolvedValue([]),
  k8sGet: vi.fn().mockResolvedValue({ metadata: { name: 'alice' } }),
}));

let canPatch = true;
vi.mock('../../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: canPatch, isLoading: false }) }));

vi.mock('../../../engine/askPulse', () => ({ askPulse: vi.fn() }));

vi.mock('../../../engine/errorToast', () => ({
  showErrorToast: vi.fn(),
}));

import { UpdatesTab } from '../UpdatesTab';
import { k8sPatch } from '../../../engine/query';
import { askPulse } from '../../../engine/askPulse';
import { PulseError } from '../../../engine/errors';
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
    pdbs: [],
    firingAlerts: [],
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

const CV_PATH = '/apis/config.openshift.io/v1/clusterversions/version';

/** The non-dry-run ClusterVersion patches sent. */
const cvPatches = () => vi.mocked(k8sPatch).mock.calls.filter(([path]) => path === CV_PATH);

/** Fill the start-update dialog's reason (ticking "update anyway" when blockers are listed) and start. */
async function confirmStart(version: string, reason = 'Monthly z-stream, CHG-1') {
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: reason } });
  const anyway = within(dialog).queryByRole('checkbox', { name: 'I understand and want to update anyway' });
  if (anyway) fireEvent.click(anyway);
  const start = within(dialog).getByRole('button', { name: `Start update to ${version}` }) as HTMLButtonElement;
  await vi.waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  return dialog;
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

  const row = (id: string) => screen.getByTestId(`readiness-${id}`);

  it('readiness: nodes, operators and channel pass from the lists, in a "N passed" line', async () => {
    renderTab({
      clusterVersion: makeClusterVersion(),
      availableUpdates: [{ version: '4.15.5', image: 'quay.io/x@sha256:1' }],
      nodes: [makeNode('node-1'), makeNode('node-2')] as any,
      operators: [makeOperator('console'), makeOperator('dns')] as any,
    });
    expect(screen.getByRole('heading', { name: /to 4\.15\.5$/ })).toBeDefined();
    expect(row('nodes').dataset.status).toBe('passed');
    expect(row('nodes').textContent).toContain('2/2 nodes are Ready');
    expect(row('operators').textContent).toContain('2/2 platform operators');
    expect(row('channel').dataset.status).toBe('passed');
    expect(screen.getByText(/checks? passed: .*nodes ready 2\/2 .*platform operators 2\/2 healthy/)).toBeDefined();
    // A z-stream removes no API.
    expect(row('removed-apis').dataset.status).toBe('passed');
    expect(row('removed-apis').textContent).toMatch(/4\.15\.5 is a z-stream update/);
  });

  it('readiness: a degraded operator and an unready node are blockers; the verdict counts them', () => {
    renderTab({
      clusterVersion: makeClusterVersion(),
      availableUpdates: [{ version: '4.15.5', image: 'quay.io/x@sha256:1' }],
      operators: [makeOperator('etcd', true), makeOperator('dns')] as any,
      nodes: [makeNode('node-1', true), makeNode('node-2', false)] as any,
    });
    expect(row('operators').dataset.status).toBe('blocker');
    expect(row('operators').textContent).toMatch(/1\/2 platform operators healthy\. etcd \(Degraded\)/);
    expect(row('nodes').dataset.status).toBe('blocker');
    expect(row('nodes').textContent).toMatch(/1\/2 nodes are Ready\. Not ready: node-2/);
    expect(screen.getByTestId('upgrade-readiness').dataset.verdict).toBe('not_ready');
    expect(screen.getByRole('heading', { name: 'Not ready to update to 4.15.5' })).toBeDefined();
    expect(screen.getByTestId('readiness-counts').textContent).toMatch(/^\d+ blockers/);
    // The action stays enabled and states the risk.
    expect(screen.getByTestId('update-action-risk').textContent).toMatch(/The update is your call\. With \d+ blockers open/);
    expect((screen.getByRole('button', { name: /Start update/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('readiness: failed reads are Unknown with the reason, never a pass', () => {
    const forbidden = Object.assign(new Error('forbidden'), { status: 403 });
    renderTab({
      clusterVersion: makeClusterVersion(),
      availableUpdates: [{ version: '4.15.5', image: 'quay.io/x@sha256:1' }],
      nodesError: forbidden, operatorsError: forbidden, pdbsError: forbidden,
      firingAlerts: undefined, firingAlertsError: new Error('Prometheus returned 500 Internal Server Error'),
    });
    for (const id of ['nodes', 'operators', 'pdbs']) {
      expect(row(id).dataset.status, id).toBe('unknown');
      expect(row(id).textContent, id).toMatch(/Could not check: .*Permission denied \(403\)/);
    }
    expect(row('alerts').dataset.status).toBe('unknown');
    expect(row('alerts').textContent).toMatch(/Prometheus returned 500/);
    expect(row('etcd-health').dataset.status).toBe('unknown');
    expect(screen.getByTestId('upgrade-readiness').dataset.verdict).not.toBe('ready');
    expect(document.body.textContent).not.toMatch(/Ready to update/);
  });

  it('readiness: a PDB with 0 disruptions covering a pod on a node that will drain is a blocker with Edit PDB', () => {
    const go = vi.fn();
    const node = { ...makeNode('worker-1'), metadata: { ...makeNode('worker-1').metadata, labels: { 'node-role.kubernetes.io/worker': '' } } };
    renderTab({
      go,
      clusterVersion: makeClusterVersion(),
      availableUpdates: [{ version: '4.15.5', image: 'quay.io/x@sha256:1' }],
      nodes: [node] as any,
      pods: [{ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'db-0', namespace: 'payments', uid: 'p', creationTimestamp: '', labels: { app: 'db' } }, spec: { containers: [], nodeName: 'worker-1' } }] as Pod[],
      pdbs: [{ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: { name: 'db', namespace: 'payments', uid: 'pdb' }, spec: { selector: { matchLabels: { app: 'db' } }, minAvailable: 2 }, status: { disruptionsAllowed: 0, currentHealthy: 2 } }],
    });
    expect(row('pdbs').dataset.status).toBe('blocker');
    expect(row('pdbs').textContent).toMatch(/payments\/db requires 2 available \(2 healthy\), so pod db-0 on worker-1 cannot be evicted/);
    fireEvent.click(within(row('pdbs')).getByRole('button', { name: 'Edit PDB' }));
    expect(go).toHaveBeenCalledWith('/yaml/policy~v1~poddisruptionbudgets/payments/db', 'db (YAML)');
  });

  it('readiness: a node only in a paused pool will not drain, so its PDB does not block', () => {
    const node = { ...makeNode('worker-1'), metadata: { ...makeNode('worker-1').metadata, labels: { 'node-role.kubernetes.io/worker': '' } } };
    renderTab({
      clusterVersion: makeClusterVersion(),
      availableUpdates: [{ version: '4.15.5', image: 'quay.io/x@sha256:1' }],
      nodes: [node] as any,
      machineConfigPools: [{ apiVersion: 'machineconfiguration.openshift.io/v1', kind: 'MachineConfigPool', metadata: { name: 'worker', uid: 'w', creationTimestamp: '' }, spec: { paused: true, nodeSelector: { matchLabels: { 'node-role.kubernetes.io/worker': '' } } } }] as MachineConfigPool[],
      pods: [{ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'db-0', namespace: 'payments', uid: 'p', creationTimestamp: '', labels: { app: 'db' } }, spec: { containers: [], nodeName: 'worker-1' } }] as Pod[],
      pdbs: [{ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: { name: 'db', namespace: 'payments', uid: 'pdb' }, spec: { selector: { matchLabels: { app: 'db' } } }, status: { disruptionsAllowed: 0 } }],
    });
    expect(row('pdbs').dataset.status).toBe('passed');
    expect(row('pdbs').textContent).toMatch(/Nodes in paused pool worker are not counted: their nodes will drain when unpaused/);
    expect(screen.getByTestId('worker-pools-paused').textContent).toContain('worker');
  });

  it('readiness: critical alerts are a blocker that links to Alerts filtered to critical', () => {
    const go = vi.fn();
    renderTab({
      go,
      clusterVersion: makeClusterVersion(),
      firingAlerts: [
        { labels: { alertname: 'KubeAPIDown', severity: 'critical' }, state: 'firing' },
        { labels: { alertname: 'Watchdog', severity: 'none' }, state: 'firing' },
      ],
    });
    expect(row('alerts').dataset.status).toBe('blocker');
    expect(row('alerts').textContent).toMatch(/1 critical alert firing: KubeAPIDown/);
    fireEvent.click(within(row('alerts')).getByRole('button', { name: 'View critical alerts' }));
    expect(go).toHaveBeenCalledWith('/alerts?severity=critical', 'Alerts');
  });

  it('readiness: HyperShift etcd and control-plane certificates are managed by the hosting provider', () => {
    renderTab({ clusterVersion: makeClusterVersion(), isHyperShift: true, operators: [makeOperator('dns')] as any });
    expect(row('etcd-backup').textContent).toContain('managed by the hosting provider');
    expect(row('etcd-health').textContent).toContain('managed by the hosting provider');
    expect(row('cp-certs').textContent).toContain('managed by the hosting provider');
  });

  it('Ask Pulse sends the readiness result as chat context', () => {
    renderTab({ clusterVersion: makeClusterVersion(), availableUpdates: [{ version: '4.15.5', image: 'quay.io/x@sha256:1' }], nodes: [makeNode('node-1', false)] as any });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Pulse' }));
    expect(askPulse).toHaveBeenCalledWith(expect.stringMatching(/Not ready to update to 4\.15\.5[\s\S]*- Blocker: Nodes ready: 0\/1 nodes are Ready/), { kind: 'ClusterVersion', name: 'version' });
  });

  it('Ask Pulse is disabled on a remote cluster, with the agent dock\'s reason', async () => {
    const { useFleetStore } = await import('../../../store/fleetStore');
    useFleetStore.setState({ activeClusterId: 'east' });
    try {
      renderTab({ clusterVersion: makeClusterVersion() });
      const ask = screen.getByRole('button', { name: 'Ask Pulse' }) as HTMLButtonElement;
      expect(ask.disabled).toBe(true);
      expect(ask.title).toBe('This agent runs on Local Cluster. Remote resource-context actions are unavailable.');
      expect(screen.getByTestId('readiness-ask-disabled').textContent).toMatch(/runs on Local Cluster/);
      fireEvent.click(ask);
      expect(askPulse).not.toHaveBeenCalled();
    } finally {
      useFleetStore.setState({ activeClusterId: 'local' });
    }
  });

  it('while the ClusterVersion is loading, its checks say Checking…, not Passed or Unknown', () => {
    renderTab({ clusterVersion: null, clusterVersionLoading: true });
    expect(row('channel').dataset.status).toBe('checking');
    expect(row('removed-apis').dataset.status).toBe('checking');
    expect(screen.getByTestId('upgrade-readiness').dataset.verdict).not.toBe('ready');
  });

  it('the stuck-update Re-apply confirm does not list the readiness blockers of a different target', async () => {
    const cv = makeClusterVersion({
      spec: { desiredUpdate: { version: '4.21.28', image: 'quay.io/x@sha256:old' } },
      status: {
        desired: { version: '4.21.27', image: 'quay.io/x@sha256:old' },
        conditions: [{ type: 'Progressing', status: 'False', lastTransitionTime: new Date(Date.now() - 10 * 60000).toISOString() }],
        history: [],
      },
    });
    renderTab({
      clusterVersion: cv,
      nodes: [makeNode('node-1', false)] as any,
      availableUpdates: [{ version: '4.21.28', image: 'quay.io/x@sha256:new' }, { version: '4.21.30', image: 'quay.io/x@sha256:newer' }],
    });
    // Readiness is for the picked target, 4.21.30.
    expect(screen.getByRole('heading', { name: 'Not ready to update to 4.21.30' })).toBeDefined();
    fireEvent.click(screen.getByText('Re-apply update to 4.21.28'));
    expect(within(screen.getByRole('dialog')).queryByTestId('start-update-blockers')).toBeNull();
    expect(within(screen.getByRole('dialog')).getByTestId('start-update-other-target').textContent).toMatch(/checked for 4\.21\.30, not 4\.21\.28/);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: /Start update/ }));
    expect(within(screen.getByRole('dialog')).getByTestId('start-update-blockers').textContent).toMatch(/Nodes ready: 0\/1/);
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
    await confirmStart('4.21.28');
    await vi.waitFor(() => expect(cvPatches()).toHaveLength(1));
    expect(cvPatches()[0][1]).toMatchObject({ spec: { desiredUpdate: { version: '4.21.28', image: 'quay.io/openshift-release-dev/ocp-release@sha256:correct-new-image' } } });
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
    it('a recommended target patches version and image together on the cluster it was requested on, dry run first', async () => {
      renderGraph();
      fireEvent.click(screen.getByRole('button', { name: '4.16.8 — Recommended' }));
      fireEvent.click(screen.getByRole('button', { name: 'Update to 4.16.8' }));
      await confirmStart('4.16.8');
      await vi.waitFor(() => expect(cvPatches()).toHaveLength(1));
      const calls = vi.mocked(k8sPatch).mock.calls;
      expect(calls[0][0]).toBe(`${CV_PATH}?dryRun=All`);
      expect(calls[0][1]).toEqual(calls[1][1]);
      expect(calls[1][0]).toBe(CV_PATH);
      expect(calls[1][1]).toMatchObject({ spec: { desiredUpdate: { version: '4.16.8', image: 'quay.io/ocp@sha256:bbb' } } });
      expect(calls[1][2]).toBe('application/merge-patch+json');
      expect(calls[1][3]).toBe('local');
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
      // Accepting the risks leads to the same start-update confirmation, reason required.
      await confirmStart('4.17.1');
      await vi.waitFor(() => expect(cvPatches()).toHaveLength(1));
      expect(cvPatches()[0][1]).toMatchObject({ spec: { desiredUpdate: {
        version: '4.17.1',
        image: 'quay.io/ocp@sha256:ccc',
        acceptRisks: [{ name: 'OlderRisk' }, { name: 'OVNInterconnectMigration' }, { name: 'AROBrokenDNSMasq' }],
      } } });
      // The PATCH response had no acceptRisks (feature gate off): the toast says so rather than claiming it was recorded.
      await vi.waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success', detail: expect.stringContaining('did not record acceptRisks'),
      })));
    });

    it('says the accepted risks were recorded when the cluster kept them', async () => {
      vi.mocked(k8sPatch).mockResolvedValueOnce({}).mockResolvedValueOnce({ spec: { desiredUpdate: { acceptRisks: [{ name: 'OVNInterconnectMigration' }, { name: 'AROBrokenDNSMasq' }] } } });
      renderGraph();
      fireEvent.click(screen.getByRole('button', { name: '4.17.1 — Conditional, 2 risks' }));
      fireEvent.click(screen.getByRole('button', { name: 'Review risks and update to 4.17.1' }));
      expect(screen.getByRole('dialog').textContent).toContain('recorded only where the ClusterUpdateAcceptRisks feature gate is enabled');
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Accept risks and update' }));
      await confirmStart('4.17.1');
      await vi.waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success', detail: 'Updating to 4.17.1 · accepted risks recorded in spec.desiredUpdate.acceptRisks',
      })));
    });

    it('a rejected dry run is shown in the dialog and nothing is sent', async () => {
      vi.mocked(k8sPatch).mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
      renderGraph();
      fireEvent.click(screen.getByRole('button', { name: '4.16.8 — Recommended' }));
      fireEvent.click(screen.getByRole('button', { name: 'Update to 4.16.8' }));
      const dialog = await confirmStart('4.16.8');
      expect(await within(dialog).findByRole('alert')).toBeDefined();
      expect(within(dialog).getByRole('alert').textContent).toMatch(/Update not started: Forbidden/);
      expect(cvPatches()).toHaveLength(0);
      expect(addToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    it('does not patch when the active cluster changed after the update was requested', async () => {
      registerCluster({ id: 'other', name: 'Other', connectionType: 'acm-proxy', target: 'other' });
      try {
        renderGraph();
        fireEvent.click(screen.getByRole('button', { name: '4.16.8 — Recommended' }));
        fireEvent.click(screen.getByRole('button', { name: 'Update to 4.16.8' }));
        await screen.findByRole('dialog');
        setActiveClusterId('other');
        const dialog = await confirmStart('4.16.8');
        expect(await within(dialog).findByRole('alert')).toBeDefined();
        expect(k8sPatch).not.toHaveBeenCalled();
      } finally {
        setActiveClusterId('local');
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
      expect((screen.getByRole('button', { name: /Start update/ }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getAllByText('You do not have permission to patch the ClusterVersion.').length).toBe(2);
      expect(screen.queryByText('Change')).toBeNull();
    });

    it('labels the duration estimate as the last completed update', () => {
      renderGraph();
      fireEvent.click(screen.getByRole('button', { name: '4.16.8 — Recommended' }));
      expect(screen.getByText(/Estimated duration: ~80 min/)).toBeDefined();
      expect(screen.getByText(/based on the last completed update, to 4.16.3/)).toBeDefined();
    });

    it('history is a table with real durations, including 0-minute ones', () => {
      const cv = idleClusterVersion();
      cv.status!.history!.push({ state: 'Completed', version: '4.15.19', startedTime: '2026-06-01T10:00:00Z', completionTime: '2026-06-01T10:00:20Z' });
      renderGraph(cv);
      const history = screen.getByRole('table', { name: 'Update history' });
      expect(history.textContent).toContain('1h 20m');
      expect(history.textContent).toContain('45m');
      expect(history.textContent).toContain('0m');
      expect(history.textContent).toContain('not recorded');
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
      // Save asks first; nothing is patched until the change is confirmed.
      expect(await screen.findByText('Change update channel from stable-4.16 to stable-4.17?')).toBeDefined();
      expect(k8sPatch).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Change channel' }));
      await vi.waitFor(() => expect(k8sPatch).toHaveBeenCalledWith(
        '/apis/config.openshift.io/v1/clusterversions/version',
        { spec: { channel: 'stable-4.17' } },
        'application/merge-patch+json',
        'local',
      ));
    });

    it('the confirmation says which offered targets stay and which drop out, from their release channels', async () => {
      const cv = idleClusterVersion({ channels: ['stable-4.16', 'fast-4.16'] });
      const availableUpdates = [
        { version: '4.16.8', image: 'quay.io/ocp@sha256:bbb', channels: ['stable-4.16', 'fast-4.16'] },
        { version: '4.17.2', image: 'quay.io/ocp@sha256:ddd', channels: ['stable-4.17'] },
      ];
      renderTab({ clusterVersion: cv, cvVersion: '4.16.3', cvChannel: 'stable-4.16', availableUpdates });
      fireEvent.click(screen.getByText('Change'));
      fireEvent.change(screen.getByRole('combobox', { name: 'Update channel' }), { target: { value: 'fast-4.16' } });
      fireEvent.click(screen.getByText('Save'));
      const impact = await screen.findByTestId('channel-change-impact');
      expect(impact.textContent).toMatch(/Still offered \(their release lists fast-4\.16\): 4\.16\.8/);
      expect(impact.textContent).toMatch(/No longer offered \(their release does not list fast-4\.16\): 4\.17\.2/);
      // The conditional 4.17.1 carries no channel list: unknown, not "kept".
      expect(impact.textContent).toMatch(/Not known \(the release metadata lists no channels\): 4\.17\.1/);
      expect(impact.textContent).toMatch(/Updates only in fast-4\.16 appear after the cluster refreshes/);
    });

    it('when the cluster\'s channel list does not include the new channel, warns that updates may disappear instead of "still offered"', async () => {
      // No status.desired.channels: the picker offers generated channels, and
      // whether 4.16.3 is in stable-4.17 is not known.
      const cv = idleClusterVersion();
      const availableUpdates = [{ version: '4.17.2', image: 'quay.io/ocp@sha256:ddd', channels: ['stable-4.17'] }];
      renderTab({ clusterVersion: cv, cvVersion: '4.16.3', cvChannel: 'stable-4.16', availableUpdates });
      fireEvent.click(screen.getByText('Change'));
      fireEvent.change(screen.getByRole('combobox', { name: 'Update channel' }), { target: { value: 'stable-4.17' } });
      fireEvent.click(screen.getByText('Save'));
      const impact = await screen.findByTestId('channel-change-impact');
      expect(within(impact).getByRole('alert').textContent).toMatch(/does not show whether the installed release \(4\.16\.3\) is in stable-4\.17\. Updates may disappear until the cluster's version is in that channel\./);
      expect(impact.textContent).not.toMatch(/Still offered/);
      expect(impact.textContent).toMatch(/Their release lists stable-4\.17, but they may not be offered: 4\.17\.2/);
    });

    it('says "still offered" only when the cluster\'s channel list includes the new channel', async () => {
      const cv = idleClusterVersion({ channels: ['stable-4.16', 'fast-4.16'] });
      const availableUpdates = [{ version: '4.16.8', image: 'quay.io/ocp@sha256:bbb', channels: ['stable-4.16', 'fast-4.16'] }];
      renderTab({ clusterVersion: cv, cvVersion: '4.16.3', cvChannel: 'stable-4.16', availableUpdates });
      fireEvent.click(screen.getByText('Change'));
      fireEvent.change(screen.getByRole('combobox', { name: 'Update channel' }), { target: { value: 'fast-4.16' } });
      fireEvent.click(screen.getByText('Save'));
      const impact = await screen.findByTestId('channel-change-impact');
      expect(within(impact).queryByRole('alert')).toBeNull();
      expect(impact.textContent).toMatch(/Still offered \(their release lists fast-4\.16\): 4\.16\.8/);
    });

    it('cancelling the channel confirmation sends nothing', async () => {
      renderTab({ clusterVersion: idleClusterVersion(), cvVersion: '4.16.3', cvChannel: 'stable-4.16' });
      fireEvent.click(screen.getByText('Change'));
      fireEvent.change(screen.getByRole('combobox', { name: 'Update channel' }), { target: { value: 'fast-4.16' } });
      fireEvent.click(screen.getByText('Save'));
      await screen.findByText('Change update channel from stable-4.16 to fast-4.16?');
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText('Change update channel from stable-4.16 to fast-4.16?')).toBeNull();
      expect(k8sPatch).not.toHaveBeenCalled();
    });

    it('without permission to patch the ClusterVersion there is no Change button', () => {
      canPatch = false;
      renderTab({ clusterVersion: idleClusterVersion(), cvVersion: '4.16.3', cvChannel: 'stable-4.16' });
      expect(screen.queryByText('Change')).toBeNull();
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
    expect((screen.getByRole('button', { name: /Start update/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('The update service gave no release image for this version.').length).toBe(2);
  });

});

describe('UpdatesTab — pause and resume a MachineConfigPool', () => {
  const MCP_PATH = (n: string) => `/apis/machineconfiguration.openshift.io/v1/machineconfigpools/${n}`;
  const pools = () => poolsMidUpdate.map((p, i) => ({ ...p, metadata: { ...p.metadata, resourceVersion: `rv-${i}` } })) as MachineConfigPool[];
  const inFlight = () => {
    const cv = inFlightClusterVersion();
    return { clusterVersion: cv, cvVersion: '4.16.8', isUpdating: true, availableUpdates: cv.status!.availableUpdates!, operators: operatorsMidUpdate, machineConfigPools: pools() };
  };
  beforeEach(() => { vi.clearAllMocks(); canPatch = true; setActiveClusterId('local'); });
  afterEach(cleanup);

  it('in flight: pausing a pool row explains the effect, then patches spec.paused conditional on the shown resourceVersion', async () => {
    renderTab(inFlight());
    const progress = screen.getByRole('region', { name: 'Update progress' });
    fireEvent.click(within(progress).getByRole('button', { name: 'Pause MachineConfigPool master' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Node updates stop for this pool/);
    expect(dialog.textContent).toMatch(/rotated certificates .* do not reach nodes in a paused pool, and kubelet certificates can expire/);
    expect(dialog.textContent).not.toMatch(/Certificates still rotate/);
    expect(dialog.textContent).toMatch(/Do not leave the pool paused for long/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await vi.waitFor(() => expect(k8sPatch).toHaveBeenCalledTimes(1));
    expect(k8sPatch).toHaveBeenCalledWith(MCP_PATH('master'), { metadata: { resourceVersion: 'rv-0' }, spec: { paused: true } }, 'application/merge-patch+json', 'local');
    await vi.waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: 'MachineConfigPool "master" paused' })));
    // No separate pool list during an update: the progress rows carry the action.
    expect(screen.queryByRole('list', { name: 'MachineConfigPools' })).toBeNull();
  });

  it('between updates: pools are listed with Unpause for a paused pool', async () => {
    const cv = idleClusterVersion();
    renderTab({ clusterVersion: cv, cvVersion: '4.16.3', machineConfigPools: pools() });
    const list = screen.getByRole('list', { name: 'MachineConfigPools' });
    expect(list.textContent).toContain('Paused');
    fireEvent.click(within(list).getByRole('button', { name: 'Unpause MachineConfigPool worker' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/drained and rebooted one at a time/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unpause' }));
    await vi.waitFor(() => expect(k8sPatch).toHaveBeenCalledWith(MCP_PATH('worker'), { metadata: { resourceVersion: 'rv-1' }, spec: { paused: false } }, 'application/merge-patch+json', 'local'));
  });

  it('a pool changed since it was shown is not overwritten, and the dialog says so', async () => {
    vi.mocked(k8sPatch).mockRejectedValueOnce(new PulseError({ message: 'the object has been modified', category: 'conflict' as never, statusCode: 409, context: {} as never, userMessage: 'Conflict', suggestions: [] }));
    renderTab(inFlight());
    fireEvent.click(screen.getByRole('button', { name: 'Pause MachineConfigPool master' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Pause' }));
    expect(await within(screen.getByRole('dialog')).findByText(/The object changed since this page loaded it, so nothing was changed/)).toBeDefined();
    expect(addToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('is disabled without permission to patch MachineConfigPools', () => {
    canPatch = false;
    renderTab(inFlight());
    const btn = screen.getByRole('button', { name: 'Pause MachineConfigPool master' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('You do not have permission to change MachineConfigPools');
  });

  it('does not write when the active cluster changed after the dialog opened', async () => {
    registerCluster({ id: 'other', name: 'Other', connectionType: 'acm-proxy', target: 'other' });
    try {
      renderTab(inFlight());
      fireEvent.click(screen.getByRole('button', { name: 'Pause MachineConfigPool master' }));
      const dialog = await screen.findByRole('dialog');
      setActiveClusterId('other');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
      expect(await within(screen.getByRole('dialog')).findByText(/was not run/)).toBeDefined();
      expect(k8sPatch).not.toHaveBeenCalled();
    } finally {
      setActiveClusterId('local');
      unregisterCluster('other');
    }
  });
});
