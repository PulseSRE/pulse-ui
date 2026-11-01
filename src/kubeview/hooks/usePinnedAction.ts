/**
 * A confirmable action that remembers the cluster it was opened on.
 *
 * Every state-changing admin action follows the same shape: the user opens a
 * confirmation that says exactly what will happen, confirms, and the request
 * goes to the cluster the dialog was opened on — or is refused, with a
 * reason, if the active cluster changed in between (engine/pendingCluster).
 * A failure stays in the dialog, so the user sees what went wrong next to
 * the thing they tried to do instead of a toast that disappears.
 */
import { useCallback, useState } from 'react';
import { useActiveClusterId } from './useClusterBase';
import { assertActiveCluster } from '../engine/pendingCluster';
import { PulseError } from '../engine/errors';

export interface PendingAction<T> {
  target: T;
  /** The cluster that was active when the dialog opened. */
  clusterId: string;
}

export function errorMessage(e: unknown): string {
  if (e instanceof PulseError) return e.userMessage && e.userMessage !== e.message ? `${e.userMessage}: ${e.message}` : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function usePinnedAction<T>() {
  const activeClusterId = useActiveClusterId();
  const [pending, setPending] = useState<PendingAction<T> | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((target: T) => {
    setError(null);
    setPending({ target, clusterId: activeClusterId });
  }, [activeClusterId]);

  const close = useCallback(() => {
    setPending(null);
    setError(null);
  }, []);

  /**
   * Run `fn` against the pinned cluster. Resolves true when it succeeded (the
   * dialog closes), false when it was refused or failed (the dialog stays
   * open with the error).
   */
  const run = useCallback(async (what: string, fn: (target: T, clusterId: string) => Promise<void>): Promise<boolean> => {
    if (!pending) return false;
    setRunning(true);
    setError(null);
    try {
      assertActiveCluster(pending.clusterId, what);
      await fn(pending.target, pending.clusterId);
      setPending(null);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setRunning(false);
    }
  }, [pending]);

  return { pending, open, close, run, running, error, setError };
}
