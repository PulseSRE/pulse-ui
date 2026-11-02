// @vitest-environment jsdom
/**
 * Admin › Updates readiness (Wave 14): the fix actions (take an etcd backup,
 * pause worker pools) and etcd member health.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { ClusterOperator, MachineConfigPool } from '../../../engine/types';
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
import { idleClusterVersion } from '../../../__fixtures__/clusterVersionUpdates';

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

const pool = (name: string, paused = false, rv = '1') => ({
  apiVersion: 'machineconfiguration.openshift.io/v1', kind: 'MachineConfigPool',
  metadata: { name, uid: name, creationTimestamp: '', resourceVersion: rv },
  spec: { paused, nodeSelector: { matchLabels: { [`node-role.kubernetes.io/${name}`]: '' } } },
  status: { machineCount: 3, updatedMachineCount: 3 },
}) as MachineConfigPool;

beforeEach(() => {
  vi.clearAllMocks();
  canI = true;
  for (const k of Object.keys(listByPath)) delete listByPath[k];
  setActiveClusterId('local');
});
afterEach(cleanup);

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

  it('master and arbiter pools are not worker pools', () => {
    renderTab({ machineConfigPools: [pool('master'), pool('arbiter'), pool('worker', true)] });
    expect(screen.queryByRole('button', { name: 'Pause worker pools first' })).toBeNull();
    expect(screen.getByTestId('worker-pools-paused').textContent).toBe('Worker pools paused: worker');
  });

  it('a failure part-way names the pools already paused', async () => {
    vi.mocked(k8sPatch)
      .mockResolvedValueOnce({}).mockResolvedValueOnce({}) // dry runs
      .mockResolvedValueOnce({}) // worker paused
      .mockRejectedValueOnce(Object.assign(new Error('machineconfigpools "infra" is forbidden'), { status: 403 }));
    renderTab({ machineConfigPools: [pool('worker', false, 'a'), pool('infra', false, 'b')] });
    fireEvent.click(screen.getByRole('button', { name: 'Pause worker pools first' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/infra: .*forbidden.*already paused: worker/);
    expect(addToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('pending CSRs and an expired control-plane certificate are blockers; a 404 on etcd pods is unknown', async () => {
    listByPath['/certificatesigningrequests'] = [{ metadata: { name: 'csr-1' }, spec: { signerName: 'kubernetes.io/kubelet-serving' }, status: {} }];
    listByPath['openshift-kube-apiserver/secrets'] = [{ type: 'kubernetes.io/tls', metadata: { name: 'old', namespace: 'openshift-kube-apiserver', annotations: { 'service.beta.openshift.io/expiry': '2020-01-01T00:00:00Z' } } }];
    listByPath['openshift-etcd/pods'] = Object.assign(new Error('not found'), { status: 404 });
    const go = vi.fn();
    renderTab({ go, operators: [{ apiVersion: 'config.openshift.io/v1', kind: 'ClusterOperator', metadata: { name: 'etcd', uid: 'e', creationTimestamp: '' }, status: { conditions: [{ type: 'Available', status: 'True' }] } } as ClusterOperator] });
    await vi.waitFor(() => expect(screen.getByTestId('readiness-csrs').dataset.status).toBe('blocker'));
    fireEvent.click(within(screen.getByTestId('readiness-csrs')).getByRole('button', { name: 'Certificate requests' }));
    expect(go).toHaveBeenCalledWith('/admin?tab=csrs', 'Certificate requests');
    await vi.waitFor(() => expect(screen.getByTestId('readiness-cp-certs').dataset.status).toBe('blocker'));
    expect(screen.getByTestId('readiness-cp-certs').textContent).toMatch(/openshift-kube-apiserver\/old expired/);
    fireEvent.click(within(screen.getByTestId('readiness-cp-certs')).getByRole('button', { name: 'Certificates' }));
    expect(go).toHaveBeenCalledWith('/admin?tab=certificates&system=1', 'Certificates');
    await vi.waitFor(() => expect(screen.getByTestId('readiness-etcd-health').dataset.status).toBe('unknown'));
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

