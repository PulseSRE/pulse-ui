/**
 * MetricsChart - Interactive SVG chart component for time-series metrics
 *
 * Features:
 * - Pure SVG rendering (no chart library dependencies)
 * - Multiple series support (line and area)
 * - Threshold lines (e.g., resource requests/limits)
 * - Hover tooltips with cross-chart synchronization
 * - Time range brush selection
 * - Responsive width
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';

export interface DataPoint {
  timestamp: number;  // unix timestamp in seconds
  value: number;
}

export interface ChartSeries {
  id: string;
  label: string;
  data: DataPoint[];
  color: string;      // tailwind color or hex
  type?: 'line' | 'area';
  dashed?: boolean;
}

export interface MetricsChartProps {
  series: ChartSeries[];
  height?: number;          // default 200
  timeRange?: [number, number];  // [start, end] unix timestamps
  yAxisLabel?: string;
  yAxisFormat?: (value: number) => string;  // e.g., formatBytes, formatPercent
  showLegend?: boolean;
  thresholds?: Array<{ value: number; label: string; color: string }>;  // horizontal threshold lines
  onTimeRangeSelect?: (start: number, end: number) => void;  // drag-select time range
  onHover?: (timestamp: number | null) => void;  // for cross-chart synchronization
  hoverTimestamp?: number | null;  // externally controlled hover line
}

import { CHART_COLOR_SEQUENCE } from '../../engine/colors';

const _DEFAULT_COLORS = CHART_COLOR_SEQUENCE;

export function MetricsChart({
  series,
  height = 200,
  timeRange,
  yAxisLabel,
  yAxisFormat = (v) => v.toFixed(2),
  showLegend = true,
  thresholds = [],
  onTimeRangeSelect,
  onHover,
  hoverTimestamp,
}: MetricsChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(containerRef.current);
    setContainerWidth(containerRef.current.clientWidth);

    return () => observer.disconnect();
  }, []);

  // Calculate data bounds
  const { minTime, maxTime, minValue, maxValue } = useMemo(() => {
    let minT = Infinity, maxT = -Infinity;
    let minV = Infinity, maxV = -Infinity;

    // Use provided time range or calculate from data
    if (timeRange) {
      minT = timeRange[0];
      maxT = timeRange[1];
    } else {
      for (const s of series) {
        for (const d of s.data) {
          if (d.timestamp < minT) minT = d.timestamp;
          if (d.timestamp > maxT) maxT = d.timestamp;
        }
      }
    }

    // Calculate value range
    for (const s of series) {
      for (const d of s.data) {
        if (d.value < minV) minV = d.value;
        if (d.value > maxV) maxV = d.value;
      }
    }

    // Include thresholds in value range
    for (const t of thresholds) {
      if (t.value < minV) minV = t.value;
      if (t.value > maxV) maxV = t.value;
    }

    // Add padding to value range
    const valueRange = maxV - minV;
    const padding = valueRange * 0.1;
    minV = Math.max(0, minV - padding);
    maxV = maxV + padding;

    // Handle edge cases
    if (!isFinite(minT) || !isFinite(maxT)) {
      minT = Date.now() / 1000 - 3600;
      maxT = Date.now() / 1000;
    }
    if (!isFinite(minV) || !isFinite(maxV) || minV === maxV) {
      minV = 0;
      maxV = 1;
    }

    return { minTime: minT, maxTime: maxT, minValue: minV, maxValue: maxV };
  }, [series, timeRange, thresholds]);

  // Chart dimensions
  const padding = { top: 10, right: 10, bottom: 30, left: 60 };
  const chartWidth = containerWidth - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scale functions
  const xScale = (timestamp: number): number => {
    return padding.left + ((timestamp - minTime) / (maxTime - minTime)) * chartWidth;
  };

  const yScale = (value: number): number => {
    return padding.top + chartHeight - ((value - minValue) / (maxValue - minValue)) * chartHeight;
  };

  // Inverse scale for mouse position to timestamp
  const xScaleInverse = (x: number): number => {
    return minTime + ((x - padding.left) / chartWidth) * (maxTime - minTime);
  };

  // Build SVG path for a series
  const buildPath = (data: DataPoint[], type: 'line' | 'area' = 'line'): string => {
    if (data.length === 0) return '';

    const points = data.map((d) => ({ x: xScale(d.timestamp), y: yScale(d.value) }));

    if (type === 'area') {
      const bottom = yScale(minValue);
      const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      return `${path} L ${points[points.length - 1].x} ${bottom} L ${points[0].x} ${bottom} Z`;
    }

    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  };

  // Format time labels
  const formatTimeLabel = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const range = maxTime - minTime;

    if (range < 3600) {
      // Less than 1 hour: show minutes
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (range < 86400) {
      // Less than 1 day: show hours:minutes
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      // More than 1 day: show month/day
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // Generate Y-axis ticks
  const yTicks = useMemo(() => {
    const tickCount = 5;
    const ticks: number[] = [];
    const step = (maxValue - minValue) / (tickCount - 1);

    for (let i = 0; i < tickCount; i++) {
      ticks.push(minValue + step * i);
    }

    return ticks;
  }, [minValue, maxValue]);

  // Generate X-axis ticks
  const xTicks = useMemo(() => {
    const tickCount = Math.min(6, Math.floor(chartWidth / 80));
    const ticks: number[] = [];
    const step = (maxTime - minTime) / (tickCount - 1);

    for (let i = 0; i < tickCount; i++) {
      ticks.push(minTime + step * i);
    }

    return ticks;
  }, [minTime, maxTime, chartWidth]);

  // Mouse event handlers
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const timestamp = xScaleInverse(x);

    if (timestamp >= minTime && timestamp <= maxTime) {
      setHoveredTime(timestamp);
      onHover?.(timestamp);
    }
  };

  const handleMouseLeave = () => {
    setHoveredTime(null);
    onHover?.(null);
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onTimeRangeSelect) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const timestamp = xScaleInverse(x);
    setBrushStart(timestamp);
    setBrushEnd(timestamp);
  };

  const handleMouseUp = () => {
    if (brushStart !== null && brushEnd !== null && onTimeRangeSelect) {
      const start = Math.min(brushStart, brushEnd);
      const end = Math.max(brushStart, brushEnd);
      if (end - start > 60) { // Minimum 1 minute selection
        onTimeRangeSelect(start, end);
      }
    }
    setBrushStart(null);
    setBrushEnd(null);
  };

  const handleBrushMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (brushStart === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const timestamp = xScaleInverse(x);
    setBrushEnd(timestamp);
  };

  // Use external hover timestamp if provided
  const effectiveHoverTime = hoverTimestamp ?? hoveredTime;

  // Find values at hover time for tooltip
  const tooltipData = useMemo(() => {
    if (effectiveHoverTime === null) return null;

    const values: Array<{ label: string; value: string; color: string }> = [];

    for (const s of series) {
      // Find closest data point
      let closest = s.data[0];
      let minDiff = Infinity;

      for (const d of s.data) {
        const diff = Math.abs(d.timestamp - effectiveHoverTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = d;
        }
      }

      if (closest && minDiff < (maxTime - minTime) / 100) {
        values.push({
          label: s.label,
          value: yAxisFormat(closest.value),
          color: s.color,
        });
      }
    }

    return values.length > 0 ? values : null;
  }, [effectiveHoverTime, series, maxTime, minTime, yAxisFormat]);

  return (
    <div ref={containerRef} className="w-full">
      <svg
        width={containerWidth}
        height={height}
        className="select-none"
        onMouseMove={brushStart !== null ? handleBrushMove : handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        {/* Y-axis grid lines */}
        {yTicks.map((tick, i) => (
          <line
            key={`y-grid-${i}`}
            x1={padding.left}
            y1={yScale(tick)}
            x2={padding.left + chartWidth}
            y2={yScale(tick)}
            className="stroke-slate-700 stroke-opacity-20"
            strokeWidth="1"
          />
        ))}

        {/* X-axis grid lines */}
        {xTicks.map((tick, i) => (
          <line
            key={`x-grid-${i}`}
            x1={xScale(tick)}
            y1={padding.top}
            x2={xScale(tick)}
            y2={padding.top + chartHeight}
            className="stroke-slate-700 stroke-opacity-20"
            strokeWidth="1"
          />
        ))}

        {/* Threshold lines */}
        {thresholds.map((threshold, i) => (
          <g key={`threshold-${i}`}>
            <line
              x1={padding.left}
              y1={yScale(threshold.value)}
              x2={padding.left + chartWidth}
              y2={yScale(threshold.value)}
              stroke={threshold.color}
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
            <text
              x={padding.left + chartWidth - 4}
              y={yScale(threshold.value) - 4}
              className="text-xs fill-slate-400"
              textAnchor="end"
            >
              {threshold.label}
            </text>
          </g>
        ))}

        {/* Data series */}
        {series.map((s, _i) => (
          <g key={s.id}>
            {s.type === 'area' && (
              <path
                d={buildPath(s.data, 'area')}
                fill={s.color}
                fillOpacity={0.2}
              />
            )}
            <path
              d={buildPath(s.data, 'line')}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeDasharray={s.dashed ? '4 4' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}

        {/* Hover cursor line */}
        {effectiveHoverTime !== null && (
          <line
            x1={xScale(effectiveHoverTime)}
            y1={padding.top}
            x2={xScale(effectiveHoverTime)}
            y2={padding.top + chartHeight}
            className="stroke-slate-400 stroke-opacity-50"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        )}

        {/* Brush selection */}
        {brushStart !== null && brushEnd !== null && (
          <rect
            x={Math.min(xScale(brushStart), xScale(brushEnd))}
            y={padding.top}
            width={Math.abs(xScale(brushEnd) - xScale(brushStart))}
            height={chartHeight}
            className="fill-blue-500 fill-opacity-20 stroke-blue-500"
            strokeWidth="1"
          />
        )}

        {/* Y-axis labels */}
        {yTicks.map((tick, i) => (
          <text
            key={`y-label-${i}`}
            x={padding.left - 8}
            y={yScale(tick)}
            className="text-xs fill-slate-400"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {yAxisFormat(tick)}
          </text>
        ))}

        {/* X-axis labels */}
        {xTicks.map((tick, i) => (
          <text
            key={`x-label-${i}`}
            x={xScale(tick)}
            y={padding.top + chartHeight + 20}
            className="text-xs fill-slate-400"
            textAnchor="middle"
          >
            {formatTimeLabel(tick)}
          </text>
        ))}

        {/* Y-axis title */}
        {yAxisLabel && (
          <text
            x={12}
            y={padding.top + chartHeight / 2}
            className="text-xs fill-slate-400"
            textAnchor="middle"
            transform={`rotate(-90, 12, ${padding.top + chartHeight / 2})`}
          >
            {yAxisLabel}
          </text>
        )}

        {/* Transparent overlay for mouse tracking */}
        <rect
          x={padding.left}
          y={padding.top}
          width={chartWidth}
          height={chartHeight}
          fill="transparent"
        />
      </svg>

      {/* Hover tooltip */}
      {tooltipData && effectiveHoverTime !== null && (
        <div
          className="absolute bg-slate-800 text-white text-xs rounded px-2 py-1.5 shadow-lg pointer-events-none z-10"
          style={{
            left: Math.min(xScale(effectiveHoverTime) + 10, containerWidth - 150),
            top: padding.top + 10,
          }}
        >
          <div className="font-medium mb-1">{formatTimeLabel(effectiveHoverTime)}</div>
          {tooltipData.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: d.color }}
              />
              <span className="text-slate-300">{d.label}:</span>
              <span className="font-mono">{d.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {showLegend && series.length > 0 && (
        <div className="flex flex-wrap gap-4 mt-2 text-xs">
          {series.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5">
              <div
                className="w-3 h-0.5 rounded"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-slate-400">{s.label}</span>
            </div>
          ))}
          {thresholds.map((t, i) => (
            <div key={`legend-threshold-${i}`} className="flex items-center gap-1.5">
              <div
                className="w-3 h-0.5 rounded border-dashed"
                style={{ borderColor: t.color, borderTopWidth: 1 }}
              />
              <span className="text-slate-400">{t.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
