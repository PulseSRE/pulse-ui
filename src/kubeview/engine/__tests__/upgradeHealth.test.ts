import { describe, it, expect } from 'vitest';
import {
  getMachineConfigPoolProgress,
  summarizeMachineConfigPools,
  getNodeRolloutStatus,
  getNodesInRollout,
  getDrainBlockingNodes,
  getBlockingPdbs,
  detectDesiredUpdateMismatch,
  getUpgradeableBlocker,
  getConditionalUpdateRisks,
  getDegradedOperators,
  estimateUpgradeEta,
} from '../upgradeHealth';
import type { ClusterVersion, ClusterOperator, MachineConfigPool, Node } from '../types';

// ---- Fixtures ----

function makePool(overrides: Partial<NonNullable<MachineConfigPool['status']>> = {}, name = 'worker'): MachineConfigPool {
  return {
    apiVersion: 'machineconfiguration.openshift.io/v1',
    kind: 'MachineConfigPool',
    metadata: { name, uid: `mcp-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
    status: {
      machineCount: 3,
      readyMachineCount: 3,
      updatedMachineCount: 3,
      degradedMachineCount: 0,
      unavailableMachineCount: 0,
      configuration: { name: 'rendered-worker-abc123' },
      conditions: [
        { type: 'Updated', status: 'True' },
        { type: 'Updating', status: 'False' },
        { type: 'Degraded', status: 'False' },
        { type: 'RenderDegraded', status: 'False' },
      ],
      ...overrides,
    },
  };
}

function makeNode(name: string, overrides: Partial<{
  annotations: Record<string, string>;
  ready: boolean;
  unschedulable: boolean;
}> = {}): Node {
  const { annotations = {}, ready = true, unschedulable = false } = overrides;
  return {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: { name, uid: `node-${name}`, creationTimestamp: '2026-01-01T00:00:00Z', annotations },
    spec: { unschedulable },
    status: { conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] },
  };
}

function makeClusterVersion(overrides: Partial<ClusterVersion> = {}): ClusterVersion {
  return {
    apiVersion: 'config.openshift.io/v1',
    kind: 'ClusterVersion',
    metadata: { name: 'version', uid: 'cv-1', creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: { clusterID: 'cluster-abc', channel: 'stable-4.21' },
    status: { conditions: [], history: [] },
    ...overrides,
  };
}

function makeOperator(name: string, degraded = false, message = 'operator is degraded'): ClusterOperator {
  return {
    apiVersion: 'config.openshift.io/v1',
    kind: 'ClusterOperator',
    metadata: { name, uid: `co-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
    status: {
      conditions: [
        { type: 'Available', status: degraded ? 'False' : 'True' },
        { type: 'Degraded', status: degraded ? 'True' : 'False', message: degraded ? message : undefined, reason: degraded ? 'SyncError' : undefined },
      ],
    },
  };
}

// ---- MachineConfigPool rollout progress ----

describe('getMachineConfigPoolProgress', () => {
  it('reports real per-pool counts and Updated state — e.g. "3/6 worker nodes updated"', () => {
    const pool = makePool({ machineCount: 6, updatedMachineCount: 6, readyMachineCount: 6 }, 'worker');
    const result = getMachineConfigPoolProgress(pool);
    expect(result.name).toBe('worker');
    expect(result.machineCount).toBe(6);
    expect(result.updatedMachineCount).toBe(6);
    expect(result.isUpdated).toBe(true);
    expect(result.isUpdating).toBe(false);
    expect(result.isDegraded).toBe(false);
  });

  it('reports partial progress mid-rollout', () => {
    const pool = makePool({
      machineCount: 6, updatedMachineCount: 3, readyMachineCount: 4, unavailableMachineCount: 1,
      conditions: [{ type: 'Updated', status: 'False' }, { type: 'Updating', status: 'True' }, { type: 'Degraded', status: 'False' }],
    });
    const result = getMachineConfigPoolProgress(pool);
    expect(result.updatedMachineCount).toBe(3);
    expect(result.machineCount).toBe(6);
    expect(result.isUpdating).toBe(true);
    expect(result.isUpdated).toBe(false);
  });

  it('surfaces the real Degraded condition message, not just a badge', () => {
    const pool = makePool({
      degradedMachineCount: 1,
      conditions: [
        { type: 'Updated', status: 'False' },
        { type: 'Degraded', status: 'True', message: 'Node worker-3 is reporting: "failed to drain node: pod disruption budget violated"' },
      ],
    });
    const result = getMachineConfigPoolProgress(pool);
    expect(result.isDegraded).toBe(true);
    expect(result.degradedMessage).toContain('pod disruption budget violated');
  });

  it('falls back to RenderDegraded message when Degraded has none', () => {
    const pool = makePool({
      conditions: [
        { type: 'Updated', status: 'False' },
        { type: 'Degraded', status: 'False' },
        { type: 'RenderDegraded', status: 'True', message: 'error rendering machine config: invalid ignition' },
      ],
    });
    const result = getMachineConfigPoolProgress(pool);
    expect(result.isDegraded).toBe(true);
    expect(result.degradedMessage).toContain('invalid ignition');
  });

  it('summarizes multiple pools (master + worker)', () => {
    const pools = [makePool({}, 'master'), makePool({ machineCount: 6, updatedMachineCount: 2 }, 'worker')];
    const result = summarizeMachineConfigPools(pools);
    expect(result.map((p) => p.name)).toEqual(['master', 'worker']);
    expect(result[1].updatedMachineCount).toBe(2);
  });
});

// ---- Node rollout status ----

describe('getNodeRolloutStatus / getNodesInRollout', () => {
  it('reads real MCO annotations for current vs desired config', () => {
    const node = makeNode('worker-1', {
      annotations: {
        'machineconfiguration.openshift.io/state': 'Working',
        'machineconfiguration.openshift.io/desiredConfig': 'rendered-worker-new',
        'machineconfiguration.openshift.io/currentConfig': 'rendered-worker-old',
      },
    });
    const status = getNodeRolloutStatus(node);
    expect(status.mcoState).toBe('Working');
    expect(status.needsUpdate).toBe(true);
  });

  it('treats matching desired/current config as fully applied', () => {
    const node = makeNode('worker-2', {
      annotations: {
        'machineconfiguration.openshift.io/state': 'Done',
        'machineconfiguration.openshift.io/desiredConfig': 'rendered-worker-x',
        'machineconfiguration.openshift.io/currentConfig': 'rendered-worker-x',
      },
    });
    const status = getNodeRolloutStatus(node);
    expect(status.needsUpdate).toBe(false);
  });

  it('getNodesInRollout only returns nodes mid-update, not fully-Done ones', () => {
    const done = makeNode('worker-1', { annotations: { 'machineconfiguration.openshift.io/state': 'Done', 'machineconfiguration.openshift.io/desiredConfig': 'a', 'machineconfiguration.openshift.io/currentConfig': 'a' } });
    const working = makeNode('worker-2', { annotations: { 'machineconfiguration.openshift.io/state': 'Working', 'machineconfiguration.openshift.io/desiredConfig': 'b', 'machineconfiguration.openshift.io/currentConfig': 'a' } });
    const result = getNodesInRollout([done, working]);
    expect(result.map((n) => n.name)).toEqual(['worker-2']);
  });

  it('surfaces the real machineconfiguration.openshift.io/reason annotation for degraded nodes', () => {
    const node = makeNode('worker-3', {
      annotations: {
        'machineconfiguration.openshift.io/state': 'Degraded',
        'machineconfiguration.openshift.io/reason': 'failed to drain node: timed out waiting for the condition',
      },
    });
    const status = getNodeRolloutStatus(node);
    expect(status.reason).toBe('failed to drain node: timed out waiting for the condition');
  });
});

describe('getDrainBlockingNodes', () => {
  it('flags cordoned/unschedulable nodes', () => {
    const node = makeNode('worker-1', { unschedulable: true });
    const result = getDrainBlockingNodes([node]);
    expect(result).toHaveLength(1);
    expect(result[0].unschedulable).toBe(true);
  });

  it('flags NotReady nodes', () => {
    const node = makeNode('worker-1', { ready: false });
    const result = getDrainBlockingNodes([node]);
    expect(result).toHaveLength(1);
    expect(result[0].ready).toBe(false);
  });

  it('does not flag healthy, schedulable nodes', () => {
    const node = makeNode('worker-1');
    expect(getDrainBlockingNodes([node])).toHaveLength(0);
  });
});

// ---- Blocking PodDisruptionBudgets ----

describe('getBlockingPdbs', () => {
  const rolloutNodes = getNodesInRollout([
    makeNode('worker-1', { annotations: { 'machineconfiguration.openshift.io/state': 'Working', 'machineconfiguration.openshift.io/desiredConfig': 'b', 'machineconfiguration.openshift.io/currentConfig': 'a' } }),
  ]);

  it('flags a PDB with disruptionsAllowed=0 whose pod sits on a node mid-rollout', () => {
    const pdbs = [{ metadata: { name: 'app-pdb', namespace: 'my-app' }, spec: { selector: { matchLabels: { app: 'my-app' } } }, status: { disruptionsAllowed: 0 } }];
    const pods = [{ metadata: { name: 'my-app-1', namespace: 'my-app', labels: { app: 'my-app' } }, spec: { nodeName: 'worker-1' } }];
    const result = getBlockingPdbs(pdbs, pods, rolloutNodes);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('app-pdb');
    expect(result[0].blockedNodeNames).toEqual(['worker-1']);
  });

  it('does not flag a PDB that still allows disruptions', () => {
    const pdbs = [{ metadata: { name: 'app-pdb', namespace: 'my-app' }, spec: { selector: { matchLabels: { app: 'my-app' } } }, status: { disruptionsAllowed: 1 } }];
    const pods = [{ metadata: { name: 'my-app-1', namespace: 'my-app', labels: { app: 'my-app' } }, spec: { nodeName: 'worker-1' } }];
    expect(getBlockingPdbs(pdbs, pods, rolloutNodes)).toHaveLength(0);
  });

  it('does not flag a PDB whose covered pods are on a node that is not mid-rollout', () => {
    const pdbs = [{ metadata: { name: 'app-pdb', namespace: 'my-app' }, spec: { selector: { matchLabels: { app: 'my-app' } } }, status: { disruptionsAllowed: 0 } }];
    const pods = [{ metadata: { name: 'my-app-1', namespace: 'my-app', labels: { app: 'my-app' } }, spec: { nodeName: 'worker-99-not-updating' } }];
    expect(getBlockingPdbs(pdbs, pods, rolloutNodes)).toHaveLength(0);
  });

  it('skips PDBs with an empty selector rather than guessing at a match', () => {
    const pdbs = [{ metadata: { name: 'no-selector-pdb', namespace: 'my-app' }, spec: { selector: { matchLabels: {} } }, status: { disruptionsAllowed: 0 } }];
    const pods = [{ metadata: { name: 'my-app-1', namespace: 'my-app', labels: { app: 'my-app' } }, spec: { nodeName: 'worker-1' } }];
    expect(getBlockingPdbs(pdbs, pods, rolloutNodes)).toHaveLength(0);
  });

  it('returns nothing when no nodes are mid-rollout', () => {
    const pdbs = [{ metadata: { name: 'app-pdb', namespace: 'my-app' }, spec: { selector: { matchLabels: { app: 'my-app' } } }, status: { disruptionsAllowed: 0 } }];
    const pods = [{ metadata: { name: 'my-app-1', namespace: 'my-app', labels: { app: 'my-app' } }, spec: { nodeName: 'worker-1' } }];
    expect(getBlockingPdbs(pdbs, pods, [])).toHaveLength(0);
  });
});

// ---- Stuck / no-op desiredUpdate detection ----
// Regression coverage for the exact production bug class fixed at the
// write-path in UpdatesTab's handleStartUpdate (PR #50): spec.desiredUpdate
// paired with a stale image silently no-ops. This is the read-path guard
// that detects the same symptom regardless of what set spec.desiredUpdate.

describe('detectDesiredUpdateMismatch', () => {
  it('flags a version requested but never applied (stale-image no-op), after the grace window', () => {
    const now = new Date('2026-08-18T12:10:00Z').getTime();
    const cv = makeClusterVersion({
      spec: { desiredUpdate: { version: '4.21.28', image: 'quay.io/openshift-release-dev/ocp-release@sha256:oldimage' } },
      status: {
        desired: { version: '4.21.27', image: 'quay.io/openshift-release-dev/ocp-release@sha256:oldimage' },
        conditions: [{ type: 'Progressing', status: 'False', lastTransitionTime: '2026-08-18T10:00:00Z' }],
      },
    });
    const result = detectDesiredUpdateMismatch(cv, { now });
    expect(result).not.toBeNull();
    expect(result?.requestedVersion).toBe('4.21.28');
    expect(result?.actualVersion).toBe('4.21.27');
    expect(result?.mismatchKind).toBe('version');
    expect(result?.minutesSinceProgressingStable).toBe(130);
  });

  it('flags an image mismatch as the authoritative mismatch kind when both version and image disagree', () => {
    const now = new Date('2026-08-18T12:10:00Z').getTime();
    const cv = makeClusterVersion({
      spec: { desiredUpdate: { version: '4.21.28', image: 'quay.io/openshift-release-dev/ocp-release@sha256:newimage' } },
      status: {
        desired: { version: '4.21.27', image: 'quay.io/openshift-release-dev/ocp-release@sha256:oldimage' },
        conditions: [{ type: 'Progressing', status: 'False', lastTransitionTime: '2026-08-18T10:00:00Z' }],
      },
    });
    const result = detectDesiredUpdateMismatch(cv, { now });
    expect(result?.mismatchKind).toBe('image');
  });

  it('does NOT flag as stuck while Progressing=True (a real update is legitimately underway)', () => {
    const cv = makeClusterVersion({
      spec: { desiredUpdate: { version: '4.21.28', image: 'sha256:x' } },
      status: {
        desired: { version: '4.21.27', image: 'sha256:old' },
        conditions: [{ type: 'Progressing', status: 'True', lastTransitionTime: '2026-08-18T10:00:00Z' }],
      },
    });
    expect(detectDesiredUpdateMismatch(cv)).toBeNull();
  });

  it('does NOT flag within the grace window right after a legitimate patch', () => {
    const now = new Date('2026-08-18T10:01:00Z').getTime(); // 1 minute after lastTransitionTime
    const cv = makeClusterVersion({
      spec: { desiredUpdate: { version: '4.21.28', image: 'sha256:new' } },
      status: {
        desired: { version: '4.21.27', image: 'sha256:old' },
        conditions: [{ type: 'Progressing', status: 'False', lastTransitionTime: '2026-08-18T10:00:00Z' }],
      },
    });
    expect(detectDesiredUpdateMismatch(cv, { now, graceMinutes: 2 })).toBeNull();
  });

  it('does NOT flag when nothing has been requested', () => {
    const cv = makeClusterVersion({ spec: {}, status: { desired: { version: '4.21.27', image: 'sha256:old' }, conditions: [] } });
    expect(detectDesiredUpdateMismatch(cv)).toBeNull();
  });

  it('does NOT flag when requested version/image match what is already active', () => {
    const cv = makeClusterVersion({
      spec: { desiredUpdate: { version: '4.21.27', image: 'sha256:old' } },
      status: { desired: { version: '4.21.27', image: 'sha256:old' }, conditions: [{ type: 'Progressing', status: 'False' }] },
    });
    expect(detectDesiredUpdateMismatch(cv)).toBeNull();
  });

  it('handles a missing clusterVersion gracefully', () => {
    expect(detectDesiredUpdateMismatch(null)).toBeNull();
    expect(detectDesiredUpdateMismatch(undefined)).toBeNull();
  });
});

// ---- Upgradeable=False / admin-ack blockers ----

describe('getUpgradeableBlocker', () => {
  it('returns null when Upgradeable is True or absent', () => {
    expect(getUpgradeableBlocker(makeClusterVersion({ status: { conditions: [{ type: 'Upgradeable', status: 'True' }] } }))).toBeNull();
    expect(getUpgradeableBlocker(makeClusterVersion({ status: { conditions: [] } }))).toBeNull();
  });

  it('surfaces the real Upgradeable=False message and reason verbatim', () => {
    const message = 'Kubernetes 1.25 and therefore OpenShift 4.12 remove several APIs which require admin consideration.';
    const cv = makeClusterVersion({ status: { conditions: [{ type: 'Upgradeable', status: 'False', reason: 'AdminAckRequired', message }] } });
    const result = getUpgradeableBlocker(cv);
    expect(result?.message).toBe(message);
    expect(result?.reason).toBe('AdminAckRequired');
  });

  it('extracts a literal admin-acks unblock command when the message includes one, without inventing the ConfigMap key', () => {
    const message = 'Admin ack required. Run the following to acknowledge: oc -n openshift-config patch configmap admin-acks --patch \'{"data":{"ack-4.11-kube-1.25-api-removals-in-4.12":"true"}}\' --type=merge';
    const cv = makeClusterVersion({ status: { conditions: [{ type: 'Upgradeable', status: 'False', message }] } });
    const result = getUpgradeableBlocker(cv);
    expect(result?.adminAckCommand).toContain('ack-4.11-kube-1.25-api-removals-in-4.12');
  });

  it('returns null adminAckCommand (rather than a fabricated one) when the message has no literal command', () => {
    const cv = makeClusterVersion({ status: { conditions: [{ type: 'Upgradeable', status: 'False', message: 'Not upgradeable for an unspecified reason.' }] } });
    expect(getUpgradeableBlocker(cv)?.adminAckCommand).toBeNull();
  });
});

// ---- Conditional update risks ----

describe('getConditionalUpdateRisks', () => {
  it('returns an empty list when there are no conditionalUpdates', () => {
    expect(getConditionalUpdateRisks(makeClusterVersion())).toEqual([]);
  });

  it('flattens real risk entries verbatim, including message and url', () => {
    const cv = makeClusterVersion({
      status: {
        conditionalUpdates: [
          {
            release: { version: '4.21.29', image: 'sha256:risky' },
            risks: [{ name: 'AwsCsiKnownIssue', message: 'This update path is known to cause CSI driver instability on AWS.', url: 'https://access.redhat.com/solutions/1234' }],
          },
        ],
      },
    });
    const result = getConditionalUpdateRisks(cv);
    expect(result).toEqual([{ version: '4.21.29', image: 'sha256:risky', riskName: 'AwsCsiKnownIssue', message: 'This update path is known to cause CSI driver instability on AWS.', url: 'https://access.redhat.com/solutions/1234' }]);
  });

  it('skips risk entries with no message rather than fabricating one', () => {
    const cv = makeClusterVersion({
      status: { conditionalUpdates: [{ release: { version: '4.21.29' }, risks: [{ name: 'NoMessage' }] }] },
    });
    expect(getConditionalUpdateRisks(cv)).toEqual([]);
  });
});

// ---- Degraded operators ----

describe('getDegradedOperators', () => {
  it('returns the real Degraded condition message for each degraded operator', () => {
    const operators = [makeOperator('console', false), makeOperator('etcd', true, 'EtcdMembersDegraded: 1 of 3 members are unhealthy')];
    const result = getDegradedOperators(operators);
    expect(result).toEqual([{ name: 'etcd', message: 'EtcdMembersDegraded: 1 of 3 members are unhealthy', reason: 'SyncError' }]);
  });

  it('returns an empty list when nothing is degraded', () => {
    expect(getDegradedOperators([makeOperator('console', false)])).toEqual([]);
  });
});

// ---- Evidence-based ETA ----

describe('estimateUpgradeEta', () => {
  it('derives an ETA from observed MachineConfigPool rollout rate when progress data exists', () => {
    // 20 minutes elapsed, 2/6 nodes updated => 10 min/node => 4 remaining => ~40 min
    const now = new Date('2026-08-18T12:20:00Z').getTime();
    const result = estimateUpgradeEta({
      progressingSince: '2026-08-18T12:00:00Z',
      pools: [{ name: 'worker', machineCount: 6, updatedMachineCount: 2, readyMachineCount: 2, degradedMachineCount: 0, unavailableMachineCount: 0, isUpdating: true, isDegraded: false, isUpdated: false, degradedMessage: undefined, configuration: '' }],
      nodeCount: 6,
      now,
    });
    expect(result.isEvidenceBased).toBe(true);
    expect(result.minutes).toBe(40);
  });

  it('falls back to the rough per-node guess when there is no observed progress yet', () => {
    const result = estimateUpgradeEta({ progressingSince: undefined, pools: [], nodeCount: 3 });
    expect(result.isEvidenceBased).toBe(false);
    expect(result.minutes).toBe(30); // Math.max(30, 3 * 10)
    expect(result.label).toContain('Rough estimate');
  });

  it('falls back to the rough guess when 0 nodes have updated yet (rate would be undefined)', () => {
    const result = estimateUpgradeEta({
      progressingSince: '2026-08-18T12:00:00Z',
      pools: [{ name: 'worker', machineCount: 6, updatedMachineCount: 0, readyMachineCount: 6, degradedMachineCount: 0, unavailableMachineCount: 0, isUpdating: true, isDegraded: false, isUpdated: false, degradedMessage: undefined, configuration: '' }],
      nodeCount: 6,
      now: new Date('2026-08-18T12:05:00Z').getTime(),
    });
    expect(result.isEvidenceBased).toBe(false);
    expect(result.minutes).toBe(60); // Math.max(30, 6 * 10)
  });

  it('uses the larger node-count fallback rough estimate for big clusters', () => {
    const result = estimateUpgradeEta({ progressingSince: undefined, pools: [], nodeCount: 12 });
    expect(result.minutes).toBe(120);
  });
});
