/**
 * "Diagnose": ask the agent to investigate a resource that has no monitor
 * finding, through the inbox.
 *
 *   1. Reuse an open inbox item for the same resource — only one nobody has
 *      claimed, or one that already has an investigation (shown with when it
 *      was made) — else create one (POST /api/agent/inbox).
 *   2. POST /api/agent/inbox/{id}/investigate (pulse-agent#233). 202 with
 *      `{status|state: "queued"|"running", item_id, source, requested_by,
 *      queued_at, started_at, finished_at, error, report_id}`; a call while a
 *      run is in progress returns that run. 409 (closed item) and 429 (daily
 *      budget, cost budget, circuit breaker, cooldown, concurrency) carry
 *      `detail: {reason, message, retry_after}`, shown as is. 401: no
 *      forwarded user token.
 *   3. Poll GET /api/agent/inbox/{id}/investigation until its `state` is done
 *      or failed (polling stops) or 10 minutes pass. Before a report exists
 *      the body is `{item_id, state, run, error}`; with one it is the report
 *      row (its own `status` is the report's, completed/failed) plus `state`
 *      and `run`. `state` is what is read: a linked older report can sit
 *      beside a new run that is still queued. 404: nothing recorded yet.
 *
 * A new item carries `metadata.category_hint` when the page knows what kind of
 * problem it is (`engine/diagnoseCategory.ts`), so the agent runs the
 * monitor's plan template for it; an agent without that support ignores the
 * key and runs freeform. A plan can take longer than a freeform run, so the
 * window stretches to the run's own `timeout_seconds` when the agent says it.
 *
 * Every outcome is said: the report, the refusal or failure reason, "no
 * report yet" after the window, or the agent being unreachable.
 */
import React from 'react';
import { agentFetch, AgentHttpError, agentJson } from '../../engine/safeQuery';
import { fetchInbox, type InboxItem, type InvestigationReport } from '../../engine/inboxApi';
import { isPlanCategory, type PlanCategory } from '../../engine/diagnoseCategory';

export const DIAGNOSE_POLL_MS = 5000;
export const DIAGNOSE_WINDOW_MS = 10 * 60 * 1000;
/** Longest the window stretches for a run that reports a long budget (a plan). */
export const DIAGNOSE_MAX_WINDOW_MS = 45 * 60 * 1000;
/** Time past the run's budget for the agent to save the report. */
const SAVE_GRACE_MS = 2 * 60 * 1000;

export type RunPhase = 'queued' | 'running';

export type DiagnoseState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  /** `windowMs`: how long to wait for this run (its budget when the agent reported one). */
  | { phase: 'waiting'; itemId: string; run: RunPhase; reused: boolean; since: number; windowMs: number }
  | { phase: 'done'; itemId: string; report: InvestigationReport; reused: boolean; at?: number }
  /** The run finished (`state: done`) but the agent returned no report for it. */
  | { phase: 'empty'; itemId: string }
  /** `retryAt`: epoch ms from the refusal's retry_after, when it gave one. */
  /** `again`: the refused request was a Diagnose again, so Try again starts a new run too. */
  | { phase: 'refused'; itemId: string; reason: string; retryAt?: number; again: boolean }
  | { phase: 'failed'; itemId?: string; reason: string }
  /** `windowMs`: how long it waited. */
  | { phase: 'timeout'; itemId: string; windowMs: number }
  | { phase: 'unreachable'; reason: string };

export interface DiagnoseTarget {
  kind: string;
  name: string;
  namespace: string;
  /** What kind of problem it is, when the page knows; sent as `metadata.category_hint`. */
  category?: PlanCategory;
}

// What POST …/investigate refuses as item_closed (pulse-agent#233); an
// agent_cleared item can still be investigated, so it can be reused.
const CLOSED = new Set(['resolved', 'archived']);

export const SIGN_IN = 'Your session has no user token for the agent (401); sign in again';

function signInNeeded(e: unknown): boolean {
  if (e instanceof AgentHttpError) return e.status === 401;
  return e instanceof Error && /Inbox API error: 401\b/.test(e.message);
}

function sameResource(item: InboxItem, t: DiagnoseTarget): boolean {
  return (item.resources ?? []).some((r) => r.kind === t.kind && r.name === t.name && (r.namespace ?? '') === t.namespace);
}

function unreachable(e: unknown): string | null {
  if (e instanceof AgentHttpError) return e.status === 502 || e.status === 503 || e.status === 504 ? `the agent answered ${e.status}` : null;
  if (e instanceof TypeError) return e.message || 'network error';
  if (e instanceof Error && /Inbox API error: (502|503|504)/.test(e.message)) return e.message;
  return null;
}

/** The wait for a run: its budget plus time to save, within [default, max]; the default when unknown. */
export function windowFor(timeoutSeconds: unknown): number {
  if (typeof timeoutSeconds !== 'number' || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return DIAGNOSE_WINDOW_MS;
  return Math.min(DIAGNOSE_MAX_WINDOW_MS, Math.max(DIAGNOSE_WINDOW_MS, timeoutSeconds * 1000 + SAVE_GRACE_MS));
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
  | { status: RunPhase; windowMs: number }
  | { status: 'done'; report: InvestigationReport; at?: number }
  | { status: 'empty' }
  | { status: 'failed'; reason: string };

type Body = Record<string, unknown> | null;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

/** FastAPI's `detail`: a string, or #233's `{reason, message, retry_after}`. */
function detailText(body: Body): string | undefined {
  const d = body?.detail;
  if (typeof d === 'string') return d || undefined;
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    const msg = str(o.message) ?? str(o.reason);
    const after = typeof o.retry_after === 'number' && o.retry_after > 0 ? o.retry_after : undefined;
    if (msg) return after ? `${msg} (retry in ${after < 120 ? `${after}s` : `${Math.ceil(after / 60)} min`})` : msg;
  }
  return undefined;
}

async function readBody(res: Response): Promise<Body> {
  try { return (await res.json()) as Body; } catch { return null; }
}

/** GET …/investigation, read as the pipeline's state. */
export async function readInvestigation(itemId: string): Promise<InvestigationRead> {
  const res = await agentFetch(`/api/agent/inbox/${encodeURIComponent(itemId)}/investigation`);
  if (res.status === 404) return { status: 'none' };
  const body = await readBody(res);
  if (!res.ok) {
    const detail = detailText(body);
    const head = res.status === 401 ? SIGN_IN
      : res.status === 403 ? 'Permission denied (403)' : `Request failed (${res.status})`;
    throw new AgentHttpError(res.status, `${head}${detail ? `: ${detail}` : ''}`);
  }
  const run = (body?.run && typeof body.run === 'object' ? body.run : null) as Record<string, unknown> | null;
  const isReport = !!(str(body?.id) || str(body?.summary) || str(body?.suspected_cause));
  // `state` is the run's; an agent older than #233 has none, so the report's own status decides.
  const state = str(body?.state) ?? (isReport ? (body?.status === 'failed' ? 'failed' : 'done') : undefined);
  if (state === 'queued' || state === 'running') return { status: state, windowMs: windowFor(run?.timeout_seconds) };
  if (state === 'failed') {
    return { status: 'failed', reason: str(run?.error) ?? str(body?.error) ?? 'the investigation failed' };
  }
  if (state === 'done') {
    if (!isReport) return { status: 'empty' };
    const report = body as unknown as InvestigationReport & Record<string, unknown>;
    return { status: 'done', report, at: toMs(report.timestamp) ?? toMs(run?.finished_at) };
  }
  return { status: 'none' };
}

/** The body of the item Diagnose creates; the hint only when it is a known plan category. */
export function diagnoseItemBody(t: DiagnoseTarget): Record<string, unknown> {
  const metadata: Record<string, unknown> = { source: 'detail_page_diagnose' };
  if (isPlanCategory(t.category)) metadata.category_hint = t.category;
  return {
    title: `Diagnose ${t.kind} ${t.namespace}/${t.name}`,
    summary: `Requested from the ${t.kind} page: find why ${t.kind} ${t.name} is unhealthy.`,
    severity: 'warning',
    namespace: t.namespace,
    resources: [{ kind: t.kind, name: t.name, namespace: t.namespace }],
    metadata,
  };
}

async function findOrCreateItem(t: DiagnoseTarget): Promise<{ itemId: string; reused: boolean; hasInvestigation: boolean }> {
  const list = await fetchInbox({ namespace: t.namespace, limit: 200 });
  const open = (list.items ?? []).filter((i) => !CLOSED.has(i.status) && sameResource(i, t));
  // An investigation report, or a run recorded on the item (#233: metadata.investigation_run).
  const withInv = open.find((i) => {
    const md = i.metadata as { investigation_id?: string; investigation_run?: unknown } | undefined;
    return !!md?.investigation_id || !!md?.investigation_run;
  });
  const unclaimed = open.find((i) => !i.claimed_by);
  const reuse = withInv ?? unclaimed;
  if (reuse) return { itemId: reuse.id, reused: true, hasInvestigation: reuse === withInv };
  const created = await agentJson<{ id: string }>('/api/agent/inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(diagnoseItemBody(t)),
  });
  return { itemId: created.id, reused: false, hasInvestigation: false };
}

/** retry_after from a refusal's detail, else the Retry-After header, in seconds. */
function retryAfterSeconds(res: Response, body: Body): number | undefined {
  const d = body?.detail as Record<string, unknown> | undefined;
  if (d && typeof d === 'object' && typeof d.retry_after === 'number' && d.retry_after > 0) return d.retry_after;
  const h = Number(res.headers?.get?.('Retry-After'));
  return Number.isFinite(h) && h > 0 ? h : undefined;
}

/** POST …/investigate: the run's phase, or the agent's reason for refusing. */
async function requestInvestigation(itemId: string): Promise<{ run: RunPhase; windowMs: number } | { refused: string; retryAfter?: number }> {
  const res = await agentFetch(`/api/agent/inbox/${encodeURIComponent(itemId)}/investigate`, { method: 'POST' });
  const body = await readBody(res);
  if (res.status === 409 || res.status === 429) {
    return {
      refused: detailText(body) ?? (res.status === 429 ? 'the agent is busy or over its investigation budget' : 'the item is closed'),
      retryAfter: retryAfterSeconds(res, body),
    };
  }
  if (!res.ok) {
    const detail = detailText(body);
    const head = res.status === 401 ? SIGN_IN
      : res.status === 403 ? 'You do not have permission to do this'
      : res.status === 404 ? 'The inbox item no longer exists (404)'
      : `Starting the investigation failed (${res.status})`;
    throw new AgentHttpError(res.status, `${head}${detail && res.status !== 404 ? `: ${detail}` : ''}`);
  }
  const phase = str(body?.state) ?? str(body?.status);
  return { run: phase === 'running' ? 'running' : 'queued', windowMs: windowFor(body?.timeout_seconds) };
}

export interface DiagnoseOptions {
  /** The page shows a remote cluster: the agent investigates its own cluster only, so nothing is sent. */
  remote?: boolean;
}

export function useDiagnose(target: DiagnoseTarget, opts: DiagnoseOptions = {}) {
  const [state, setState] = React.useState<DiagnoseState>({ phase: 'idle' });
  const key = `${target.kind}/${target.namespace}/${target.name}`;
  const remote = !!opts.remote;
  // Read at click time: the category can settle after the page renders (the
  // pod's status arrives later) without resetting the card.
  const targetRef = React.useRef(target);
  targetRef.current = target;
  React.useEffect(() => { setState({ phase: 'idle' }); }, [key, remote]);

  /** `again`: start a new run even when the item already has a report (Diagnose again). */
  const run = React.useCallback(async (again = false) => {
    if (remote) return;
    setState({ phase: 'starting' });
    try {
      const item = await findOrCreateItem(targetRef.current);
      if (item.hasInvestigation && !again) {
        const inv = await readInvestigation(item.itemId);
        if (inv.status === 'done') { setState({ phase: 'done', itemId: item.itemId, report: inv.report, reused: true, at: inv.at }); return; }
        if (inv.status === 'queued' || inv.status === 'running') {
          setState({ phase: 'waiting', itemId: item.itemId, run: inv.status, reused: true, since: Date.now(), windowMs: inv.windowMs });
          return;
        }
      }
      const started = await requestInvestigation(item.itemId);
      if ('refused' in started) {
        setState({ phase: 'refused', itemId: item.itemId, reason: started.refused, retryAt: started.retryAfter ? Date.now() + started.retryAfter * 1000 : undefined, again });
        return;
      }
      setState({ phase: 'waiting', itemId: item.itemId, run: started.run, reused: item.reused, since: Date.now(), windowMs: started.windowMs });
    } catch (e) {
      const down = unreachable(e);
      setState(down ? { phase: 'unreachable', reason: down }
        : { phase: 'failed', reason: signInNeeded(e) ? SIGN_IN : e instanceof Error ? e.message : String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, remote]);

  // Poll while waiting; done and failed end it.
  const waiting = state.phase === 'waiting' ? state : null;
  React.useEffect(() => {
    if (!waiting) return undefined;
    const { itemId, since, reused, windowMs } = waiting;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const inv = await readInvestigation(itemId);
        if (stop) return;
        if (inv.status === 'done') { stop = true; setState({ phase: 'done', itemId, report: inv.report, reused, at: inv.at }); return; }
        if (inv.status === 'failed') { stop = true; setState({ phase: 'failed', itemId, reason: inv.reason }); return; }
        if (inv.status === 'empty') { stop = true; setState({ phase: 'empty', itemId }); return; }
        if ((inv.status === 'queued' || inv.status === 'running') && inv.status !== waiting.run) {
          setState({ ...waiting, run: inv.status, windowMs: Math.max(waiting.windowMs, inv.windowMs) });
          return;
        }
      } catch (e) {
        stop = true;
        const down = unreachable(e);
        setState(down ? { phase: 'unreachable', reason: down }
          : { phase: 'failed', itemId, reason: signInNeeded(e) ? SIGN_IN : e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - since >= windowMs) { stop = true; setState({ phase: 'timeout', itemId, windowMs }); }
    };
    const id = setInterval(() => { void tick(); }, DIAGNOSE_POLL_MS);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting?.itemId, waiting?.run, waiting?.since]);

  return { state, run };
}
