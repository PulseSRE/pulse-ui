/**
 * "Diagnose": ask the agent to investigate a resource that has no monitor
 * finding, through the inbox (contract fixed in the Wave 11 brief):
 *
 *   1. reuse an open inbox item for the same resource, or create one
 *      (POST /api/agent/inbox, the resource in `resources`);
 *   2. POST /api/agent/inbox/{id}/investigate;
 *   3. poll GET /api/agent/inbox/{id}/investigation (404 = not yet) and the
 *      item itself (agent_review_failed = it gave up) until a report arrives
 *      or 10 minutes pass.
 *
 * Each outcome is said plainly: a report, a failure with the agent's status,
 * "no report yet" after the window with a link to the item, or the agent
 * being unreachable.
 */
import React from 'react';
import { agentFetch, AgentHttpError, agentJson } from '../../engine/safeQuery';
import { fetchInbox, fetchInboxInvestigation, fetchInboxItem, type InboxItem, type InvestigationReport } from '../../engine/inboxApi';

export const DIAGNOSE_POLL_MS = 5000;
export const DIAGNOSE_WINDOW_MS = 10 * 60 * 1000;

export type DiagnoseState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'waiting'; itemId: string; reused: boolean; note?: string; since: number }
  | { phase: 'done'; itemId: string; report: InvestigationReport }
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

async function startInvestigation(t: DiagnoseTarget): Promise<{ itemId: string; reused: boolean; note?: string; report?: InvestigationReport }> {
  const list = await fetchInbox({ namespace: t.namespace, limit: 200 });
  const open = (list.items ?? []).find((i) => !CLOSED.has(i.status) && sameResource(i, t));
  let itemId: string;
  let reused = false;
  if (open) {
    itemId = open.id;
    reused = true;
    if ((open.metadata as { investigation_id?: string } | undefined)?.investigation_id) {
      const report = await fetchInboxInvestigation(itemId);
      if (report) return { itemId, reused, report };
    }
  } else {
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
    itemId = created.id;
  }
  const res = await agentFetch(`/api/agent/inbox/${encodeURIComponent(itemId)}/investigate`, { method: 'POST' });
  if (res.status === 409) return { itemId, reused, note: 'Someone else has claimed this item; waiting for their investigation.' };
  if (!res.ok) throw new AgentHttpError(res.status, `Starting the investigation failed (${res.status})`);
  return { itemId, reused };
}

export function useDiagnose(target: DiagnoseTarget) {
  const [state, setState] = React.useState<DiagnoseState>({ phase: 'idle' });
  const key = `${target.kind}/${target.namespace}/${target.name}`;
  React.useEffect(() => { setState({ phase: 'idle' }); }, [key]);

  const run = React.useCallback(async () => {
    setState({ phase: 'starting' });
    try {
      const r = await startInvestigation(target);
      if (r.report) setState({ phase: 'done', itemId: r.itemId, report: r.report });
      else setState({ phase: 'waiting', itemId: r.itemId, reused: r.reused, note: r.note, since: Date.now() });
    } catch (e) {
      const down = unreachable(e);
      setState(down ? { phase: 'unreachable', reason: down } : { phase: 'failed', reason: e instanceof Error ? e.message : String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Poll while waiting.
  React.useEffect(() => {
    if (state.phase !== 'waiting') return undefined;
    const { itemId, since } = state;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const report = await fetchInboxInvestigation(itemId);
        if (stop) return;
        if (report) { setState({ phase: 'done', itemId, report }); return; }
        const item = await fetchInboxItem(itemId);
        if (stop) return;
        if (item.status === 'agent_review_failed') {
          setState({ phase: 'failed', itemId, reason: 'The agent tried to investigate and could not (agent_review_failed).' });
          return;
        }
      } catch (e) {
        const down = unreachable(e);
        if (down) { setState({ phase: 'unreachable', reason: down }); return; }
        setState({ phase: 'failed', itemId, reason: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - since >= DIAGNOSE_WINDOW_MS) setState({ phase: 'timeout', itemId });
    };
    const id = setInterval(() => { void tick(); }, DIAGNOSE_POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, [state]);

  return { state, run };
}
