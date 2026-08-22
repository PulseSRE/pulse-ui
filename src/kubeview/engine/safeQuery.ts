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
