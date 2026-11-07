/**
 * Pause or unpause a MachineConfigPool: one confirmation, one write, used on
 * Compute and on Admin › Updates. Gated on permission to patch
 * MachineConfigPools; the write goes to the cluster that was active when the
 * dialog opened and is conditional on the resourceVersion shown (a pool that
 * changed meanwhile is not overwritten).
 */
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCanI } from '../hooks/useCanI';
import { useActionDialog, type ActionSpec } from './ActionDialog';
import { sendWrite, setMcpPaused } from '../engine/workloadActions';
import type { K8sResource } from '../engine/renderers';

export function isMcpPaused(mcp: K8sResource): boolean {
  return !!(mcp.spec as { paused?: boolean } | undefined)?.paused;
}

export function mcpPauseSpec(mcp: K8sResource): ActionSpec {
  const name = mcp.metadata.name;
  return isMcpPaused(mcp)
    ? {
        title: `Unpause MachineConfigPool "${name}"?`,
        description: 'Pending MachineConfig changes, including a cluster update\'s new OS and configuration, start rolling out to this pool\'s nodes, which are drained and rebooted one at a time (up to maxUnavailable).',
        confirmLabel: 'Unpause',
        run: (cid) => sendWrite(setMcpPaused(mcp, false), cid),
        success: `MachineConfigPool "${name}" unpaused`,
      }
    : {
        title: `Pause MachineConfigPool "${name}"?`,
        description: 'Node updates stop for this pool: no MachineConfig changes, including a cluster update\'s new OS and configuration, are applied to its nodes, so they are not drained or rebooted until it is unpaused. On some OpenShift versions, rotated certificates (such as the kube-apiserver-to-kubelet signer CA) do not reach nodes in a paused pool, and kubelet certificates can expire. Do not leave the pool paused for long: its nodes also fall behind the rest of the cluster, and later cluster updates can be blocked until they catch up.',
        confirmLabel: 'Pause',
        run: (cid) => sendWrite(setMcpPaused(mcp, true), cid),
        success: `MachineConfigPool "${name}" paused`,
      };
}

export function MachineConfigPoolPauseButton({ mcp, variant = 'icon' }: { mcp: K8sResource; variant?: 'icon' | 'text' }) {
  const { allowed: canPatch } = useCanI('patch', 'machineconfiguration.openshift.io', 'machineconfigpools');
  const { open, dialog } = useActionDialog();
  const paused = isMcpPaused(mcp);
  const verb = paused ? 'Unpause' : 'Pause';
  const Icon = paused ? Play : Pause;
  return (
    <>
      <button
        type="button"
        onClick={() => open(mcpPauseSpec(mcp))}
        disabled={!canPatch}
        title={canPatch ? verb : 'You do not have permission to change MachineConfigPools'}
        aria-label={`${verb} MachineConfigPool ${mcp.metadata.name}`}
        className={cn(
          'text-faint hover:text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed',
          variant === 'icon' ? 'p-2 mr-2' : 'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs',
        )}
      >
        <Icon className="w-3.5 h-3.5" />
        {variant === 'text' && verb}
      </button>
      {dialog}
    </>
  );
}
