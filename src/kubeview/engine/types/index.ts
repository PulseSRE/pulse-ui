/**
 * Typed K8s resource interfaces.
 *
 * Usage: import specific types and use as generics with useK8sListWatch<Pod>()
 * or cast resources in views: `const pods = data as Pod[]`
 */

// Common sub-types
export type {
  ObjectMeta,
  OwnerReference,
  Condition,
  LabelSelector,
  Container,
  ContainerPort,
  EnvVar,
  ResourceRequirements,
  VolumeMount,
  Probe,
  ContainerStatus,
  Taint,
  Toleration,
  PodTemplateSpec,
  PodSpec,
} from './common';

// Core (v1)
export type { Pod, Node, Service, ConfigMap, Secret, Namespace, ServiceAccount, PersistentVolumeClaim, PersistentVolume, Event } from './core';

// Apps (apps/v1)
export type { Deployment, StatefulSet, DaemonSet, ReplicaSet } from './apps';

// Batch (batch/v1)
export type { Job, CronJob } from './batch';

// RBAC (rbac.authorization.k8s.io/v1)
export type { PolicyRule, RoleRef, Subject, ClusterRole, ClusterRoleBinding, Role, RoleBinding } from './rbac';

// Networking
export type { Ingress, NetworkPolicy, Route } from './networking';

// OpenShift
export type { ClusterVersion, ClusterOperator, BuildConfig, Build, ImageStream, MachineSet, Machine } from './openshift';

// Storage
export type { StorageClass, VolumeSnapshot, CSIDriver } from './storage';

// Timeline
export type { TimelineEntry, TimelineCategory, TimelineSeverity, CorrelationGroup } from './timeline';

// Union of all typed resources
export type TypedK8sResource =
  | import('./core').Pod
  | import('./core').Node
  | import('./core').Service
  | import('./core').ConfigMap
  | import('./core').Secret
  | import('./core').Namespace
  | import('./core').ServiceAccount
  | import('./core').PersistentVolumeClaim
  | import('./core').PersistentVolume
  | import('./core').Event
  | import('./apps').Deployment
  | import('./apps').StatefulSet
  | import('./apps').DaemonSet
  | import('./apps').ReplicaSet
  | import('./batch').Job
  | import('./batch').CronJob
  | import('./rbac').ClusterRole
  | import('./rbac').ClusterRoleBinding
  | import('./rbac').Role
  | import('./rbac').RoleBinding
  | import('./networking').Ingress
  | import('./networking').NetworkPolicy
  | import('./networking').Route
  | import('./openshift').ClusterVersion
  | import('./openshift').ClusterOperator
  | import('./openshift').BuildConfig
  | import('./openshift').Build
  | import('./openshift').ImageStream
  | import('./openshift').MachineSet
  | import('./openshift').Machine
  | import('./storage').StorageClass
  | import('./storage').VolumeSnapshot
  | import('./storage').CSIDriver;
