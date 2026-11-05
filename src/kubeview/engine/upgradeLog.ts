/**
 * Who started each cluster update, and why.
 *
 * ClusterVersion history records versions and times but not the person or the
 * reason. Pulse writes both into an annotation on ClusterVersion `version`, in
 * the same merge patch that sets spec.desiredUpdate, so the record and the
 * update cannot drift apart: either both are written or neither is.
 *
 * The annotation is written by whoever may patch ClusterVersion, so it is a
 * record Pulse kept, not proof; the API server's audit log has the
 * authoritative identity for each patch. `startedAt` comes from the clock of
 * the browser that started the update, so it can be off by that machine's
 * clock skew; history rows are matched to it with a tolerance for that.
 *
 * Entries Pulse does not understand (written by another tool or a newer
 * Pulse) are kept as they are when appending; only the history display
 * leaves them out.
 */

import type { ClusterVersion } from './types';
import { desiredUpdatePatch, durationMinutes, type UpgradeHistoryEntry, type UpgradeTarget } from './upgradeGraph';

export const UPDATE_LOG_ANNOTATION = 'pulse.openshift.io/update-log';
export const UPDATE_LOG_MAX = 50;
export const UPDATE_REASON_MAX = 500;

export interface UpdateLogEntry {
  version: string;
  startedAt: string;
  /** The username Pulse read for the person who started it; null when it could not be read. */
  by: string | null;
  reason: string;
  /** Set when the user was impersonating someone; `by` is then the impersonated identity. */
  impersonated?: boolean;
}

export interface ParsedUpdateLog {
  /** Entries Pulse understands, for display. */
  entries: UpdateLogEntry[];
  /** Every item in the array, understood or not; appending keeps all of them. */
  items: unknown[];
  /** Items in the array Pulse does not understand (kept, not shown). */
  unrecognised: number;
  /** False when the annotation is present but not a JSON array; it is then replaced. */
  valid: boolean;
}

/** The entries in the annotation; `valid: false` when it is present but not a JSON array. */
export function parseUpdateLog(raw: string | undefined | null): ParsedUpdateLog {
  if (!raw) return { entries: [], items: [], unrecognised: 0, valid: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entries: [], items: [], unrecognised: 0, valid: false };
  }
  if (!Array.isArray(parsed)) return { entries: [], items: [], unrecognised: 0, valid: false };
  const entries = parsed.filter((e): e is UpdateLogEntry =>
    !!e && typeof e === 'object'
    && typeof (e as UpdateLogEntry).version === 'string'
    && typeof (e as UpdateLogEntry).startedAt === 'string'
    && typeof (e as UpdateLogEntry).reason === 'string'
    && ((e as UpdateLogEntry).by === null || typeof (e as UpdateLogEntry).by === 'string'),
  ).map((e) => ({ version: e.version, startedAt: e.startedAt, by: e.by, reason: e.reason, ...(e.impersonated ? { impersonated: true } : {}) }));
  return { entries, items: parsed, unrecognised: parsed.length - entries.length, valid: true };
}

/** How many of the oldest items appending one entry would push out of the log. */
export function updateLogOverflow(log: ParsedUpdateLog): number {
  return Math.max(0, log.items.length + 1 - UPDATE_LOG_MAX);
}

export function updateLogOf(cv: ClusterVersion | null | undefined) {
  return parseUpdateLog(cv?.metadata?.annotations?.[UPDATE_LOG_ANNOTATION]);
}

/**
 * The annotation value with `entry` appended to every existing item
 * (understood or not), keeping the last UPDATE_LOG_MAX. The reason is capped
 * at UPDATE_REASON_MAX here, whatever the caller's input allowed.
 */
export function appendUpdateLog(raw: string | undefined | null, entry: UpdateLogEntry): string {
  const { items } = parseUpdateLog(raw);
  const capped = { ...entry, reason: entry.reason.slice(0, UPDATE_REASON_MAX) };
  return JSON.stringify([...items, capped].slice(-UPDATE_LOG_MAX));
}

/**
 * The single merge patch that starts an update and records it: the
 * desiredUpdate (with acceptRisks for a conditional target, as before) plus
 * the appended log annotation.
 */
export function updateStartPatch(
  target: Pick<UpgradeTarget, 'version' | 'image' | 'state' | 'risks'>,
  clusterVersion: ClusterVersion | null | undefined,
  entry: UpdateLogEntry,
) {
  const { spec } = desiredUpdatePatch(target, clusterVersion?.spec?.desiredUpdate?.acceptRisks);
  return {
    metadata: { annotations: { [UPDATE_LOG_ANNOTATION]: appendUpdateLog(clusterVersion?.metadata?.annotations?.[UPDATE_LOG_ANNOTATION], entry) } },
    spec,
  };
}

/** Browser clock skew allowed between an entry's startedAt and the history row's startedTime. */
export const LOG_MATCH_SKEW_MS = 5 * 60_000;

/**
 * The log entry for history row `index` (history is newest first): an entry
 * for the row's version whose startedAt lies in [row start − 5 min, row
 * completion] (no upper bound while it runs) and after the start of the update
 * before it. An entry left from an earlier attempt at the same version is not
 * borrowed. A row without a start time matches nothing.
 */
export function logEntryFor(entries: UpdateLogEntry[], history: Array<Pick<UpgradeHistoryEntry, 'version' | 'startedTime' | 'completionTime'>>, index: number): UpdateLogEntry | null {
  const h = history[index];
  const start = h?.startedTime ? Date.parse(h.startedTime) : NaN;
  if (!h || Number.isNaN(start)) return null;
  const end = h.completionTime ? Date.parse(h.completionTime) : Infinity;
  const older = history[index + 1]?.startedTime ? Date.parse(history[index + 1].startedTime!) : -Infinity;
  const lo = Math.max(start - LOG_MATCH_SKEW_MS, older);
  const candidates = entries.filter((e) => {
    const t = Date.parse(e.startedAt);
    return e.version === h.version && !Number.isNaN(t) && t >= lo && t > older && t <= end;
  });
  return candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
}

/** "1h 48m" from minutes. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
}

/**
 * Duration range of the last (up to) three completed updates, or null when
 * none has recorded times. The oldest history entry is the installation, not
 * an update, so it is left out.
 */
export function estimateFromHistory(history: UpgradeHistoryEntry[]): { text: string; samples: number } | null {
  const mins = history.slice(0, -1)
    .filter((h) => h.state === 'Completed')
    .map((h) => durationMinutes(h.startedTime, h.completionTime))
    .filter((m): m is number => m !== null && m > 0)
    .slice(0, 3);
  if (mins.length === 0) return null;
  const lo = Math.min(...mins);
  const hi = Math.max(...mins);
  const range = lo === hi ? `about ${formatMinutes(lo)}` : `${formatMinutes(lo)}–${formatMinutes(hi)}`;
  return { text: `${range} based on the last ${mins.length === 1 ? 'update' : `${mins.length} updates`}`, samples: mins.length };
}
