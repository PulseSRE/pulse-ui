/**
 * RBAC API (rbac.authorization.k8s.io/v1) resource types.
 */

import type { ObjectMeta } from './common';

export interface PolicyRule {
  verbs: string[];
  apiGroups?: string[];
  resources?: string[];
  resourceNames?: string[];
  nonResourceURLs?: string[];
}

export interface RoleRef {
  apiGroup: string;
  kind: 'ClusterRole' | 'Role';
  name: string;
}

export interface Subject {
  kind: 'User' | 'Group' | 'ServiceAccount';
  name: string;
  namespace?: string;
  apiGroup?: string;
}

export interface ClusterRole {
  apiVersion: 'rbac.authorization.k8s.io/v1';
  kind: 'ClusterRole';
  metadata: ObjectMeta;
  rules?: PolicyRule[];
  [key: string]: unknown;
}

export interface ClusterRoleBinding {
  apiVersion: 'rbac.authorization.k8s.io/v1';
  kind: 'ClusterRoleBinding';
  metadata: ObjectMeta;
  roleRef: RoleRef;
  subjects?: Subject[];
  [key: string]: unknown;
}

export interface Role {
  apiVersion: 'rbac.authorization.k8s.io/v1';
  kind: 'Role';
  metadata: ObjectMeta;
  rules?: PolicyRule[];
  [key: string]: unknown;
}

export interface RoleBinding {
  apiVersion: 'rbac.authorization.k8s.io/v1';
  kind: 'RoleBinding';
  metadata: ObjectMeta;
  roleRef: RoleRef;
  subjects?: Subject[];
  [key: string]: unknown;
}
