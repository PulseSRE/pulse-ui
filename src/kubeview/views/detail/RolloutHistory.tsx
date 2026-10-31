/**
 * RolloutHistory — horizontal revision timeline for a Deployment (its
 * ReplicaSets) or a StatefulSet/DaemonSet (its ControllerRevisions).
 *
 * Revisions are watched, so a rollout in progress appears as it happens. Each
 * revision shows its images (with what changed from the revision before),
 * change-cause and age; the current one is marked. Rolling back replaces
 * spec.template with the revision's template exactly (JSON Patch `replace`,
 * guarded by a `test` of the resourceVersion the page showed, so a concurrent
 * change is rejected rather than overwritten), on the cluster the page was
 * showing when the rollback was requested, and only with permission to patch.
 */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sPatch } from '../../engine/query';
import { timeAgo } from '../../engine/dateUtils';
import { useUIStore } from '../../store/uiStore';
import { useFleetStore } from '../../store/fleetStore';
import { useCanI } from '../../hooks/useCanI';
import { useK8sListWatch } from '../../hooks/useK8sListWatch';
import { assertActiveCluster } from '../../engine/pendingCluster';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { LoadError } from '../../components/primitives/LoadError';
import type { K8sResource } from '../../engine/renderers';
import type { Container, PodTemplateSpec } from '../../engine/types';

type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet';

const PLURAL: Record<WorkloadKind, string> = { Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets' };

export interface RevisionEntry {
  revision: number;
  name: string;
  createdAt?: string;
  images: Array<{ container: string; image: string }>;
  changeCause?: string;
  replicas?: { ready: number; desired: number } | null;
  current: boolean;
  template?: PodTemplateSpec;
}

export function isRolloutWorkload(kind: string | undefined): kind is WorkloadKind {
  return kind === 'Deployment' || kind === 'StatefulSet' || kind === 'DaemonSet';
}

function containersOf(template: PodTemplateSpec | undefined) {
  return ((template?.spec?.containers || []) as Container[]).map((c) => ({ container: c.name, image: c.image || '' }));
}

/** Revisions of `workload` from its ReplicaSets or ControllerRevisions, oldest first. */
export function parseRevisions(workload: K8sResource, items: K8sResource[]): RevisionEntry[] {
  const kind = workload.kind as WorkloadKind;
  const uid = workload.metadata.uid;
  const owned = items.filter((o) => o.metadata.ownerReferences?.some((r) => r.kind === kind && (uid ? r.uid === uid : r.name === workload.metadata.name)));
  const status = (workload.status || {}) as Record<string, unknown>;
  let revs: RevisionEntry[];
  if (kind === 'Deployment') {
    const currentRev = workload.metadata.annotations?.['deployment.kubernetes.io/revision'];
    revs = owned.map((rs) => {
      const spec = (rs.spec || {}) as { replicas?: number; template?: PodTemplateSpec };
      const st = (rs.status || {}) as { readyReplicas?: number };
      const rev = rs.metadata.annotations?.['deployment.kubernetes.io/revision'];
      return {
        revision: parseInt(rev || '0', 10),
        name: rs.metadata.name,
        createdAt: rs.metadata.creationTimestamp,
        images: containersOf(spec.template),
        changeCause: rs.metadata.annotations?.['kubernetes.io/change-cause'],
        replicas: { ready: st.readyReplicas ?? 0, desired: spec.replicas ?? 0 },
        current: !!currentRev && rev === currentRev,
        template: spec.template,
      };
    }).filter((r) => r.revision > 0);
    if (!currentRev && revs.length) revs.reduce((a, b) => (a.revision > b.revision ? a : b)).current = true;
  } else {
    const maxRev = Math.max(0, ...owned.map((cr) => Number((cr as { revision?: number }).revision) || 0));
    const currentName = kind === 'StatefulSet' ? (status.updateRevision as string | undefined) : undefined;
    revs = owned.map((cr) => {
      const revision = Number((cr as { revision?: number }).revision) || 0;
      const data = (cr as { data?: { spec?: { template?: PodTemplateSpec & { $patch?: string } } } }).data;
      const raw = data?.spec?.template;
      let template: PodTemplateSpec | undefined;
      if (raw) {
        // ControllerRevision data is a strategic-merge patch; "$patch: replace" is a directive, not template content.
        const { $patch: _directive, ...rest } = raw;
        template = rest as PodTemplateSpec;
      }
      const current = currentName ? cr.metadata.name === currentName : revision === maxRev;
      return {
        revision,
        name: cr.metadata.name,
        createdAt: cr.metadata.creationTimestamp,
        images: containersOf(template),
        changeCause: cr.metadata.annotations?.['kubernetes.io/change-cause'],
        replicas: null,
        current,
        template,
      };
    });
  }
  return revs.sort((a, b) => a.revision - b.revision);
}

/** What a rollback to `target` changes in the running template. */
export function templateDiff(current: PodTemplateSpec | undefined, target: PodTemplateSpec | undefined): string[] {
  const diffs: string[] = [];
  const cur = Object.fromEntries(((current?.spec?.containers || []) as Container[]).map((c) => [c.name, c]));
  const tgt = Object.fromEntries(((target?.spec?.containers || []) as Container[]).map((c) => [c.name, c]));
  for (const name of new Set([...Object.keys(cur), ...Object.keys(tgt)])) {
    const a = cur[name];
    const b = tgt[name];
    if (!a) { diffs.push(`Container "${name}": added`); continue; }
    if (!b) { diffs.push(`Container "${name}": removed`); continue; }
    if (a.image !== b.image) diffs.push(`Container "${name}": image ${a.image} -> ${b.image}`);
    const aEnv = new Set((a.env || []).map((e) => e.name));
    const bEnv = new Set((b.env || []).map((e) => e.name));
    const added = [...bEnv].filter((k) => !aEnv.has(k));
    const removed = [...aEnv].filter((k) => !bEnv.has(k));
    if (added.length) diffs.push(`Container "${name}": env added: ${added.join(', ')}`);
    if (removed.length) diffs.push(`Container "${name}": env removed: ${removed.join(', ')}`);
    for (const tier of ['limits', 'requests'] as const) {
      for (const res of ['cpu', 'memory'] as const) {
        const x = a.resources?.[tier]?.[res] || 'none';
        const y = b.resources?.[tier]?.[res] || 'none';
        if (x !== y) diffs.push(`Container "${name}": ${res} ${tier} ${x} -> ${y}`);
      }
    }
  }
  return diffs.length > 0 ? diffs : ['No visible spec changes detected'];
}

function shortImage(image: string): string {
  return image.split('/').pop() || image;
}

function imageChanges(prev: RevisionEntry | undefined, rev: RevisionEntry): string[] {
  if (!prev) return [];
  const before = Object.fromEntries(prev.images.map((i) => [i.container, i.image]));
  return rev.images
    .filter((i) => before[i.container] !== undefined && before[i.container] !== i.image)
    .map((i) => `${i.container}: ${shortImage(before[i.container])} → ${shortImage(i.image)}`)
    .concat(rev.images.filter((i) => before[i.container] === undefined).map((i) => `+ ${i.container}`));
}

function inFlightOf(resource: K8sResource): { updated: number; ready: number; desired: number } | null {
  const st = (resource.status || {}) as Record<string, number | undefined>;
  const spec = (resource.spec || {}) as { replicas?: number };
  if (resource.kind === 'DaemonSet') {
    return { updated: st.updatedNumberScheduled ?? 0, ready: st.numberReady ?? 0, desired: st.desiredNumberScheduled ?? 0 };
  }
  return { updated: st.updatedReplicas ?? 0, ready: st.readyReplicas ?? 0, desired: spec.replicas ?? 1 };
}

export interface RolloutHistoryProps {
  resource: K8sResource;
  namespace: string;
  /** The cluster the resource was read from; defaults to the active cluster. */
  clusterId?: string;
}

export function RolloutHistory({ resource, namespace, clusterId: clusterIdProp }: RolloutHistoryProps) {
  const activeClusterId = useFleetStore((s) => s.activeClusterId);
  const clusterId = clusterIdProp ?? activeClusterId;
  const kind = resource.kind as WorkloadKind;
  const supported = isRolloutWorkload(resource.kind);
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const { allowed: canPatch } = useCanI('patch', 'apps', supported ? PLURAL[kind] : 'deployments', namespace);

  const listPath = kind === 'Deployment' ? '/apis/apps/v1/replicasets' : '/apis/apps/v1/controllerrevisions';
  const list = useK8sListWatch<K8sResource>({ apiPath: listPath, namespace, clusterId, enabled: supported });
  const revisions = useMemo(() => (list.data ? parseRevisions(resource, list.data) : []), [resource, list.data]);

  const [selected, setSelected] = useState<number | null>(null);
  const [target, setTarget] = useState<{ rev: RevisionEntry; clusterId: string; resourceVersion?: string } | null>(null);
  const [rolling, setRolling] = useState(false);

  if (!supported) return null;

  const current = revisions.find((r) => r.current);
  const shown = revisions.find((r) => r.revision === selected) ?? current ?? revisions[revisions.length - 1];
  const flight = inFlightOf(resource);
  const rollingOut = !!flight && flight.desired > 0 && flight.updated < flight.desired;
  const currentTemplate = (resource.spec as { template?: PodTemplateSpec } | undefined)?.template;
  const path = `/apis/apps/v1/namespaces/${namespace}/${PLURAL[kind]}/${resource.metadata.name}`;

  async function handleRollback() {
    if (!target) return;
    setRolling(true);
    try {
      assertActiveCluster(target.clusterId, 'The rollback');
      if (!target.rev.template || !target.resourceVersion) {
        throw new Error(`${kind} version or revision template is missing. Refresh and try again.`);
      }
      const template = structuredClone(target.rev.template);
      // These labels belong to the controllers, not to the workload's template.
      if (template.metadata?.labels) {
        delete template.metadata.labels['pod-template-hash'];
        delete template.metadata.labels['controller-revision-hash'];
      }
      await k8sPatch(
        path,
        [
          { op: 'test', path: '/metadata/resourceVersion', value: target.resourceVersion },
          { op: 'replace', path: '/spec/template', value: template },
        ],
        'application/json-patch+json',
        target.clusterId,
      );
      addToast({ type: 'success', title: `Rollback to revision ${target.rev.revision} started`, detail: `${kind} "${resource.metadata.name}" is rolling back.` });
      queryClient.invalidateQueries({ queryKey: ['k8s'] });
    } catch (err: unknown) {
      addToast({ type: 'error', title: 'Rollback failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setRolling(false);
      setTarget(null);
    }
  }

  return (
    <section id="rollout-history" aria-label="Rollout history" className="rounded-lg border border-slate-800 bg-slate-950">
      <header className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-100">
        <History className="h-4 w-4 text-slate-400" />
        Rollout History
        {list.data && <span className="ml-auto text-xs text-slate-500">{revisions.length} revision{revisions.length !== 1 ? 's' : ''}</span>}
      </header>

      {rollingOut && flight && (
        <div className="border-t border-slate-800 px-4 py-2.5" aria-label="Rollout in progress">
          <div className="flex justify-between text-xs mb-1">
            <span className="flex items-center gap-1.5 text-blue-300"><Loader2 className="h-3 w-3 animate-spin" /> Rolling out</span>
            <span className="font-mono text-slate-400">{flight.updated}/{flight.desired} updated · {flight.ready} ready</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.round((flight.updated / flight.desired) * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="border-t border-slate-800">
        {list.isLoading && (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading revision history...
          </div>
        )}
        {list.isError && (
          <LoadError className="m-3" title="Revisions could not be loaded" error={list.error} onRetry={() => list.refetch()} />
        )}
        {list.data && revisions.length === 0 && (
          <div className="px-4 py-4 text-sm text-slate-500">No revisions found.</div>
        )}

        {revisions.length > 0 && (
          <>
            {/* Timeline, oldest left */}
            <ol aria-label="Revisions" className="flex items-start gap-0 overflow-x-auto px-4 pt-4 pb-2">
              {revisions.map((rev, i) => {
                const changes = imageChanges(revisions[i - 1], rev);
                const isShown = shown?.revision === rev.revision;
                return (
                  <li key={rev.name} className="flex items-start shrink-0">
                    {i > 0 && <div aria-hidden className={cn('mt-3 h-0.5 w-10', changes.length ? 'bg-violet-500/60' : 'bg-slate-700')} />}
                    <button
                      type="button"
                      onClick={() => setSelected(rev.revision)}
                      aria-pressed={isShown}
                      aria-label={`Revision ${rev.revision}${rev.current ? ' (current)' : ''}`}
                      className="flex flex-col items-center w-28 text-center group"
                    >
                      <span className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-mono transition-colors',
                        rev.current ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                          : isShown ? 'border-slate-200 bg-slate-700 text-slate-100' : 'border-slate-600 bg-slate-900 text-slate-400 group-hover:border-slate-400',
                      )}>
                        {rev.current ? <CheckCircle className="h-3.5 w-3.5" /> : rev.revision}
                      </span>
                      <span className="mt-1 font-mono text-xs text-slate-200">#{rev.revision}</span>
                      <span className="text-[10px] text-slate-500" title={rev.createdAt}>{rev.createdAt ? timeAgo(rev.createdAt) : '—'}</span>
                      {changes.length > 0 && (
                        <span className="mt-1 max-w-full truncate rounded-sm bg-violet-500/10 px-1 text-[10px] text-violet-300" title={changes.join('\n')}>
                          {changes[0]}{changes.length > 1 ? ` +${changes.length - 1}` : ''}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>

            {/* Selected revision */}
            {shown && (
              <div className="mx-4 mb-4 rounded-md border border-slate-800 bg-slate-900/40 p-3 text-xs space-y-2" aria-label={`Revision ${shown.revision} details`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-slate-100">#{shown.revision}</span>
                  {shown.current && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-400">Current</span>}
                  <span className="font-mono text-slate-500">{shown.name}</span>
                  {shown.replicas && <span className="ml-auto text-slate-500">{shown.replicas.ready}/{shown.replicas.desired} replicas</span>}
                </div>
                <div>
                  <span className="text-slate-500">Images: </span>
                  <span className="text-slate-300 font-mono">{shown.images.map((i) => i.image).join(', ') || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Change cause: </span>
                  <span className="text-slate-300">{shown.changeCause || 'not recorded'}</span>
                </div>
                {!shown.current && (
                  <>
                    <div>
                      <span className="text-slate-500">Rolling back changes: </span>
                      <ul className="mt-1 space-y-0.5 text-slate-400">
                        {templateDiff(currentTemplate, shown.template).map((d, i) => <li key={i} className="font-mono">{d}</li>)}
                      </ul>
                    </div>
                    {canPatch && (
                      <button
                        type="button"
                        onClick={() => setTarget({ rev: shown, clusterId, resourceVersion: resource.metadata.resourceVersion })}
                        aria-label={`Roll back to revision ${shown.revision}`}
                        className="flex items-center gap-1 rounded-sm bg-amber-500/15 px-2 py-1 font-medium text-amber-400 hover:bg-amber-500/25"
                      >
                        <RotateCcw className="h-3 w-3" /> Roll back to #{shown.revision}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!target}
        onClose={() => !rolling && setTarget(null)}
        onConfirm={handleRollback}
        title={`Roll back ${resource.metadata.name} to revision #${target?.rev.revision ?? ''}?`}
        description={target ? templateDiff(currentTemplate, target.rev.template).join('\n') : ''}
        confirmLabel="Roll back"
        variant="warning"
        loading={rolling}
      />
    </section>
  );
}

export default RolloutHistory;
