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
