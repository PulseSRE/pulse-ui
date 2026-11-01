import { useEffect } from 'react';
import { UserCheck, Workflow } from 'lucide-react';
import { EmptyState } from '../../components/primitives/EmptyState';
import { LoadError } from '../../components/primitives/LoadError';
import { describeAwaiting } from '../../engine/durableRunsApi';
import { proposalForItem, useApprovalsStore } from '../../store/approvalsStore';
import { useInboxStore } from '../../store/inboxStore';
import { ApprovalButtons } from './DurableRunControls';
import { ProposedFixes } from './ProposedFixes';

/** How many answers are waiting on a person. */
export function useApprovalCount(): number {
  return useApprovalsStore((s) => s.proposals.length + s.runs.length);
}

/**
 * One queue for everything waiting on a person: proposed fixes, durable runs
 * parked on an approval gate, and any inbox item flagged as waiting on an
 * approval. Approve and reject happen here; Pulse Agent → Runs and the inbox
 * banner link here instead of keeping their own copies.
 */
export function ApprovalsQueue() {
  const proposals = useApprovalsStore((s) => s.proposals);
  const runs = useApprovalsStore((s) => s.runs);
  const loaded = useApprovalsStore((s) => s.loaded);
  const proposalsError = useApprovalsStore((s) => s.proposalsError);
  const refresh = useApprovalsStore((s) => s.refresh);
  const refreshRuns = useApprovalsStore((s) => s.refreshRuns);
  const runAnswered = useApprovalsStore((s) => s.runAnswered);
  const items = useInboxStore((s) => s.items);
  const setSelectedItem = useInboxStore((s) => s.setSelectedItem);

  // ProposedFixes polls the proposals itself; durable runs move faster.
  useEffect(() => {
    refreshRuns();
    const timer = setInterval(refreshRuns, 15_000);
    return () => clearInterval(timer);
  }, [refreshRuns]);

  // Items an agent flagged as waiting whose question is not already listed above.
  const flagged = items.filter(
    (i) => i.metadata?.has_pending_approval && i.status !== 'resolved' && i.status !== 'archived' && !proposalForItem(proposals, i),
  );

  const nothing = proposals.length === 0 && runs.length === 0 && flagged.length === 0;

  return (
    <div className="space-y-3 p-4">
      {proposalsError && (
        <LoadError title="Could not load proposed fixes" error={proposalsError} onRetry={refresh} />
      )}

      <ProposedFixes />

      {runs.length > 0 && (
        <div className="rounded-md border border-amber-700/40 bg-amber-500/5">
          <div className="flex items-center gap-2 border-b border-amber-700/30 px-3 py-2">
            <Workflow className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-medium text-amber-200">
              {runs.length} durable run{runs.length === 1 ? '' : 's'} waiting for approval
            </span>
          </div>
          <ul className="divide-y divide-amber-700/20">
            {runs.map((run) => (
              <li key={`${run.workflow_id}:${run.phase_id}`} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">{describeAwaiting(run)}</div>
                  <div className="truncate text-xs text-slate-500">
                    {run.workflow_id}
                    {run.phases && Object.keys(run.phases).length > 0 && (
                      <> · done: {Object.entries(run.phases).map(([id, p]) => `${id} ${p.status ?? ''}`.trim()).join(', ')}</>
                    )}
                  </div>
                </div>
                <ApprovalButtons run={run} onAnswered={() => runAnswered(run.workflow_id, run.phase_id)} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {flagged.length > 0 && (
        <div className="rounded-md border border-amber-700/40 bg-amber-500/5">
          <div className="flex items-center gap-2 border-b border-amber-700/30 px-3 py-2">
            <UserCheck className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-medium text-amber-200">Inbox items waiting on an approval</span>
          </div>
          <ul className="divide-y divide-amber-700/20">
            {flagged.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{item.title}</span>
                <button
                  type="button"
                  onClick={() => setSelectedItem(item.id)}
                  className="shrink-0 text-xs text-blue-400 hover:underline"
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loaded && !proposalsError && nothing && (
        <EmptyState
          icon={<UserCheck className="h-8 w-8" />}
          title="Nothing is waiting on you"
          description="Fixes Pulse proposes at trust level 2 and durable runs that stop for approval appear here."
        />
      )}
    </div>
  );
}
