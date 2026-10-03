import { getActiveClusterId, getClusterBase } from '../engine/clusterConnection';
/**
 * ArgoCD Store — detects ArgoCD availability and maintains a resource lookup cache.
 * All ArgoCD features are gated behind `available === true`.
 */

import { create } from 'zustand';
import { k8sList, getImpersonationHeaders } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import type { ArgoApplication, ArgoSyncInfo, ArgoSyncStatus, ArgoHealthStatus } from '../engine/types';

interface ArgoCDState {
  // Detection
  available: boolean;
  detecting: boolean;
  /** True once detection has completed (regardless of result) — prevents retry loops */
  detected: boolean;
  detectionError: string | null;
  namespace: string | null; // namespace where ArgoCD apps live (e.g., 'openshift-gitops')
  rolloutsAvailable: boolean;

  // Applications
  applications: ArgoApplication[];
  applicationsLoading: boolean;

  // Rollouts
  rollouts: K8sResource[];
  rolloutsLoading: boolean;

  // Resource lookup cache: "Kind/namespace/name" -> ArgoSyncInfo
  resourceCache: Map<string, ArgoSyncInfo>;

  // Actions
  reset: () => void;
  detect: () => Promise<void>;
  loadApplications: () => Promise<void>;
  loadRollouts: () => Promise<void>;
  lookupResource: (kind: string, namespace: string | undefined, name: string) => ArgoSyncInfo | undefined;
}

function buildResourceKey(kind: string, namespace: string | undefined, name: string): string {
  return `${kind}/${namespace || '_'}/${name}`;
}

function buildResourceCache(apps: ArgoApplication[]): Map<string, ArgoSyncInfo> {
  const cache = new Map<string, ArgoSyncInfo>();

  for (const app of apps) {
    const resources = app.status?.resources || [];
    const source = app.spec?.source || app.spec?.sources?.[0];

    for (const r of resources) {
      const key = buildResourceKey(r.kind, r.namespace, r.name);
      cache.set(key, {
        appName: app.metadata.name,
        appNamespace: app.metadata.namespace || '',
        syncStatus: r.status || 'Unknown',
        healthStatus: r.health?.status as ArgoHealthStatus | undefined,
        revision: app.status?.sync?.revision,
        repoURL: source?.repoURL,
        path: source?.path,
      });
    }
  }

  return cache;
}

export const useArgoCDStore = create<ArgoCDState>((set, get) => ({
  available: false,
  detecting: false,
  detected: false,
  detectionError: null,
  namespace: null,
  rolloutsAvailable: false,
  applications: [],
  applicationsLoading: false,
  rollouts: [],
  rolloutsLoading: false,
  resourceCache: new Map(),

  reset: () => set({ available: false, detecting: false, detected: false, detectionError: null,
    namespace: null, rolloutsAvailable: false, applications: [], applicationsLoading: false,
    rollouts: [], rolloutsLoading: false, resourceCache: new Map() }),

  detect: async () => {
    const clusterId = getActiveClusterId();
    const scopedSet = (next: Partial<ArgoCDState>) => {
      if (getActiveClusterId() === clusterId) set(next);
    };
    scopedSet({ detecting: true, detectionError: null });
    try {
      // Check if argoproj.io API group exists
      const res = await fetch(`${getClusterBase(clusterId)}/apis/argoproj.io/v1alpha1`, { headers: getImpersonationHeaders() });
      if (!res.ok) {
        scopedSet({ available: false, detecting: false, detected: true });
        return;
      }

      // Check if rollouts resource exists in the API group
      let hasRollouts = false;
      try {
        const apiRes = await res.clone().json();
        const resources: Array<{ name: string }> = apiRes.resources || [];
        hasRollouts = resources.some((r: { name: string }) => r.name === 'rollouts');
      } catch {
        // Could not parse API resources, rollouts detection failed gracefully
      }
      scopedSet({ rolloutsAvailable: hasRollouts });

      // API group exists — try to find Applications
      // Check openshift-gitops first (OpenShift GitOps operator default), then argocd
      for (const ns of ['openshift-gitops', 'argocd']) {
        try {
          const apps = await k8sList<K8sResource>(
            `/apis/argoproj.io/v1alpha1/namespaces/${ns}/applications`, undefined, clusterId
          );
          // Namespace is valid (even if 0 apps, the API responded)
          scopedSet({
            available: true,
            detecting: false,
            detected: true,
            namespace: ns,
          });
          // Load applications fully
          if (getActiveClusterId() === clusterId) get().loadApplications();
          return;
        } catch {
          // Namespace doesn't exist or no access, try next
        }
      }

      // Try cluster-wide list as fallback
      try {
        const apps = await k8sList<K8sResource>(
          '/apis/argoproj.io/v1alpha1/applications', undefined, clusterId
        );
        if (apps.length > 0) {
          const firstNs = apps[0].metadata.namespace || 'openshift-gitops';
          scopedSet({
            available: true,
            detecting: false,
            detected: true,
            namespace: firstNs,
          });
          if (getActiveClusterId() === clusterId) get().loadApplications();
          return;
        }
      } catch {
        // No access to cluster-wide list
      }

      // API group exists but no apps found or accessible
      scopedSet({ available: true, detecting: false, detected: true, namespace: null });
    } catch {
      scopedSet({
        available: false,
        detecting: false,
        detected: true,
        detectionError: 'Failed to detect ArgoCD',
      });
    }
  },

  loadApplications: async () => {
    const clusterId = getActiveClusterId();
    const scopedSet = (next: Partial<ArgoCDState>) => {
      if (getActiveClusterId() === clusterId) set(next);
    };
    const { namespace } = get();
    scopedSet({ applicationsLoading: true });

    try {
      const path = namespace
        ? `/apis/argoproj.io/v1alpha1/namespaces/${namespace}/applications`
        : '/apis/argoproj.io/v1alpha1/applications';

      const typed = await k8sList<ArgoApplication>(path, undefined, clusterId);

      scopedSet({
        applications: typed,
        applicationsLoading: false,
        resourceCache: buildResourceCache(typed),
      });
    } catch {
      scopedSet({ applicationsLoading: false });
    }
  },

  loadRollouts: async () => {
    const clusterId = getActiveClusterId();
    const scopedSet = (next: Partial<ArgoCDState>) => {
      if (getActiveClusterId() === clusterId) set(next);
    };
    scopedSet({ rolloutsLoading: true });
    try {
      const items = await k8sList<K8sResource>(
        '/apis/argoproj.io/v1alpha1/rollouts', undefined, clusterId
      );
      scopedSet({ rollouts: items, rolloutsLoading: false });
    } catch {
      scopedSet({ rolloutsLoading: false });
    }
  },

  lookupResource: (kind, namespace, name) => {
    const key = buildResourceKey(kind, namespace, name);
    return get().resourceCache.get(key);
  },
}));
