/**
 * GET /api/agent/changes — what changed around a resource (agent `changes_rest.py`).
 *
 * Reads run as the caller and on the agent's (local) cluster only. A route
 * an older agent lacks (404 without `code`) raises AgentFeatureUnavailable;
 * a refused read is an error with the agent's reason, never an empty list.
 */
import { agentFetch } from './safeQuery';
import { AgentFeatureUnavailable, readAgentError } from './agentFeature';

export interface ChangeEntry {
  at: string;
  kind: string;
  namespace: string;
  name: string;
  summary: string;
  actor: string | null;
  source: 'rollout' | 'configmap' | 'secret' | 'workload' | 'argo' | 'clusterversion' | string;
}

export interface ChangesResponse {
  changes: ChangeEntry[];
  available: boolean;
  unreadable?: string[];
  truncated?: boolean;
}

export interface ChangesQuery {
  namespace?: string;
  kind?: string;
  name?: string;
  since?: string;
  until?: string;
}

/** Kinds the agent tracks change history for (agent `resource_changes.SUPPORTED_KINDS`). */
export const CHANGE_KINDS = new Set(['Pod', 'ReplicaSet', 'Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'ConfigMap', 'Secret']);

export async function fetchChanges(q: ChangesQuery): Promise<ChangesResponse> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) params.set(k, v);
  const res = await agentFetch(`/api/agent/changes?${params.toString()}`);
  if (res.status === 404) {
    const body = await res.clone().json().catch(() => null);
    if (!body || body.code !== 'resource_not_found') throw new AgentFeatureUnavailable('Change history');
  }
  if (!res.ok) throw await readAgentError(res, 'Change history could not be read');
  return res.json();
}
