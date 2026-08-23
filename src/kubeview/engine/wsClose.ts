/**
 * Close a WebSocket without console noise.
 *
 * Calling close() on a socket that is still CONNECTING is legal, but the
 * browser logs "WebSocket is closed before the connection is established" —
 * and React StrictMode's dev double-mount tears down every first mount's
 * subscription exactly in that state, spamming the console with alarming
 * non-errors on every page load (and sending at least one operator on a
 * debugging detour). Deferring the close to onopen silences it; handlers are
 * detached first so the throwaway socket can't deliver events.
 */
export function closeQuietly(ws: WebSocket): void {
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.onopen = () => ws.close();
  } else {
    ws.close();
  }
}
