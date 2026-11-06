/**
 * The agent's ledger of writes made through Pulse (`POST /rbac/ledger`,
 * pulse-agent API_CONTRACT.md › RBAC change history).
 *
 * The agent checks that the caller may make the write and takes the actor
 * from the caller's own token; the UI sends what it wrote, why, and the
 * resourceVersion the write returned (for a delete, the version deleted), so
 * the agent's observed history can credit exactly that change to it. An agent
 * without the ledger answers 404; recording is then skipped and the caller
 * says so. Recording never undoes or blocks the write itself.
 */
import { agentFetch } from './safeQuery';

export interface LedgerEntry {
  verb: 'create' | 'update' | 'patch' | 'delete';
  kind: string;
  namespace?: string;
  name: string;
  resource_version?: string;
  reason?: string;
  outcome?: 'ok' | 'failed';
  before?: unknown;
  after?: unknown;
}

export type LedgerResult = 'recorded' | 'absent' | 'failed';

export async function recordLedger(entry: LedgerEntry): Promise<LedgerResult> {
  try {
    const res = await agentFetch('/api/agent/rbac/ledger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
    if (res.status === 404) return 'absent';
    return res.ok ? 'recorded' : 'failed';
  } catch {
    return 'failed';
  }
}
