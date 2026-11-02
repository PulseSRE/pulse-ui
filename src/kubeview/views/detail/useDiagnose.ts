/**
 * "Diagnose": ask the agent to investigate a resource that has no monitor
 * finding, through the inbox.
 *
 *   1. Reuse an open inbox item for the same resource — only one nobody has
 *      claimed, or one that already has an investigation (shown with when it
 *      was made) — else create one (POST /api/agent/inbox).
 *   2. POST /api/agent/inbox/{id}/investigate. The agent runs it (202, queued
 *      or running; idempotent) or refuses with a reason (409/429: budget,
 *      cooldown, concurrency), which is shown as is.
 *   3. Poll GET /api/agent/inbox/{id}/investigation, which reports
 *      queued/running/done/failed, until done or failed (polling stops) or 10
 *      minutes pass. A 404 means nothing has been recorded yet.
 *
 * Every outcome is said: the report, the refusal or failure reason, "no
 * report yet" after the window, or the agent being unreachable.
 */
import React from 'react';
import { agentFetch, AgentHttpError, agentJson } from '../../engine/safeQuery';
import { fetchInbox, type InboxItem, type InvestigationReport } from '../../engine/inboxApi';

export const DIAGNOSE_POLL_MS = 5000;
export const DIAGNOSE_WINDOW_MS = 10 * 60 * 1000;

export type RunPhase = 'queued' | 'running';

export type DiagnoseState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'waiting'; itemId: string; run: RunPhase; reused: boolean; since: number }
  | { phase: 'done'; itemId: string; report: InvestigationReport; reused: boolean; at?: number }
  | { phase: 'refused'; itemId: string; reason: string }
  | { phase: 'failed'; itemId?: string; reason: string }
  | { phase: 'timeout'; itemId: string }
  | { phase: 'unreachable'; reason: string };

export interface DiagnoseTarget { kind: string; name: string; namespace: string }

const CLOSED = new Set(['resolved', 'archived', 'agent_cleared']);

function sameResource(item: InboxItem, t: DiagnoseTarget): boolean {
  return (item.resources ?? []).some((r) => r.kind === t.kind && r.name === t.name && (r.namespace ?? '') === t.namespace);
}

function unreachable(e: unknown): string | null {
  if (e instanceof AgentHttpError) return e.status === 502 || e.status === 503 || e.status === 504 ? `the agent answered ${e.status}` : null;
  if (e instanceof TypeError) return e.message || 'network error';
  if (e instanceof Error && /Inbox API error: (502|503|504)/.test(e.message)) return e.message;
  return null;
}

/** Epoch ms from seconds or ms. */
function toMs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v) {
    const n = Date.parse(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

export type InvestigationRead =
  | { status: 'none' }
  | { status: RunPhase }
  | { status: 'done'; report: InvestigationReport; at?: number }
  | { status: 'failed'; reason: string };

/** GET …/investigation, read as the pipeline's status. */
export async function readInvestigation(itemId: string): Promise<InvestigationRead> {
  const res = await agentFetch(`/api/agent/inbox/${encodeURIComponent(itemId)}/investigation`);
  if (res.status === 404) return { status: 'none' };
  let body: Record<string, unknown> | null = null;
  try { body = (await res.json()) as Record<string, unknown>; } catch { body = null; }
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? `: ${body.detail}` : '';
    throw new AgentHttpError(res.status, `${res.status === 403 ? 'Permission denied (403)' : `Request failed (${res.status})`}${detail}`);
  }
  const status = typeof body?.status === 'string' ? body.status : undefined;
  if (status === 'queued' || status === 'running') return { status };
  if (status === 'failed') {
    const reason = [body?.error, body?.reason, body?.detail].find((x) => typeof x === 'string' && x) as string | undefined;
    return { status: 'failed', reason: reason ?? 'the investigation failed' };
  }
  const report = (body?.report && typeof body.report === 'object' ? body.report : body) as InvestigationReport & Record<string, unknown>;
  if (status === 'done' || report?.summary || report?.suspected_cause) {
    return { status: 'done', report, at: toMs(report.completed_at ?? report.timestamp ?? report.created_at ?? body?.completed_at) };
  }
  return { status: 'none' };
}

async function findOrCreateItem(t: DiagnoseTarget): Promise<{ itemId: string; reused: boolean; hasInvestigation: boolean }> {
  const list = await fetchInbox({ namespace: t.namespace, limit: 200 });
  const open = (list.items ?? []).filter((i) => !CLOSED.has(i.status) && sameResource(i, t));
  const withInv = open.find((i) => !!(i.metadata as { investigation_id?: string } | undefined)?.investigation_id);
  const unclaimed = open.find((i) => !i.claimed_by);
  const reuse = withInv ?? unclaimed;
  if (reuse) return { itemId: reuse.id, reused: true, hasInvestigation: reuse === withInv };
  const created = await agentJson<{ id: string }>('/api/agent/inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `Diagnose ${t.kind} ${t.namespace}/${t.name}`,
      summary: `Requested from the ${t.kind} page: find why ${t.kind} ${t.name} is unhealthy.`,
      severity: 'warning',
      namespace: t.namespace,
      resources: [{ kind: t.kind, name: t.name, namespace: t.namespace }],
      metadata: { source: 'detail_page_diagnose' },
    }),
  });
  return { itemId: created.id, reused: false, hasInvestigation: false };
}

/** POST …/investigate: the run's phase, or the agent's reason for refusing. */
async function requestInvestigation(itemId: string): Promise<{ run: RunPhase } | { refused: string }> {
  const res = await agentFetch(`/api/agent/inbox/${encodeURIComponent(itemId)}/investigate`, { method: 'POST' });
  let body: Record<string, unknown> | null = null;
  try { body = (await res.json()) as Record<string, unknown>; } catch { body = null; }
  if (res.status === 409 || res.status === 429) {
    const reason = [body?.reason, body?.detail].find((x) => typeof x === 'string' && x) as string | undefined;
    return { refused: reason ?? (res.status === 429 ? 'the agent is busy or over its investigation budget' : 'the agent refused to start it') };
  }
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? `: ${body.detail}` : '';
    throw new AgentHttpError(res.status, `${res.status === 403 ? 'You do not have permission to do this' : `Starting the investigation failed (${res.status})`}${detail}`);
  }
  return { run: body?.status === 'running' ? 'running' : 'queued' };
}

export function useDiagnose(target: DiagnoseTarget) {
  const [state, setState] = React.useState<DiagnoseState>({ phase: 'idle' });
  const key = `${target.kind}/${target.namespace}/${target.name}`;
  React.useEffect(() => { setState({ phase: 'idle' }); }, [key]);

  const run = React.useCallback(async () => {
    setState({ phase: 'starting' });
    try {
      const item = await findOrCreateItem(target);
      if (item.hasInvestigation) {
        const inv = await readInvestigation(item.itemId);
        if (inv.status === 'done') { setState({ phase: 'done', itemId: item.itemId, report: inv.report, reused: true, at: inv.at }); return; }
        if (inv.status === 'queued' || inv.status === 'running') {
          setState({ phase: 'waiting', itemId: item.itemId, run: inv.status, reused: true, since: Date.now() });
          return;
        }
      }
      const started = await requestInvestigation(item.itemId);
      if ('refused' in started) { setState({ phase: 'refused', itemId: item.itemId, reason: started.refused }); return; }
      setState({ phase: 'waiting', itemId: item.itemId, run: started.run, reused: item.reused, since: Date.now() });
    } catch (e) {
      const down = unreachable(e);
      setState(down ? { phase: 'unreachable', reason: down } : { phase: 'failed', reason: e instanceof Error ? e.message : String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Poll while waiting; done and failed end it.
  const waiting = state.phase === 'waiting' ? state : null;
  React.useEffect(() => {
    if (!waiting) return undefined;
    const { itemId, since, reused } = waiting;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const inv = await readInvestigation(itemId);
        if (stop) return;
        if (inv.status === 'done') { stop = true; setState({ phase: 'done', itemId, report: inv.report, reused, at: inv.at }); return; }
        if (inv.status === 'failed') { stop = true; setState({ phase: 'failed', itemId, reason: inv.reason }); return; }
        if ((inv.status === 'queued' || inv.status === 'running') && inv.status !== waiting.run) {
          setState({ ...waiting, run: inv.status });
          return;
        }
      } catch (e) {
        stop = true;
        const down = unreachable(e);
        setState(down ? { phase: 'unreachable', reason: down } : { phase: 'failed', itemId, reason: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - since >= DIAGNOSE_WINDOW_MS) { stop = true; setState({ phase: 'timeout', itemId }); }
    };
    const id = setInterval(() => { void tick(); }, DIAGNOSE_POLL_MS);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting?.itemId, waiting?.run, waiting?.since]);

  return { state, run };
}
