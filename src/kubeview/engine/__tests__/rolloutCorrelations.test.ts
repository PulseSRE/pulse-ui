import { describe, expect, it } from 'vitest';
import { correlateClientSignals } from '../rolloutCorrelations';
import type { Finding } from '../monitorClient';
import type { InboxItem } from '../inboxApi';

const at = (iso: string) => Date.parse(iso);
const finding = (id: string, resources: Finding['resources'], ts: string, startedAt?: string): Finding =>
  ({ id, title: id, severity: 'warning', category: 'x', summary: '', resources, autoFixable: false, timestamp: at(ts), ...(startedAt ? { startedAt: at(startedAt) } : {}) });
const placed = (out: ReturnType<typeof correlateClientSignals>) =>
  Object.fromEntries(out.map((c) => [c.revision, c.items.map((i) => i.label).sort()]));

const DEP = { kind: 'Deployment', namespace: 'prod', name: 'api' };
const depRef = { kind: 'Deployment', name: 'api', namespace: 'prod' };

describe('placing findings on rollout revisions', () => {
  it('after a rollback (an old ReplicaSet renumbered as the newest revision) findings are placed only by exact pod/ReplicaSet name', () => {
    // rev 2 = api-b created 10-02; rev 3 = api-a (rev 1 rolled back to), created 10-01.
    const revisions = [{ revision: 2, name: 'api-b', createdAt: '2026-10-02T00:00:00Z' }, { revision: 3, name: 'api-a', createdAt: '2026-10-01T00:00:00Z' }];
    const out = correlateClientSignals(DEP, revisions, [
      finding('during-b', [depRef], '2026-10-02T12:00:00Z'), // rev 2 was running then, but times cannot tell: not placed
      finding('before-all', [depRef], '2026-09-30T00:00:00Z'),
      finding('pod-of-a', [{ kind: 'Pod', name: 'api-a-x1y2z', namespace: 'prod' }], '2026-10-02T12:00:00Z'), // exact by name
    ], []);
    expect(placed(out)).toEqual({ 3: ['pod-of-a'] });
    // Not even after every start: when the rollback happened is unknown.
    expect(placed(correlateClientSignals(DEP, revisions, [finding('late', [depRef], '2026-10-03T00:00:00Z')], []))).toEqual({});
    expect(placed(correlateClientSignals(DEP, revisions, [finding('rs-b', [{ kind: 'ReplicaSet', name: 'api-b', namespace: 'prod' }], '2026-10-03T00:00:00Z')], []))).toEqual({ 2: ['rs-b'] });
  });

  it('uses the finding\'s onset (startedAt) rather than when it was last reported', () => {
    const revisions = [{ revision: 1, name: 'api-a', createdAt: '2026-10-01T00:00:00Z' }, { revision: 2, name: 'api-b', createdAt: '2026-10-02T00:00:00Z' }];
    const out = correlateClientSignals(DEP, revisions, [finding('old', [depRef], '2026-10-03T00:00:00Z', '2026-10-01T06:00:00Z')], []);
    expect(placed(out)).toEqual({ 1: ['old'] });
  });

  it('a reference without a namespace matches only through its inbox item\'s namespace', () => {
    const revisions = [{ revision: 1, name: 'api-a', createdAt: '2026-10-01T00:00:00Z' }];
    const noNs = { kind: 'Deployment', name: 'api' };
    const inbox = (id: string, namespace: string | null) => ({ id, finding_id: null, title: id, severity: 'warning', namespace, resources: [noNs], created_at: at('2026-10-01T06:00:00Z') / 1000 }) as unknown as InboxItem;
    const out = correlateClientSignals(DEP, revisions, [finding('f-no-ns', [noNs as Finding['resources'][0]], '2026-10-01T06:00:00Z')], [inbox('in-prod', 'prod'), inbox('in-staging', 'staging'), inbox('in-none', null)]);
    expect(placed(out)).toEqual({ 1: ['in-prod'] });
  });

  it('a DaemonSet-looking pod name counts only when no owner says otherwise', () => {
    const DS = { kind: 'DaemonSet', namespace: 'prod', name: 'agent' };
    const revisions = [{ revision: 1, name: 'agent-6f7', createdAt: '2026-10-01T00:00:00Z' }];
    const out = correlateClientSignals(DS, revisions, [
      finding('ds-pod', [{ kind: 'Pod', name: 'agent-ab12c', namespace: 'prod', ownerKind: 'DaemonSet', ownerName: 'agent' }], '2026-10-01T06:00:00Z'),
      finding('job-pod', [{ kind: 'Pod', name: 'agent-zz9yx', namespace: 'prod', ownerKind: 'Job', ownerName: 'agent' }], '2026-10-01T06:00:00Z'),
      finding('unowned', [{ kind: 'Pod', name: 'agent-qq1rr', namespace: 'prod' }], '2026-10-01T06:00:00Z'),
    ], []);
    expect(placed(out)).toEqual({ 1: ['ds-pod', 'unowned'] });
  });
});
