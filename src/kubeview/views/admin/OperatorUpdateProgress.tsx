import React from 'react';
import { Puzzle, CheckCircle, XCircle, RefreshCw, AlertTriangle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Panel } from '../../components/primitives/Panel';
import { resourceDetailUrl } from '../../engine/gvr';
import { formatDurationMs } from '../../engine/format';
import type { ClusterOperator, Condition, Pod } from '../../engine/types';

/** An operator still Progressing after this long, during an update, is treated as stuck. */
export const STUCK_PROGRESSING_MINUTES = 30;
const MAX_NAMESPACES = 6;

const cond = (op: ClusterOperator, type: string) => (op.status?.conditions as Condition[] | undefined)?.find((c) => c.type === type);

/** Why an operator looks stuck during an update, or null. */
export function operatorStuckReason(op: ClusterOperator, now = Date.now()): string | null {
  if (cond(op, 'Degraded')?.status === 'True') return 'Degraded';
  if (cond(op, 'Available')?.status === 'False') return 'Not available';
  const p = cond(op, 'Progressing');
  if (p?.status === 'True' && p.lastTransitionTime) {
    const ms = now - new Date(p.lastTransitionTime).getTime();
    if (ms > STUCK_PROGRESSING_MINUTES * 60_000) return `Progressing for ${formatDurationMs(ms)}`;
  }
  return null;
}

/** Namespaces an operator names in status.relatedObjects (the namespaces themselves, and objects' namespaces). */
export function relatedNamespaces(op: ClusterOperator): string[] {
  const out = new Set<string>();
  for (const r of op.status?.relatedObjects || []) {
    if (r.resource === 'namespaces' && !r.group && r.name) out.add(r.name);
    else if (r.namespace) out.add(r.namespace);
  }
  return [...out];
}

function podReady(p: Pod): boolean {
  return ((p.status?.conditions || []) as Condition[]).some((c) => c.type === 'Ready' && c.status === 'True');
}

function StuckDetail({ op, pods, podsError, podsLoading, go }: { op: ClusterOperator; pods: Pod[]; podsError?: string; podsLoading?: boolean; go: (path: string, title: string) => void }) {
  const namespaces = relatedNamespaces(op);
  const [openNs, setOpenNs] = React.useState<string | null>(null);
  if (namespaces.length === 0) return <p className="mt-1 text-xs text-slate-500">The operator lists no related namespaces.</p>;
  const nsPods = openNs ? pods.filter((p) => p.metadata.namespace === openNs).sort((a, b) => Number(podReady(a)) - Number(podReady(b))) : [];
  return (
    <div className="mt-1.5 space-y-1.5" data-testid={`stuck-operator-${op.metadata.name}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-500">Related namespaces:</span>
        {namespaces.slice(0, MAX_NAMESPACES).map((ns) => (
          <button key={ns} type="button" aria-expanded={openNs === ns} onClick={() => setOpenNs((v) => (v === ns ? null : ns))}
            className={cn('px-1.5 py-0.5 rounded-sm font-mono', openNs === ns ? 'bg-blue-900/60 text-blue-200' : 'bg-slate-800 text-blue-400 hover:text-blue-300')}>
            {ns}
          </button>
        ))}
        {namespaces.length > MAX_NAMESPACES && <span className="text-slate-500">+{namespaces.length - MAX_NAMESPACES} more</span>}
      </div>
      {openNs && (podsError
        ? <p className="text-xs text-slate-500">Pods could not be read ({podsError}).</p>
        : podsLoading
          ? <p className="text-xs text-slate-500">Loading pods{'\u2026'}</p>
          : nsPods.length === 0
          ? <p className="text-xs text-slate-500">No pods in {openNs}.</p>
          : (
            <ul className="space-y-1" aria-label={`Pods in ${openNs}`}>
              {nsPods.slice(0, 10).map((p) => (
                <li key={p.metadata.name} className="flex items-center gap-2 text-xs">
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', podReady(p) ? 'bg-emerald-500' : 'bg-red-500')} aria-hidden="true" />
                  <button type="button" onClick={() => go(`/r/v1~pods/${openNs}/${p.metadata.name}`, p.metadata.name)} className="font-mono text-blue-400 hover:text-blue-300 hover:underline truncate">{p.metadata.name}</button>
                  <span className="text-slate-500">{podReady(p) ? 'Ready' : (p.status?.phase || 'Not ready')}</span>
                  <button type="button" onClick={() => go(`/logs/${openNs}/${p.metadata.name}`, `${p.metadata.name} (Logs)`)} className="ml-auto inline-flex items-center gap-1 text-blue-400 hover:text-blue-300">
                    <FileText className="w-3 h-3" aria-hidden="true" />Logs
                  </button>
                </li>
              ))}
              {nsPods.length > 10 && <li className="text-xs text-slate-500">+{nsPods.length - 10} more</li>}
            </ul>
          ))}
    </div>
  );
}

/**
 * ClusterOperators during an update: each one's state and the message behind
 * it. A stuck operator (Degraded, unavailable, or Progressing for too long)
 * opens its related namespaces, their pods, and each pod's logs.
 */
export function OperatorUpdateProgress({ operators, pods, podsError, podsLoading, go }: {
  operators: ClusterOperator[];
  pods: Pod[];
  podsError?: string;
  podsLoading?: boolean;
  go: (path: string, title: string) => void;
}) {
  return (
    <Panel title="Operator Update Progress" icon={<Puzzle className="w-4 h-4 text-blue-500" />}>
      <div className="space-y-1 max-h-96 overflow-auto">
        {operators.map((op) => {
          const isProgressing = cond(op, 'Progressing')?.status === 'True';
          const degraded = cond(op, 'Degraded');
          const isDegraded = degraded?.status === 'True';
          const stuck = operatorStuckReason(op);
          const version = op.status?.versions?.find((v) => v.name === 'operator')?.version || '';
          const detailMessage = isDegraded ? (degraded?.message || degraded?.reason)
            : isProgressing ? (cond(op, 'Progressing')?.message || cond(op, 'Progressing')?.reason)
            : '';
          return (
            <div key={op.metadata.uid || op.metadata.name} className="py-1.5 px-2 hover:bg-slate-800/30 rounded-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  {isDegraded ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                    : stuck ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    : isProgressing ? <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0 mt-0.5" />
                    : <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => go(resourceDetailUrl({ apiVersion: 'config.openshift.io/v1', kind: 'ClusterOperator', metadata: { name: op.metadata.name } }), op.metadata.name)}
                      className="text-sm text-slate-200 hover:underline text-left"
                    >
                      {op.metadata.name}
                    </button>
                    {detailMessage && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{detailMessage}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {version && <span className="text-xs font-mono text-slate-500">{version}</span>}
                  <span className={cn('text-xs px-1.5 py-0.5 rounded-sm',
                    isDegraded ? 'bg-red-900/50 text-red-300'
                      : stuck ? 'bg-amber-900/50 text-amber-300'
                      : isProgressing ? 'bg-blue-900/50 text-blue-300'
                      : 'bg-green-900/50 text-green-300')}>
                    {isDegraded ? 'Degraded' : stuck ? `Stuck: ${stuck}` : isProgressing ? 'Updating' : 'Ready'}
                  </span>
                </div>
              </div>
              {stuck && <div className="ml-5"><StuckDetail op={op} pods={pods} podsError={podsError} podsLoading={podsLoading} go={go} /></div>}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
