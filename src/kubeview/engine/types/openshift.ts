/**
 * OpenShift-specific resource types.
 */

import type { ObjectMeta, Condition, LabelSelector } from './common';

export interface ClusterVersion {
  apiVersion: 'config.openshift.io/v1';
  kind: 'ClusterVersion';
  metadata: ObjectMeta;
  spec?: {
    clusterID?: string;
    channel?: string;
    desiredUpdate?: { version?: string; image?: string; force?: boolean };
    upstream?: string;
  };
  status?: {
    desired?: { version: string; image: string };
    history?: Array<{ state: string; version: string; startedTime?: string; completionTime?: string; image?: string }>;
    conditions?: Condition[];
    availableUpdates?: Array<{ version: string; image?: string }>;
    // Conditional updates (config.openshift.io/v1 ClusterVersion.status.conditionalUpdates):
    // recommended updates that carry known, structured risks for this cluster's
    // specific configuration (e.g. platform, topology). Distinct from
    // availableUpdates, which lists updates with no known caveats. Each risk's
    // `message`/`url` are authored by the OpenShift update recommendation
    // service — surface them verbatim rather than summarizing.
    conditionalUpdates?: Array<{
      release?: { version?: string; image?: string; url?: string };
      risks?: Array<{
        name?: string;
        message?: string;
        url?: string;
        matchingRules?: Array<{ type?: string; [key: string]: unknown }>;
      }>;
      conditions?: Condition[];
    }>;
    observedGeneration?: number;
    versionHash?: string;
  };
  [key: string]: unknown;
}

/**
 * MachineConfigPool (machineconfiguration.openshift.io/v1) — the real
 * mechanism OpenShift node updates roll out through. `master`/`worker` (and
 * any custom pools) each track their own rollout: how many machines in the
 * pool are updated, ready, degraded, or unavailable, plus which rendered
 * MachineConfig they're converging on.
 */
export interface MachineConfigPool {
  apiVersion: 'machineconfiguration.openshift.io/v1';
  kind: 'MachineConfigPool';
  metadata: ObjectMeta;
  spec?: {
    paused?: boolean;
    maxUnavailable?: number | string;
    configuration?: { name?: string; source?: Array<{ apiVersion?: string; kind?: string; name?: string }> };
    machineConfigSelector?: LabelSelector;
    nodeSelector?: LabelSelector;
  };
  status?: {
    conditions?: Condition[];
    configuration?: { name?: string; source?: Array<{ apiVersion?: string; kind?: string; name?: string }> };
    machineCount?: number;
    readyMachineCount?: number;
    updatedMachineCount?: number;
    degradedMachineCount?: number;
    unavailableMachineCount?: number;
    observedGeneration?: number;
  };
  [key: string]: unknown;
}

export interface ClusterOperator {
  apiVersion: 'config.openshift.io/v1';
  kind: 'ClusterOperator';
  metadata: ObjectMeta;
  spec?: Record<string, unknown>;
  status?: {
    conditions?: Condition[];
    versions?: Array<{ name: string; version: string }>;
    relatedObjects?: Array<{ group: string; resource: string; namespace?: string; name: string }>;
  };
  [key: string]: unknown;
}

export interface BuildConfig {
  apiVersion: 'build.openshift.io/v1';
  kind: 'BuildConfig';
  metadata: ObjectMeta;
  spec?: {
    source?: { type?: string; git?: { uri: string; ref?: string }; contextDir?: string };
    strategy?: { type?: string; sourceStrategy?: unknown; dockerStrategy?: unknown };
    output?: { to?: { kind: string; name: string } };
    triggers?: Array<{ type: string; [key: string]: unknown }>;
    runPolicy?: string;
  };
  status?: {
    lastVersion?: number;
  };
  [key: string]: unknown;
}

export interface Build {
  apiVersion: 'build.openshift.io/v1';
  kind: 'Build';
  metadata: ObjectMeta;
  spec?: {
    source?: { type?: string; git?: { uri: string; ref?: string } };
    strategy?: { type?: string };
    output?: { to?: { kind: string; name: string } };
  };
  status?: {
    phase?: 'New' | 'Pending' | 'Running' | 'Complete' | 'Failed' | 'Error' | 'Cancelled';
    startTimestamp?: string;
    completionTimestamp?: string;
    duration?: number;
    message?: string;
    reason?: string;
  };
  [key: string]: unknown;
}

export interface ImageStream {
  apiVersion: 'image.openshift.io/v1';
  kind: 'ImageStream';
  metadata: ObjectMeta;
  spec?: {
    lookupPolicy?: { local: boolean };
    tags?: Array<{ name: string; from?: { kind: string; name: string }; importPolicy?: unknown }>;
  };
  status?: {
    dockerImageRepository?: string;
    publicDockerImageRepository?: string;
    tags?: Array<{ tag: string; items?: Array<{ created: string; dockerImageReference: string; image: string }> }>;
  };
  [key: string]: unknown;
}

export interface MachineSet {
  apiVersion: 'machine.openshift.io/v1beta1';
  kind: 'MachineSet';
  metadata: ObjectMeta;
  spec?: {
    replicas?: number;
    selector?: { matchLabels?: Record<string, string> };
    template?: { spec?: { providerSpec?: { value?: Record<string, unknown> } } };
  };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    fullyLabeledReplicas?: number;
    observedGeneration?: number;
  };
  [key: string]: unknown;
}

export interface Machine {
  apiVersion: 'machine.openshift.io/v1beta1';
  kind: 'Machine';
  metadata: ObjectMeta;
  spec?: {
    providerSpec?: { value?: Record<string, unknown> };
  };
  status?: {
    phase?: string;
    nodeRef?: { name: string; kind: string };
    providerStatus?: Record<string, unknown>;
    addresses?: Array<{ type: string; address: string }>;
  };
  [key: string]: unknown;
}

export interface NodePool {
  apiVersion: 'hypershift.openshift.io/v1beta1';
  kind: 'NodePool';
  metadata: ObjectMeta;
  spec?: {
    clusterName?: string;
    replicas?: number;
    autoScaling?: { min?: number; max?: number };
    platform?: {
      type?: string;
      aws?: { instanceType?: string; rootVolume?: { size?: number; type?: string } };
      azure?: { vmSize?: string };
      gcp?: { instanceType?: string };
    };
    release?: { image?: string };
    management?: {
      autoRepair?: boolean;
      upgradeType?: string;
      replace?: { strategy?: string; rollingUpdate?: { maxUnavailable?: number; maxSurge?: number } };
    };
    nodeLabels?: Record<string, string>;
    nodeTaints?: Array<{ key: string; value?: string; effect: string }>;
  };
  status?: {
    replicas?: number;
    version?: string;
    conditions?: Condition[];
  };
  [key: string]: unknown;
}
