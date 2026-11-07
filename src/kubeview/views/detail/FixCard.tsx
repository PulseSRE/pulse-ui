/**
 * "Proposed fix": what Pulse's rules see on this pod (engine/diagnosis, which
 * was computed but shown nowhere on the page) and the guided fixes that
 * follow, applied to the owner so they survive the next rollout.
 *
 * Review and apply opens FixConfirmDialog; afterwards the rollout is watched
 * for 10 minutes here (and on the owner's page) and the card says whether it
 * held. Every read a fix depends on is honest: an owner that cannot be read
 * means no fix is offered, with the reason; unreadable quotas are "unknown".
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wrench, ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, HelpCircle, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { K8sResource } from '../../engine/renderers';
import type { Event } from '../../engine/types';
import { readK8s, listK8s } from '../../engine/readResult';
import { diagnoseResource } from '../../engine/diagnosis';
import { proposeFixes, withServiceAccount, workloadTarget, type GuidedFix } from '../../engine/podFixes';
import { useUIStore } from '../../store/uiStore';
import { quotaHeadroom } from '../../engine/quotaHeadroom';
import { useK8sListWatch } from '../../hooks/useK8sListWatch';
import { useCanI } from '../../hooks/useCanI';
import { useFleetStore } from '../../store/fleetStore';
import { useFixWatchStore } from '../../store/fixWatchStore';
import { k8sFetch } from '../../engine/query';
import { errorReason, type ReadResult } from '../../engine/readResult';
import { askPulse } from '../../engine/askPulse';
import { TONE_CLASSES } from '../../engine/statusColors';
import { LoadError } from '../../components/primitives/LoadError';
import { parseRevisions } from './RolloutHistory';
import { DiffBlock, FixConfirmDialog } from './FixConfirmDialog';
import type { UsageResult } from './usePodUsage';
import { AskPulseButton } from '../../components/agent/AskPulseButton';

type Go = (path: string, title: string) => void;

interface FixCardProps {
  /** The failing pod the fixes are computed from. */
  pod: K8sResource | null;
  /** Where the fixes go: the pod's owner (API path), or the workload whose page this is. */
  ownerApiPath?: string;
  /** The workload object when the page already has it (Deployment page). */
  ownerObject?: K8sResource;
  usage?: UsageResult;
  /** While usage is being measured no value is proposed, so it does not change under the reader. */
  usageLoading?: boolean;
  events?: Event[];
  /** On the pod page, the owner's page, for "follow the rollout there". */
  ownerPage?: { path: string; label: string };
  go: Go;
}

const PULL_SECRET_TYPES = ['kubernetes.io/dockerconfigjson', 'kubernetes.io/dockercfg'];
const METADATA_ONLY = 'application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1';

/**
 * Names of the namespace's registry credentials, read as metadata only
 * (PartialObjectMetadataList), so no secret data reaches the browser.
 */
export async function listPullSecretNames(ns: string, clusterId: string): Promise<ReadResult<string[]>> {
  const names: string[] = [];
  try {
    for (const type of PULL_SECRET_TYPES) {
      const res = await k8sFetch(clusterId, `/api/v1/namespaces/${ns}/secrets?fieldSelector=${encodeURIComponent(`type=${type}`)}`, { headers: { Accept: METADATA_ONLY } });
      if (!res.ok) return { state: 'error', reason: errorReason({ status: res.status }) };
      const body = (await res.json()) as { items?: Array<{ metadata?: { name?: string } }> };
      for (const i of body.items ?? []) if (i.metadata?.name) names.push(i.metadata.name);
    }
  } catch (e) {
    return { state: 'error', reason: errorReason(e) };
  }
  return { state: 'ok', data: names };
}

function needsPullSecret(pod: K8sResource | null): boolean {
  const st = pod?.status as { containerStatuses?: Array<{ state?: { waiting?: { reason?: string } } }> } | undefined;
  return !!st?.containerStatuses?.some((s) => s.state?.waiting?.reason === 'ImagePullBackOff' || s.state?.waiting?.reason === 'ErrImagePull');
}

export function FixCard({ pod, ownerApiPath, ownerObject, usage, usageLoading, events, ownerPage, go }: FixCardProps) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const ns = pod?.metadata.namespace || ownerObject?.metadata.namespace || '';
  const ownerRead = useQuery({
    queryKey: ['fix-owner', clusterId, ownerApiPath],
    queryFn: () => readK8s<K8sResource>(ownerApiPath!, clusterId),
    enabled: !ownerObject && !!ownerApiPath,
    refetchInterval: 30_000,
  });
  const owner: K8sResource | null = ownerObject ?? (ownerRead.data?.state === 'ok' ? ownerRead.data.data : null);
  const ownerError = !ownerObject && ownerRead.data && ownerRead.data.state !== 'ok'
    ? (ownerRead.data.state === 'absent' ? 'it no longer exists' : ownerRead.data.reason)
    : null;

  const isDeployment = owner?.kind === 'Deployment';
  const rsList = useK8sListWatch<K8sResource>({ apiPath: '/apis/apps/v1/replicasets', namespace: ns, enabled: isDeployment && !!ns });
  const revisions = React.useMemo(() => (owner && rsList.data ? parseRevisions(owner, rsList.data) : undefined), [owner, rsList.data]);

  const wantSecrets = needsPullSecret(pod);
  const secrets = useQuery({
    queryKey: ['fix-pull-secrets', clusterId, ns],
    queryFn: () => listPullSecretNames(ns, clusterId),
    enabled: wantSecrets && !!ns,
  });
  const pullSecrets = secrets.data?.state === 'ok' ? secrets.data.data : [];

  const fixes = React.useMemo(
    () => (pod && !usageLoading ? proposeFixes({ pod, owner, usage, revisions, events, pullSecrets }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pod, owner, usage, usageLoading, revisions, events, pullSecrets.join(',')],
  );
  const diagnoses = React.useMemo(() => (pod ? diagnoseResource(pod) : []), [pod]);

  const wantQuota = fixes.some((f) => f.memoryDelta);
  const quotas = useQuery({
    queryKey: ['fix-quotas', clusterId, ns],
    queryFn: () => listK8s<K8sResource>(`/api/v1/namespaces/${ns}/resourcequotas`, clusterId),
    enabled: wantQuota && !!ns,
  });

  const workloadPlural = owner ? `${owner.kind.toLowerCase()}s` : 'deployments';
  const { allowed: canPatchWorkload } = useCanI('patch', 'apps', workloadPlural, ns, undefined, { enabled: !!owner && !!ns });
  const { allowed: canPatchSA } = useCanI('patch', '', 'serviceaccounts', ns, undefined, { enabled: wantSecrets && !!ns });
  const canPatch = (f: GuidedFix) => (f.target.kind === 'ServiceAccount' ? canPatchSA : canPatchWorkload);

  const [showOthers, setShowOthers] = React.useState(false);
  const [review, setReview] = React.useState<{ fix: GuidedFix; target: K8sResource | null; clusterId: string } | null>(null);
  const [reviewError, setReviewError] = React.useState<string | null>(null);
  const [applied, setApplied] = React.useState<string | null>(null);

  const ownerTarget = owner ? workloadTarget(owner) : null;
  const watchKey = ownerTarget ? `${clusterId}|${ownerTarget.apiPath}` : '';
  const watch = useFixWatchStore((s) => (watchKey ? s.watches[watchKey] : undefined));

  async function openReview(chosen: GuidedFix) {
    setReviewError(null);
    // Pinned to the cluster the owner was read from (this page's); the dialog
    // refuses if the active cluster has changed since.
    const pinned = clusterId;
    let fix = chosen;
    let fresh: K8sResource | null = owner;
    // Build the fix again from the owner as it is now, so the diff, the
    // resourceVersion test and the values describe the object being patched.
    if (ownerTarget) {
      const r = await readK8s<K8sResource>(ownerTarget.apiPath, pinned);
      if (r.state !== 'ok') {
        setReviewError(`${ownerTarget.kind} ${ownerTarget.name} could not be read again: ${r.state === 'absent' ? 'it no longer exists' : r.reason}`);
        return;
      }
      fresh = r.data;
      const again = pod ? proposeFixes({ pod, owner: fresh, usage, revisions, events, pullSecrets }).find((f) => f.id === chosen.id) : undefined;
      if (!again) {
        setReviewError(`${ownerTarget.kind} ${ownerTarget.name} changed since this page loaded it, and this fix no longer applies. Reload to see what does.`);
        return;
      }
      fix = again;
    }
    if (fix.target.kind === 'ServiceAccount') {
      const sa = await readK8s<K8sResource>(fix.target.apiPath, pinned);
      if (sa.state !== 'ok') {
        setReviewError(`ServiceAccount ${fix.target.name} could not be read: ${sa.state === 'absent' ? 'it does not exist' : sa.reason}`);
        return;
      }
      setReview({ fix: withServiceAccount(fix, sa.data), target: sa.data, clusterId: pinned });
      return;
    }
    setReview({ fix, target: fresh, clusterId: pinned });
  }

  function onApplied(fix: GuidedFix, pinned: string, result: unknown) {
    setReview(null);
    setApplied(fix.title);
    useUIStore.getState().addToast({
      type: 'success',
      title: `Applied: ${fix.title}`,
      detail: fix.watchable ? `Pulse is watching ${fix.target.kind} ${fix.target.name} for 10 minutes; its page shows whether the fix held.` : fix.impact,
    });
    if (fix.watchable) {
      const generation = (result as { metadata?: { generation?: number } } | undefined)?.metadata?.generation;
      useFixWatchStore.getState().start({
        title: fix.title, kind: fix.target.kind, name: fix.target.name, namespace: fix.target.namespace,
        apiPath: fix.target.apiPath, clusterId: pinned, generation,
      });
    }
  }

  const [primary, ...others] = fixes;
  const headroomFor = (f: GuidedFix) => (f.memoryDelta ? quotaHeadroom(quotas.data, f.memoryDelta) : undefined);
  const askWhy = (f: GuidedFix) => askPulse(
    `Why "${f.title}"? ${f.basis} Is that the right fix for ${pod?.metadata.name ?? 'this workload'}, and what else should I check?`,
    pod ? { kind: 'Pod', name: pod.metadata.name, namespace: ns } : owner ? { kind: owner.kind, name: owner.metadata.name, namespace: ns } : undefined,
  );

  return (
    <section aria-labelledby="fix-h" className="flex flex-col gap-3.5 rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 id="fix-h" className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <Wrench className="h-4 w-4 text-slate-400" aria-hidden /> Proposed fix
        </h2>
        <span className="text-xs text-slate-400">Applied to the owner, so it survives the next rollout</span>
      </div>

      {watch && <WatchStatus watch={watch} onDismiss={() => useFixWatchStore.getState().dismiss(watch.key)} />}
      {applied && !watch && <p role="status" className="text-sm text-emerald-300">Applied: {applied}.</p>}
      {applied && ownerPage && watch?.status === 'watching' && (
        <p className="text-xs text-slate-400">
          This pod will be replaced by the rollout; the watch continues on{' '}
          <button type="button" onClick={() => go(ownerPage.path, ownerPage.label)} className="text-blue-400 hover:underline">{ownerPage.label}</button>.
        </p>
      )}

      {!pod && <p className="text-sm text-slate-400">No failing pod to compute a fix from.</p>}
      {pod && ownerApiPath && !ownerObject && ownerRead.isLoading && <p className="text-sm text-slate-400">Reading the owner…</p>}
      {pod && ownerError && (
        <LoadError title="No fix can be proposed: the owner could not be read" error={ownerError} onRetry={() => ownerRead.refetch()} />
      )}
      {pod && !ownerApiPath && !ownerObject && (
        <p className="text-sm text-slate-400">This pod has no workload owner, so there is nothing to patch that would outlive it.</p>
      )}
      {secrets.data?.state === 'error' && (
        <p className="text-xs text-amber-300">Registry credentials in {ns} could not be listed ({secrets.data.reason}), so no pull secret can be proposed.</p>
      )}

      {primary && (
        <div className="overflow-hidden rounded-lg border border-slate-700" data-testid="primary-fix">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-slate-950/60 px-3.5 py-3">
            <div className="text-[15px] font-semibold text-slate-100">{primary.title}</div>
            <span className="ml-auto text-xs text-slate-400">{primary.restarts > 0 ? `${primary.impact.split(' (')[0]}` : 'No restart'} · undo: {primary.undo.split(' (')[0].toLowerCase()}</span>
          </div>
          <DiffBlock fix={primary} />
          <div className="border-t border-slate-800 bg-slate-950/60 px-3.5 py-2.5 text-[12.5px] text-slate-300">
            {primary.basis}
            {headroomFor(primary) && <div className={cn('mt-1', headroomFor(primary)!.tone === 'over' && TONE_CLASSES.danger.text)}>{headroomFor(primary)!.text}</div>}
          </div>
        </div>
      )}

      {primary && (
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => void openReview(primary)}
            disabled={!canPatch(primary)}
            title={!canPatch(primary) ? `You do not have permission to patch ${primary.target.plural} in ${ns}` : undefined}
            className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Review and apply
          </button>
          <AskPulseButton size="md" suffix="why" onAsk={() => askWhy(primary)} className="min-h-[44px] rounded-lg px-4" />
          {others.length > 0 && (
            <button type="button" onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers} className="flex min-h-[44px] items-center gap-1 rounded-lg border border-slate-700 px-4 text-sm text-slate-300 hover:bg-slate-800">
              Other fixes ({others.length}) {showOthers ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </div>
      )}
      {primary && !canPatch(primary) && (
        <p className="text-xs text-slate-400">You do not have permission to patch {primary.target.plural} in {ns}; ask someone who can, or use Ask Pulse.</p>
      )}
      {reviewError && <p role="alert" className="text-xs text-red-300">{reviewError}</p>}

      {showOthers && others.length > 0 && (
        <ul className="space-y-2" aria-label="Other fixes">
          {others.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800 px-3 py-2 text-sm">
              <span className="text-slate-200">{f.title}</span>
              <button
                type="button"
                onClick={() => void openReview(f)}
                disabled={!canPatch(f)}
                title={!canPatch(f) ? `You do not have permission to patch ${f.target.plural} in ${ns}` : undefined}
                className="ml-auto rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                aria-label={`Review: ${f.title}`}
              >
                Review
              </button>
            </li>
          ))}
        </ul>
      )}

      {pod && owner && usageLoading && <p className="text-sm text-slate-400">Measuring memory and CPU use…</p>}
      {pod && owner && !usageLoading && fixes.length === 0 && (
        <p className="text-sm text-slate-400">No guided fix matches this pod&apos;s state.</p>
      )}

      {diagnoses.length > 0 && (
        <div aria-label="Rule checks">
          <div className="mb-1 text-xs font-medium text-slate-400">What Pulse&apos;s rules see</div>
          <ul className="space-y-1.5 text-[13px]">
            {diagnoses.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', d.severity === 'critical' ? 'bg-red-500' : d.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500')} />
                <span><span className="text-slate-200">{d.title}.</span> <span className="text-slate-400">{d.suggestion ?? d.detail}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review && (
        <FixConfirmDialog
          fix={review.fix}
          targetObject={review.target}
          clusterId={review.clusterId}
          canPatch={canPatch(review.fix)}
          headroom={headroomFor(review.fix)}
          onClose={() => setReview(null)}
          onApplied={(result) => onApplied(review.fix, review.clusterId, result)}
        />
      )}
    </section>
  );
}

function WatchStatus({ watch, onDismiss }: { watch: { status: string; detail: string; title: string; checkError?: string }; onDismiss: () => void }) {
  const icon = watch.status === 'held' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    : watch.status === 'not-held' ? <XCircle className="h-4 w-4 text-red-400" />
      : watch.status === 'unknown' ? <HelpCircle className="h-4 w-4 text-slate-400" />
        : <Loader2 className="h-4 w-4 animate-spin text-blue-400" />;
  return (
    <div role="status" data-testid="fix-watch" className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
      watch.status === 'held' ? 'border-emerald-900 bg-emerald-950/30 text-emerald-200'
        : watch.status === 'not-held' ? 'border-red-900 bg-red-950/30 text-red-200'
          : 'border-slate-700 bg-slate-950/50 text-slate-300')}>
      <span className="mt-0.5">{icon}</span>
      <div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400"><Eye className="h-3 w-3" /> {watch.title}</div>
        <div>{watch.detail}</div>
        {watch.status === 'watching' && watch.checkError && <div className="text-xs text-amber-300">Last check failed: {watch.checkError}</div>}
      </div>
      <button type="button" onClick={onDismiss} className="ml-auto shrink-0 rounded-sm px-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200">
        {watch.status === 'watching' ? 'Stop watching' : 'Dismiss'}
      </button>
    </div>
  );
}
