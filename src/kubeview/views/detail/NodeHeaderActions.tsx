/**
 * Cordon/uncordon and Drain on the node detail page — the same requests as
 * the node table and the node map (engine/nodeActions), each confirmed, each
 * against the cluster that was active when its dialog opened.
 */
import { useState } from 'react';
import { Ban, CheckCircle, LogOut } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCanI } from '../../hooks/useCanI';
import { useActionDialog } from '../../components/ActionDialog';
import { DrainNodeDialog } from '../../components/DrainNodeDialog';
import { setNodeSchedulable, scheduleChangeCopy } from '../../engine/nodeActions';
import { getActiveClusterId } from '../../engine/clusterConnection';
import type { K8sResource } from '../../engine/renderers';

const btn = 'px-2.5 py-1.5 text-xs text-slate-400 rounded-sm hover:bg-slate-800 flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export function NodeHeaderActions({ node }: { node: K8sResource }) {
  const name = node.metadata.name;
  const queryClient = useQueryClient();
  const { allowed: canPatch } = useCanI('patch', '', 'nodes');
  const { open, dialog } = useActionDialog();
  const [drain, setDrain] = useState<{ clusterId: string } | null>(null);
  const cordoned = !!(node.spec as { unschedulable?: boolean } | undefined)?.unschedulable;
  const noPerm = canPatch ? undefined : 'You do not have permission to change nodes';

  return (
    <>
      {cordoned ? (
        <button
          className={`${btn} hover:text-emerald-400`}
          disabled={!canPatch}
          title={noPerm}
          onClick={() => open({ ...scheduleChangeCopy(name, true), run: (cid) => setNodeSchedulable(name, true, cid) })}
        >
          <CheckCircle className="w-3.5 h-3.5" /> Uncordon
        </button>
      ) : (
        <button
          className={`${btn} hover:text-amber-400`}
          disabled={!canPatch}
          title={noPerm}
          onClick={() => open({ ...scheduleChangeCopy(name, false), run: (cid) => setNodeSchedulable(name, false, cid) })}
        >
          <Ban className="w-3.5 h-3.5" /> Cordon
        </button>
      )}
      <button
        className={`${btn} hover:text-red-400`}
        disabled={!canPatch}
        title={noPerm ?? 'Cordon the node and evict its pods'}
        onClick={() => setDrain({ clusterId: getActiveClusterId() })}
      >
        <LogOut className="w-3.5 h-3.5" /> Drain
      </button>
      {drain && (
        <DrainNodeDialog
          node={name}
          clusterId={drain.clusterId}
          onClose={() => setDrain(null)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['detail'] })}
        />
      )}
      {dialog}
    </>
  );
}
