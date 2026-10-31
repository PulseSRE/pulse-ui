/**
 * ArgoCD resource types (argoproj.io/v1alpha1).
 * Only present on clusters with ArgoCD/OpenShift GitOps installed.
 */

import type { ObjectMeta, Condition } from './common';

export interface ArgoApplication {
  apiVersion: 'argoproj.io/v1alpha1';
  kind: 'Application';
  metadata: ObjectMeta;
  spec?: {
    source?: ArgoSource;
    sources?: ArgoSource[];
    destination: {
      server?: string;
      namespace?: string;
      name?: string;
    };
    project: string;
    syncPolicy?: {
      automated?: {
        prune?: boolean;
        selfHeal?: boolean;
        allowEmpty?: boolean;
      };
      syncOptions?: string[];
      retry?: {
        limit?: number;
        backoff?: { duration?: string; factor?: number; maxDuration?: string };
      };
    };
  };
  status?: {
    sync: {
      status: ArgoSyncStatus;
      revision?: string;
      comparedTo?: {
        source?: ArgoSource;
        destination?: { server?: string; namespace?: string };
      };
    };
    health: {
      status: ArgoHealthStatus;
      message?: string;
    };
    operationState?: {
      phase: string;
      message?: string;
      startedAt?: string;
      finishedAt?: string;
      syncResult?: {
        revision: string;
        resources?: ArgoManagedResource[];
      };
    };
    resources?: ArgoManagedResource[];
    history?: ArgoSyncHistoryEntry[];
    reconciledAt?: string;
    conditions?: Array<{ type: string; message: string; lastTransitionTime?: string }>;
    summary?: {
      images?: string[];
      externalURLs?: string[];
    };
  };
  operation?: {
    initiatedBy?: { username?: string; automated?: boolean };
    sync?: { revision?: string; revisions?: string[]; prune?: boolean; syncOptions?: string[] };
  };
}

export interface ArgoSource {
  repoURL: string;
  path?: string;
  targetRevision?: string;
  chart?: string;
  helm?: {
    valueFiles?: string[];
    values?: string;
    parameters?: Array<{ name: string; value: string }>;
    releaseName?: string;
  };
  kustomize?: {
    namePrefix?: string;
    nameSuffix?: string;
    images?: string[];
  };
  directory?: {
    recurse?: boolean;
    include?: string;
    exclude?: string;
  };
}

export interface ArgoManagedResource {
  group: string;
  version: string;
  kind: string;
  namespace: string;
  name: string;
  status: ArgoSyncStatus;
  health?: {
    status: ArgoHealthStatus;
    message?: string;
  };
  requiresPruning?: boolean;
}

export interface ArgoSyncHistoryEntry {
  id: number;
  revision: string;
  deployedAt: string;
  deployStartedAt?: string;
  source?: ArgoSource;
  sources?: ArgoSource[];
}

export interface ArgoAppProject {
  apiVersion: 'argoproj.io/v1alpha1';
  kind: 'AppProject';
  metadata: ObjectMeta;
  spec?: {
    description?: string;
    sourceRepos?: string[];
    destinations?: Array<{ server?: string; namespace?: string; name?: string }>;
    clusterResourceWhitelist?: Array<{ group: string; kind: string }>;
    namespaceResourceWhitelist?: Array<{ group: string; kind: string }>;
    roles?: Array<{ name: string; description?: string; policies?: string[]; groups?: string[] }>;
  };
}

export type ArgoSyncStatus = 'Synced' | 'OutOfSync' | 'Unknown';
export type ArgoHealthStatus = 'Healthy' | 'Degraded' | 'Progressing' | 'Suspended' | 'Missing' | 'Unknown';

/** Lookup info for a single resource managed by ArgoCD */
export interface ArgoSyncInfo {
  appName: string;
  appNamespace: string;
  syncStatus: ArgoSyncStatus;
  healthStatus?: ArgoHealthStatus;
  revision?: string;
  repoURL?: string;
  path?: string;
}
