import { describe, it, expect } from 'vitest';
import {
  checkControlPlaneCerts, checkEtcdBackup, checkChannel, nodesThatWillDrain, readinessVerdict, toLoadable,
  NO_BACKUP_API_DETAIL, type ReadinessCheck,
} from '../upgradeReadiness';
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
