import { useUIStore } from '../store/uiStore';

/**
 * Check for session expiry on any API response.
 *
 * Raises the session-expired modal on a 401 — and, just as importantly, takes
 * it back down when a request succeeds. Every other degraded reason already
 * clears itself (`observability_unavailable` in the incident hooks,
 * `polling_fallback` and `agent_unreachable` in agentNotifications); this one
 * was set from seven places and cleared from none outside the tests, so a
 * single transient 401 latched the modal for the life of the page.
 *
 * That is not a theoretical window. On a cluster whose API server is
 * restarting and dropping TLS handshakes, a one-off 401 is routine, and the
 * operator is then told their session expired for as long as the tab stays
 * open — while every subsequent request succeeds behind the modal.
 *
 * A 2xx from an endpoint behind the OAuth proxy is proof the session is good:
 * the proxy would have answered 401 itself otherwise.
 */
export function checkAuth(response: Response): Response {
  const ui = useUIStore.getState();
  if (response.status === 401) {
    ui.addDegradedReason('session_expired');
  } else if (response.ok) {
    ui.removeDegradedReason('session_expired');
  }
  return response;
}

/**
 * Fetch wrapper that checks for 401 on agent API calls.
 * Use instead of raw fetch() for /api/agent/ endpoints.
 */
export async function agentFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  checkAuth(res);
  return res;
}

/**
 * Safe query wrapper — returns null for 404 (resource doesn't exist),
 * throws for 500/network errors so React Query shows error banners.
 */
export async function safeQuery<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    // 404 = resource legitimately doesn't exist
    if (e instanceof Response && e.status === 404) return null;
    // Check for fetch Response-like objects
    if (typeof e === 'object' && e !== null && 'status' in e) {
      const status = (e as { status: number }).status;
      if (status === 404) return null;
      if (status === 401) {
        useUIStore.getState().addDegradedReason('session_expired');
      }
    }
    throw e; // Let React Query handle the error
  }
}

/** An agent API call that answered with an error status. */
export class AgentHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AgentHttpError';
  }
}

/**
 * Fetch an agent endpoint and parse its JSON, throwing on a non-2xx answer.
 *
 * `agentFetch` never throws on an error status, and many callers went on to
 * read the error body as data — a 403 rendered as "nothing here", a failed
 * save as "saved". The thrown error carries the server's `detail` when there
 * is one, so the UI can say what went wrong rather than just that it did.
 */
export async function agentJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await agentFetch(url, init);
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = typeof body?.detail === 'string' ? body.detail : typeof body?.error === 'string' ? body.error : '';
    } catch {
      // Not JSON: the status line is all there is.
    }
    const reason =
      res.status === 403
        ? 'You do not have permission to do this'
        : res.status === 401
          ? 'Your session has expired'
          : `Request failed (${res.status})`;
    throw new AgentHttpError(res.status, detail ? `${reason}: ${detail}` : reason);
  }
  return (await res.json()) as T;
}
