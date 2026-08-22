import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkAuth, agentFetch } from '../safeQuery';
import { useUIStore } from '../../store/uiStore';

/**
 * The session-expired modal could be raised but never lowered.
 *
 * `session_expired` was added from seven call sites and removed from none
 * outside the test suite, while every other degraded reason cleared itself.
 * So a single transient 401 pinned the modal for the life of the page — and on
 * a cluster whose API server is restarting and dropping TLS handshakes, a
 * one-off 401 is routine. The operator is then told their session expired
 * while every request behind the modal succeeds.
 */

function res(status: number): Response {
  return { status, ok: status >= 200 && status < 300 } as Response;
}

describe('session_expired is a state, not a one-way trip', () => {
  beforeEach(() => {
    useUIStore.getState().removeDegradedReason('session_expired');
  });

  const expired = () => useUIStore.getState().degradedReasons.has('session_expired');

  it('a 401 raises it', () => {
    checkAuth(res(401));
    expect(expired()).toBe(true);
  });

  it('a later success takes it back down', () => {
    checkAuth(res(401));
    expect(expired()).toBe(true);
    checkAuth(res(200));
    expect(expired()).toBe(false);
  });

  it('the transient blip does not outlive itself', () => {
    // The real sequence on an unstable API server: one failure among many
    // successes. The modal must not survive it.
    [200, 200, 401, 200, 200].forEach((s) => checkAuth(res(s)));
    expect(expired()).toBe(false);
  });

  it('a server error does not clear it — only proof of auth does', () => {
    // A 500 says nothing about the session. Clearing on it would hide a
    // genuinely expired session behind an unrelated backend fault.
    checkAuth(res(401));
    checkAuth(res(500));
    expect(expired()).toBe(true);
  });

  it('a 403 does not clear it either', () => {
    checkAuth(res(401));
    checkAuth(res(403));
    expect(expired()).toBe(true);
  });

  it('agentFetch clears it on a successful call', async () => {
    checkAuth(res(401));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200)));
    await agentFetch('/api/agent/health');
    expect(expired()).toBe(false);
    vi.unstubAllGlobals();
  });
});
