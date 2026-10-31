/**
 * The one place time, duration and size are turned into text.
 *
 * Before this module there were about ten relative-time implementations, two
 * byte formatters and four duration formatters, each with its own thresholds
 * and units, so the same pod could be "3d" in one table and "72h" in another.
 * engine/formatters.ts, engine/formatting.ts and engine/dateUtils.ts re-export
 * from here under their old names; new code imports from this file.
 *
 * Dates are rendered in a fixed locale so a screenshot, a test and a support
 * ticket all read the same regardless of the browser's language settings.
 */

export const FORMAT_LOCALE = 'en-US';

export type TimeInput = number | string | Date | null | undefined;

/** Epoch milliseconds for a timestamp, or null when it is missing or unparseable. */
export function toEpochMs(input: TimeInput): number | null {
  if (input === null || input === undefined || input === '') return null;
  const ms = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : new Date(input).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The coarsest single unit for a non-negative span in ms: 45s, 12m, 3h, 5d, 2mo, 1y. */
function spanUnit(ms: number): string {
  const d = Math.max(0, ms);
  if (d < MIN) return `${Math.floor(d / SEC)}s`;
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  const days = Math.floor(d / DAY);
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return `${days}d`;
}

/**
 * Bare age of a timestamp, the way a resource table shows it: "45s", "12m",
 * "3h", "5d", "2mo", "1y". `fallback` (default "—") when there is no time.
 * A timestamp slightly in the future (clock skew) reads "0s".
 */
export function formatAge(input: TimeInput, fallback = '—', now: number = Date.now()): string {
  const ms = toEpochMs(input);
  if (ms === null) return fallback;
  return spanUnit(now - ms);
}

/**
 * How long ago, with its own "ago": "just now", "30s ago", "5m ago", "2d ago".
 * Under five seconds — or in the future, which only clock skew between the
 * agent and the browser can produce — is "just now". Callers must not append
 * another "ago".
 */
export function formatRelative(input: TimeInput, fallback = '—', now: number = Date.now()): string {
  const ms = toEpochMs(input);
  if (ms === null) return fallback;
  const diff = now - ms;
  if (diff < 5 * SEC) return 'just now';
  return `${spanUnit(diff)} ago`;
}

/**
 * A measured span in milliseconds, in compound units: "<1s", "45s", "5m 30s",
 * "2h 5m", "3d 4h".
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const d = Math.max(0, ms);
  if (d < SEC) return '<1s';
  const secs = Math.floor(d / SEC);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return secs % 60 ? `${mins}m ${secs % 60}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

/** A span in seconds, compound units (see formatDurationMs). Rounds to the second. */
export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds > 0 && seconds < 1) return '<1s';
  return formatDurationMs(Math.round(seconds) * SEC);
}

/** Time between two timestamps, or from `start` until now. */
export function formatDurationBetween(start: TimeInput, end?: TimeInput, now: number = Date.now()): string {
  const s = toEpochMs(start);
  if (s === null) return '—';
  const e = end === undefined || end === null || end === '' ? now : toEpochMs(end);
  if (e === null) return '—';
  return formatDurationMs(e - s);
}

/**
 * A span of seconds as the coarsest unit that still reads precisely: 45s, 12m,
 * 3h, 2d. For labels ("every 2h", "−7m") rather than measurements.
 */
export function formatShortDuration(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 90) return `${Math.round(s)}s`;
  const mins = Math.round(s / 60);
  if (mins < 90) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Bare span since a unix-seconds timestamp ("running 30m"). */
export function formatElapsed(startedAtSeconds: number, now: number = Date.now()): string {
  return formatShortDuration(now / 1000 - startedAtSeconds);
}

/**
 * A metric value measured in seconds, which may be sub-second (latencies):
 * "250µs", "12ms", "1.5s", "2.5m", "1.2h".
 */
export function formatMetricSeconds(seconds: number): string {
  if (seconds === 0) return '0s';
  if (seconds < 0.001) return `${(seconds * 1_000_000).toFixed(0)}µs`;
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** A whole-unit Prometheus range string for a number of seconds: 30s, 5m, 2h, 2d, 2w. */
export function formatPromRange(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
}

/**
 * Bytes in Kubernetes quantity units, as resource tables show them:
 * "512", "4 Ki", "128 Mi", "1.5 Gi", "2.0 Ti".
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} Ti`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} Gi`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} Mi`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} Ki`;
  return `${bytes}`;
}

/**
 * Bytes with IEC unit names and three significant figures, as metric charts
 * show them: "0 B", "512 B", "1.50 KiB", "12.3 MiB", "256 GiB".
 */
export function formatBytesIEC(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  if (value >= 100) return `${value.toFixed(0)} ${sizes[i]}`;
  if (value >= 10) return `${value.toFixed(1)} ${sizes[i]}`;
  return `${value.toFixed(2)} ${sizes[i]}`;
}

/** Date and time in the fixed locale: "Oct 30, 2026, 2:05:09 PM". */
export function formatTimestamp(input: TimeInput, fallback = '—', options?: Intl.DateTimeFormatOptions): string {
  const ms = toEpochMs(input);
  if (ms === null) return fallback;
  return new Date(ms).toLocaleString(FORMAT_LOCALE, options ?? { dateStyle: 'medium', timeStyle: 'medium' });
}

/** Date only in the fixed locale: "Oct 30, 2026". */
export function formatDate(input: TimeInput, fallback = '—'): string {
  const ms = toEpochMs(input);
  if (ms === null) return fallback;
  return new Date(ms).toLocaleDateString(FORMAT_LOCALE, { dateStyle: 'medium' });
}

/** Time only in the fixed locale: "2:05:09 PM". */
export function formatTime(input: TimeInput, fallback = '—'): string {
  const ms = toEpochMs(input);
  if (ms === null) return fallback;
  return new Date(ms).toLocaleTimeString(FORMAT_LOCALE);
}

/** Group key for a date: "Today", "Yesterday", or "October 28, 2026". */
export function getDateKey(date: Date, now: Date = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const eventDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (eventDate.getTime() === today.getTime()) return 'Today';
  if (eventDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString(FORMAT_LOCALE, { month: 'long', day: 'numeric', year: 'numeric' });
}
