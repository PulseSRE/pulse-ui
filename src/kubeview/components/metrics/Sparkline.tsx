/**
 * Sparkline — Minimal inline chart for time-series data.
 * Pure SVG, no dependencies.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { queryRange, queryInstant, getTimeRange, metricsAvailableFor } from './prometheus';
import { LoadError } from '../primitives/LoadError';
import { describeReadError } from '../../engine/readError';
import { useInMetricsScope, useReportMetricFailure } from './MetricsScope';
import { compareToUsual, formatMetricValue, thresholdColor, thresholdLevel, usualQuery, type Thresholds } from './metricFormat';
import { useReportAttention } from '../agent/attention';
import { useActiveClusterId } from '../../hooks/useClusterBase';

interface SparklineProps {
  query: string;
  duration?: string;    // e.g., "1h", "6h", "24h"
  color?: string;       // stroke color, e.g., "#3b82f6"
  fillColor?: string;   // area fill, e.g., "#3b82f620"
  height?: number;
  width?: number;
  label?: string;
  unit?: string;        // e.g., "%", "MB"
  className?: string;
  refreshInterval?: number;
}

export function Sparkline({
  query,
  duration = '1h',
  color = '#3b82f6',
  fillColor,
  height = 40,
  width = 160,
  label,
  unit = '',
  className = '',
  refreshInterval = 60000,
}: SparklineProps) {
  const clusterId = useActiveClusterId();
  // A failed read throws (PrometheusReadError) so it shows as an error, never as "No data".
  const { data: series = [], isPending, isError, error, refetch } = useQuery({
    queryKey: ['sparkline', query, duration, clusterId],
    queryFn: ({ signal }) => {
      const [start, end] = getTimeRange(duration);
      return queryRange(query, start, end, undefined, clusterId, signal);
    },
    enabled: metricsAvailableFor(clusterId),
    refetchInterval: refreshInterval,
    staleTime: 30000,
  });

  // Prometheus can legitimately return "NaN"/"+Inf"/"-Inf" samples (e.g. a
  // rate() or division query with no data at that instant) — parseFloat
  // passes those straight through as non-finite numbers, and a single one
  // anywhere in the series poisons Math.min/Math.max for the whole array,
  // producing a `NaN` SVG path ("M2,NaN L2.98,NaN ...") that fails to render.
  // Drop non-finite samples so the line just has a small gap instead.
  // After a failed refetch the last series is stale: an error wins over it.
  const values = isError ? [] : (series[0]?.values?.map(([, v]) => parseFloat(v)) || []).filter(Number.isFinite);

  const available = metricsAvailableFor(clusterId);
  const inScope = useInMetricsScope();
  useReportMetricFailure(available && isError, error, refetch);
  if (available && isError) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {label && <span className="text-xs text-faint">{label}</span>}
        {inScope ? (
          // The scope's banner says why, once for the page.
          <span className="text-xs text-slate-400" style={{ width, height }} title={describeReadError(error).reason}>—</span>
        ) : (
          <LoadError compact title="Could not load metrics" error={error} onRetry={() => { void refetch(); }} className="min-w-0 flex-1" />
        )}
      </div>
    );
  }

  if (values.length < 2) {
    const text = !available ? 'Local cluster only' : isPending ? 'Checking…' : 'No data for this period';
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {label && <span className="text-xs text-faint">{label}</span>}
        <div className="text-xs text-slate-400" style={{ width, height }}>
          <span className="flex items-center justify-center h-full">{text}</span>
        </div>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const current = values[values.length - 1];
  const padding = 2;

  // Build SVG path
  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (v - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${height} L${points[0].x},${height} Z`;
  const fill = fillColor || `${color}15`;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {label && <span className="text-xs text-faint w-12 shrink-0">{label}</span>}
      <svg width={width} height={height} className="shrink-0">
        <path d={areaPath} fill={fill} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {/* Current value dot */}
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={2} fill={color} />
      </svg>
      <span className="text-xs font-mono text-slate-300 w-14 text-right shrink-0">
        {formatMetricValue(current)}{unit}
      </span>
    </div>
  );
}

/**
 * MetricCard — Sparkline with a label, current value, and card styling.
 */
export function MetricCard({
  title,
  query,
  unit = '%',
  color = '#3b82f6',
  duration = '1h',
  thresholds,
  onClick,
}: {
  title: string;
  query: string;
  unit?: string;
  color?: string;
  duration?: string;
  thresholds?: Thresholds;
  onClick?: () => void;
}) {
  const clusterId = useActiveClusterId();
  const available = metricsAvailableFor(clusterId);
  // Throws on a failed read so the card says so, instead of an empty "No data".
  const { data: series = [], isPending, isError, error, refetch } = useQuery({
    queryKey: ['metric-card', query, duration, clusterId],
    queryFn: ({ signal }) => {
      const [start, end] = getTimeRange(duration);
      return queryRange(query, start, end, undefined, clusterId, signal);
    },
    enabled: metricsAvailableFor(clusterId),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // See the matching comment in Sparkline above: filter out non-finite
  // Prometheus samples before they poison min/max and produce a NaN path.
  // After a failed refetch the last series is stale: an error wins over it.
  const values = isError ? [] : (series[0]?.values?.map(([, v]) => parseFloat(v)) || []).filter(Number.isFinite);
  const current = values.length > 0 ? values[values.length - 1] : null;
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const range = max - min || 1;
  const w = 200;
  const h = 56;
  const padding = 2;

  // What this query usually reads (its median over the last day), so the card
  // can say "2.1× usual" instead of leaving the reader to remember normal.
  // Single-series cards only: for several series "usual" has no one meaning.
  const singleSeries = !isError && series.length === 1;
  const { data: usual } = useQuery({
    queryKey: ['metric-card-usual', query, clusterId],
    queryFn: async ({ signal }) => {
      // Context only: if this fails the card just has no "× usual" line.
      const rows = await queryInstant(usualQuery(query), undefined, clusterId, signal);
      return rows.length === 1 ? rows[0].value : null;
    },
    enabled: Boolean(query) && singleSeries && available && !isError,
    refetchInterval: 300000,
    retry: false,
    staleTime: 300000,
  });
  const vsUsual = singleSeries ? compareToUsual(current, usual, thresholds) : null;
  const failed = available && isError;
  const inScope = useInMetricsScope();
  useReportMetricFailure(failed, error, refetch);

  const displayColor = thresholdColor(current, thresholds) ?? color;
  // On a dashboard, a card past its threshold is listed in the view's attention strip.
  useReportAttention(
    `metric-card:${title}:${query}`,
    title,
    thresholdLevel(current, thresholds),
    current !== null ? `${formatMetricValue(current)}${unit}` : undefined,
  );

  const points = values.map((v, i) => {
    const x = padding + (i / Math.max(values.length - 1, 1)) * (w - padding * 2);
    const y = padding + (1 - (v - min) / range) * (h - padding * 2);
    return { x, y };
  });

  const linePath = points.length >= 2
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    : '';

  const trendArrow = values.length >= 4 && current !== null
    ? (() => { const d = current - values[Math.floor(values.length / 2)]; return Math.abs(d) >= 0.5 ? (d > 0 ? '▲' : '▼') : null; })()
    : null;

  return (
    // The card holds no controls of its own (a failure's Retry is on the
    // MetricsScope banner), so it can be one keyboard-reachable button.
    <div
      className={cn('bg-slate-900 rounded-lg border border-slate-800 p-3', onClick && 'cursor-pointer hover:border-slate-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500')}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400">{title}</span>
        <span className="text-sm font-mono font-bold flex items-center gap-1" style={{ color: displayColor }}>
          {current !== null ? `${formatMetricValue(current)}${unit}` : '—'}
          {trendArrow && <span className="text-[10px]">{trendArrow}</span>}
        </span>
      </div>
      {vsUsual && vsUsual.label !== 'usual' && (
        <div
          className={cn(
            '-mt-1.5 mb-1 text-right text-[10px]',
            vsUsual.tone === 'worse' ? 'text-amber-400' : vsUsual.tone === 'better' ? 'text-emerald-400' : 'text-slate-400',
          )}
          title={`Usual: ${formatMetricValue(vsUsual.usual)}${unit} (median over the last 24 hours)`}
        >
          {vsUsual.label}
        </div>
      )}
      {failed ? (
        // Quiet "unknown": no red box, no Retry inside the card. In a scope the
        // banner gives the reason once; on its own the card says it here.
        <div className="flex items-center justify-center text-center text-xs text-slate-400" style={{ height: h }} title={describeReadError(error).reason}>
          {inScope ? 'Could not load metrics' : `Could not load metrics: ${describeReadError(error).reason}`}
        </div>
      ) : linePath ? (
        <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <path d={`${linePath} L${points[points.length - 1].x},${h} L${points[0].x},${h} Z`} fill={`${displayColor}15`} />
          <path d={linePath} fill="none" stroke={displayColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <div className="flex items-center justify-center text-xs text-slate-400" style={{ height: h }}>
          {!available ? 'Metrics are available for the local cluster only' : isPending ? 'Checking…' : 'No data for this period'}
        </div>
      )}
    </div>
  );
}
