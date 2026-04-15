/**
 * Sparkline — Minimal inline chart for time-series data.
 * Pure SVG, no dependencies.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { queryRange, getTimeRange } from './prometheus';
import { safeQuery } from '../../engine/safeQuery';

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
  const { data: series = [] } = useQuery({
    queryKey: ['sparkline', query, duration],
    queryFn: async () => {
      const [start, end] = getTimeRange(duration);
      return (await safeQuery(() => queryRange(query, start, end))) ?? [];
    },
    refetchInterval: refreshInterval,
    staleTime: 30000,
  });

  const values = series[0]?.values?.map(([, v]) => parseFloat(v)) || [];

  if (values.length < 2) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {label && <span className="text-xs text-slate-500">{label}</span>}
        <div className="text-xs text-slate-600" style={{ width, height }}>
          <span className="flex items-center justify-center h-full">No data</span>
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
      {label && <span className="text-xs text-slate-500 w-12 shrink-0">{label}</span>}
      <svg width={width} height={height} className="shrink-0">
        <path d={areaPath} fill={fill} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {/* Current value dot */}
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={2} fill={color} />
      </svg>
      <span className="text-xs font-mono text-slate-300 w-14 text-right shrink-0">
        {current.toFixed(1)}{unit}
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
  thresholds?: { warning: number; critical: number };
  onClick?: () => void;
}) {
  const { data: series = [] } = useQuery({
    queryKey: ['metric-card', query, duration],
    queryFn: async () => {
      const [start, end] = getTimeRange(duration);
      return (await safeQuery(() => queryRange(query, start, end))) ?? [];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const values = series[0]?.values?.map(([, v]) => parseFloat(v)) || [];
  const current = values.length > 0 ? values[values.length - 1] : null;
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const range = max - min || 1;
  const w = 200;
  const h = 48;
  const padding = 2;

  // Determine color based on thresholds
  let displayColor = color;
  if (current !== null && thresholds) {
    if (current >= thresholds.critical) displayColor = '#ef4444';
    else if (current >= thresholds.warning) displayColor = '#f59e0b';
  }

  const points = values.map((v, i) => {
    const x = padding + (i / Math.max(values.length - 1, 1)) * (w - padding * 2);
    const y = padding + (1 - (v - min) / range) * (h - padding * 2);
    return { x, y };
  });

  const linePath = points.length >= 2
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    : '';

  return (
    <div className={cn('bg-slate-900 rounded-lg border border-slate-800 p-3', onClick && 'cursor-pointer hover:border-slate-600 transition-colors')} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400">{title}</span>
        <span className="text-sm font-mono font-bold" style={{ color: displayColor }}>
          {current !== null ? `${current.toFixed(1)}${unit}` : '—'}
        </span>
      </div>
      {linePath ? (
        <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <path d={`${linePath} L${points[points.length - 1].x},${h} L${points[0].x},${h} Z`} fill={`${displayColor}15`} />
          <path d={linePath} fill="none" stroke={displayColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <div className="flex items-center justify-center text-xs text-slate-600" style={{ height: h }}>No data</div>
      )}
    </div>
  );
}
