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
  status: 'proposed' | 'executing' | 'completed' | 'failed' | 'rolled_back';
  beforeState: string;
  afterState: string;
  error?: string;
  reasoning: string;
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
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch fix history: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Fetch details for a single action record. */
export async function fetchActionDetail(id: string): Promise<ActionRecord> {
  const res = await fetch(`${AGENT_BASE}/fix-history/${encodeURIComponent(id)}`);
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
  const res = await fetch(`${AGENT_BASE}/briefing?hours=${hours}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch briefing: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Fetch memory system stats. */
export interface MemoryStats {
  enabled: boolean;
  incidents: number;
  runbooks: number;
  patterns: number;
  metrics: Record<string, { avg: number; count: number }>;
}

export async function fetchMemoryStats(): Promise<MemoryStats> {
  const res = await fetch(`${AGENT_BASE}/memory/stats`);
  if (!res.ok) {
    throw new Error(`Failed to fetch memory stats: ${res.status}`);
  }
  return res.json();
}

/** Request a rollback for a completed action. */
export async function requestRollback(actionId: string): Promise<void> {
  const res = await fetch(
    `${AGENT_BASE}/fix-history/${encodeURIComponent(actionId)}/rollback`,
    { method: 'POST' },
  );
  if (!res.ok) {
    throw new Error(`Failed to request rollback: ${res.status} ${res.statusText}`);
  }
}
