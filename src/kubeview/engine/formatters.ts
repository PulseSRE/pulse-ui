/**
 * @deprecated Import from `engine/format` instead. Kept so existing imports
 * keep working; each name here is a thin wrapper over the single formatter.
 */
import { formatRelative } from './format';

/** @deprecated Use `formatRelative` from `engine/format`. */
export function formatRelativeTime(timestamp: number): string {
  return formatRelative(timestamp);
}
