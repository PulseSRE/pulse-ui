/** Typed fetch functions for the agent's episode endpoints.
 *
 * An episode is one event with a cause, as opposed to the several findings it
 * produced. The inbox uses these to show a cause with its symptoms folded
 * underneath, rather than ranking them beside each other — which is what
 * happened during a real control-plane outage, where nine "Deployment
 * degraded" criticals outranked the single etcd warning that caused them.
 */

import { agentFetch } from './safeQuery';

const AGENT_BASE = '/api/agent';

export interface Episode {
  id: string;
  status: 'open' | 'closed';
  cause_category: string;
  cause_title: string;
  cause_finding_id: string | null;
  cause_layer: number;
  started_at: number;
  ended_at: number | null;
  last_seen_at: number;
  symptom_count: number;
  namespaces: string[];
  correlation_key: string;
  recurrence_of: string | null;
}

export interface EpisodeSymptom {
  episode_id: string;
  correlation_key: string;
  category: string;
  title: string;
  namespace: string;
  attached_at: number;
  detached_at: number | null;
  detached_by: string | null;
}

/** Config, RBAC or deployment activity shortly before an episode began. */
export interface EpisodeChange {
  category: string;
  title: string;
  namespace: string;
  at: number;
  seconds_before: number;
}

/** How often this cause has come back, and on what cadence if it has one. */
export interface EpisodeRecurrence {
  occurrences: number;
  recurring: boolean;
  first_seen?: number;
  window_seconds?: number;
  interval_seconds?: number;
  prior_episode_ids?: string[];
}

async function get<T>(path: string): Promise<T> {
  const res = await agentFetch(`${AGENT_BASE}${path}`);
  if (!res.ok) throw new Error(`Episode API error: ${res.status} on ${path}`);
  return res.json();
}

export async function fetchOpenEpisodes(): Promise<Episode[]> {
  const data = await get<{ episodes: Episode[] }>('/episodes');
  return data.episodes ?? [];
}

export async function fetchEpisode(id: string): Promise<{
  episode: Episode;
  symptoms: EpisodeSymptom[];
  /** Optional so an older agent, which sends neither, still renders. */
  changes?: EpisodeChange[];
  recurrence?: EpisodeRecurrence;
}> {
  return get(`/episodes/${encodeURIComponent(id)}`);
}

/**
 * Tell the agent a symptom was not actually caused by this episode.
 *
 * The correction is stored and the symptom is never re-attached. It is also
 * the only ground truth the agent ever gets about whether its correlation is
 * right, which is why the control is worth putting in front of people rather
 * than burying it.
 */
export async function detachSymptom(episodeId: string, correlationKey: string): Promise<void> {
  const res = await agentFetch(`${AGENT_BASE}/episodes/${encodeURIComponent(episodeId)}/detach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correlationKey }),
  });
  if (!res.ok) throw new Error(`Could not detach symptom: ${res.status}`);
}
