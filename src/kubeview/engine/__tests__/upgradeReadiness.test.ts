import { describe, it, expect } from 'vitest';
import {
  checkControlPlaneCerts, checkEtcdBackup, checkChannel, nodesThatWillDrain, readinessVerdict, toLoadable,
  checkAdminAck, checkUpgradeable, checkCriticalAlerts, checkDrainPdbs, checkNodes, checkOperators, checkPendingCsrs, checkEtcdHealth,
  NO_BACKUP_API_DETAIL, type ReadinessCheck, type RemovalReads,
} from '../upgradeReadiness';
import type { ApiRemovalVerdict } from '../upgradeApiRemovals';
import type { ClusterVersion, MachineConfigPool, Node } from '../types';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const c = (status: ReadinessCheck['status']): ReadinessCheck => ({ id: 'nodes', label: 'x', status, detail: '' });

describe('readinessVerdict', () => {
  it('Unknown never counts as passed; a blocker wins; checking is not ready', () => {
    expect(readinessVerdict([c('passed'), c('passed')]).state).toBe('ready');
    expect(readinessVerdict([c('passed'), c('unknown')]).state).toBe('unknown');
    expect(readinessVerdict([c('unknown'), c('blocker')])).toMatchObject({ state: 'not_ready', blockers: 1, unknown: 1 });
    expect(readinessVerdict([c('passed'), c('checking')]).state).toBe('checking');
  });
});

describe('toLoadable', () => {
  it('keeps 404 apart from errors and never turns an error into data', () => {
    expect(toLoadable([], Object.assign(new Error('x'), { status: 404 }), false)).toEqual({ state: 'absent' });
    expect(toLoadable([], Object.assign(new Error('x'), { status: 403 }), false)).toEqual({ state: 'error', reason: 'Permission denied (403)' });
    expect(toLoadable(undefined, null, false)).toEqual({ state: 'loading' });
  });
});

describe('checkEtcdBackup', () => {
  const ok = <T,>(data: T) => ({ state: 'ok' as const, data });
  const done = (name: string, at: string) => ({ metadata: { name, creationTimestamp: at }, status: { conditions: [{ type: 'BackupCompleted', status: 'True' as const, lastTransitionTime: at }] } });
  it('API not served: unknown with the cluster-backup.sh note', () => {
    const r = checkEtcdBackup({ state: 'absent' }, { state: 'absent' }, false, NOW);
    expect(r).toMatchObject({ status: 'unknown', detail: NO_BACKUP_API_DETAIL });
  });
  it('recent completion passes; an old one is a blocker; none recorded is unknown', () => {
    expect(checkEtcdBackup(ok([done('a', '2026-11-02T10:00:00Z')]), ok([]), false, NOW).status).toBe('passed');
    expect(checkEtcdBackup(ok([done('a', '2026-10-20T10:00:00Z')]), ok([]), false, NOW).status).toBe('blocker');
    const none = checkEtcdBackup(ok([]), ok([{ metadata: { name: 'default' }, spec: { etcd: { schedule: '0 3 * * *' } } }]), false, NOW);
    expect(none.status).toBe('unknown');
    expect(none.detail).toMatch(/Backup schedule is configured \(default: 0 3 \* \* \*\)/);
  });
  it('a read error is unknown with the reason', () => {
    expect(checkEtcdBackup({ state: 'error', reason: 'Permission denied (403)' }, ok([]), false, NOW).detail).toMatch(/Could not check: Permission denied \(403\)/);
  });
});

describe('checkControlPlaneCerts', () => {
  it('no secrets is unknown, not a pass', () => {
    expect(checkControlPlaneCerts({ state: 'ok', data: [] }, false).status).toBe('unknown');
  });
});

describe('checkChannel', () => {
  const cv = (channel: string) => ({ spec: { channel } }) as unknown as ClusterVersion;
  it('candidate is a blocker, stable passes, unreadable ClusterVersion is unknown', () => {
    expect(checkChannel(cv('candidate-4.19')).status).toBe('blocker');
    expect(checkChannel(cv('stable-4.19')).status).toBe('passed');
    expect(checkChannel(null).status).toBe('unknown');
  });
});

describe('nodesThatWillDrain', () => {
  const node = (name: string, role: string) => ({ metadata: { name, labels: { [`node-role.kubernetes.io/${role}`]: '' } } }) as unknown as Node;
  const pool = (name: string, paused: boolean) => ({ metadata: { name }, spec: { paused, nodeSelector: { matchLabels: { [`node-role.kubernetes.io/${name}`]: '' } } } }) as unknown as MachineConfigPool;
  it('leaves out nodes whose only pool is paused; unreadable pools mean every node', () => {
    const nodes = [node('m1', 'master'), node('w1', 'worker')];
    expect(nodesThatWillDrain(nodes, [pool('master', false), pool('worker', true)])).toEqual(['m1']);
    expect(nodesThatWillDrain(nodes, null)).toEqual(['m1', 'w1']);
  });
});

describe('404 (API not served) is Unknown on every row that reads one', () => {
  const absent = { state: 'absent' as const };
  const ok = <T,>(data: T) => ({ state: 'ok' as const, data });
  it.each([
    ['nodes', () => checkNodes(absent)],
    ['operators', () => checkOperators(absent)],
    ['alerts', () => checkCriticalAlerts(absent)],
    ['csrs', () => checkPendingCsrs(absent)],
    ['cp-certs', () => checkControlPlaneCerts(absent, false)],
    ['pdbs (PDB API)', () => checkDrainPdbs(absent, ok([]), ok([]), [])],
    ['pdbs (pods)', () => checkDrainPdbs(ok([]), absent, ok([]), [])],
    ['etcd-health (pods)', () => checkEtcdHealth(ok([{ metadata: { name: 'etcd' }, status: { conditions: [{ type: 'Available', status: 'True' }] } }] as never), absent, false)],
    ['etcd-backup', () => checkEtcdBackup(absent, absent, false)],
  ])('%s', (_name, run) => {
    const r = run();
    expect(r.status).toBe('unknown');
    expect(r.detail).toMatch(/not served|could not be read|not found|API not enabled/);
  });
});

describe('control-plane certificates', () => {
  const secret = (name: string, expiry: Date) => ({ metadata: { name, namespace: 'openshift-kube-apiserver', annotations: { 'service.beta.openshift.io/expiry': expiry.toISOString() } } });
  it('expired, and expiring within a day, are blockers; otherwise the earliest expiry passes', () => {
    const day = 86_400_000;
    expect(checkControlPlaneCerts({ state: 'ok', data: [secret('old', new Date(Date.now() - 3 * day))] }, false)).toMatchObject({ status: 'blocker', detail: expect.stringMatching(/openshift-kube-apiserver\/old expired [34] days ago/) });
    expect(checkControlPlaneCerts({ state: 'ok', data: [secret('soon', new Date(Date.now() + day / 2))] }, false)).toMatchObject({ status: 'blocker', detail: expect.stringMatching(/expires within a day/) });
    const fine = checkControlPlaneCerts({ state: 'ok', data: [secret('a', new Date(Date.now() + 100.5 * day)), secret('b', new Date(Date.now() + 20.5 * day))] }, false);
    expect(fine).toMatchObject({ status: 'passed', summary: 'control-plane certificates valid for 20 days' });
  });
});

describe('pending CSRs', () => {
  it('a pending request is a blocker; approved ones pass', () => {
    const csr = (name: string, approved: boolean) => ({ metadata: { name }, spec: { signerName: 'kubernetes.io/kubelet-serving' }, status: approved ? { conditions: [{ type: 'Approved', status: 'True' }], certificate: 'x' } : {} });
    expect(checkPendingCsrs({ state: 'ok', data: [csr('a', false), csr('b', true)] as never }).detail).toMatch(/1 certificate signing request is pending approval/);
    expect(checkPendingCsrs({ state: 'ok', data: [csr('b', true)] as never }).status).toBe('passed');
  });
});

describe('admin acknowledgement and Upgradeable', () => {
  const cv = (reason: string) => ({ status: { conditions: [{ type: 'Upgradeable', status: 'False', reason, message: 'Kubernetes 1.32 removes APIs.' }] } }) as unknown as ClusterVersion;
  const verdict = { target: { ocp: '4.19', kube: '1.32' }, gates: [{ key: 'ack-4.18-x-in-4.19', description: '', acknowledged: true }] } as unknown as ApiRemovalVerdict;
  const reads = (gatesState: 'ok' | 'error') => ({
    apiRequestCounts: { state: 'ok', data: [] },
    adminGates: gatesState === 'ok' ? { state: 'ok', data: {} } : { state: 'error', reason: 'Request failed (500)' },
    adminAcks: { state: 'ok', data: {} },
  }) as unknown as RemovalReads;
  it('Upgradeable=False AdminAckRequired is a blocker quoting the CVO, even when every gate reads as acknowledged or gates are unreadable', () => {
    for (const r of [reads('ok'), reads('error'), null]) {
      const c = checkAdminAck(r, r ? verdict : null, cv('AdminAckRequired'));
      expect(c.status).toBe('blocker');
      expect(c.detail).toMatch(/Upgradeable=False \(AdminAckRequired\): Kubernetes 1\.32 removes APIs\./);
    }
    expect(checkAdminAck(reads('ok'), verdict, cv('Other')).status).toBe('passed');
  });
  it('checkUpgradeable without a ClusterVersion is Checking while loading and Unknown after, never Passed', () => {
    expect(checkUpgradeable(undefined, true)?.status).toBe('checking');
    expect(checkUpgradeable(null)?.status).toBe('unknown');
    expect(checkChannel(null, true).status).toBe('checking');
  });
});

describe('drain check text', () => {
  it('names paused pools whose nodes will drain when unpaused', () => {
    const node = { metadata: { name: 'w1', labels: { 'node-role.kubernetes.io/worker': '' } } } as unknown as Node;
    const pool = { metadata: { name: 'worker' }, spec: { paused: true, nodeSelector: { matchLabels: { 'node-role.kubernetes.io/worker': '' } } } } as unknown as MachineConfigPool;
    const r = checkDrainPdbs({ state: 'ok', data: [] }, { state: 'ok', data: [] }, { state: 'ok', data: [node] }, [pool]);
    expect(r.status).toBe('passed');
    expect(r.detail).toMatch(/Nodes in paused pool worker are not counted: their nodes will drain when unpaused/);
  });
  it('a critical alert says silenced alerts count', () => {
    expect(checkCriticalAlerts({ state: 'ok', data: [{ labels: { alertname: 'A', severity: 'critical' }, state: 'firing' }] }).detail).toMatch(/Silenced alerts are counted too/);
  });
});
