/**
 * Confirm a guided fix: the exact change, a server-side dry run, the impact,
 * quota after the change and how to undo it, then apply it to the cluster the
 * dialog was opened on. Built on the shared WriteConfirmDialog.
 *
 * The dry run (`dryRun=All`) sends the same request the apply will send, so
 * RBAC, validation and admission for that object answer before anything
 * changes; Apply stays disabled until it passes. It does not create pods, so
 * a ResourceQuota that would refuse the new pods is not checked by it — the
 * quota line is computed separately. A failed apply stays in the dialog.
 */
import React from 'react';
import { DiffPre, WriteConfirmDialog } from '../../components/primitives/WriteConfirmDialog';
import { sendWrite } from '../../engine/workloadActions';
import { dryRunRequest, withChangeCause, type GuidedFix } from '../../engine/podFixes';
import type { K8sResource } from '../../engine/renderers';
import type { Headroom } from '../../engine/quotaHeadroom';

export function DiffBlock({ fix }: { fix: GuidedFix }) {
  return <DiffPre diff={{ header: fix.diffHeader, lines: fix.diff }} />;
}

interface FixConfirmDialogProps {
  fix: GuidedFix;
  /** The object the fix patches, as read (for the change-cause annotation). */
  targetObject: K8sResource | null;
  clusterId: string;
  canPatch: boolean;
  headroom?: Headroom;
  onClose: () => void;
  onApplied: (result: unknown, note: string) => void;
}

export function FixConfirmDialog({ fix, targetObject, clusterId, canPatch, headroom, onClose, onApplied }: FixConfirmDialogProps) {
  const dryRun = React.useCallback(
    () => sendWrite(dryRunRequest(withChangeCause(fix, targetObject, '')), clusterId),
    [fix, targetObject, clusterId],
  );
  const recordsCause = fix.target.kind !== 'ServiceAccount';
  return (
    <WriteConfirmDialog
      title={fix.question}
      where={{ namespace: fix.target.namespace, clusterId, actingAs: 'user' }}
      change={{
        diff: { header: fix.diffHeader, lines: fix.diff },
        note: recordsCause ? 'Also records the change cause (kubernetes.io/change-cause) so Rollout History says why.' : undefined,
      }}
      impact={fix.impact}
      undo={fix.undo}
      extraFacts={headroom ? [{ label: 'Quota after change', value: headroom.text, tone: headroom.tone === 'over' ? 'danger' : undefined }] : undefined}
      after={fix.watchable
        ? <><span className="font-semibold text-slate-100">After applying,</span> Pulse watches the rollout and the new pods&apos; restarts for 10 minutes on this page and says whether it held.</>
        : <><span className="font-semibold text-slate-100">After applying,</span> nothing restarts by itself, so Pulse cannot watch whether this held: restart the workload, then check its pods.</>}
      dryRun={dryRun}
      rbac={{ allowed: canPatch, deniedMessage: `You do not have permission to patch ${fix.target.plural} in ${fix.target.namespace}` }}
      reason={recordsCause ? { label: 'Note for the change cause', id: 'fix-note' } : undefined}
      // A direct write with the person's own credentials, not an agent approval.
      observeGate={false}
      confirmLabel={`Apply to ${fix.target.kind} ${fix.target.name}`}
      failurePrefix="Apply failed"
      what={fix.title}
      pinnedClusterId={clusterId}
      onConfirm={async (note) => {
        const result = await sendWrite(withChangeCause(fix, targetObject, note), clusterId);
        onApplied(result, note);
      }}
      onClose={onClose}
    />
  );
}
