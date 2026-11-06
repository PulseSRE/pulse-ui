/**
 * POST /api/agent/inbox/by-alert — the Inbox item, related items and episode
 * for each firing alert (agent `alert_triage.py`; contract in API_CONTRACT.md).
 *
 * The agent recomputes the correlation key its firing-alerts scanner gives
 * the alert, so the item returned is the one the monitor made, not a guess.
 * An agent without the endpoint raises AgentFeatureUnavailable.
 */
import { agentFetch } from './safeQuery';
import { AgentFeatureUnavailable, readAgentError } from './agentFeature';

export interface TriageInvestigation {
  id: string | null;
  summary: string;
  suspectedCause: string;
  recommendedFix: string;
  confidence: number | null;
}

export interface TriageItem {
  id: string;
  title: string;
  status: string;
  severity: string | null;
  namespace: string | null;
  claimedBy: string | null;
  dueDate: number | null;
  findingId: string | null;
  correlationKey: string | null;
  investigation: TriageInvestigation | null;
  fixReady: boolean;
}

export interface AlertTriage {
  alertname: string;
  correlationKey: string;
  resource: { kind: string; name: string; namespace?: string } | null;
  item: TriageItem | null;
  related: TriageItem[];
  episode: { id: string; causeTitle: string; causeItem: TriageItem | null } | null;
}

/** How long the Alerts page waits for the Inbox before saying "Could not check". */
export const TRIAGE_TIMEOUT_MS = 5000;

export async function fetchAlertTriage(labelSets: Array<Record<string, string>>, timeoutMs = TRIAGE_TIMEOUT_MS): Promise<AlertTriage[]> {
  if (labelSets.length === 0) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await agentFetch('/api/agent/inbox/by-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alerts: labelSets.map((labels) => ({ labels })) }),
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`The Inbox did not answer in ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404 || res.status === 405) throw new AgentFeatureUnavailable('Alert triage links');
  if (!res.ok) throw await readAgentError(res, 'The Inbox could not be checked');
  const body = await res.json();
  return Array.isArray(body?.results) ? body.results : [];
}

export interface TriageSummary {
  /** The item to open. */
  itemId: string | null;
  label: string;
  detail: string;
  confidence: number | null;
}

/**
 * One chip's worth of triage: the investigated item first (this alert's or
 * the same resource's), then the episode cause, then the plain item.
 */
export function summarizeTriage(t: AlertTriage): TriageSummary | null {
  const candidates = [t.item, ...t.related].filter((x): x is TriageItem => !!x);
  const investigated = candidates.find((c) => c.investigation?.suspectedCause);
  if (investigated?.investigation) {
    const inv = investigated.investigation;
    return {
      itemId: investigated.id,
      label: 'cause found',
      detail: `${inv.suspectedCause}${investigated.fixReady ? ' · fix ready' : ''}`,
      confidence: typeof inv.confidence === 'number' ? inv.confidence : null,
    };
  }
  if (t.episode) {
    return {
      itemId: t.episode.causeItem?.id ?? t.item?.id ?? null,
      label: `same episode as ${t.episode.causeTitle || 'another problem'}`,
      detail: '',
      confidence: null,
    };
  }
  const plain = candidates[0];
  if (plain) {
    return {
      itemId: plain.id,
      label: plain.claimedBy ? `in Inbox · ${plain.claimedBy}` : 'in Inbox · not investigated yet',
      detail: plain.title,
      confidence: null,
    };
  }
  return null;
}
