/**
 * Actions on an installed OLM operator: change channel, switch update
 * approval, approve a pending InstallPlan, and see when an upgrade waits.
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpCircle, CheckCircle } from 'lucide-react';
import {
  approveInstallPlan, needsApproval, patchSubscription, upgradeAvailable,
  type ApprovalStrategy, type InstallPlanLike, type SubscriptionLike,
} from '../../engine/olm';
import { useCanI } from '../../hooks/useCanI';
import { usePinnedAction } from '../../hooks/usePinnedAction';
import { useUIStore } from '../../store/uiStore';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { Badge } from '../../components/primitives/Badge';
import { LoadError } from '../../components/primitives/LoadError';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';

type Change =
  | { kind: 'channel'; channel: string }
  | { kind: 'approval'; approval: ApprovalStrategy }
  | { kind: 'approve-plan'; plan: InstallPlanLike };

export function ManageSubscription({ sub, installPlan, channels, displayName }: {
  sub: SubscriptionLike;
  installPlan: InstallPlanLike | null | undefined;
  channels: Array<{ name: string; version?: string }>;
  displayName: string;
}) {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const ns = sub.metadata.namespace;
  const { allowed: canPatchSub } = useCanI('patch', 'operators.coreos.com', 'subscriptions', ns);
  const { allowed: canPatchPlan } = useCanI('patch', 'operators.coreos.com', 'installplans', ns);
  const currentChannel = sub.spec?.channel || '';
  const currentApproval = (sub.spec?.installPlanApproval || 'Automatic') as ApprovalStrategy;
  const [channel, setChannel] = React.useState(currentChannel);
  React.useEffect(() => setChannel(currentChannel), [currentChannel]);
  const action = usePinnedAction<Change>();
  const upgrade = upgradeAvailable(sub);
  const pendingPlan = needsApproval(installPlan) ? installPlan! : null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['operator-sub'] });
    queryClient.invalidateQueries({ queryKey: ['installplan'] });
    queryClient.invalidateQueries({ queryKey: ['readiness', 'subscriptions'] });
  };

  const confirm = () => action.run(`Changing ${displayName}`, async (change, clusterId) => {
    if (change.kind === 'channel') {
      await patchSubscription(clusterId, sub, { channel: change.channel });
      addToast({ type: 'success', title: `${displayName} now follows ${change.channel}` });
    } else if (change.kind === 'approval') {
      await patchSubscription(clusterId, sub, { installPlanApproval: change.approval });
      addToast({ type: 'success', title: `${displayName} updates are now ${change.approval}` });
    } else {
      await approveInstallPlan(clusterId, change.plan);
      addToast({ type: 'success', title: `InstallPlan ${change.plan.metadata.name} approved` });
    }
    refresh();
  });

  const change = action.pending?.target;
  const title = !change ? '' : change.kind === 'channel' ? `Switch ${displayName} to ${change.channel}?`
    : change.kind === 'approval' ? `Make ${displayName} updates ${change.approval}?`
      : `Approve InstallPlan ${change.plan.metadata.name}?`;
  const description = !change ? '' : change.kind === 'channel'
    ? `Sets spec.channel on Subscription ${ns}/${sub.metadata.name} from ${currentChannel} to ${change.channel}. OLM then resolves the newest version in that channel${currentApproval === 'Manual' ? ' and creates an InstallPlan that waits for approval' : ' and upgrades the operator automatically'}.`
    : change.kind === 'approval'
      ? `Sets spec.installPlanApproval on Subscription ${ns}/${sub.metadata.name} to ${change.approval}. ${change.approval === 'Manual' ? 'Future updates wait for an InstallPlan approval.' : 'Pending and future updates install without asking.'}`
      : `Sets spec.approved=true on InstallPlan ${ns}/${change.plan.metadata.name}. OLM then installs ${(change.plan.spec?.clusterServiceVersionNames || []).join(', ') || 'the planned version'}.`;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-100">Updates</h2>
        {upgrade
          ? <Badge size="sm" variant="warning"><ArrowUpCircle className="w-3 h-3" /> Upgrade available: {upgrade}</Badge>
          : <Badge size="sm" variant="success"><CheckCircle className="w-3 h-3" /> Up to date in {currentChannel || 'its channel'}</Badge>}
      </div>

      {pendingPlan && (
        <div className="flex items-center justify-between gap-3 rounded border border-amber-800 bg-amber-950/30 px-3 py-2">
          <span className="text-xs text-amber-200">
            InstallPlan {pendingPlan.metadata.name} is waiting for approval
            {pendingPlan.spec?.clusterServiceVersionNames?.length ? ` (${pendingPlan.spec.clusterServiceVersionNames.join(', ')})` : ''}.
          </span>
          <Button size="sm" disabled={!canPatchPlan} title={canPatchPlan ? undefined : `You do not have permission to patch InstallPlans in ${ns}`}
            onClick={() => action.open({ kind: 'approve-plan', plan: pendingPlan })}>
            Approve
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-6">
        <label className="text-xs text-slate-400">
          Channel
          <div className="flex items-center gap-2 mt-1">
            <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel"
              className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded-sm text-slate-200">
              {channels.map((c) => <option key={c.name} value={c.name}>{c.name}{c.version ? ` (v${c.version})` : ''}</option>)}
            </select>
            <Button size="sm" variant="secondary" disabled={channel === currentChannel || !canPatchSub}
              title={canPatchSub ? undefined : `You do not have permission to patch Subscriptions in ${ns}`}
              onClick={() => action.open({ kind: 'channel', channel })}>
              Change channel
            </Button>
          </div>
        </label>
        <div className="text-xs text-slate-400">
          Update approval: <span className="text-slate-200">{currentApproval}</span>
          <Button size="sm" variant="secondary" className="ml-2" disabled={!canPatchSub}
            title={canPatchSub ? undefined : `You do not have permission to patch Subscriptions in ${ns}`}
            onClick={() => action.open({ kind: 'approval', approval: currentApproval === 'Manual' ? 'Automatic' : 'Manual' })}>
            Switch to {currentApproval === 'Manual' ? 'Automatic' : 'Manual'}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={!!action.pending}
        onClose={action.close}
        onConfirm={confirm}
        title={title}
        description={description}
        confirmLabel={change?.kind === 'approve-plan' ? 'Approve' : 'Apply'}
        variant="warning"
        loading={action.running}
      >
        {action.error && <LoadError className="mt-3" title="Nothing was changed" error={action.error} />}
      </ConfirmDialog>
    </Card>
  );
}
