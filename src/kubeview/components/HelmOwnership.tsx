/**
 * Helm ownership on resource pages: a badge in the header, the release a
 * resource belongs to, and the note shown wherever a hand edit or a
 * workload-level rollback would be undone by the release.
 */
import { useQuery } from '@tanstack/react-query';
import { Ship } from 'lucide-react';
import { k8sFetch } from '../engine/query';
import { summarizeHelmReleases } from '../engine/helmRelease';
import { helmOwnerOf, helmReleasePath, type HelmOwner } from '../engine/helmOwnership';
import type { Secret } from '../engine/types';
import type { K8sResource } from '../engine/renderers';
import { useFleetStore } from '../store/fleetStore';
import { useNavigateTab } from '../hooks/useNavigateTab';

/** What Pulse keeps of a release record: no values, no stored chart. */
export interface HelmReleaseFacts {
  revision: number;
  status: string;
  chart?: string;
  chartVersion?: string;
  /** Objects in the rendered manifest of the deployed (else latest) revision; undefined when unreadable. */
  resources?: Array<{ apiVersion: string; kind: string; name: string }>;
}

const PARTIAL_METADATA = 'application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1';

function storagePath(owner: HelmOwner): string {
  return `/api/v1/namespaces/${owner.namespace}/secrets?labelSelector=${encodeURIComponent(`owner=helm,name=${owner.release}`)}`;
}

/**
 * Revision and status of `owner`'s release from its storage Secrets' labels,
 * listed metadata-only: no release record (and so no values) reaches the browser.
 */
export function useHelmReleaseMeta(owner: HelmOwner | null, clusterIdOverride?: string) {
  const active = useFleetStore((s) => s.activeClusterId);
  const clusterId = clusterIdOverride ?? active;
  return useQuery<{ revision: number; status: string } | null>({
    queryKey: ['helm', 'release-meta', clusterId, owner?.namespace, owner?.release],
    queryFn: async () => {
      const res = await k8sFetch(clusterId, storagePath(owner!), { headers: { Accept: PARTIAL_METADATA } });
      if (!res.ok) throw new Error(`The release record could not be read (${res.status} ${res.statusText})`);
      const data = await res.json() as { items?: Array<{ metadata?: { labels?: Record<string, string> } }> };
      const revs = (data.items ?? []).map((i) => ({ revision: Number(i.metadata?.labels?.version), status: i.metadata?.labels?.status ?? 'unknown' }))
        .filter((r) => Number.isFinite(r.revision))
        .sort((a, b) => b.revision - a.revision);
      return revs[0] ?? null;
    },
    enabled: !!owner,
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * The release record of `owner`, decoded only where it is needed (to check
 * that the release really lists an object). Only the facts above are kept;
 * values and the stored chart are dropped.
 */
export function useHelmRelease(owner: HelmOwner | null, clusterIdOverride?: string) {
  const active = useFleetStore((s) => s.activeClusterId);
  const clusterId = clusterIdOverride ?? active;
  return useQuery<HelmReleaseFacts | null>({
    queryKey: ['helm', 'release-facts', clusterId, owner?.namespace, owner?.release],
    queryFn: async () => {
      const res = await k8sFetch(clusterId, storagePath(owner!));
      if (!res.ok) throw new Error(`The release record could not be read (${res.status} ${res.statusText})`);
      const data = await res.json();
      const [summary] = await summarizeHelmReleases((data.items || []) as Secret[]);
      if (!summary) return null;
      const deployed = summary.revisions.find((r) => r.status === 'deployed') ?? summary;
      return { revision: summary.revision, status: summary.status, chart: summary.chart, chartVersion: summary.chartVersion, resources: deployed.resources };
    },
    enabled: !!owner,
    retry: false,
    staleTime: 30_000,
  });
}

export interface HelmOwnership {
  /** What the object's labels and annotations claim (null: not Helm-labelled). */
  claimed: HelmOwner | null;
  /** True: the release lists it. False: the release does not. Null: could not check yet / unreadable. */
  verified: boolean | null;
  /** The owner to act on: the claim, unless the release was read and does not list the object. */
  owner: HelmOwner | null;
  release: HelmReleaseFacts | null | undefined;
  releaseError: unknown;
  loading: boolean;
}

/**
 * Helm ownership checked against the release: labels can be copied or left
 * behind, so an object counts as the release's only if the release's
 * manifest lists its kind and name.
 */
export function useHelmOwnership(resource: K8sResource | null | undefined, clusterIdOverride?: string): HelmOwnership {
  const claimed = helmOwnerOf(resource);
  const rel = useHelmRelease(claimed, clusterIdOverride);
  let verified: boolean | null = null;
  if (claimed && resource && rel.data !== undefined && !rel.isError) {
    verified = !!rel.data?.resources?.some((r) => r.kind === resource.kind && r.name === resource.metadata.name);
    if (rel.data && rel.data.resources === undefined) verified = null;
  }
  return { claimed, verified, owner: verified === false ? null : claimed, release: rel.data, releaseError: rel.error, loading: !!claimed && rel.isLoading };
}

/** "claims Helm ownership; release X does not list it". */
export function HelmClaimNote({ claimed }: { claimed: HelmOwner }) {
  return (
    <p role="note" className="text-xs text-amber-300" data-testid="helm-claim-note">
      Claims Helm ownership (release {claimed.release}), but release {claimed.release} in {claimed.namespace} does not list it: Pulse treats it as not managed by Helm.
    </p>
  );
}

export function HelmOwnerBadge({ resource }: { resource: K8sResource }) {
  const owner = helmOwnerOf(resource);
  const release = useHelmReleaseMeta(owner);
  const go = useNavigateTab();
  if (!owner) return null;
  const rev = release.data ? ` rev ${release.data.revision}` : '';
  const title = release.isError
    ? `Labelled as managed by Helm release ${owner.release} in ${owner.namespace}. Its revision could not be checked: ${(release.error as Error).message}`
    : release.data === null
      ? `Labelled as managed by Helm release ${owner.release} in ${owner.namespace}, but no record of that release was found.`
      : `Managed by Helm release ${owner.release} in ${owner.namespace}${release.data ? ` (${release.data.status})` : ''}. Hand edits are overwritten on the next upgrade.`;
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
export function helmOwnerSentence(owner: HelmOwner, release: HelmReleaseFacts | null | undefined): string {
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
export function HelmRollbackNote({ resource, kind, onNavigate }: { resource: K8sResource; kind: string; onNavigate?: () => void }) {
  const go = useNavigateTab();
  const h = useHelmOwnership(resource);
  if (!h.claimed) return null;
  if (h.verified === false) return <div className="mt-3"><HelmClaimNote claimed={h.claimed} /></div>;
  const owner = h.claimed;
  return (
    <div role="alert" className="mt-3 rounded-md border border-sky-800 bg-sky-950/40 px-3 py-2 text-xs text-sky-100" data-testid="helm-rollback-note">
      <p>
        This {kind} is managed by Helm release <strong>{owner.release}</strong> in {owner.namespace}. A rollback here is reverted
        by Helm on the release&apos;s next upgrade, and leaves the release&apos;s other objects as they are. Roll back the release instead.
        {h.verified === null && !h.loading && ' (Pulse could not read the release record to confirm it lists this object.)'}
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
