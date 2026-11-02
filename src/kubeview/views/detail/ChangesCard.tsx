/**
 * "What changed before this": rollouts, ConfigMap/Secret edits, Argo syncs and
 * cluster updates around a resource, from the agent's change correlation
 * (GET /api/agent/changes, pulse-agent#230).
 *
 * Contract: newest first; `unreadable` lists optional sources the user could
 * not read (a muted note, not an error). 404 with code resource_not_found:
 * the resource is gone; any other 404: an older agent without the endpoint
 * (muted). 401: the session expired (agentFetch raises the sign-in prompt).
 * `truncated`: capped at the latest 500. `available: false`: the agent cannot reach the cluster (muted).
 * 400/403/5xx: an error with Retry — never an empty list.
 */
import { useQuery } from '@tanstack/react-query';
import { History, Loader2 } from 'lucide-react';
import { agentFetch, AgentHttpError } from '../../engine/safeQuery';
import { LoadError } from '../../components/primitives/LoadError';

export const CHANGES_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface ChangeEntry {
  at: string;
  kind: string;
  namespace: string;
  name: string;
  summary: string;
  actor: string | null;
  source: string;
}

export type ChangesResult =
  | { state: 'ok'; changes: ChangeEntry[]; unreadable: string[]; truncated: boolean }
  | { state: 'unavailable'; reason: 'old-agent' | 'not-available' | 'gone' | 'session' };

export async function fetchChanges(params: { namespace: string; kind: string; name: string; since: Date; until: Date }): Promise<ChangesResult> {
  const qs = new URLSearchParams({
    namespace: params.namespace, kind: params.kind, name: params.name,
    since: params.since.toISOString(), until: params.until.toISOString(),
  });
  const res = await agentFetch(`/api/agent/changes?${qs}`);
  let body: { detail?: unknown; code?: string; changes?: ChangeEntry[]; available?: boolean; unreadable?: string[]; truncated?: boolean } | null = null;
  try { body = await res.json(); } catch { body = null; }
  // agentFetch has already raised the session-expired prompt (checkAuth).
  if (res.status === 401) return { state: 'unavailable', reason: 'session' };
  if (res.status === 404) return { state: 'unavailable', reason: body?.code === 'resource_not_found' ? 'gone' : 'old-agent' };
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? `: ${body.detail}` : '';
    const what = res.status === 403 ? 'Permission denied (403)' : `Request failed (${res.status})`;
    throw new AgentHttpError(res.status, `${what}${detail}`);
  }
  if (body?.available === false) return { state: 'unavailable', reason: 'not-available' };
  return { state: 'ok', changes: body?.changes ?? [], unreadable: body?.unreadable ?? [], truncated: body?.truncated === true };
}

const UNAVAILABLE: Record<'old-agent' | 'not-available' | 'gone' | 'session', string> = {
  session: 'Your session has expired: sign in again to see what changed.',
  'old-agent': 'Change history is unavailable on this agent (it predates the changes API).',
  'not-available': 'Change history is not available: the agent cannot reach the cluster.',
  gone: 'No change history: the resource no longer exists.',
};

function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChangesCard({ namespace, kind, name, until, since }: { namespace: string; kind: string; name: string; until?: number; since?: number }) {
  // Rounded to the minute so the query key stays stable between renders.
  const end = until ?? Math.ceil(Date.now() / 60_000) * 60_000;
  const start = since ?? end - CHANGES_WINDOW_MS;
  const q = useQuery({
    queryKey: ['agent-changes', namespace, kind, name, start, end],
    queryFn: () => fetchChanges({ namespace, kind, name, since: new Date(start), until: new Date(end) }),
    retry: false,
    staleTime: 60_000,
  });
  return (
    <section aria-labelledby="chg-h" className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h2 id="chg-h" className="flex items-center gap-2 text-[15px] font-semibold text-slate-100">
        <History className="h-4 w-4 text-slate-400" aria-hidden /> What changed before this
      </h2>
      {q.isLoading && <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading changes…</p>}
      {q.isError && <LoadError title="Changes could not be loaded" error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.state === 'unavailable' && <p className="text-xs text-slate-500" data-testid="changes-unavailable">{UNAVAILABLE[q.data.reason]}</p>}
      {q.data?.state === 'ok' && (
        <>
          {q.data.changes.length === 0 ? (
            <p className="text-xs text-slate-400">No changes recorded for {kind} {name} in the last {Math.round((end - start) / 3_600_000)}h.</p>
          ) : (
            <ol className="flex flex-col gap-2.5 text-[13px]" aria-label="Changes">
              {q.data.changes.map((c, i) => (
                <li key={`${c.at}-${i}`} className="flex gap-2.5">
                  <span className="min-w-[44px] font-mono text-slate-400">{hhmm(c.at)}</span>
                  <span className="text-slate-200">
                    {c.summary}
                    {c.actor && <span className="text-slate-400"> · by {c.actor}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {q.data.truncated && <p className="text-xs text-slate-500" data-testid="changes-truncated">Showing the latest 500 changes.</p>}
          {q.data.unreadable.length > 0 && (
            <p className="text-xs text-slate-500" data-testid="changes-unreadable">Couldn&apos;t check: {q.data.unreadable.join(', ')} (no permission to read them).</p>
          )}
        </>
      )}
    </section>
  );
}
