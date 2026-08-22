/** Shared formatting utilities. */

export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  // This also absorbs a negative. The timestamp comes from the agent and the
  // comparison from the browser — two machines, two clocks — and a beat of
  // skew rendered "Last scan: -1s ago" on the landing page. A separate
  // Math.max(0, …) would be dead code: this branch already covers it, which a
  // mutation test proved by passing with the clamp removed.
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

