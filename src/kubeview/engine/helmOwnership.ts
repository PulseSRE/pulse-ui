/**
 * Helm ownership of a live object.
 *
 * Helm 3 marks every object it creates with the label
 * `app.kubernetes.io/managed-by: Helm` and the annotations
 * `meta.helm.sh/release-name` / `meta.helm.sh/release-namespace` (it refuses
 * to adopt an object without them). An object with these is overwritten by
 * the release on its next upgrade or rollback, so a hand edit — including a
 * workload-level rollback — does not last.
 */
import type { K8sResource } from './renderers';

export interface HelmOwner {
  release: string;
  namespace: string;
  /** `helm.sh/chart` label, when present (e.g. "checkout-3.2.1"). */
  chart?: string;
}

export function helmOwnerOf(resource: Pick<K8sResource, 'metadata'> | null | undefined): HelmOwner | null {
  const md = resource?.metadata;
  if (!md) return null;
  if (md.labels?.['app.kubernetes.io/managed-by'] !== 'Helm') return null;
  const release = md.annotations?.['meta.helm.sh/release-name'];
  if (!release) return null;
  const namespace = md.annotations?.['meta.helm.sh/release-namespace'] || md.namespace || '';
  return { release, namespace, chart: md.labels?.['helm.sh/chart'] };
}

export type HelmReleaseAction = 'values' | 'rollback' | 'uninstall';

/** The Helm releases list, opened on this release (and its action dialog). */
export function helmReleasePath(owner: HelmOwner, action?: HelmReleaseAction): string {
  const q = new URLSearchParams({ tab: 'helm', release: owner.release, releaseNs: owner.namespace });
  if (action) q.set('action', action);
  return `/software?${q.toString()}`;
}
