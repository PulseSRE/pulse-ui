/**
 * Durable (Temporal) plan runs: answering approval gates and starting a run
 * from an inbox item.
 *
 * An approval gate can wait a day, but it used to be answerable only from the
 * plan panel that started the run, and only while that panel stayed open.
 * These calls let the Runs tab and the inbox answer it instead.
 */

import { agentFetch } from './safeQuery';

const AGENT_BASE = '/api/agent';

export interface AwaitingRun {
  workflow_id: string;
  phase_id: string;
  started_at?: string;
  memo?: {
    incident_type?: string;
    resource_kind?: string;
    resource_name?: string;
    resource_namespace?: string;
  };
  phases?: Record<string, { status?: string; confidence?: number }>;
}

export interface InboxPlan {
  incident_type: string;
  plan_name: string;
  phases: { id: string; approval_required: boolean }[];
}

async function detail(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body && typeof body.detail === 'string' && body.detail) || `${fallback} (${res.status})`;
}

/** Runs parked on an approval gate. Empty when durable execution is off. */
export async function fetchAwaitingApprovals(): Promise<AwaitingRun[]> {
  const res = await agentFetch(`${AGENT_BASE}/workflow-runs/awaiting-approval`);
  if (!res.ok) return [];
  const data = await res.json();
  // Only rows that actually name a waiting phase are answerable.
  return (data.runs ?? []).filter((r: AwaitingRun) => typeof r?.phase_id === 'string' && r.phase_id);
}

/** Deliver a person's verdict to a waiting run. Throws with the agent's reason. */
export async function answerApproval(workflowId: string, phaseId: string, approved: boolean): Promise<void> {
  const res = await agentFetch(`${AGENT_BASE}/workflow-runs/${encodeURIComponent(workflowId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase_id: phaseId, approved }),
  });
  if (!res.ok) throw new Error(await detail(res, 'Could not deliver the verdict'));
}

/** The plan a durable run of this item would use, or null when none matches. */
export async function fetchInboxPlan(itemId: string): Promise<InboxPlan | null> {
  const res = await agentFetch(`${AGENT_BASE}/inbox/${encodeURIComponent(itemId)}/plan`);
  if (!res.ok) return null;
  return res.json();
}

/** Start a durable run that investigates this item's finding. */
export async function startInboxDurableRun(itemId: string): Promise<{ workflow_id: string; plan_name: string }> {
  const res = await agentFetch(`${AGENT_BASE}/inbox/${encodeURIComponent(itemId)}/durable-run`, { method: 'POST' });
  if (!res.ok) throw new Error(await detail(res, 'Could not start the run'));
  return res.json();
}

/** "remediate on web-0 in shop" — what a person is being asked to approve. */
export function describeAwaiting(run: Pick<AwaitingRun, 'phase_id' | 'memo'>): string {
  const m = run.memo ?? {};
  const where = [m.resource_name, m.resource_namespace].filter(Boolean).join(' in ');
  const plan = m.incident_type ? `${m.incident_type} plan` : 'plan';
  return `'${run.phase_id}' of the ${plan}${where ? ` on ${where}` : ''}`;
}
