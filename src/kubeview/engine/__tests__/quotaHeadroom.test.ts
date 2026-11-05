import { describe, it, expect } from 'vitest';
import { quotaHeadroom } from '../quotaHeadroom';

const MiB = 1024 * 1024;
const quota = (hard: string, used: string) => ({ apiVersion: 'v1', kind: 'ResourceQuota', metadata: { name: 'mem' }, status: { hard: { 'requests.memory': hard }, used: { 'requests.memory': used } } });

describe('quotaHeadroom', () => {
  const delta = { requests: 256 * MiB, limits: 256 * MiB, replicas: 3 };
  it('room left after the change', () => {
    expect(quotaHeadroom({ state: 'ok', data: [quota('8Gi', '5Gi')] as never }, delta)).toEqual({ tone: 'ok', text: 'Namespace quota has room: 2.3Gi of 8.0Gi memory requests left after this change (mem).' });
  });
  it('over quota says new pods would be refused', () => {
    expect(quotaHeadroom({ state: 'ok', data: [quota('8Gi', '7.5Gi')] as never }, delta).tone).toBe('over');
  });
  it('an unreadable quota list is unknown, not "has room"', () => {
    const h = quotaHeadroom({ state: 'error', reason: 'Permission denied (403)' }, delta);
    expect(h.tone).toBe('unknown');
    expect(h.text).toContain('Permission denied (403)');
  });
  it('no memory quota', () => {
    expect(quotaHeadroom({ state: 'ok', data: [] }, delta).tone).toBe('none');
  });
});
