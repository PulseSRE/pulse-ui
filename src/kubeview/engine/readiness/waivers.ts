/**
 * Readiness gate waivers kept by the agent (`/readiness/waivers`).
 *
 * The agent stores waivers for the cluster it is installed on, with the
 * signed-in admin who waived each gate (never a name the browser sends).
 * Reads use the shared UI credential; waiving and lifting need an admin, the
 * same authority as approving a fix.
 *
 * An agent from before this endpoint answers the list with 404. That is the
 * one case where the UI falls back to the browser store; every other failure
 * is an error the user sees, so a waiver is never dropped silently.
 */

import { agentFetch } from '../safeQuery';
import type { Waiver } from './types';

const BASE = '/api/agent/readiness/waivers';

/** Where waivers are kept: on the cluster (agent) or, for an older agent, in this browser. */
export type WaiverStorage = 'cluster' | 'browser';

/** A waiver as the agent returns it. */
interface ServerWaiver {
  gate_id: string;
  reason: string;
  waived_by: string;
  created_at: string;
  expires_at: string | null;
}

export type WaiverListResult =
  | { storage: 'cluster'; waivers: Record<string, Waiver> }
  | { storage: 'browser' };

/** A waiver request the agent refused or could not answer. */
export class WaiverRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WaiverRequestError';
  }
}

function toWaiver(w: ServerWaiver): Waiver {
  const created = Date.parse(w.created_at);
  const expires = w.expires_at ? Date.parse(w.expires_at) : NaN;
  return {
    gateId: w.gate_id,
    reason: w.reason,
    approvedBy: w.waived_by,
    createdAt: Number.isNaN(created) ? 0 : created,
    expiresAt: Number.isNaN(expires) ? null : expires,
  };
}

async function errorFor(res: Response, action: 'load' | 'waive' | 'unwaive'): Promise<WaiverRequestError> {
  let detail = '';
  try {
    const body = await res.json();
    detail = typeof body?.error === 'string' ? body.error : typeof body?.detail === 'string' ? body.detail : '';
  } catch {
    // Not JSON: the status is all there is.
  }
  if (res.status === 403) {
    return new WaiverRequestError(
      403,
      action === 'unwaive'
        ? 'Only a Pulse administrator can remove a waiver. Ask an administrator to remove it.'
        : 'Only a Pulse administrator can waive a gate. Ask an administrator to waive it.',
    );
  }
  if (res.status === 401) {
    return new WaiverRequestError(
      401,
      'The agent could not tell who you are, so it cannot record the waiver. Sign in again and retry.',
    );
  }
  const what = action === 'load' ? 'Could not load waivers' : action === 'waive' ? 'Could not save the waiver' : 'Could not remove the waiver';
  return new WaiverRequestError(res.status, `${what} (${res.status})${detail ? `: ${detail}` : ''}`);
}

/** This cluster's active waivers, or `storage: 'browser'` when the agent predates the endpoint. */
export async function fetchClusterWaivers(): Promise<WaiverListResult> {
  const res = await agentFetch(BASE);
  if (res.status === 404) return { storage: 'browser' };
  if (!res.ok) throw await errorFor(res, 'load');
  const body = (await res.json()) as { waivers?: ServerWaiver[] };
  if (!body || !Array.isArray(body.waivers)) {
    throw new WaiverRequestError(res.status, 'Could not load waivers: the agent sent an unexpected response.');
  }
  return {
    storage: 'cluster',
    waivers: Object.fromEntries(body.waivers.map((w) => [w.gate_id, toWaiver(w)])),
  };
}

/** Waive a gate on the cluster. The agent records the signed-in admin as the author. */
export async function saveClusterWaiver(gateId: string, reason: string, expiresAt: number | null = null): Promise<Waiver> {
  const res = await agentFetch(`${BASE}/${encodeURIComponent(gateId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, expires_at: expiresAt === null ? null : new Date(expiresAt).toISOString() }),
  });
  if (!res.ok) throw await errorFor(res, 'waive');
  return toWaiver((await res.json()) as ServerWaiver);
}

/** Lift a gate's waiver on the cluster. Lifting one that is not there succeeds. */
export async function deleteClusterWaiver(gateId: string): Promise<void> {
  const res = await agentFetch(`${BASE}/${encodeURIComponent(gateId)}`, { method: 'DELETE' });
  if (!res.ok) throw await errorFor(res, 'unwaive');
}

/** Whether a waiver still stands at `now` (no expiry, or expiry in the future). */
export function isActiveWaiver(w: Pick<Waiver, 'expiresAt'>, now = Date.now()): boolean {
  return w.expiresAt === null || w.expiresAt > now;
}
