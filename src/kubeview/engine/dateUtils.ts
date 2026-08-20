/** Shared date/time formatting utilities */

/** Format a Date as a human-readable date group key (Today, Yesterday, or full date). */
export function getDateKey(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const eventDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (eventDate.getTime() === today.getTime()) return 'Today';
  if (eventDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Format a duration between two ISO timestamps (or from start to now) */
export function formatDuration(start: string, end?: string): string {
  if (!start) return '—';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const diff = Math.max(0, endMs - startMs);
  if (diff < 1000) return '<1s';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

/** Format a timestamp as relative time (e.g., "5m ago", "2d ago") */
export function timeAgo(ts: string): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days > 365) return `${Math.floor(days / 365)}y ago`;
  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  return `${days}d ago`;
}

/** Format a Date as relative age (e.g., "5d ago", "2mo ago") */
export function formatAge(date: Date): string {
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 365) return `${Math.floor(days / 365)}y ago`;
  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days > 0) return `${days}d ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs > 0) return `${hrs}h ago`;
  const mins = Math.floor(diff / 60000);
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}

/**
 * A span of seconds as the coarsest unit that still reads precisely: 45s, 12m,
 * 3h, 2d.
 *
 * Deliberately not named formatDuration — that already exists above and takes
 * two ISO strings, returning compound units like "5m 30s". This takes a number
 * of seconds and returns one unit, for places where the span is a label rather
 * than a measurement ("every 2h", "−7m").
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

/**
 * How long ago a unix-seconds timestamp was, as a bare span with no "ago".
 *
 * Not formatAge — that takes a Date and appends "ago". This is for phrasing
 * that supplies its own preposition, like "running 30m".
 */
export function formatElapsed(startedAtSeconds: number): string {
  return formatShortDuration(Date.now() / 1000 - startedAtSeconds);
}
