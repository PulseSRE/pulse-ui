/**
 * Approvals — everything waiting for a person to say yes or no.
 *
 * Approvals used to live in four places: the "Approval waiting" chip on an
 * inbox row (with no button behind it), the proposed-fixes banner above the
 * inbox, the approval panel inside a durable-run item's drawer, and the
 * "awaiting approval" list on Pulse Agent → Runs. Each loaded its own copy.
 * This store is the one list they all read, so the Inbox → Approvals tab, the
 * row chip, the drawer's Approve button and the count agree.
 *
 * Two kinds of question:
 * - proposed fixes (fix history, `status=proposed`), answered with
 *   `POST /fix-history/{id}/approve|reject`;
 * - durable runs parked on an approval gate, answered with
 *   `POST /workflow-runs/{id}/approve`.
 */

import { create } from 'zustand';
import { approveFix, fetchFixHistory, rejectFix, type ActionRecord } from '../engine/fixHistory';
import { fetchAwaitingApprovals, type AwaitingRun } from '../engine/durableRunsApi';
import type { InboxItem } from '../engine/inboxApi';

interface ApprovalsState {
  proposals: ActionRecord[];
  runs: AwaitingRun[];
  /** Whether the proposal list has loaded at least once. */
  loaded: boolean;
  /** Set when the proposal list could not be read; the queue says so rather than "nothing waiting". */
  proposalsError: string | null;
  /** Set when the durable-run approvals could not be read (not when durable execution is off). */
  runsError: string | null;

  refreshProposals: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Approve a proposed fix. Throws with the agent's reason when it refuses. */
  approve: (actionId: string) => Promise<ActionRecord>;
  /** Reject a proposed fix with a reason. Throws with the agent's reason when it refuses. */
  reject: (actionId: string, reason: string) => Promise<ActionRecord>;
  /** Drop an answered durable run from the list (the next poll confirms it). */
  runAnswered: (workflowId: string, phaseId: string) => void;
}

const INITIAL = {
  proposals: [] as ActionRecord[],
  runs: [] as AwaitingRun[],
  loaded: false,
  proposalsError: null as string | null,
  runsError: null as string | null,
};

export const useApprovalsStore = create<ApprovalsState>((set, get) => ({
  ...INITIAL,

  refreshProposals: async () => {
    try {
      const res = await fetchFixHistory({ filters: { status: 'proposed' } });
      set({ proposals: res.actions ?? [], loaded: true, proposalsError: null });
    } catch (e) {
      set({ proposals: [], loaded: true, proposalsError: e instanceof Error ? e.message : 'Could not load proposed fixes' });
    }
  },

  refreshRuns: async () => {
    try {
      // Durable execution off answers [] here; that is "nothing to answer".
      set({ runs: await fetchAwaitingApprovals(), runsError: null });
    } catch (e) {
      // Anything else is a failed read: keep the last known runs and say so,
      // rather than "Nothing is waiting on you".
      set({ runsError: e instanceof Error ? e.message : 'Could not load runs awaiting approval' });
    }
  },

  refresh: async () => {
    await Promise.all([get().refreshProposals(), get().refreshRuns()]);
  },

  approve: async (actionId) => {
    try {
      const result = await approveFix(actionId);
      set((s) => ({ proposals: s.proposals.filter((p) => p.id !== actionId) }));
      return result;
    } catch (e) {
      // Refused on purpose (cleared, already answered): re-read rather than trust stale state.
      get().refreshProposals();
      throw e;
    }
  },

  reject: async (actionId, reason) => {
    try {
      const result = await rejectFix(actionId, reason);
      set((s) => ({ proposals: s.proposals.filter((p) => p.id !== actionId) }));
      return result;
    } catch (e) {
      get().refreshProposals();
      throw e;
    }
  },

  runAnswered: (workflowId, phaseId) =>
    set((s) => ({ runs: s.runs.filter((r) => !(r.workflow_id === workflowId && r.phase_id === phaseId)) })),
}));

/** For tests: back to an empty, unloaded store. */
export function resetApprovalsStore(): void {
  useApprovalsStore.setState({ ...INITIAL });
}

/** The pending fix proposal for an inbox item, if there is one. */
export function proposalForItem(proposals: ActionRecord[], item: Pick<InboxItem, 'id' | 'finding_id'>): ActionRecord | undefined {
  return proposals.find(
    (p) => p.inboxItemId === item.id || (!!item.finding_id && p.findingId === item.finding_id),
  );
}

/** The durable run an inbox item is asking about, if it is a durable-approval item. */
export function runForItem(item: Pick<InboxItem, 'metadata'>): { workflowId: string; phaseId: string } | null {
  const md = item.metadata || {};
  if (md.generator !== 'durable_approvals') return null;
  if (typeof md.workflow_id !== 'string' || typeof md.phase_id !== 'string') return null;
  return { workflowId: md.workflow_id, phaseId: md.phase_id };
}

/** Whether a person's answer is waiting on this item. */
export function itemAwaitsApproval(
  state: Pick<ApprovalsState, 'proposals' | 'runs'>,
  item: Pick<InboxItem, 'id' | 'finding_id' | 'metadata' | 'status'>,
): boolean {
  if (item.status === 'resolved' || item.status === 'archived') return false;
  if (item.metadata?.has_pending_approval) return true;
  if (proposalForItem(state.proposals, item)) return true;
  const run = runForItem(item);
  return !!run && state.runs.some((r) => r.workflow_id === run.workflowId && r.phase_id === run.phaseId);
}
