/**
 * "Needs approval": every operator update waiting for a person, across
 * namespaces, at the top of the Operators page.
 *
 * Keeping operators current used to mean opening each operator to find its
 * pending InstallPlan. This lists them all with the version they replace and
 * the version they install. Approve goes through the shared WriteConfirmDialog:
 * the exact change, the server's dry run, your permission, observe mode and
 * the cluster it was opened on. The approval carries the plan's
 * resourceVersion, so a plan that changed after you reviewed it is refused.
 *
 * There is no Deny: OLM has none. Leaving a plan unapproved is how an update is
 * declined, and the panel says so.
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle, ClipboardCheck, Loader2 } from 'lucide-react';
import {
  approveInstallPlan, csvVersion, INSTALLPLANS_PATH, pendingApprovals,
  type InstallPlanLike, type PendingApproval, type SubscriptionLike,
} from '../../engine/olm';
import { k8sList } from '../../engine/query';
import { safeQuery } from '../../engine/safeQuery';
import { formatAge } from '../../engine/format';
import { useCanI } from '../../hooks/useCanI';
import { useUIStore } from '../../store/uiStore';
import { Card } from '../../components/primitives/Card';
import { Badge } from '../../components/primitives/Badge';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { WriteConfirmDialog } from '../../components/primitives/WriteConfirmDialog';
import { AskPulseButton } from '../../components/agent/AskPulseButton';
import type { ResourceContext } from '../../engine/agentClient';

export const NEEDS_APPROVAL_ID = 'needs-approval';

export const NO_DENY_TEXT = 'OLM has no Deny. To decline an update, leave its plan unapproved: nothing installs and the current version keeps running.';

function versions(row: PendingApproval): string {
  const to = row.installs.map(csvVersion).join(', ') || '?';
  const from = row.replaces.map(csvVersion).join(', ');
  return from ? `${from} → ${to}` : to;
}

function planContext(plan: InstallPlanLike): ResourceContext {
  return { kind: 'InstallPlan', name: plan.metadata.name, namespace: plan.metadata.namespace, gvr: 'operators.coreos.com/v1alpha1/installplans' };
}

function ApproveDialog({ row, clusterId, onClose, onApproved }: {
  row: PendingApproval; clusterId: string; onClose: () => void; onApproved: () => void;
}) {
  const { plan } = row;
  const ns = plan.metadata.namespace;
  const rbac = useCanI('patch', 'operators.coreos.com', 'installplans', ns, undefined, { clusterId });
  const dryRun = React.useCallback(() => approveInstallPlan(clusterId, plan, { precondition: true, dryRun: true }), [clusterId, plan]);
  return (
    <WriteConfirmDialog
      title={`Approve InstallPlan ${plan.metadata.name}?`}
      where={{ namespace: ns, clusterId, actingAs: 'user' }}
      pinnedClusterId={clusterId}
      what="This approval"
      change={{
        diff: {
          header: `InstallPlan ${ns}/${plan.metadata.name} (resourceVersion ${plan.metadata.resourceVersion ?? 'unknown'})`,
          lines: [{ field: 'spec.approved', before: 'false', after: 'true' }],
        },
        note: `Sent with resourceVersion ${plan.metadata.resourceVersion ?? 'unknown'}: if the plan changed since this page read it, the API server refuses and nothing is approved.`,
      }}
      impact={(
        <>
          OLM installs <strong className="font-medium">{row.installs.join(', ') || 'the planned version'}</strong>
          {row.replaces.length > 0 ? <>, replacing <strong className="font-medium">{row.replaces.join(', ')}</strong></> : row.subscription ? ' (no installed version to replace)' : ' (the version it replaces is unknown)'}.
          {row.stepCount > 0 && ` The plan applies ${row.stepCount} resource${row.stepCount === 1 ? '' : 's'}${row.crdCount ? `, including ${row.crdCount} CustomResourceDefinition${row.crdCount === 1 ? '' : 's'}` : ''}.`}
        </>
      )}
      undo="OLM cannot un-approve a plan. Once it installs, going back means reinstalling the operator at the older version."
      extraFacts={row.gitops ? [{ label: 'GitOps', value: `Tracked by Argo CD application ${row.gitops}. Approval mode, channel and startingCSV live in Git; change those with a pull request, not here.` }] : undefined}
      dryRun={dryRun}
      rbac={{ allowed: rbac.allowed, loading: rbac.isLoading, deniedMessage: `You do not have permission to patch InstallPlans in ${ns}` }}
      confirmLabel="Approve"
      failurePrefix="Not approved"
      onConfirm={async () => {
        await approveInstallPlan(clusterId, plan, { precondition: true });
        onApproved();
      }}
      onClose={onClose}
    />
  );
}

function ApprovalRow({ row, onApprove }: { row: PendingApproval; onApprove: (row: PendingApproval) => void }) {
  const { plan } = row;
  const superseded = row.current === false;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="pending-approval">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-100">{row.operator}</span>
          <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-300">
            {row.replaces.length ? row.replaces.map(csvVersion).join(', ') : <span className="text-faint">{row.subscription ? 'new install' : 'unknown'}</span>}
            <ArrowRight aria-label="to" className="h-3 w-3 text-slate-500" />
            {row.installs.map(csvVersion).join(', ') || '?'}
          </span>
          {superseded && <Badge size="sm" variant="outline">Superseded</Badge>}
          {row.gitops && <Badge size="sm" variant="info">Argo CD: {row.gitops}</Badge>}
        </div>
        <div className="mt-0.5 text-xs text-slate-400">
          {plan.metadata.namespace}/{plan.metadata.name}
          {row.channel ? ` · channel ${row.channel}` : ''}
          {row.createdAt ? ` · waiting ${formatAge(row.createdAt)}` : ''}
          {superseded ? ' · its Subscription now points at a newer plan' : ''}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <AskPulseButton
          size="sm"
          prompt={`What does InstallPlan ${plan.metadata.namespace}/${plan.metadata.name} change (${row.operator} ${versions(row)}), and is it safe to approve?`}
          context={planContext(plan)}
        />
        <Button
          size="sm"
          disabled={superseded}
          title={superseded ? 'A newer InstallPlan replaced this one; approve that one instead.' : undefined}
          onClick={() => onApprove(row)}
        >
          Approve
        </Button>
      </div>
    </li>
  );
}

export function PendingApprovals({ clusterId, subscriptions, subscriptionsError, highlight }: {
  clusterId: string;
  /** The page's Subscription list; null when it could not be read. */
  subscriptions: SubscriptionLike[] | null;
  subscriptionsError?: unknown;
  /** Opened from an Inbox item's link (`?view=approvals`): scroll here. */
  highlight?: boolean;
}) {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const [approving, setApproving] = React.useState<PendingApproval | null>(null);
  const ref = React.useRef<HTMLElement>(null);

  // A 404 means OLM is not served here (nothing can wait for approval); a 403
  // or 500 is shown as an error, never as "nothing waiting".
  const { data: plans, error, isLoading, refetch } = useQuery<InstallPlanLike[] | null>({
    queryKey: ['installplans', 'all', clusterId],
    queryFn: () => safeQuery(() => k8sList<InstallPlanLike>(INSTALLPLANS_PATH, undefined, clusterId)),
    refetchInterval: 30000,
  });

  const rows = React.useMemo(() => pendingApprovals(plans ?? [], subscriptions), [plans, subscriptions]);

  React.useEffect(() => {
    if (highlight && ref.current && typeof ref.current.scrollIntoView === 'function') ref.current.scrollIntoView({ block: 'start' });
  }, [highlight, isLoading]);

  const onApproved = () => {
    const row = approving;
    setApproving(null);
    if (row) addToast({ type: 'success', title: `InstallPlan ${row.plan.metadata.name} approved`, detail: `OLM is installing ${row.installs.join(', ') || 'the planned version'}` });
    void queryClient.invalidateQueries({ queryKey: ['installplans'] });
    void queryClient.invalidateQueries({ queryKey: ['installplan'] });
    void queryClient.invalidateQueries({ queryKey: ['readiness', 'subscriptions'] });
    void queryClient.invalidateQueries({ queryKey: ['operator-sub'] });
  };

  // OLM is not installed: no section at all, as with no Subscriptions.
  if (!isLoading && !error && plans === null) return null;

  return (
    <section id={NEEDS_APPROVAL_ID} ref={ref} aria-labelledby={`${NEEDS_APPROVAL_ID}-title`} tabIndex={-1}>
      <Card className={highlight ? 'ring-1 ring-blue-600' : undefined}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
          <ClipboardCheck className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <h2 id={`${NEEDS_APPROVAL_ID}-title`} className="text-sm font-semibold text-slate-100">Needs approval</h2>
          {!isLoading && !error && <Badge size="sm" variant={rows.length ? 'warning' : 'success'}>{rows.length}</Badge>}
          <p className="w-full text-xs text-slate-400">Operator updates waiting for an InstallPlan approval, across all namespaces. {NO_DENY_TEXT}</p>
        </div>
        {isLoading ? (
          <p className="flex items-center gap-2 px-4 py-3 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Reading InstallPlans…</p>
        ) : error ? (
          <LoadError className="m-4" title="InstallPlans could not be read, so pending operator updates are unknown" error={error} onRetry={() => { void refetch(); }} />
        ) : rows.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-3 text-sm text-slate-300"><CheckCircle className="h-4 w-4 text-green-400" aria-hidden="true" /> No operator update is waiting for approval.</p>
        ) : (
          <>
            {!!subscriptionsError && (
              <p className="px-4 pt-3 text-xs text-slate-400">Subscriptions could not be read, so the version each plan replaces and whether it is the current plan are unknown.</p>
            )}
            <ul className="divide-y divide-slate-800" aria-label="InstallPlans waiting for approval">
              {rows.map((row) => <ApprovalRow key={`${row.plan.metadata.namespace}/${row.plan.metadata.name}`} row={row} onApprove={setApproving} />)}
            </ul>
          </>
        )}
      </Card>
      {approving && <ApproveDialog row={approving} clusterId={clusterId} onClose={() => setApproving(null)} onApproved={onApproved} />}
    </section>
  );
}
