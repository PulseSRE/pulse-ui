/**
 * Inbox API — types and REST helpers for the Ops Inbox.
 * Used by the inbox store and inbox UI components.
 */

// ---- Types ----

export type InboxItemType = 'task';
export type InboxSeverity = 'critical' | 'warning' | 'info';
export type AgentStatus = 'agent_reviewing' | 'agent_cleared' | 'agent_review_failed';
export type InboxStatus = 'new' | 'triaged' | 'claimed' | 'in_progress' | 'resolved' | 'archived' | AgentStatus;

export interface InboxItem {
  id: string;
  item_type: InboxItemType;
  status: InboxStatus;
  title: string;
  summary: string;
  severity: InboxSeverity | null;
  priority_score: number;
  confidence: number;
  noise_score: number;
  namespace: string | null;
  resources: Array<{ kind: string; name: string; namespace: string }>;
  correlation_key: string | null;
  claimed_by: string | null;
  claimed_at: number | null;
  created_by: string;
  due_date: number | null;
  finding_id: string | null;
  view_id: string | null;
  pinned_by: string[];
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
  snoozed_until: number | null;
}

export interface InboxGroup {
  correlation_key: string;
  items: InboxItem[];
  count: number;
  top_severity: string;
}

export interface InboxResponse {
  items: InboxItem[];
  groups: InboxGroup[];
  stats: Record<string, number>;
  total: number;
}

export interface InboxFilters {
  type?: string;
  status?: string;
  namespace?: string;
  claimed_by?: string;
  severity?: string;
  group_by?: string;
  limit?: number;
  offset?: number;
}

// ---- REST helpers ----

import { agentFetch } from './safeQuery';

const AGENT_BASE = '/api/agent';

async function _fetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await agentFetch(url, init);
  if (!res.ok) {
    throw new Error(`Inbox API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchInbox(filters: InboxFilters = {}): Promise<InboxResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return _fetch(`${AGENT_BASE}/inbox${qs ? `?${qs}` : ''}`);
}

export async function fetchInboxStats(): Promise<Record<string, number>> {
  return _fetch(`${AGENT_BASE}/inbox/stats`);
}

export async function fetchInboxItem(id: string): Promise<InboxItem> {
  return _fetch(`${AGENT_BASE}/inbox/${encodeURIComponent(id)}`);
}

export async function createInboxTask(data: {
  title: string;
  summary?: string;
  due_date?: number;
  namespace?: string;
}): Promise<{ id: string; item_type: string; status: string }> {
  return _fetch(`${AGENT_BASE}/inbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function claimInboxItem(id: string): Promise<void> {
  await _fetch(`${AGENT_BASE}/inbox/${id}/claim`, { method: 'POST' });
}

export async function unclaimInboxItem(id: string): Promise<void> {
  await _fetch(`${AGENT_BASE}/inbox/${id}/claim`, { method: 'DELETE' });
}

export async function acknowledgeInboxItem(id: string): Promise<void> {
  await _fetch(`${AGENT_BASE}/inbox/${id}/acknowledge`, { method: 'POST' });
}

export async function snoozeInboxItem(id: string, hours: number): Promise<void> {
  await _fetch(`${AGENT_BASE}/inbox/${id}/snooze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours }),
  });
}

export async function dismissInboxItem(id: string): Promise<void> {
  await _fetch(`${AGENT_BASE}/inbox/${id}/dismiss`, { method: 'POST' });
}

export async function resolveInboxItem(id: string): Promise<void> {
  await _fetch(`${AGENT_BASE}/inbox/${id}/resolve`, { method: 'POST' });
}

export async function escalateInboxItem(id: string): Promise<{ finding_id: string }> {
  return _fetch(`${AGENT_BASE}/inbox/${id}/escalate`, { method: 'POST' });
}

export async function pinInboxItem(id: string): Promise<void> {
  await _fetch(`${AGENT_BASE}/inbox/${id}/pin`, { method: 'POST' });
}

export async function advanceInboxStatus(id: string, status: string): Promise<void> {
  await _fetch(`${AGENT_BASE}/inbox/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export async function restoreInboxItem(id: string): Promise<void> {
  await _fetch(`${AGENT_BASE}/inbox/${id}/restore`, { method: 'POST' });
}

export interface InvestigationReport {
  id: string;
  summary: string;
  suspected_cause: string;
  recommended_fix: string;
  confidence: number;
  evidence: string[];
  alternatives_considered: string[];
}

export async function fetchInboxInvestigation(id: string): Promise<InvestigationReport | null> {
  const res = await agentFetch(`${AGENT_BASE}/inbox/${id}/investigation`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Inbox API error: ${res.status} ${res.statusText}`);
  return res.json();
}
