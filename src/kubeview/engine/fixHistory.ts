/**
 * Fix History — types and REST helpers for querying the agent's
 * autonomous action history. Used by the monitor store and fix history UI.
 */

import type { ResourceRef } from './monitorClient';

// ---- Types ----

export interface ActionRecord {
  id: string;
  findingId: string;
  timestamp: number;
  category: string;
  tool: string;
  input: Record<string, unknown>;
  // 'expired' is a proposal nobody answered inside the approval window — the
  // agent's most common trust-2 outcome. It is not a failure: the fix never ran.
  status: 'proposed' | 'executing' | 'completed' | 'failed' | 'rolled_back' | 'expired';
  beforeState: string;
  afterState: string;
  error?: string;
  reasoning: string;
  /**
   * Cause title of the open episode that already explains this finding.
   *
   * Present when the agent's own causal model says this fix treats a symptom.
   * Absent on older agents, and on proposals nothing explains.
   */
  explainedBy?: string;
  durationMs: number;
  rollbackAvailable: boolean;
  rollbackAction?: { tool: string; input: Record<string, unknown> };
  resources: ResourceRef[];
}

export interface FixHistoryFilters {
  since?: number;
  category?: string;
  status?: string;
  search?: string;
}

export interface FixHistoryResponse {
  actions: ActionRecord[];
  total: number;
  page: number;
  pageSize: number;
}

// ---- REST helpers ----

import { agentFetch } from './safeQuery';

const AGENT_BASE = '/api/agent';

/** Fetch paginated fix history with optional filters. */
export async function fetchFixHistory(params?: {
  page?: number;
  filters?: FixHistoryFilters;
}): Promise<FixHistoryResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.filters?.since) query.set('since', String(params.filters.since));
  if (params?.filters?.category) query.set('category', params.filters.category);
  if (params?.filters?.status) query.set('status', params.filters.status);
  if (params?.filters?.search) query.set('search', params.filters.search);

  const qs = query.toString();
  const url = `${AGENT_BASE}/fix-history${qs ? `?${qs}` : ''}`;
  const res = await agentFetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch fix history: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Fetch details for a single action record. */
export async function fetchActionDetail(id: string): Promise<ActionRecord> {
  const res = await agentFetch(`${AGENT_BASE}/fix-history/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch action detail: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Fetch cluster activity briefing. */
export interface BriefingResponse {
  greeting: string;
  summary: string;
  hours: number;
  actions: { total: number; completed: number; failed: number };
  investigations: number;
  categoriesFixed: string[];
}

export async function fetchBriefing(hours = 12): Promise<BriefingResponse> {
  const res = await agentFetch(`${AGENT_BASE}/briefing?hours=${hours}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch briefing: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Approve a fix the agent proposed while nobody was connected to answer it.
 *
 * The agent re-derives the plan from the finding as it stands now rather than
 * replaying what it proposed earlier, so this can be refused: a 409 means the
 * condition cleared, somebody else approved it first, or no automated fix
 * applies any more. Those are answers, not errors — surface the message.
 */
export async function approveFix(actionId: string): Promise<ActionRecord> {
  const res = await agentFetch(
    `${AGENT_BASE}/fix-history/${encodeURIComponent(actionId)}/approve`,
    { method: 'POST' },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error || `Failed to approve fix: ${res.status} ${res.statusText}`);
  }
  return body as ActionRecord;
}

/**
 * Request a rollback for a completed action.
 *
 * Only actions with a pre-write snapshot (or restart_deployment, which rolls
 * back by revision) can be rolled back — the agent answers 400 with a reason
 * for anything else. That refusal is an answer, not a transport failure, so
 * surface its message.
 */
export async function requestRollback(actionId: string): Promise<void> {
  const res = await agentFetch(
    `${AGENT_BASE}/fix-history/${encodeURIComponent(actionId)}/rollback`,
    { method: 'POST' },
  );
  if (!res.ok) {
    let body: { error?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      // no JSON body — fall through to the status line
    }
    throw new Error(
      body?.error || `Failed to request rollback: ${res.status} ${res.statusText}`,
    );
  }
}
