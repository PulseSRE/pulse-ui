/**
 * Helm ownership on resource pages: a badge in the header, the release a
 * resource belongs to, and the note shown wherever a hand edit or a
 * workload-level rollback would be undone by the release.
 */
import { useQuery } from '@tanstack/react-query';
import { Ship } from 'lucide-react';
import { k8sFetch } from '../engine/query';
import { summarizeHelmReleases, type HelmReleaseSummary } from '../engine/helmRelease';
import { helmOwnerOf, helmReleasePath, type HelmOwner } from '../engine/helmOwnership';
import type { Secret } from '../engine/types';
import type { K8sResource } from '../engine/renderers';
import { useFleetStore } from '../store/fleetStore';
import { useNavigateTab } from '../hooks/useNavigateTab';

/** The release record of `owner` (reads its Helm storage Secrets' labels and record). */
export function useHelmRelease(owner: HelmOwner | null, clusterIdOverride?: string) {
  const active = useFleetStore((s) => s.activeClusterId);
  const clusterId = clusterIdOverride ?? active;
  return useQuery<HelmReleaseSummary | null>({
    queryKey: ['helm', 'release', clusterId, owner?.namespace, owner?.release],
    queryFn: async () => {
      const sel = encodeURIComponent(`owner=helm,name=${owner!.release}`);
      const res = await k8sFetch(clusterId, `/api/v1/namespaces/${owner!.namespace}/secrets?labelSelector=${sel}`);
      if (!res.ok) throw new Error(`The release record could not be read (${res.status} ${res.statusText})`);
      const data = await res.json();
      const [summary] = await summarizeHelmReleases((data.items || []) as Secret[]);
      return summary ?? null;
    },
    enabled: !!owner,
    retry: false,
    staleTime: 30_000,
  });
}

export function HelmOwnerBadge({ resource }: { resource: K8sResource }) {
  const owner = helmOwnerOf(resource);
  const release = useHelmRelease(owner);
  const go = useNavigateTab();
  if (!owner) return null;
  const rev = release.data ? ` rev ${release.data.revision}` : '';
  const title = release.isError
    ? `Managed by Helm release ${owner.release} in ${owner.namespace}. Its revision could not be checked: ${(release.error as Error).message}`
    : `Managed by Helm release ${owner.release} in ${owner.namespace}. Hand edits are overwritten on the next upgrade.`;
  return (
    <button
      type="button"
      onClick={() => go(helmReleasePath(owner), `Helm ${owner.release}`)}
      className="flex items-center gap-1 px-2 py-1 text-xs bg-sky-950/60 text-sky-300 rounded-sm border border-sky-800 hover:bg-sky-900/60"
      title={title}
      data-testid="helm-owner-badge"
    >
      <Ship className="w-3 h-3" aria-hidden="true" /> Helm · {owner.release}{rev}
    </button>
  );
}

/** One sentence on what the release does to hand edits, with what it was detected from. */
export function helmOwnerSentence(owner: HelmOwner, release: HelmReleaseSummary | null | undefined): string {
  const chart = release?.chart ? `Chart ${release.chart}${release.chartVersion ? `-${release.chartVersion}` : ''}` : owner.chart ? `Chart ${owner.chart}` : null;
  const rev = release ? `revision ${release.revision} (${release.status})` : null;
  return [chart, rev].filter(Boolean).join(' · ')
    + `${chart || rev ? ' · ' : ''}detected from label app.kubernetes.io/managed-by: Helm and annotation meta.helm.sh/release-name: ${owner.release}.`;
}

/**
 * Shown before a workload-level rollback of a Helm-owned workload: Helm puts
 * the release's template back on its next upgrade, so the right mechanism is
 * the release rollback.
 */
export function HelmRollbackNote({ owner, kind, onNavigate }: { owner: HelmOwner; kind: string; onNavigate?: () => void }) {
  const go = useNavigateTab();
  return (
    <div role="alert" className="mt-3 rounded-md border border-sky-800 bg-sky-950/40 px-3 py-2 text-xs text-sky-100" data-testid="helm-rollback-note">
      <p>
        This {kind} is managed by Helm release <strong>{owner.release}</strong> in {owner.namespace}. A rollback here is reverted
        by Helm on the release&apos;s next upgrade, and leaves the release&apos;s other objects as they are. Roll back the release instead.
      </p>
      <button
        type="button"
        onClick={() => { onNavigate?.(); go(helmReleasePath(owner, 'rollback'), `Helm ${owner.release}`); }}
        className="mt-2 rounded-sm bg-sky-700 px-2.5 py-1 font-medium text-white hover:bg-sky-600"
      >
        Roll back the release…
      </button>
    </div>
  );
}
