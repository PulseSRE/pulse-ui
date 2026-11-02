import { describe, it, expect } from 'vitest';
import {
  computeApiRemovalVerdict, kubeMinorForOcp, targetMinorOptions, classifyRemovedApis,
  applicableGates, currentClusterVersion, parseApiRequestCountName,
  type APIRequestCount, type ApiRemovalInputs,
} from '../upgradeApiRemovals';
import type { ClusterVersion, ConfigMap } from '../types';
import type { ReadResult } from '../readResult';

function cv(version = '4.18.5', extra: Partial<NonNullable<ClusterVersion['status']>> = {}): ClusterVersion {
  return {
    apiVersion: 'config.openshift.io/v1',
    kind: 'ClusterVersion',
    metadata: { name: 'version', uid: 'cv', creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: { clusterID: 'c', channel: 'stable-4.19' },
    status: { desired: { version }, history: [{ state: 'Completed', version }], conditions: [], ...extra },
  } as ClusterVersion;
}

function arc(name: string, removedInRelease: string | undefined, requestCount: number, users: Array<[string, string, number]> = []): APIRequestCount {
  return {
    metadata: { name },
    status: {
      ...(removedInRelease ? { removedInRelease } : {}),
      requestCount,
      last24h: [{ byNode: [{ nodeName: 'm1', byUser: users.map(([username, userAgent, n]) => ({ username, userAgent, requestCount: n })) }] }],
    },
  };
}

function cm(name: string, data: Record<string, string>): ConfigMap {
  return { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name, uid: name, creationTimestamp: '2026-01-01T00:00:00Z' }, data } as ConfigMap;
}

const GATE = 'ack-4.18-kube-1.32-api-removals-in-4.19';
const ok = <T,>(data: T): ReadResult<T> => ({ state: 'ok', data });

function inputs(over: Partial<ApiRemovalInputs> = {}): ApiRemovalInputs {
  return {
    clusterVersion: cv(),
    apiRequestCounts: ok([arc('flowschemas.v1beta3.flowcontrol.apiserver.k8s.io', '1.32', 0), arc('pods.v1', undefined, 900)]),
    adminGates: ok(cm('admin-gates', { [GATE]: 'Kubernetes 1.32 removes v1beta3 FlowSchema.' })),
    adminAcks: ok(cm('admin-acks', { [GATE]: 'true' })),
    ...over,
  };
}

describe('version mapping', () => {
  it('maps OpenShift 4.N to Kubernetes 1.(N+13)', () => {
    expect(kubeMinorForOcp('4.16')).toBe('1.29');
    expect(kubeMinorForOcp('4.17')).toBe('1.30');
    expect(kubeMinorForOcp('4.18.3')).toBe('1.31');
    expect(kubeMinorForOcp('4.19')).toBe('1.32');
    expect(kubeMinorForOcp('5.0')).toBeNull();
    expect(kubeMinorForOcp('')).toBeNull();
  });

  it('takes the current version from the latest completed history entry', () => {
    const c = cv('4.19.1', { history: [{ state: 'Partial', version: '4.19.1' }, { state: 'Completed', version: '4.18.9' }] });
    expect(currentClusterVersion(c)).toBe('4.18.9');
    expect(currentClusterVersion(cv('4.18.2', { history: [] }))).toBe('4.18.2');
    expect(currentClusterVersion(null)).toBeNull();
  });

  it('offers the next minor plus newer minors from available and conditional updates', () => {
    const c = cv('4.18.5', {
      availableUpdates: [{ version: '4.18.7' }, { version: '4.19.2' }],
      conditionalUpdates: [{ release: { version: '4.20.1' }, risks: [] }],
    } as Partial<NonNullable<ClusterVersion['status']>>);
    expect(targetMinorOptions(c)).toEqual(['4.19', '4.20']);
    expect(targetMinorOptions(null)).toEqual([]);
  });

  it('splits an APIRequestCount name into resource, version and group', () => {
    expect(parseApiRequestCountName('flowschemas.v1beta3.flowcontrol.apiserver.k8s.io')).toEqual({ resource: 'flowschemas', version: 'v1beta3', group: 'flowcontrol.apiserver.k8s.io' });
    expect(parseApiRequestCountName('pods.v1')).toEqual({ resource: 'pods', version: 'v1', group: '' });
  });
});

describe('classifyRemovedApis', () => {
  it('counts an API removed in or before the target as in use or unused, ignoring later removals and never-removed APIs', () => {
    const { inUse, unused } = classifyRemovedApis([
      arc('flowschemas.v1beta3.flowcontrol.apiserver.k8s.io', '1.32', 12, [['jane', 'kubectl/v1.31', 12]]),
      arc('cronjobs.v1beta1.batch', '1.25', 0),
      arc('future.v1beta1.example.io', '1.33', 50),
      arc('pods.v1', undefined, 1000),
    ], '1.32');
    expect(inUse.map((a) => a.name)).toEqual(['flowschemas.v1beta3.flowcontrol.apiserver.k8s.io']);
    expect(unused.map((a) => a.name)).toEqual(['cronjobs.v1beta1.batch']);
    expect(inUse[0]).toMatchObject({ resource: 'flowschemas', version: 'v1beta3', group: 'flowcontrol.apiserver.k8s.io', removedInRelease: '1.32', requestCount: 12 });
  });

  it('aggregates callers across nodes and hours, ranks non-platform callers first, and flags system: callers without hiding them', () => {
    const a: APIRequestCount = {
      metadata: { name: 'flowschemas.v1beta3.flowcontrol.apiserver.k8s.io' },
      status: {
        removedInRelease: '1.32',
        requestCount: 530,
        currentHour: { byNode: [{ byUser: [{ username: 'jane', userAgent: 'kubectl', requestCount: 999 }] }] },
        last24h: [
          { byNode: [{ byUser: [{ username: 'system:serviceaccount:openshift-x:op', userAgent: 'op/1', requestCount: 500 }] }] },
          { byNode: [{ byUser: [{ username: 'jane', userAgent: 'kubectl', requestCount: 10 }] }, { byUser: [{ username: 'jane', userAgent: 'kubectl', requestCount: 20 }] }] },
        ],
      },
    };
    const { inUse } = classifyRemovedApis([a], '1.32');
    // currentHour is part of last24h, so it is not added a second time.
    expect(inUse[0].callers).toEqual([
      { username: 'jane', userAgent: 'kubectl', requestCount: 30, platform: false },
      { username: 'system:serviceaccount:openshift-x:op', userAgent: 'op/1', requestCount: 500, platform: true },
    ]);
  });
});

describe('applicableGates', () => {
  const gates = cm('admin-gates', { [GATE]: 'd1', 'ack-4.19-kube-1.33-api-removals-in-4.20': 'd2', 'ack-4.17-kube-1.31-api-removals-in-4.18': 'old', 'not-a-gate': 'x' });
  it('applies gates evaluated on the current minor and every minor crossed to the target', () => {
    expect(applicableGates(gates, null, '4.18.3', '4.19').map((g) => g.key)).toEqual([GATE]);
    expect(applicableGates(gates, null, '4.18.3', '4.20').map((g) => g.key)).toEqual([GATE, 'ack-4.19-kube-1.33-api-removals-in-4.20']);
  });
  it('marks a gate acknowledged only when admin-acks has it set to "true", and unknown when admin-acks could not be read', () => {
    expect(applicableGates(gates, cm('admin-acks', { [GATE]: 'true' }), '4.18', '4.19')[0].acknowledged).toBe(true);
    expect(applicableGates(gates, cm('admin-acks', { [GATE]: 'false' }), '4.18', '4.19')[0].acknowledged).toBe(false);
    expect(applicableGates(gates, null, '4.18', '4.19')[0].acknowledged).toBe(false);
    expect(applicableGates(gates, 'unknown', '4.18', '4.19')[0].acknowledged).toBeNull();
  });
});

describe('computeApiRemovalVerdict', () => {
  it('is go when nothing removed in the target is called and every gate is acknowledged', () => {
    const v = computeApiRemovalVerdict(inputs());
    expect(v.status).toBe('go');
    expect(v.target).toEqual({ ocp: '4.19', kube: '1.32' });
    expect(v.unused.map((a) => a.name)).toEqual(['flowschemas.v1beta3.flowcontrol.apiserver.k8s.io']);
    expect(v.reason).toMatch(/No API removed in Kubernetes 1\.32/);
  });

  it('is go with no gates at all', () => {
    const v = computeApiRemovalVerdict(inputs({ adminGates: ok(cm('admin-gates', {})), adminAcks: ok(cm('admin-acks', {})) }));
    expect(v.status).toBe('go');
    expect(v.reason).toMatch(/no admin acknowledgement is required/);
  });

  it('is no_go when a removed API is in use, with callers', () => {
    const v = computeApiRemovalVerdict(inputs({ apiRequestCounts: ok([arc('flowschemas.v1beta3.flowcontrol.apiserver.k8s.io', '1.32', 42, [['ci-bot', 'helm/3', 42]])]) }));
    expect(v.status).toBe('no_go');
    expect(v.inUse[0].callers[0]).toMatchObject({ username: 'ci-bot', userAgent: 'helm/3' });
    expect(v.reason).toMatch(/1 API removed in Kubernetes 1\.32 was called 42 times/);
  });

  it('is no_go when a gate for the target is not acknowledged', () => {
    const v = computeApiRemovalVerdict(inputs({ adminAcks: ok(cm('admin-acks', {})) }));
    expect(v.status).toBe('no_go');
    expect(v.gates).toEqual([{ key: GATE, description: 'Kubernetes 1.32 removes v1beta3 FlowSchema.', acknowledged: false }]);
    expect(v.reason).toMatch(/admin acknowledgement for 4\.19 is not given/);
  });

  it('treats a missing admin-acks ConfigMap as nothing acknowledged', () => {
    expect(computeApiRemovalVerdict(inputs({ adminAcks: { state: 'absent' } })).status).toBe('no_go');
  });

  it.each([
    ['403', { state: 'error', reason: 'Permission denied (403)' } as const, /APIRequestCounts could not be read \(Permission denied \(403\)\)/],
    ['500', { state: 'error', reason: 'Request failed (500)' } as const, /Request failed \(500\)/],
    ['404', { state: 'absent' } as const, /not available on this cluster/],
  ])('is unknown, never go, when APIRequestCounts read returns %s', (_label, res, re) => {
    const v = computeApiRemovalVerdict(inputs({ apiRequestCounts: res }));
    expect(v.status).toBe('unknown');
    expect(v.reason).toMatch(/^Could not check/);
    expect(v.reason).toMatch(re);
  });

  it('is unknown when admin-gates or admin-acks cannot be read, and the gate state is unknown rather than unacknowledged', () => {
    expect(computeApiRemovalVerdict(inputs({ adminGates: { state: 'error', reason: 'Permission denied (403)' } })).status).toBe('unknown');
    const v = computeApiRemovalVerdict(inputs({ adminAcks: { state: 'error', reason: 'Request failed (500)' } }));
    expect(v.status).toBe('unknown');
    expect(v.gates[0].acknowledged).toBeNull();
    expect(v.reason).toMatch(/admin-acks ConfigMap could not be read/);
  });

  it('still reports blockers it found when another read failed, but stays unknown', () => {
    const v = computeApiRemovalVerdict(inputs({
      apiRequestCounts: ok([arc('flowschemas.v1beta3.flowcontrol.apiserver.k8s.io', '1.32', 3)]),
      adminAcks: { state: 'error', reason: 'Request failed (500)' },
    }));
    expect(v.status).toBe('unknown');
    expect(v.inUse).toHaveLength(1);
    expect(v.reason).toMatch(/Found so far: 1 API removed/);
  });

  it('is unknown when the ClusterVersion is unreadable or the target cannot be determined', () => {
    expect(computeApiRemovalVerdict(inputs({ clusterVersion: null })).status).toBe('unknown');
    expect(computeApiRemovalVerdict(inputs({ clusterVersion: cv('', { history: [] }) })).status).toBe('unknown');
    expect(computeApiRemovalVerdict(inputs({ targetVersion: '4.17' })).status).toBe('unknown');
    expect(computeApiRemovalVerdict(inputs({ targetVersion: 'garbage' })).status).toBe('unknown');
  });

  it('checks a picked target: two minors ahead includes later removals and gates', () => {
    const v = computeApiRemovalVerdict(inputs({
      targetVersion: '4.20.1',
      apiRequestCounts: ok([arc('x.v1beta1.example.io', '1.33', 5)]),
      adminGates: ok(cm('admin-gates', { [GATE]: 'd1', 'ack-4.19-kube-1.33-api-removals-in-4.20': 'd2' })),
      adminAcks: ok(cm('admin-acks', { [GATE]: 'true' })),
    }));
    expect(v.target).toEqual({ ocp: '4.20', kube: '1.33' });
    expect(v.status).toBe('no_go');
    expect(v.inUse).toHaveLength(1);
    expect(v.gates.filter((g) => !g.acknowledged).map((g) => g.key)).toEqual(['ack-4.19-kube-1.33-api-removals-in-4.20']);
    // The same API is not a blocker for 4.19, which ships 1.32.
    expect(computeApiRemovalVerdict(inputs({ apiRequestCounts: ok([arc('x.v1beta1.example.io', '1.33', 5)]) })).status).toBe('go');
  });

  it('handles an empty APIRequestCount list as go when no gate is pending', () => {
    expect(computeApiRemovalVerdict(inputs({ apiRequestCounts: ok([]) })).status).toBe('go');
  });
});
