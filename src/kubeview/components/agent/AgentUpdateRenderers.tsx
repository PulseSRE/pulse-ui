/**
 * Renderers for the agent's `upgrade_graph` and `rollout_history` components.
 *
 * upgrade_graph draws the same UpgradeGraph as Admin › Updates, read-only:
 * starting an update happens on that page, which re-reads the live
 * ClusterVersion, pins the cluster and asks for risk acceptance.
 *
 * rollout_history renders the live RolloutHistory for the workload (watched,
 * with RBAC-gated, confirmed rollback) on the agent's own cluster. Until the
 * workload can be read, or if it cannot, the agent's snapshot is shown.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpCircle, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UpgradeGraph } from '../updates/UpgradeGraph';
import { RolloutHistory } from '../../views/detail/RolloutHistory';
import { k8sGet } from '../../engine/query';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import { timeAgo } from '../../engine/dateUtils';
import { resourceDetailUrl } from '../../engine/gvr';
import type { UpgradeGraphSpec, RolloutHistorySpec } from '../../engine/agentComponents';
import type { UpgradeModel } from '../../engine/upgradeGraph';
import type { K8sResource } from '../../engine/renderers';

const PLURAL: Record<string, string> = { Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets' };

export function AgentUpgradeGraph({ spec }: { spec: UpgradeGraphSpec }) {
  const navigate = useNavigate();
  const model: UpgradeModel = useMemo(() => ({
    current: spec.current || { version: '' },
    desired: spec.desired,
    updatesFrom: spec.updatesFrom ?? spec.edges?.[0]?.from,
    channels: spec.channels,
    nodes: (spec.nodes || []).map((n) => ({ ...n, risks: n.risks || [], recommended: n.recommended ?? n.state === 'recommended' })),
    edges: spec.edges,
    history: spec.history || [],
    progress: spec.progress || { phase: 'idle' },
    blockers: spec.blockers || [],
  }), [spec]);
  return (
    <div className="my-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <div className="text-xs font-medium text-slate-300 mb-2">{spec.title || 'Cluster updates'}</div>
      <UpgradeGraph
        model={model}
        onNavigate={(path) => navigate(path)}
        readOnlyHint={(
          <button
            type="button"
            onClick={() => navigate('/admin?tab=updates')}
            className="px-3 py-1.5 text-xs rounded-sm bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5"
          >
            <ArrowUpCircle className="w-3.5 h-3.5" /> Review and update in Admin › Updates
          </button>
        )}
      />
    </div>
  );
}

export function AgentRolloutHistory({ spec }: { spec: RolloutHistorySpec }) {
  const navigate = useNavigate();
  const w = spec.workload;
  const plural = w ? PLURAL[w.kind] : undefined;
  const path = plural ? `/apis/apps/v1/namespaces/${w.namespace}/${plural}/${w.name}` : '';
  const workload = useQuery({
    queryKey: ['agent-rollout-workload', path, LOCAL_CLUSTER_ID],
    queryFn: () => k8sGet<K8sResource>(path, LOCAL_CLUSTER_ID),
    enabled: !!path,
    // Live during a rollout: the in-flight bar and current revision follow the workload.
    refetchInterval: 10_000,
    retry: 1,
  });

  if (!w || !plural) {
    return <div className="my-2 text-xs text-slate-500">Rollout history: unsupported workload.</div>;
  }

  return (
    <div className="my-2 space-y-1">
      {spec.title && <div className="text-xs font-medium text-slate-300">{spec.title}</div>}
      {workload.data ? (
        <RolloutHistory resource={workload.data} namespace={w.namespace} clusterId={LOCAL_CLUSTER_ID} />
      ) : (
        <SnapshotTimeline spec={spec} note={workload.isError ? `Live revisions could not be read (${workload.error instanceof Error ? workload.error.message : 'error'}); showing the agent's snapshot.` : undefined} />
      )}
      <button
        type="button"
        onClick={() => navigate(resourceDetailUrl({ apiVersion: 'apps/v1', kind: w.kind, metadata: { name: w.name, namespace: w.namespace } }))}
        className="text-[11px] text-blue-400 hover:text-blue-300"
      >
        Open {w.kind} {w.namespace}/{w.name}
      </button>
    </div>
  );
}

function SnapshotTimeline({ spec, note }: { spec: RolloutHistorySpec; note?: string }) {
  const revisions = [...(spec.revisions || [])].sort((a, b) => a.revision - b.revision);
  return (
    <section aria-label="Rollout history snapshot" className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-slate-100 mb-2">
        <History className="h-4 w-4 text-slate-400" /> Rollout History
        <span className="ml-auto text-xs text-slate-500">{revisions.length} revision{revisions.length !== 1 ? 's' : ''}</span>
      </div>
      {note && <p role="status" className="text-xs text-amber-300/80 mb-2">{note}</p>}
      <ol className="flex items-start overflow-x-auto gap-3">
        {revisions.map((r) => (
          <li key={r.name} className="w-32 shrink-0 text-center">
            <span className={cn('inline-block rounded-full px-2 py-0.5 font-mono text-xs', r.current ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-300')}>
              #{r.revision}{r.current ? ' current' : ''}
            </span>
            <div className="mt-1 truncate font-mono text-[10px] text-slate-400" title={r.images.join(', ')}>{r.images.map((i) => i.split('/').pop()).join(', ')}</div>
            {r.changeCause && <div className="truncate text-[10px] text-slate-500" title={r.changeCause}>{r.changeCause}</div>}
            {r.createdAt && <div className="text-[10px] text-slate-600">{timeAgo(r.createdAt)}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
