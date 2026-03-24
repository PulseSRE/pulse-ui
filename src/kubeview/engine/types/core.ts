/**
 * Core API (v1) resource types.
 */

import type { ObjectMeta, Condition, ContainerStatus, PodSpec, PodTemplateSpec, ResourceRequirements, LabelSelector } from './common';

export interface Pod {
  apiVersion: 'v1';
  kind: 'Pod';
  metadata: ObjectMeta;
  spec: PodSpec;
  status?: {
    phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
    reason?: string;
    message?: string;
    conditions?: Condition[];
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
    podIP?: string;
    hostIP?: string;
    startTime?: string;
    qosClass?: string;
  };
}

export interface Node {
  apiVersion: 'v1';
  kind: 'Node';
  metadata: ObjectMeta;
  spec?: {
    unschedulable?: boolean;
    taints?: Array<{ key: string; value?: string; effect: string; timeAdded?: string }>;
    podCIDR?: string;
    providerID?: string;
  };
  status?: {
    conditions?: Condition[];
    capacity?: { cpu?: string; memory?: string; pods?: string; 'ephemeral-storage'?: string };
    allocatable?: { cpu?: string; memory?: string; pods?: string; 'ephemeral-storage'?: string };
    nodeInfo?: {
      kubeletVersion: string;
      operatingSystem: string;
      architecture: string;
      containerRuntimeVersion: string;
      osImage?: string;
      kernelVersion?: string;
      machineID?: string;
    };
    addresses?: Array<{ type: string; address: string }>;
    images?: Array<{ names?: string[]; sizeBytes?: number }>;
  };
}

export interface Service {
  apiVersion: 'v1';
  kind: 'Service';
  metadata: ObjectMeta;
  spec?: {
    type?: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
    clusterIP?: string;
    externalIPs?: string[];
    ports?: Array<{ name?: string; port: number; targetPort?: number | string; protocol?: string; nodePort?: number }>;
    selector?: Record<string, string>;
    sessionAffinity?: string;
    loadBalancerIP?: string;
    externalName?: string;
  };
  status?: {
    loadBalancer?: { ingress?: Array<{ ip?: string; hostname?: string }> };
  };
}

export interface ConfigMap {
  apiVersion: 'v1';
  kind: 'ConfigMap';
  metadata: ObjectMeta;
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
}

export interface Secret {
  apiVersion: 'v1';
  kind: 'Secret';
  metadata: ObjectMeta;
  data?: Record<string, string>;
  stringData?: Record<string, string>;
  type?: string;
}

export interface Namespace {
  apiVersion: 'v1';
  kind: 'Namespace';
  metadata: ObjectMeta;
  spec?: { finalizers?: string[] };
  status?: { phase?: 'Active' | 'Terminating'; conditions?: Condition[] };
  [key: string]: unknown;
}

export interface ServiceAccount {
  apiVersion: 'v1';
  kind: 'ServiceAccount';
  metadata: ObjectMeta;
  secrets?: Array<{ name: string }>;
  automountServiceAccountToken?: boolean;
  [key: string]: unknown;
}

export interface PersistentVolumeClaim {
  apiVersion: 'v1';
  kind: 'PersistentVolumeClaim';
  metadata: ObjectMeta;
  spec?: {
    accessModes?: string[];
    resources?: ResourceRequirements;
    storageClassName?: string;
    volumeMode?: string;
    volumeName?: string;
    selector?: LabelSelector;
  };
  status?: {
    phase?: 'Pending' | 'Bound' | 'Lost';
    accessModes?: string[];
    capacity?: Record<string, string>;
    conditions?: Condition[];
  };
}

export interface PersistentVolume {
  apiVersion: 'v1';
  kind: 'PersistentVolume';
  metadata: ObjectMeta;
  spec?: {
    capacity?: Record<string, string>;
    accessModes?: string[];
    persistentVolumeReclaimPolicy?: 'Retain' | 'Delete' | 'Recycle';
    storageClassName?: string;
    volumeMode?: string;
    claimRef?: { name: string; namespace: string; uid?: string };
    [key: string]: unknown;
  };
  status?: {
    phase?: 'Available' | 'Bound' | 'Released' | 'Failed';
    reason?: string;
  };
}

export interface Event {
  apiVersion: 'v1';
  kind: 'Event';
  metadata: ObjectMeta;
  involvedObject: { apiVersion: string; kind: string; name: string; namespace?: string; uid?: string };
  reason?: string;
  message?: string;
  type?: 'Normal' | 'Warning';
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  source?: { component?: string; host?: string };
}
