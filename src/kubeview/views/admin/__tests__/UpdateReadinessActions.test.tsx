// @vitest-environment jsdom
/**
 * Admin › Updates (Wave 14): the start-update dialog and its log annotation,
 * update history with who/why, readiness fix actions (take an etcd backup,
 * pause worker pools), and stuck-operator / drain-blocker detail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { ClusterOperator, MachineConfigPool, Node, Pod } from '../../../engine/types';
import type { UpdatesTabProps } from '../UpdatesTab';

const addToastMock = vi.fn();
vi.mock('../../../store/uiStore', () => ({
  useUIStore: (selector: (s: unknown) => unknown) => selector({ addToast: addToastMock }),
}));

const listByPath: Record<string, unknown[] | Error> = {};
vi.mock('../../../engine/query', () => ({
  k8sPatch: vi.fn().mockResolvedValue({}),
  k8sCreate: vi.fn().mockResolvedValue({}),
  k8sList: vi.fn(async (path: string) => {
    const key = Object.keys(listByPath).find((k) => path.includes(k));
    const v = key ? listByPath[key] : [];
    if (v instanceof Error) throw v;
    return v;
  }),
  k8sGet: vi.fn().mockResolvedValue({ metadata: { name: 'alice' } }),
}));

let canI = true;
vi.mock('../../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: canI, isLoading: false }) }));
vi.mock('../../../engine/errorToast', () => ({ showErrorToast: vi.fn() }));
vi.mock('../../../engine/askPulse', () => ({ askPulse: vi.fn() }));

import { UpdatesTab } from '../UpdatesTab';
import { k8sPatch, k8sCreate } from '../../../engine/query';
import { setActiveClusterId } from '../../../engine/clusterConnection';
import { idleClusterVersion, inFlightClusterVersion } from '../../../__fixtures__/clusterVersionUpdates';
import { UPDATE_LOG_ANNOTATION } from '../../../engine/upgradeLog';

const CV_PATH = '/apis/config.openshift.io/v1/clusterversions/version';
const cvPatches = () => vi.mocked(k8sPatch).mock.calls.filter(([p]) => p === CV_PATH);

function renderTab(props: Partial<UpdatesTabProps> = {}) {
  const cv = props.clusterVersion ?? idleClusterVersion();
  const defaults: UpdatesTabProps = {
    clusterVersion: cv, cvVersion: '4.16.3', cvChannel: 'stable-4.16', platform: 'AWS',
    availableUpdates: cv?.status?.availableUpdates ?? [], isUpdating: false,
    operators: [], nodes: [], pdbs: [], isHyperShift: false, machineConfigPools: [], pods: [], firingAlerts: [], go: vi.fn(),
    ...props,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><UpdatesTab {...defaults} /></MemoryRouter></QueryClientProvider>);
}

const notReadyNode = { apiVersion: 'v1', kind: 'Node', metadata: { name: 'w1', uid: 'w1', creationTimestamp: '' }, status: { conditions: [{ type: 'Ready', status: 'False' }] } } as Node;
const pool = (name: string, paused = false, rv = '1') => ({
  apiVersion: 'machineconfiguration.openshift.io/v1', kind: 'MachineConfigPool',
  metadata: { name, uid: name, creationTimestamp: '', resourceVersion: rv },
  spec: { paused, nodeSelector: { matchLabels: { [`node-role.kubernetes.io/${name}`]: '' } } },
  status: { machineCount: 3, updatedMachineCount: 3 },
}) as MachineConfigPool;

async function openStart() {
  const btn = screen.getByRole('button', { name: /Start update/ }) as HTMLButtonElement;
  await vi.waitFor(() => expect(btn.disabled).toBe(false));
  fireEvent.click(btn);
  return screen.findByRole('dialog');
}

beforeEach(() => {
  vi.clearAllMocks();
  canI = true;
  for (const k of Object.keys(listByPath)) delete listByPath[k];
  setActiveClusterId('local');
});
afterEach(cleanup);

describe('Start update dialog', () => {
  it('with blockers: lists them and needs a reason and "update anyway"; minor target says it cannot be rolled back', async () => {
    renderTab({ nodes: [notReadyNode], machineConfigPools: [pool('master'), pool('worker', true)] });
    expect(screen.getByRole('heading', { name: 'Update to 4.17.2' })).toBeDefined();
    const dialog = await openStart();
    expect(dialog.textContent).toMatch(/from 4\.16\.3 to 4\.17\.2\?/);
    expect(dialog.textContent).toMatch(/estimated about 1h 20m based on the last update/);
    expect(within(dialog).getByTestId('start-update-blockers').textContent).toMatch(/Nodes ready: 0\/1 nodes are Ready/);
    expect(within(dialog).getByTestId('start-update-undo').textContent).toBe("No. Minor updates can't be rolled back.");
    expect(within(dialog).getByTestId('start-update-pools').textContent).toBe('master updates with the control plane · worker paused');
    await vi.waitFor(() => expect(dialog.textContent).toMatch(/Recorded as started by alice/));
    const start = within(dialog).getByRole('button', { name: 'Start update to 4.17.2' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'I understand and want to update anyway' }));
    expect(start.disabled).toBe(true); // a blank reason is not a reason
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'Quarterly minor; CHG-2041' } });
    expect(start.disabled).toBe(false);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'I understand and want to update anyway' }));
    expect(start.disabled).toBe(true);
  });

  it('writes desiredUpdate and the update-log annotation in one merge patch, appending and keeping the last 50', async () => {
    const cv = idleClusterVersion();
    const old = Array.from({ length: 50 }, (_, i) => ({ version: `4.15.${i}`, startedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`, by: 'bob', reason: `r${i}` }));
    cv.metadata.annotations = { [UPDATE_LOG_ANNOTATION]: JSON.stringify(old) };
    renderTab({ clusterVersion: cv });
    const dialog = await openStart();
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'Quarterly minor; CHG-2041' } });
    const start = within(dialog).getByRole('button', { name: 'Start update to 4.17.2' }) as HTMLButtonElement;
    await vi.waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await vi.waitFor(() => expect(cvPatches()).toHaveLength(1));
    const [dry, real] = vi.mocked(k8sPatch).mock.calls;
    expect(dry[0]).toBe(`${CV_PATH}?dryRun=All`);
    expect(real[1]).toEqual(dry[1]);
    const patch = real[1] as { metadata: { annotations: Record<string, string> }; spec: unknown };
    expect(patch.spec).toEqual({ desiredUpdate: { version: '4.17.2', image: 'quay.io/ocp@sha256:ddd' } });
    const log = JSON.parse(patch.metadata.annotations[UPDATE_LOG_ANNOTATION]);
    expect(log).toHaveLength(50);
    expect(log[0].version).toBe('4.15.1');
    expect(log[49]).toMatchObject({ version: '4.17.2', by: 'alice', reason: 'Quarterly minor; CHG-2041' });
    expect(Date.parse(log[49].startedAt)).not.toBeNaN();
    expect(real[2]).toBe('application/merge-patch+json');
    await vi.waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: 'Cluster update started' })));
  });

  it('a z-stream target: no blocker box when ready, and says OpenShift does not support rolling back', async () => {
    renderTab();
    fireEvent.change(screen.getByRole('combobox', { name: 'Update target' }), { target: { value: '4.16.8' } });
    expect(screen.getByRole('heading', { name: 'Update to 4.16.8' })).toBeDefined();
    const dialog = await openStart();
    expect(within(dialog).getByTestId('start-update-undo').textContent).toBe('No. OpenShift does not support rolling back an update.');
  });

  it('cancel sends nothing', async () => {
    renderTab();
    const dialog = await openStart();
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(k8sPatch).not.toHaveBeenCalled();
  });

  it('a 403 on the real patch stays in the dialog; no success toast', async () => {
    vi.mocked(k8sPatch).mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error('clusterversions "version" is forbidden'), { status: 403 }));
    renderTab();
    const dialog = await openStart();
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'x' } });
    const start = within(dialog).getByRole('button', { name: 'Start update to 4.17.2' }) as HTMLButtonElement;
    await vi.waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/Update not started: .*forbidden/);
    expect(addToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });
});

describe('Update history', () => {
  it('shows who started each update and why from the log; older entries are "not recorded"', () => {
    const cv = idleClusterVersion();
    cv.metadata.annotations = { [UPDATE_LOG_ANNOTATION]: JSON.stringify([{ version: '4.16.3', startedAt: '2026-09-01T09:59:00Z', by: 'alice', reason: 'Monthly z-stream' }]) };
    renderTab({ clusterVersion: cv });
    const rows = within(screen.getByRole('table', { name: 'Update history' })).getAllByRole('row');
    expect(rows[1].textContent).toMatch(/4\.16\.3.*1h 20m.*alice.*Monthly z-stream.*Completed/);
    expect(rows[2].textContent).toMatch(/4\.15\.20.*45m.*not recorded.*not recorded/);
  });

  it('pages through the full history, 10 at a time', () => {
    const cv = idleClusterVersion();
    cv.status!.history = Array.from({ length: 23 }, (_, i) => ({ state: 'Completed', version: `4.14.${23 - i}`, startedTime: '2026-01-01T00:00:00Z', completionTime: '2026-01-01T01:00:00Z' }));
    renderTab({ clusterVersion: cv });
    const table = () => screen.getByRole('table', { name: 'Update history' });
    expect(within(table()).getAllByRole('row')).toHaveLength(11);
    expect(screen.getByText('1–10 of 23')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('21–23 of 23')).toBeDefined();
    expect(table().textContent).toContain('4.14.1');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Take etcd backup now', () => {
  it('when the EtcdBackup API is served and a PVC exists: confirms, dry-runs, then creates the EtcdBackup', async () => {
    listByPath['/etcdbackups'] = [];
    listByPath['/persistentvolumeclaims'] = [{ metadata: { name: 'etcd-backup-pvc' } }];
    renderTab();
    const row = () => screen.getByTestId('readiness-etcd-backup');
    await vi.waitFor(() => expect(row().textContent).toMatch(/No EtcdBackup has been recorded/));
    fireEvent.click(await within(row()).findByRole('button', { name: 'Take backup now' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/POST \/apis\/operator\.openshift\.io\/v1alpha1\/etcdbackups/);
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'pre-update-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take backup' }));
    await vi.waitFor(() => expect(k8sCreate).toHaveBeenCalledTimes(2));
    const body = { apiVersion: 'operator.openshift.io/v1alpha1', kind: 'EtcdBackup', metadata: { name: 'pre-update-1' }, spec: { pvcName: 'etcd-backup-pvc' } };
    expect(k8sCreate).toHaveBeenNthCalledWith(1, '/apis/operator.openshift.io/v1alpha1/etcdbackups?dryRun=All', body, 'local');
    expect(k8sCreate).toHaveBeenNthCalledWith(2, '/apis/operator.openshift.io/v1alpha1/etcdbackups', body, 'local');
  });

  it('a PVC name that does not exist is refused before anything is sent; a failed create stays in the dialog', async () => {
    listByPath['/etcdbackups'] = [];
    listByPath['/persistentvolumeclaims'] = [{ metadata: { name: 'etcd-backup-pvc' } }];
    vi.mocked(k8sCreate).mockRejectedValueOnce(Object.assign(new Error('etcdbackups is forbidden'), { status: 403 }));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Take backup now' }));
    const dialog = await screen.findByRole('dialog');
    const pvc = within(dialog).getByLabelText(/PersistentVolumeClaim/);
    fireEvent.change(pvc, { target: { value: 'other' } });
    expect((within(dialog).getByRole('button', { name: 'Take backup' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(pvc, { target: { value: 'etcd-backup-pvc' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take backup' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/forbidden/);
    expect(k8sCreate).toHaveBeenCalledTimes(1);
  });

  it('with no PVC in openshift-etcd: guidance instead of the button', async () => {
    listByPath['/etcdbackups'] = [];
    listByPath['/persistentvolumeclaims'] = [];
    renderTab();
    expect(await screen.findByTestId('etcd-backup-guidance')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Take backup now' })).toBeNull();
  });

  it('without permission to create EtcdBackups the button is disabled and says why', async () => {
    canI = false;
    listByPath['/etcdbackups'] = [];
    listByPath['/persistentvolumeclaims'] = [{ metadata: { name: 'p' } }];
    renderTab();
    const btn = await screen.findByRole('button', { name: 'Take backup now' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText('You do not have permission to create EtcdBackups.')).toBeDefined();
  });

  it('a recent completed backup passes; a failed latest backup is a blocker', async () => {
    const now = new Date().toISOString();
    listByPath['/etcdbackups'] = [
      { metadata: { name: 'b2', creationTimestamp: now }, status: { conditions: [{ type: 'BackupFailed', status: 'True', message: 'pvc full', lastTransitionTime: now }] } },
      { metadata: { name: 'b1', creationTimestamp: '2026-01-01T00:00:00Z' }, status: { conditions: [{ type: 'BackupCompleted', status: 'True', lastTransitionTime: now }] } },
    ];
    renderTab();
    await vi.waitFor(() => expect(screen.getByTestId('readiness-etcd-backup').dataset.status).toBe('blocker'));
    expect(screen.getByTestId('readiness-etcd-backup').textContent).toMatch(/latest etcd backup \(b2\) failed: pvc full/);
  });
});

describe('etcd member health', () => {
  const etcdCo = { apiVersion: 'config.openshift.io/v1', kind: 'ClusterOperator', metadata: { name: 'etcd', uid: 'e', creationTimestamp: '' }, status: { conditions: [{ type: 'Available', status: 'True' }, { type: 'Degraded', status: 'False' }] } } as ClusterOperator;
  const member = (n: string, ready: boolean) => ({ metadata: { name: n, namespace: 'openshift-etcd' }, status: { conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] } });

  it('3/3 ready member pods with a healthy operator pass', async () => {
    listByPath['openshift-etcd/pods'] = [member('etcd-a', true), member('etcd-b', true), member('etcd-c', true)];
    renderTab({ operators: [etcdCo] });
    await vi.waitFor(() => expect(screen.getByTestId('readiness-etcd-health').dataset.status).toBe('passed'));
    expect(screen.getByText(/etcd 3\/3 members healthy/)).toBeDefined();
  });

  it('a member down is a blocker; unreadable pods are unknown, not healthy', async () => {
    listByPath['openshift-etcd/pods'] = [member('etcd-a', true), member('etcd-b', false), member('etcd-c', true)];
    const { unmount } = renderTab({ operators: [etcdCo] });
    await vi.waitFor(() => expect(screen.getByTestId('readiness-etcd-health').dataset.status).toBe('blocker'));
    unmount();
    listByPath['openshift-etcd/pods'] = Object.assign(new Error('forbidden'), { status: 403 });
    renderTab({ operators: [etcdCo] });
    await vi.waitFor(() => expect(screen.getByTestId('readiness-etcd-health').dataset.status).toBe('unknown'));
    expect(screen.getByTestId('readiness-etcd-health').textContent).toMatch(/etcd pods could not be read \(Permission denied \(403\)\)/);
  });
});

describe('Pause worker pools first', () => {
  it('confirm pauses every unpaused non-master pool, dry run first, conditional on the version shown', async () => {
    renderTab({ machineConfigPools: [pool('master'), pool('worker', false, 'rv-w'), pool('infra', false, 'rv-i')] });
    fireEvent.click(screen.getByRole('button', { name: 'Pause worker pools first' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Pause 2 worker pools before the update\?/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await vi.waitFor(() => expect(k8sPatch).toHaveBeenCalledTimes(4));
    const calls = vi.mocked(k8sPatch).mock.calls.map(([p, b]) => [p, b]);
    expect(calls).toEqual([
      ['/apis/machineconfiguration.openshift.io/v1/machineconfigpools/worker?dryRun=All', { metadata: { resourceVersion: 'rv-w' }, spec: { paused: true } }],
      ['/apis/machineconfiguration.openshift.io/v1/machineconfigpools/infra?dryRun=All', { metadata: { resourceVersion: 'rv-i' }, spec: { paused: true } }],
      ['/apis/machineconfiguration.openshift.io/v1/machineconfigpools/worker', { metadata: { resourceVersion: 'rv-w' }, spec: { paused: true } }],
      ['/apis/machineconfiguration.openshift.io/v1/machineconfigpools/infra', { metadata: { resourceVersion: 'rv-i' }, spec: { paused: true } }],
    ]);
  });

  it('cancel sends nothing; without permission the button is disabled', async () => {
    const { unmount } = renderTab({ machineConfigPools: [pool('worker')] });
    fireEvent.click(screen.getByRole('button', { name: 'Pause worker pools first' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(k8sPatch).not.toHaveBeenCalled();
    unmount();
    canI = false;
    renderTab({ machineConfigPools: [pool('worker')] });
    expect((screen.getByRole('button', { name: 'Pause worker pools first' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('During an update', () => {
  it('a stuck operator opens its related namespaces, their pods and each pod\'s logs', () => {
    const go = vi.fn();
    const stuck = {
      apiVersion: 'config.openshift.io/v1', kind: 'ClusterOperator', metadata: { name: 'network', uid: 'n', creationTimestamp: '' },
      status: {
        conditions: [{ type: 'Available', status: 'True' }, { type: 'Progressing', status: 'True', message: 'Deployment "ovnkube" rollout is not complete', lastTransitionTime: '2020-01-01T00:00:00Z' }],
        relatedObjects: [{ group: '', resource: 'namespaces', name: 'openshift-ovn-kubernetes' }, { group: 'apps', resource: 'daemonsets', namespace: 'openshift-network-operator', name: 'x' }],
      },
    } as ClusterOperator;
    const pods = [
      { metadata: { name: 'ovnkube-node-a', namespace: 'openshift-ovn-kubernetes' }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'False' }] } },
    ] as Pod[];
    const cv = inFlightClusterVersion();
    renderTab({ clusterVersion: cv, cvVersion: '4.16.8', isUpdating: true, availableUpdates: cv.status!.availableUpdates!, operators: [stuck], pods, go });
    const detail = screen.getByTestId('stuck-operator-network');
    expect(screen.getByText(/Stuck: Progressing for/)).toBeDefined();
    expect(within(detail).getByRole('button', { name: 'openshift-network-operator' })).toBeDefined();
    fireEvent.click(within(detail).getByRole('button', { name: 'openshift-ovn-kubernetes' }));
    fireEvent.click(within(detail).getByRole('button', { name: 'Logs' }));
    expect(go).toHaveBeenCalledWith('/logs/openshift-ovn-kubernetes/ovnkube-node-a', 'ovnkube-node-a (Logs)');
    fireEvent.click(within(detail).getByRole('button', { name: 'ovnkube-node-a' }));
    expect(go).toHaveBeenCalledWith('/r/v1~pods/openshift-ovn-kubernetes/ovnkube-node-a', 'ovnkube-node-a');
    // Readiness is for before an update; it is not shown while one runs.
    expect(screen.queryByTestId('upgrade-readiness')).toBeNull();
  });

  it('a drain blocker names the pod that cannot be evicted as well as the PDB', () => {
    const go = vi.fn();
    const node = {
      apiVersion: 'v1', kind: 'Node',
      metadata: { name: 'worker-1', uid: 'w', creationTimestamp: '', annotations: { 'machineconfiguration.openshift.io/state': 'Working', 'machineconfiguration.openshift.io/desiredConfig': 'b', 'machineconfiguration.openshift.io/currentConfig': 'a' } },
      status: { conditions: [{ type: 'Ready', status: 'True' }] },
    } as Node;
    renderTab({
      isUpdating: true, go, nodes: [node],
      pods: [{ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'db-0', namespace: 'payments', uid: 'p', creationTimestamp: '', labels: { app: 'db' } }, spec: { containers: [], nodeName: 'worker-1' } }] as Pod[],
      pdbs: [{ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: { name: 'db', namespace: 'payments', uid: 'd' }, spec: { selector: { matchLabels: { app: 'db' } } }, status: { disruptionsAllowed: 0 } }],
    });
    const list = screen.getByRole('list', { name: 'Pods payments/db keeps from being evicted' });
    expect(list.textContent).toMatch(/Can't evict pod payments\/db-0 on worker-1/);
    fireEvent.click(within(list).getByRole('button', { name: 'payments/db-0' }));
    expect(go).toHaveBeenCalledWith('/r/v1~pods/payments/db-0', 'db-0');
  });
});
