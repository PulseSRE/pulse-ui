import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, ChevronDown, ChevronRight, RotateCcw, Loader2, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList, k8sPatch } from '../../engine/query';
import { K8S_BASE as BASE } from '../../engine/gvr';
import { timeAgo } from '../../engine/dateUtils';
import { useUIStore } from '../../store/uiStore';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import type { K8sResource } from '../../engine/renderers';
import type { Deployment, ReplicaSet, Container, PodTemplateSpec } from '../../engine/types';

interface Revision {
  number: number;
  replicaSet: K8sResource;
  creationTimestamp: string;
  images: string[];
  replicas: { current: number; desired: number };
  isCurrent: boolean;
  podTemplate: PodTemplateSpec | undefined;
}

function computeDiffs(currentTemplate: PodTemplateSpec | undefined, targetTemplate: PodTemplateSpec | undefined): string[] {
  const diffs: string[] = [];
  const currentContainers: Container[] = currentTemplate?.spec?.containers || [];
  const targetContainers: Container[] = targetTemplate?.spec?.containers || [];

  const currentByName = Object.fromEntries(currentContainers.map((c) => [c.name, c]));
  const targetByName = Object.fromEntries(targetContainers.map((c) => [c.name, c]));

  const allNames = new Set([...Object.keys(currentByName), ...Object.keys(targetByName)]);

  for (const name of allNames) {
    const cur = currentByName[name];
    const tgt = targetByName[name];

    if (!cur && tgt) {
      diffs.push(`Container "${name}": added`);
      continue;
    }
    if (cur && !tgt) {
      diffs.push(`Container "${name}": removed`);
      continue;
    }

    if (cur.image !== tgt.image) {
      diffs.push(`Container "${name}": image ${cur.image} -> ${tgt.image}`);
    }

    const curEnvKeys = new Set((cur.env || []).map((e) => e.name));
    const tgtEnvKeys = new Set((tgt.env || []).map((e) => e.name));
    const addedEnv = [...tgtEnvKeys].filter((k) => !curEnvKeys.has(k));
    const removedEnv = [...curEnvKeys].filter((k) => !tgtEnvKeys.has(k));
    if (addedEnv.length) diffs.push(`Container "${name}": env added: ${addedEnv.join(', ')}`);
    if (removedEnv.length) diffs.push(`Container "${name}": env removed: ${removedEnv.join(', ')}`);

    const resPaths = [
      ['limits', 'cpu'],
      ['limits', 'memory'],
      ['requests', 'cpu'],
      ['requests', 'memory'],
    ] as const;
    for (const [tier, res] of resPaths) {
      const curVal = cur.resources?.[tier]?.[res] || 'none';
      const tgtVal = tgt.resources?.[tier]?.[res] || 'none';
      if (curVal !== tgtVal) {
        diffs.push(`Container "${name}": ${res} ${tier} ${curVal} -> ${tgtVal}`);
      }
    }
  }

  return diffs.length > 0 ? diffs : ['No visible spec changes detected'];
}

export function RollbackPanel({ resource, namespace }: { resource: K8sResource; namespace: string }) {
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [expandedRevision, setExpandedRevision] = useState<number | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<Revision | null>(null);
  const [rolling, setRolling] = useState(false);

  const spec = resource.spec as Deployment['spec'];
  const matchLabels: Record<string, string> = spec?.selector?.matchLabels || {};
  const deploymentUid = resource.metadata.uid;
  const deploymentName = resource.metadata.name;

  const labelSelector = useMemo(
    () => Object.entries(matchLabels).map(([k, v]) => `${k}=${v}`).join(','),
    [matchLabels],
  );

  const { data: revisions, isLoading, error } = useQuery({
    queryKey: ['rollback-revisions', namespace, deploymentName, deploymentUid],
    queryFn: async () => {
      const replicaSets = await k8sList<K8sResource>(
        `/apis/apps/v1/namespaces/${namespace}/replicasets?labelSelector=${encodeURIComponent(labelSelector)}`,
      );

      const owned = replicaSets.filter((rs) =>
        rs.metadata.ownerReferences?.some((ref) => ref.uid === deploymentUid && ref.kind === 'Deployment'),
      );

      const parsed: Revision[] = owned
        .map((rs) => {
          const revNum = parseInt(rs.metadata.annotations?.['deployment.kubernetes.io/revision'] || '0', 10);
          const rsSpec = rs.spec as ReplicaSet['spec'];
          const podTemplate = rsSpec?.template;
          const containers: Container[] = podTemplate?.spec?.containers || [];
          const rsStatus = rs.status as ReplicaSet['status'];
          return {
            number: revNum,
            replicaSet: rs,
            creationTimestamp: rs.metadata.creationTimestamp || '',
            images: containers.map((c) => c.image),
            replicas: {
              current: rsStatus?.readyReplicas ?? rsStatus?.replicas ?? 0,
              desired: rsSpec?.replicas ?? 0,
            },
            isCurrent: false,
            podTemplate,
          };
        })
        .filter((r) => r.number > 0)
        .sort((a, b) => b.number - a.number);

      if (parsed.length > 0) {
        parsed[0].isCurrent = true;
      }

      return parsed;
    },
    enabled: resource.kind === 'Deployment' && !!deploymentUid && labelSelector.length > 0,
    refetchInterval: 30_000,
  });

  if (resource.kind !== 'Deployment') return null;

  const currentTemplate = (resource.spec as Deployment['spec'])?.template;

  async function handleRollback() {
    if (!rollbackTarget) return;
    setRolling(true);
    try {
      await k8sPatch(
        `/apis/apps/v1/namespaces/${namespace}/deployments/${deploymentName}`,
        { spec: { template: rollbackTarget.podTemplate } },
      );
      addToast({
        id: `rollback-${Date.now()}`,
        type: 'success',
        title: `Rollback to revision ${rollbackTarget.number} started`,
        detail: `Deployment "${deploymentName}" is rolling back.`,
      });
      queryClient.invalidateQueries({ queryKey: ['rollback-revisions', namespace, deploymentName] });
      queryClient.invalidateQueries({ queryKey: ['k8s'] });
    } catch (err: unknown) {
      addToast({
        id: `rollback-err-${Date.now()}`,
        type: 'error',
        title: 'Rollback failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setRolling(false);
      setRollbackTarget(null);
    }
  }

  const diffLines = rollbackTarget ? computeDiffs(currentTemplate, rollbackTarget.podTemplate) : [];

  return (
    <>
      <div className="rounded-lg border border-slate-800 bg-slate-950">
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-slate-100 hover:bg-slate-900 transition-colors rounded-t-lg"
        >
          {expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
          <History className="h-4 w-4 text-slate-400" />
          Revision History
          {revisions && (
            <span className="ml-auto text-xs text-slate-500">{revisions.length} revision{revisions.length !== 1 ? 's' : ''}</span>
          )}
        </button>

        {expanded && (
          <div className="border-t border-slate-800">
            {isLoading && (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading revision history...
              </div>
            )}

            {error && (
              <div className="px-4 py-4 text-sm text-red-400">
                Failed to load revisions: {(error as Error).message}
              </div>
            )}

            {revisions && revisions.length === 0 && (
              <div className="px-4 py-4 text-sm text-slate-500">No revisions found.</div>
            )}

            {revisions && revisions.length > 0 && (
              <div className="divide-y divide-slate-800/60">
                {revisions.map((rev) => {
                  const isOpen = expandedRevision === rev.number;
                  const diffs = isOpen ? computeDiffs(currentTemplate, rev.podTemplate) : [];
                  return (
                    <div key={rev.number} className="group">
                      <div
                        className={cn(
                          'flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer hover:bg-slate-900/60 transition-colors',
                          isOpen && 'bg-slate-900/40',
                        )}
                        onClick={() => setExpandedRevision(isOpen ? null : rev.number)}
                      >
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                        )}

                        <span className="font-mono text-slate-200">#{rev.number}</span>

                        {rev.isCurrent && (
                          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
                            <CheckCircle className="h-3 w-3" /> Current
                          </span>
                        )}

                        <span className="text-slate-500 text-xs ml-auto mr-3" title={rev.creationTimestamp}>
                          {rev.creationTimestamp ? timeAgo(rev.creationTimestamp) : '—'}
                        </span>

                        <span className="text-xs text-slate-500">
                          {rev.replicas.current}/{rev.replicas.desired} replicas
                        </span>

                        {!rev.isCurrent && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRollbackTarget(rev);
                            }}
                            className="ml-3 flex items-center gap-1 rounded bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-400 opacity-0 group-hover:opacity-100 hover:bg-amber-500/25 transition-all"
                          >
                            <RotateCcw className="h-3 w-3" /> Rollback
                          </button>
                        )}
                      </div>

                      {isOpen && (
                        <div className="bg-slate-900/30 px-4 py-3 text-xs space-y-2">
                          <div>
                            <span className="text-slate-500">Images: </span>
                            <span className="text-slate-300">{rev.images.join(', ') || '—'}</span>
                          </div>
                          {!rev.isCurrent && (
                            <div>
                              <span className="text-slate-500">Changes vs current: </span>
                              <ul className="mt-1 space-y-0.5 text-slate-400">
                                {diffs.map((d, i) => (
                                  <li key={i} className="font-mono">{d}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!rollbackTarget}
        onClose={() => !rolling && setRollbackTarget(null)}
        onConfirm={handleRollback}
        title={`Rollback to revision #${rollbackTarget?.number ?? ''}?`}
        description={diffLines.join('\n')}
        confirmLabel="Rollback"
        variant="warning"
        loading={rolling}
      />
    </>
  );
}
