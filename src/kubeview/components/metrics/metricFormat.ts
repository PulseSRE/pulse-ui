/**
 * Shared value formatting and threshold coloring for metric cards and sparklines.
 */

export const THRESHOLD_COLORS = { warning: '#f59e0b', critical: '#ef4444' } as const;

/**
 * A number as a person would write it on a dashboard.
 *
 * Counts read as counts ("4 nodes", not "4.0"), small rates keep their
 * significant digits (0.0013/s instead of "0.0", which hid a crash loop), and
 * everything else gets at most one decimal.
 */
export function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (Math.abs(value - Math.round(value)) < 1e-9) {
    return abs >= 1e4 ? Math.round(value).toLocaleString('en-US') : String(Math.round(value));
  }
  if (abs < 1) return String(Number(value.toPrecision(2)));
  if (abs < 10) return String(Number(value.toFixed(2)));
  if (abs < 1e4) return String(Number(value.toFixed(1)));
  return Math.round(value).toLocaleString('en-US');
}

export interface Thresholds {
  warning: number;
  critical: number;
}

/**
 * Which threshold a value has crossed, if any.
 *
 * Direction comes from the thresholds themselves: `critical` above `warning`
 * means higher is worse (CPU %, error rate); `critical` below `warning` means
 * lower is worse (nodes ready, available replicas). Treating every threshold
 * as higher-is-worse painted a healthy "Nodes Ready 4" red against
 * `{ warning: 2, critical: 1 }`.
 */
export function thresholdLevel(value: number | null, thresholds?: Thresholds): 'warning' | 'critical' | null {
  if (value === null || !thresholds || !Number.isFinite(value)) return null;
  const { warning, critical } = thresholds;
  if (critical < warning) {
    if (value <= critical) return 'critical';
    if (value <= warning) return 'warning';
    return null;
  }
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return null;
}

export function thresholdColor(value: number | null, thresholds?: Thresholds): string | null {
  const level = thresholdLevel(value, thresholds);
  return level ? THRESHOLD_COLORS[level] : null;
}

/** "higher" when a bigger value is worse (CPU %), "lower" when smaller is worse (ready nodes). */
export function worseDirection(thresholds?: Thresholds): 'higher' | 'lower' | null {
  if (!thresholds) return null;
  return thresholds.critical < thresholds.warning ? 'lower' : 'higher';
}

/**
 * PromQL for what a query usually reads: its median over the last day.
 *
 * Computed live from the query itself, so it needs no stored baseline and
 * follows the query when the card is edited.
 */
export function usualQuery(query: string): string {
  return `quantile_over_time(0.5, (${query})[24h:10m])`;
}

export interface UsualComparison {
  /** "2.1× usual", or "usual" when within the normal band. */
  label: string;
  /** worse / better when thresholds give a direction, otherwise neutral. */
  tone: 'worse' | 'better' | 'neutral';
  usual: number;
}

/**
 * Today's value against the usual one, in words.
 *
 * Within half again either way it reads "usual". A usual value of zero (or
 * no history) cannot be compared as a ratio, so nothing is said rather than
 * "∞× usual".
 */
export function compareToUsual(
  current: number | null,
  usual: number | null | undefined,
  thresholds?: Thresholds,
): UsualComparison | null {
  if (current === null || usual === null || usual === undefined) return null;
  if (!Number.isFinite(current) || !Number.isFinite(usual) || Math.abs(usual) < 1e-12) return null;
  const ratio = current / usual;
  if (!Number.isFinite(ratio) || ratio < 0) return null;
  if (ratio < 1.5 && ratio > 1 / 1.5) return { label: 'usual', tone: 'neutral', usual };
  const label = `${ratio >= 10 ? Math.round(ratio) : Number(ratio.toFixed(1))}× usual`;
  const direction = worseDirection(thresholds);
  if (!direction) return { label, tone: 'neutral', usual };
  const worse = direction === 'higher' ? ratio > 1 : ratio < 1;
  return { label, tone: worse ? 'worse' : 'better', usual };
}

/** True when there is data and every sample of every series is exactly zero. */
export function isFlatZero(series: ReadonlyArray<{ data?: ReadonlyArray<readonly [number, number]> }>): boolean {
  let points = 0;
  for (const s of series) {
    for (const [, v] of s.data || []) {
      if (!Number.isFinite(v)) continue;
      if (v !== 0) return false;
      points += 1;
    }
  }
  return points > 0;
}
