/**
 * Pending actions carry the cluster they were created against.
 *
 * A confirmation dialog, a proposal card or a half-finished form is created
 * while one cluster is active. If the active cluster changes before the user
 * confirms, executing it would apply a decision made about one cluster's
 * object to another cluster — or, for writes that resolve "the active
 * cluster" at call time, silently retarget them. Pin the cluster when the
 * action is created, write to that pinned cluster, and refuse when it is no
 * longer the active one.
 */
import { getActiveClusterId, getAllConnections } from './clusterConnection';

export class ClusterChangedError extends Error {
  constructor(
    public readonly pinnedClusterId: string,
    public readonly activeClusterId: string,
    what: string,
  ) {
    super(clusterChangedMessage(pinnedClusterId, activeClusterId, what));
    this.name = 'ClusterChangedError';
  }
}

export function clusterDisplayName(id: string): string {
  return getAllConnections().find((c) => c.id === id)?.name ?? id;
}

export function clusterChangedMessage(pinned: string, active: string, what = 'This action'): string {
  return `${what} was not run: it was prepared on ${clusterDisplayName(pinned)}, but the active cluster is now ${clusterDisplayName(active)}. Switch back to ${clusterDisplayName(pinned)} to run it, or start again on ${clusterDisplayName(active)}.`;
}

/** Throw ClusterChangedError unless `pinned` is still the active cluster. */
export function assertActiveCluster(pinned: string, what?: string): void {
  const active = getActiveClusterId();
  if (active !== pinned) throw new ClusterChangedError(pinned, active, what ?? 'This action');
}
