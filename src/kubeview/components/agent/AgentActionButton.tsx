import { useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WriteConfirmDialog } from '../primitives/WriteConfirmDialog';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import type { ActionButtonSpec } from '../../engine/agentComponents';
import { useCustomViewStore } from '../../store/customViewStore';

const STYLE_CLASSES = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  ghost: 'bg-transparent hover:bg-slate-700 text-slate-300 border border-slate-600',
} as const;

interface Props {
  spec: ActionButtonSpec;
  viewId?: string;
}

export function AgentActionButton({ spec, viewId }: Props) {
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const executeAction = useCustomViewStore((s) => s.executeAction);

  const style = spec.style || 'primary';
  const isWrite = spec._is_write === true;

  const handleExecute = useCallback(async () => {
    if (!viewId) {
      setError('No view context for action execution');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setShowConfirm(false);
    try {
      const data = await executeAction(viewId, spec.action, spec.action_input);
      setResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  }, [viewId, spec, executeAction]);

  /** A write runs only from the confirm dialog; a failure stays in it. */
  const runWrite = useCallback(async () => {
    if (!viewId) throw new Error('No view context for action execution');
    setError(null);
    setResult(null);
    const data = await executeAction(viewId, spec.action, spec.action_input);
    setResult(data.result);
    setShowConfirm(false);
  }, [viewId, spec, executeAction]);

  const handleClick = useCallback(() => {
    if (isWrite) {
      setShowConfirm(true);
    } else {
      handleExecute();
    }
  }, [isWrite, handleExecute]);

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={loading}
        role="button"
        aria-label={`${spec.label} — ${spec.action}`}
        aria-description={style === 'danger' ? spec.confirm_text : undefined}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
          STYLE_CLASSES[style] || STYLE_CLASSES.primary,
        )}
      >
        {loading && <Loader2 className="w-3 h-3 animate-spin" />}
        {spec.label}
      </button>

      {result && (
        <div className="text-[10px] text-emerald-400 max-w-xs truncate" title={result}>
          {result.length > 80 ? result.slice(0, 80) + '...' : result}
        </div>
      )}
      {error && (
        <div className="text-[10px] text-red-400 max-w-xs truncate" title={error}>
          {error}
        </div>
      )}

      {/* An agent-authored write: the same confirm as every other approval
          (parameters, where and as whom, observe-mode gate, cluster pin). The
          agent runs it on its own cluster with the person's forwarded token. */}
      {isWrite && showConfirm && (
        <WriteConfirmDialog
          title={`${spec.label}?`}
          where={{
            clusterId: LOCAL_CLUSTER_ID,
            actingAs: 'agent-user',
            namespace: typeof spec.action_input?.namespace === 'string' ? spec.action_input.namespace : undefined,
          }}
          change={{ params: { action: spec.action, input: spec.action_input ?? {} } }}
          impact={spec.confirm_text}
          confirmLabel={spec.label}
          what={spec.label}
          onConfirm={runWrite}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
