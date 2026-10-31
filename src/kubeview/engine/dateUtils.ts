/**
 * @deprecated Import from `engine/format` instead. Kept so existing imports
 * keep working; each name here is a thin wrapper over the single formatter.
 */
import { formatDurationBetween, formatRelative } from './format';

export { getDateKey, formatShortDuration, formatElapsed } from './format';

/** @deprecated Use `formatDurationBetween` from `engine/format`. */
export function formatDuration(start: string, end?: string): string {
  return formatDurationBetween(start, end);
}

/** @deprecated Use `formatRelative` from `engine/format`. */
export function timeAgo(ts: string): string {
  return formatRelative(ts);
}

/**
 * @deprecated Use `formatRelative` from `engine/format` (this returns "… ago";
 * `engine/format`'s `formatAge` is the bare table age).
 */
export function formatAge(date: Date): string {
  return formatRelative(date);
}
