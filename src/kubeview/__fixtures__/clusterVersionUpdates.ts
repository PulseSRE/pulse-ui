/**
 * ClusterVersion fixtures for the update graph: an idle cluster with
 * recommended and conditional targets, and one mid-update.
 */
import type { ClusterVersion, ClusterOperator, MachineConfigPool } from '../engine/types';

export const OVN_RISK = {
  name: 'OVNInterconnectMigration',
  message: 'Clusters on OVN may lose egress during migration.',
  url: 'https://issues.redhat.com/browse/OCPBUGS-1',
  matchingRules: [{ type: 'PromQL', promql: { promql: 'cluster_infrastructure_provider' } }],
};
export const DNS_RISK = {
  name: 'AROBrokenDNSMasq',
  message: 'dnsmasq fails on ARO.',
  url: 'https://issues.redhat.com/browse/OCPBUGS-2',
  matchingRules: [{ type: 'Always' }],
};

const history = [
  { state: 'Completed', version: '4.16.3', image: 'quay.io/ocp@sha256:aaa', startedTime: '2026-09-01T10:00:00Z', completionTime: '2026-09-01T11:20:00Z', verified: true },
  { state: 'Completed', version: '4.15.20', image: 'quay.io/ocp@sha256:999', startedTime: '2026-07-01T10:00:00Z', completionTime: '2026-07-01T10:45:00Z', verified: true },
];

export function idleClusterVersion(overrides: { upgradeableFalse?: boolean; acceptRisks?: Array<{ name: string }>; channels?: string[] } = {}): ClusterVersion {
  return {
    apiVersion: 'config.openshift.io/v1',
    kind: 'ClusterVersion',
    metadata: { name: 'version', uid: 'cv-1', creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: {
      clusterID: 'cluster-abc',
      channel: 'stable-4.16',
      ...(overrides.acceptRisks ? { desiredUpdate: { version: '4.16.3', image: 'quay.io/ocp@sha256:aaa', acceptRisks: overrides.acceptRisks } } : {}),
    },
    status: {
      desired: { version: '4.16.3', image: 'quay.io/ocp@sha256:aaa', ...(overrides.channels ? { channels: overrides.channels } : {}) },
      history,
      conditions: [
        { type: 'Available', status: 'True' },
        { type: 'Progressing', status: 'False', message: 'Cluster version is 4.16.3' },
        { type: 'RetrievedUpdates', status: 'True' },
        ...(overrides.upgradeableFalse ? [{ type: 'Upgradeable', status: 'False', reason: 'AdminAckRequired', message: 'Kubernetes 1.30 removes APIs; admin-ack required' } as const] : []),
      ],
      availableUpdates: [
        { version: '4.16.8', image: 'quay.io/ocp@sha256:bbb' },
        { version: '4.17.2', image: 'quay.io/ocp@sha256:ddd' },
      ],
      conditionalUpdates: [
        {
          release: { version: '4.17.1', image: 'quay.io/ocp@sha256:ccc' },
          risks: [OVN_RISK, DNS_RISK],
          conditions: [{ type: 'Recommended', status: 'False', reason: 'MultipleReasons', message: 'Two risks apply to this cluster' }],
        },
      ],
    },
  };
}

/** Mid-update 4.16.3 → 4.16.8; CVO now lists targets from 4.16.8. */
export function inFlightClusterVersion(): ClusterVersion {
  const cv = idleClusterVersion();
  cv.status = {
    ...cv.status!,
    desired: { version: '4.16.8', image: 'quay.io/ocp@sha256:bbb' },
    history: [{ state: 'Partial', version: '4.16.8', image: 'quay.io/ocp@sha256:bbb', startedTime: '2026-10-30T09:00:00Z' }, ...history],
    conditions: [
      { type: 'Available', status: 'True' },
      { type: 'Progressing', status: 'True', message: 'Working towards 4.16.8: 512 of 863 done (59% complete), waiting on network', lastTransitionTime: '2026-10-30T09:00:00Z' },
      { type: 'RetrievedUpdates', status: 'True' },
    ],
    availableUpdates: [{ version: '4.16.10', image: 'quay.io/ocp@sha256:eee' }],
    conditionalUpdates: [],
  };
  return cv;
}

export const operatorsMidUpdate: ClusterOperator[] = [
  { apiVersion: 'config.openshift.io/v1', kind: 'ClusterOperator', metadata: { name: 'dns', uid: 'co-dns' }, status: { versions: [{ name: 'operator', version: '4.16.8' }], conditions: [] } },
  { apiVersion: 'config.openshift.io/v1', kind: 'ClusterOperator', metadata: { name: 'network', uid: 'co-net' }, status: { versions: [{ name: 'operator', version: '4.16.3' }], conditions: [{ type: 'Degraded', status: 'True', message: 'rollout stuck' }] } },
  { apiVersion: 'config.openshift.io/v1', kind: 'ClusterOperator', metadata: { name: 'ingress', uid: 'co-ing' }, status: { versions: [{ name: 'operator', version: '4.16.8' }], conditions: [] } },
] as unknown as ClusterOperator[];

export const poolsMidUpdate: MachineConfigPool[] = [
  { apiVersion: 'machineconfiguration.openshift.io/v1', kind: 'MachineConfigPool', metadata: { name: 'master', uid: 'mcp-m' }, spec: {}, status: { machineCount: 3, updatedMachineCount: 3, conditions: [{ type: 'Updating', status: 'False' }] } },
  { apiVersion: 'machineconfiguration.openshift.io/v1', kind: 'MachineConfigPool', metadata: { name: 'worker', uid: 'mcp-w' }, spec: { paused: true }, status: { machineCount: 5, updatedMachineCount: 2, conditions: [{ type: 'Updating', status: 'True' }] } },
] as unknown as MachineConfigPool[];
