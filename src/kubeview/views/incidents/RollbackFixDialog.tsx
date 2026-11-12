/**
 * Confirm rolling back an agent fix (Inbox › Activity), on the shared
 * WriteConfirmDialog: the exact change (live object → the snapshot taken
 * before the fix), where and as whom, that there is no dry run, impact and
 * undo. Observe mode disables it; the cluster active when it opened is
 * pinned. Confirming sends the same request as before:
 * POST /fix-history/{id}/rollback, no body. A refusal stays in the dialog
 * with the agent's words.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { WriteConfirmDialog, type WriteChangeProps, type WriteFact } from '../../components/primitives/WriteConfirmDialog';
import { requestRollback, type ActionRecord } from '../../engine/fixHistory';
import { changedSinceFix, rollbackPlan, snapshotDiff } from '../../engine/fixRollback';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import { k8sGet } from '../../engine/query';
import { describeWriteError } from '../../components/ActionDialog';

export function RollbackFixDialog({ action, onClose, onRolledBack }: {
  action: ActionRecord;
  onClose: () => void;
  onRolledBack: () => void;
}) {
  const plan = React.useMemo(() => rollbackPlan(action), [action]);
  const res = action.resources?.[0];
  const snap = plan.kind === 'snapshot' ? plan.snapshot : null;
  // The agent runs on the local cluster; read the object there to show the exact change.
  const live = useQuery({
    queryKey: ['fix-rollback-live', LOCAL_CLUSTER_ID, plan.kind === 'snapshot' ? plan.path : ''],
    queryFn: () => k8sGet<Record<string, unknown>>((plan as { path: string }).path, LOCAL_CLUSTER_ID),
    enabled: plan.kind === 'snapshot',
    retry: false,
    staleTime: 0,
  });

  const kind = snap?.kind ?? res?.kind;
  const name = snap?.name ?? res?.name;
  const namespace = snap?.namespace ?? res?.namespace;
  const target = kind && name ? `${kind} ${name}` : null;
  const fixName = action.tool || action.category;

  let change: WriteChangeProps;
  const extraFacts: WriteFact[] = [];
  if (plan.kind === 'snapshot') {
    const snap = plan.snapshot;
    if (live.data) {
      const diff = snapshotDiff(snap, live.data);
      change = diff.lines.length > 0
        ? { diff, note: 'Replaces these fields with the copy the agent took just before the fix (labels, annotations and the whole spec or data).' }
        : { diff, note: 'The live object already matches the copy taken before the fix; rolling back changes nothing.' };
      const since = changedSinceFix(snap, live.data);
      if (since) extraFacts.push({ label: 'Changed since the fix', value: since.text, tone: since.changed ? 'danger' : undefined });
    } else {
      change = {
        params: { action: 'restore_snapshot', input: { kind: snap.kind, namespace: snap.namespace, name: snap.name } },
        note: live.isLoading
          ? `Reading the live ${snap.kind} to show the exact change…`
          : `Could not read the live ${snap.kind}, so the exact change cannot be shown: ${describeWriteError(live.error)}`,
      };
    }
  } else if (plan.kind === 'revision') {
    change = {
      params: { action: 'rollback_deployment', input: plan.input },
      note: plan.input.revision ? `Rolls back to revision ${plan.input.revision}.` : 'Rolls back to the previous revision.',
    };
  } else {
    change = {
      params: { action: plan.tool ?? 'rollback', input: plan.input ?? { actionId: action.id } },
      note: 'The agent did not say how it would undo this fix; it refuses if it has no way to.',
    };
  }

  const impact = snap
    ? snap.kind === 'ConfigMap'
      ? `Restores ConfigMap ${snap.name}'s data as it was before "${fixName}". Pods that read it at start keep the current values until restarted.`
      : `Restores ${snap.kind} ${snap.name}'s spec as it was before "${fixName}". If the pod template differs, its pods are replaced following its update strategy.`
    : plan.kind === 'revision'
      ? `Rolls ${target ?? 'the workload'} back; its pods are replaced following its update strategy.`
      : `Undoes "${fixName}"${target ? ` on ${target}` : ''}.`;

  return (
    <WriteConfirmDialog
      title={target ? `Roll back the fix on ${target}?` : 'Roll back this fix?'}
      where={{ namespace, clusterId: LOCAL_CLUSTER_ID, actingAs: 'agent-user' }}
      change={change}
      impact={impact}
      undo="No one-click undo: the rollback is recorded in Activity. To return to the fixed state, apply the fix again."
      extraFacts={extraFacts}
      after={<><span className="font-semibold text-slate-100">When you confirm,</span> the agent checks the object is the one it fixed and unchanged since, then restores it. Otherwise it refuses and changes nothing.</>}
      confirmLabel={target ? `Roll back ${target}` : 'Roll back'}
      failurePrefix="The agent did not roll back"
      what="This rollback"
      onConfirm={async () => {
        await requestRollback(action.id);
        onRolledBack();
      }}
      onClose={onClose}
    />
  );
}
