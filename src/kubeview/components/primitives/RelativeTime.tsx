import { formatRelative, formatTimestamp, toIsoString, type TimeInput } from '../../engine/format';

/**
 * "5m ago", with the full date and time on hover and in the `<time>` element,
 * so a relative time never hides when something actually happened.
 */
export function RelativeTime({ value, fallback = '—', className }: { value: TimeInput; fallback?: string; className?: string }) {
  const iso = toIsoString(value);
  if (!iso) return <span className={className}>{fallback}</span>;
  return (
    <time dateTime={iso} title={formatTimestamp(value)} className={className}>
      {formatRelative(value)}
    </time>
  );
}
