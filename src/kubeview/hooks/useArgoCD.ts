/**
 * useArgoCD — hook for accessing ArgoCD state in components.
 * Triggers detection on first use. All ArgoCD features gate on `available`.
 */

import { useEffect } from 'react';
import { useArgoCDStore } from '../store/argoCDStore';
import type { ArgoSyncInfo, ArgoApplication } from '../engine/types';

/**
 * Run Argo CD detection for the active cluster if it has not run yet.
 * A cluster switch resets the store (detected=false), so this re-detects
 * for the new cluster instead of leaving GitOps badges hidden.
 */
function useArgoDetection() {
  const detecting = useArgoCDStore((s) => s.detecting);
  const detected = useArgoCDStore((s) => s.detected);
  const detect = useArgoCDStore((s) => s.detect);

  // Trigger detection once — don't retry after detection completes
  useEffect(() => {
    if (!detected && !detecting) {
      detect();
    }
  }, [detected, detecting, detect]);
}

/** Check if ArgoCD is available and get applications */
export function useArgoCD() {
  const available = useArgoCDStore((s) => s.available);
  const detecting = useArgoCDStore((s) => s.detecting);
  const applications = useArgoCDStore((s) => s.applications);
  const applicationsLoading = useArgoCDStore((s) => s.applicationsLoading);
  const namespace = useArgoCDStore((s) => s.namespace);
  useArgoDetection();

  return { available, detecting, applications, applicationsLoading, namespace };
}

/**
 * Lookup sync info for a specific resource. Detects Argo CD itself, so a
 * Detail page shows its GitOps badge/card/history without the user having
 * visited /gitops first, and again after a cluster switch.
 */
export function useArgoSyncInfo(kind: string, namespace: string | undefined, name: string): ArgoSyncInfo | undefined {
  const available = useArgoCDStore((s) => s.available);
  const lookupResource = useArgoCDStore((s) => s.lookupResource);
  useArgoDetection();

  if (!available) return undefined;
  return lookupResource(kind, namespace, name);
}

/** Get all out-of-sync resources */
export function useArgoDrift(): ArgoApplication[] {
  const applications = useArgoCDStore((s) => s.applications);
  return applications.filter(
    (app) => app.status?.sync?.status === 'OutOfSync'
  );
}

/** Refresh ArgoCD data (re-fetch applications and rebuild cache) */
export function useArgoCDRefresh() {
  const loadApplications = useArgoCDStore((s) => s.loadApplications);
  return loadApplications;
}
