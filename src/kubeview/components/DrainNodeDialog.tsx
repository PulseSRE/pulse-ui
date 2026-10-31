/**
 * Drain a node: confirm (showing which pods move and which stay), then cordon
 * and evict with live per-pod progress, then a summary. Pods a
 * PodDisruptionBudget blocked can be retried, or the drain left there.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle, XCircle, ShieldAlert, MinusCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from './feedback/ConfirmDialog';
import { Button } from './primitives/Button';
import { useUIStore } from '../store/uiStore';
import {
  classifyPodsForDrain, drainNode, describeDrain, listNodePods, summarize,
  type DrainPodState, type DrainResult,
} from '../engine/nodeActions';

interface DrainNodeDialogProps {
  node: string;
  clusterId: string | undefined;
  onClose: () => void;
  /** Called after each drain attempt finishes (e.g. to refresh a list). */
  onDone?: (result: DrainResult) => void;
}

const STATUS_ICON: Record<DrainPodState['status'], React.ReactNode> = {
  pending: <Clock className="w-3.5 h-3.5 text-slate-500" />,
  evicting: <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />,
  evicted: <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />,
  blocked: <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />,
  failed: <XCircle className="w-3.5 h-3.5 text-red-400" />,
  skipped: <MinusCircle className="w-3.5 h-3.5 text-slate-500" />,
};

const STATUS_LABEL: Record<DrainPodState['status'], string> = {
  pending: 'Waiting', evicting: 'Evicting', evicted: 'Evicted', blocked: 'Blocked', failed: 'Failed', skipped: 'Skipped',
};

export function DrainNodeDialog({ node, clusterId, onClose, onDone }: DrainNodeDialogProps) {
  const addToast = useUIStore((s) => s.addToast);
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm');
  const [preview, setPreview] = useState<DrainPodState[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pods, setPods] = useState<DrainPodState[]>([]);
  const [result, setResult] = useState<DrainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef({ cancelled: false });

  useEffect(() => {
    let live = true;
    listNodePods(node, clusterId)
      .then((list) => { if (live) setPreview(classifyPodsForDrain(list)); })
      .catch((err) => { if (live) setPreviewError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; cancel.current.cancelled = true; };
  }, [node, clusterId]);

  const run = async (only?: DrainPodState[]) => {
    setPhase('running');
    setError(null);
    cancel.current = { cancelled: false };
    const kept = only ? pods.filter((p) => !only.some((o) => o.namespace === p.namespace && o.name === p.name)) : [];
    try {
      const r = await drainNode(node, clusterId, {
        only,
        signal: cancel.current,
        onProgress: (next) => setPods(only ? [...kept, ...next] : next),
      });
      const merged = only ? summarize(node, true, [...kept, ...r.pods]) : r;
      setPods(merged.pods);
      setResult(merged);
      const toast = describeDrain(merged);
      addToast({ type: toast.type, title: toast.title, detail: toast.detail });
      onDone?.(merged);
    } catch (err) {
      // Cordon or the pod listing failed: nothing was evicted.
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      addToast({ type: 'error', title: `Drain of "${node}" failed`, detail: `${msg}. No pods were evicted.` });
    } finally {
      setPhase('done');
    }
  };

  if (phase === 'confirm') {
    const toEvict = preview?.filter((p) => p.status === 'pending') ?? [];
    const skipped = preview?.filter((p) => p.status === 'skipped') ?? [];
    return (
      <ConfirmDialog
        open
        title={`Drain node ${node}?`}
        description="The node will be cordoned so nothing new is scheduled on it, then each pod is evicted through the Eviction API. PodDisruptionBudgets are honoured: a pod they protect is left in place and reported."
        confirmLabel="Drain"
        variant="danger"
        onConfirm={() => run()}
        onClose={onClose}
      >
        <div className="mt-3 text-xs text-slate-400" data-testid="drain-preview">
          {previewError ? (
            <span className="text-red-400">Could not list the node's pods: {previewError}</span>
          ) : !preview ? (
            <span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Listing pods on the node…</span>
          ) : (
            <span>{toEvict.length} pod{toEvict.length === 1 ? '' : 's'} to evict; {skipped.length} DaemonSet/mirror pod{skipped.length === 1 ? '' : 's'} stay.</span>
          )}
        </div>
      </ConfirmDialog>
    );
  }

  const blocked = pods.filter((p) => p.status === 'blocked');
  const summary = result ? describeDrain(result) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div role="dialog" aria-modal="true" aria-label={`Draining ${node}`} className="w-full max-w-xl rounded-lg bg-slate-800 shadow-xl">
        <div className="px-5 py-4 border-b border-slate-700">
          <h2 className="text-base font-semibold text-slate-100">
            {phase === 'running' ? `Draining ${node}…` : summary?.title ?? `Drain of ${node} failed`}
          </h2>
          <p className="text-xs text-slate-400 mt-1" data-testid="drain-summary">
            {phase === 'running'
              ? `${pods.filter((p) => p.status === 'evicted').length} of ${pods.filter((p) => p.status !== 'skipped').length} evicted`
              : error ? `${error}. No pods were evicted.` : summary?.detail}
          </p>
        </div>
        <ul className="max-h-80 overflow-auto divide-y divide-slate-700/60">
          {pods.map((p) => (
            <li key={`${p.namespace}/${p.name}`} className="px-5 py-2 flex items-start gap-2 text-xs">
              <span className="mt-0.5">{STATUS_ICON[p.status]}</span>
              <div className="min-w-0 flex-1">
                <div className="text-slate-200 truncate">{p.namespace}/{p.name}</div>
                {p.reason && <div className={cn('mt-0.5', p.status === 'blocked' ? 'text-amber-400' : p.status === 'failed' ? 'text-red-400' : 'text-slate-500')}>{p.reason}</div>}
              </div>
              <span className="text-slate-500 shrink-0">{STATUS_LABEL[p.status]}</span>
            </li>
          ))}
        </ul>
        <div className="px-5 py-3 border-t border-slate-700 flex justify-end gap-2">
          {phase === 'running' ? (
            <Button variant="secondary" size="sm" onClick={() => { cancel.current.cancelled = true; }}>Stop after current pod</Button>
          ) : (
            <>
              {blocked.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => run(blocked)}>Retry {blocked.length} blocked</Button>
              )}
              <Button size="sm" onClick={onClose}>Close</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
