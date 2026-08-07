/**
 * Visualization component renderers: chart (lazy), metric_card, bar_list,
 * progress_list, stat_card, timeline, resource_counts, node_map (lazy), topology (lazy).
 *
 * Also includes log_viewer and yaml_viewer since they are view-only.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '../../../engine/formatters';
import { MetricCard as SparklineMetricCard } from '../../metrics/Sparkline';
import type {
  ComponentSpec,
  ChartSpec,
  NodeMapSpec,
  TopologySpec,
  MetricCardSpec,
  BarListSpec,
  ProgressListSpec,
  StatCardSpec,
  TimelineSpec,
  ResourceCountsSpec,
  LogViewerSpec,
  YamlViewerSpec,
} from '../../../engine/agentComponents';

// Lazy-loaded components
const LazyAgentChart = lazy(() => import('../AgentChart'));
const LazyAgentNodeMap = lazy(() => import('../AgentNodeMap').then(m => ({ default: m.AgentNodeMap })));
const LazyAgentTopology = lazy(() => import('../AgentTopology'));

// ---------------------------------------------------------------------------
// Lazy wrappers (used by dispatcher)
// ---------------------------------------------------------------------------

export function ChartSuspense({ spec, onAddToView, refreshInterval, globalTimeRange, hoverTimestamp, onHoverTimestamp, onSpecChange }: {
  spec: ChartSpec;
  onAddToView?: (spec: ComponentSpec) => void;
  refreshInterval?: number;
  globalTimeRange?: string;
  hoverTimestamp?: number | null;
  onHoverTimestamp?: (ts: number | null) => void;
  onSpecChange?: (spec: ComponentSpec) => void;
}) {
  return (
    <Suspense fallback={<div className="h-48 flex items-center justify-center text-slate-500 text-xs">Loading chart...</div>}>
      <LazyAgentChart spec={spec} onAddToView={onAddToView} refreshInterval={refreshInterval} globalTimeRange={globalTimeRange} hoverTimestamp={hoverTimestamp} onHoverTimestamp={onHoverTimestamp} onSpecChange={onSpecChange} />
    </Suspense>
  );
}

export function NodeMapSuspense({ spec }: { spec: NodeMapSpec }) {
  return (
    <Suspense fallback={<div className="h-48 flex items-center justify-center text-slate-500 text-xs">Loading node map...</div>}>
      <LazyAgentNodeMap spec={spec} />
    </Suspense>
  );
}

export function TopologySuspense({ spec, onAddToView }: { spec: TopologySpec; onAddToView?: (spec: ComponentSpec) => void }) {
  return (
    <Suspense fallback={<div className="h-48 flex items-center justify-center text-slate-500 text-xs">Loading topology...</div>}>
      <LazyAgentTopology spec={spec} onAddToView={onAddToView} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Metric Card
// ---------------------------------------------------------------------------

const METRIC_STATUS_COLORS: Record<string, string> = {
  healthy: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
};
const METRIC_STATUS_BORDER: Record<string, string> = {
  healthy: 'border-emerald-800',
  warning: 'border-amber-800',
  error: 'border-red-800',
};

export function AgentMetricCard({ spec }: { spec: MetricCardSpec }) {
  const navigate = useNavigate();
  const color = spec.color || METRIC_STATUS_COLORS[spec.status || ''] || '#3b82f6';
  const clickable = !!spec.link;

  const handleClick = () => {
    if (spec.link) navigate(spec.link);
  };

  // If a PromQL query is provided, render the sparkline MetricCard
  if (spec.query) {
    const card = (
      <SparklineMetricCard
        title={spec.title}
        query={spec.query}
        unit={spec.unit || ''}
        color={color}
        thresholds={spec.thresholds}
      />
    );
    if (clickable) {
      return (
        <button onClick={handleClick} className="w-full h-full text-left hover:ring-1 hover:ring-blue-500/50 rounded-lg transition-all">
          {card}
        </button>
      );
    }
    return card;
  }

  // Static metric card (no query — just value + optional sparkline data)
  const Tag = clickable ? 'button' : 'div';
  return (
    <Tag
      onClick={clickable ? handleClick : undefined}
      className={cn(
        'bg-linear-to-br from-slate-900 to-slate-900/70 rounded-lg border p-3 transition-all duration-200 hover:shadow-[0_0_12px_rgba(37,99,235,0.08)] h-full',
        METRIC_STATUS_BORDER[spec.status || ''] || 'border-slate-800',
        clickable && 'cursor-pointer hover:ring-1 hover:ring-blue-500/50 w-full text-left',
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-400">{spec.title}</span>
        <span className="text-sm font-mono font-bold" style={{ color }}>
          {spec.value}{spec.unit ? spec.unit : ''}
        </span>
      </div>
      {spec.description && <div className="text-xs text-slate-500">{spec.description}</div>}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Bar List
// ---------------------------------------------------------------------------

/** Horizontal ranked bar chart — like "Top Tools" */
export function AgentBarList({ spec }: { spec: BarListSpec }) {
  const maxItems = spec.maxItems ?? 10;
  const items = (spec.items || []).slice(0, maxItems);
  const maxValue = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0" role="figure" aria-label={spec.title || 'Ranked bar chart'}>
      {spec.title && (
        <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700 text-xs font-medium text-slate-300">
          <span>{spec.title}</span>
          {spec.description && <span className="text-[10px] text-slate-500 ml-2">{spec.description}</span>}
        </div>
      )}
      <div className="p-3 space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {item.href || item.gvr ? (
              <a
                href={item.href || `#/resource/${item.gvr}`}
                className="w-40 min-w-[100px] truncate font-mono text-slate-300 hover:text-blue-400 hover:underline cursor-pointer"
                title={item.label}
              >
                {item.label}
              </a>
            ) : (
              <span className="w-40 min-w-[100px] truncate font-mono text-slate-300" title={item.label}>{item.label}</span>
            )}
            <div className="flex-1 h-4 bg-slate-800 rounded-xs overflow-hidden">
              <div
                className="h-full rounded-xs"
                style={{
                  width: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: item.color || '#3b82f6',
                }}
              />
            </div>
            <span className="w-10 text-right text-slate-400 tabular-nums">{item.value}</span>
            {item.badge && (
              <span className={cn(
                'text-[10px] font-medium',
                item.badgeVariant === 'error' ? 'text-red-400' :
                item.badgeVariant === 'warning' ? 'text-amber-400' : 'text-blue-400'
              )}>
                {item.badge}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress List
// ---------------------------------------------------------------------------

/** Utilization/capacity progress bars with auto-coloring */
export function AgentProgressList({ spec }: { spec: ProgressListSpec }) {
  const warn = spec.thresholds?.warning ?? 70;
  const crit = spec.thresholds?.critical ?? 90;

  function barColor(pct: number): string {
    if (pct >= crit) return '#ef4444';
    if (pct >= warn) return '#f59e0b';
    return '#10b981';
  }

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0">
      {spec.title && (
        <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700 text-xs font-medium text-slate-300">
          <span>{spec.title}</span>
          {spec.description && <span className="text-[10px] text-slate-500 ml-2">{spec.description}</span>}
        </div>
      )}
      <div className="p-3 space-y-2.5">
        {(spec.items || []).map((item, i) => {
          const pct = item.max > 0 ? (item.value / item.max) * 100 : 0;
          return (
            <div key={i}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <div>
                  <span className="text-slate-300">{item.label}</span>
                  {item.detail && <span className="text-[10px] text-slate-500 ml-1.5">{item.detail}</span>}
                </div>
                <span className="text-slate-400 tabular-nums">
                  {item.value}/{item.max}{item.unit ? ` ${item.unit}` : ''}
                </span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor(pct) }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

/** Single big number with trend indicator — auto-fetches from Prometheus when query prop is present */
export function AgentStatCard({ spec }: { spec: StatCardSpec }) {
  const extra = spec as unknown as Record<string, unknown>;
  const query = extra.query as string || '';
  const title = spec.title || '';
  const [liveValue, setLiveValue] = useState<string | null>(null);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    fetch(`/api/prometheus/api/v1/query?query=${encodeURIComponent(query)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const results = data?.data?.result || [];
        if (results.length > 0) {
          const raw = parseFloat(results[0].value?.[1] || '0');
          setLiveValue(Number.isInteger(raw) ? String(raw) : raw.toFixed(2));
        } else {
          setLiveValue('0');
        }
      })
      .catch(() => { if (!cancelled) setLiveValue(null); });
    return () => { cancelled = true; };
  }, [query]);

  const value = spec.value || liveValue || (query ? '...' : '—');
  const goodDir = spec.trendGood || 'down';
  const trendIsGood = spec.trend === goodDir;
  const trendColor = !spec.trend || spec.trend === 'stable'
    ? 'text-slate-400'
    : trendIsGood ? 'text-emerald-400' : 'text-red-400';
  const trendArrow = spec.trend === 'up' ? '↑' : spec.trend === 'down' ? '↓' : '';

  return (
    <div className={cn(
      'bg-linear-to-br from-slate-900 to-slate-900/70 rounded-lg border p-4 flex flex-col items-center justify-center text-center transition-all duration-200 hover:shadow-[0_0_12px_rgba(37,99,235,0.08)]',
      METRIC_STATUS_BORDER[spec.status || ''] || 'border-slate-800'
    )}>
      <span className="text-xs text-slate-400 mb-1">{title}</span>
      <div className="text-2xl font-bold text-slate-100 font-mono">
        {value}{spec.unit && <span className="text-sm text-slate-400 ml-0.5">{spec.unit}</span>}
      </div>
      {spec.trend && spec.trendValue && (
        <div className={cn('text-xs mt-1 font-medium', trendColor)}>
          {trendArrow} {spec.trendValue}
        </div>
      )}
      {spec.description && <div className="text-[10px] text-slate-500 mt-1">{spec.description}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
  normal: '#64748b',
};

const CATEGORY_COLORS: Record<string, string> = {
  alert: '#ef4444',
  event: '#3b82f6',
  rollout: '#10b981',
  config: '#8b5cf6',
};

type TimelineGrouping = 'source' | 'severity';


export function AgentTimeline({ spec }: { spec: TimelineSpec }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [hoveredEvent, setHoveredEvent] = useState<{ x: number; y: number; event: TimelineSpec['lanes'][0]['events'][0]; lane: string } | null>(null);
  const [grouping, setGrouping] = useState<TimelineGrouping>('source');

  // Responsive width
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Regroup lanes by severity when toggled
  const lanes = useMemo(() => {
    if (grouping === 'source') return spec.lanes || [];
    const bySeverity: Record<string, Array<TimelineSpec['lanes'][0]['events'][0]>> = { critical: [], warning: [], info: [], normal: [] };
    for (const lane of spec.lanes || []) {
      for (const evt of lane.events) bySeverity[evt.severity]?.push(evt);
    }
    const catMap: Record<string, 'alert' | 'event' | 'rollout' | 'config'> = { critical: 'alert', warning: 'alert', info: 'event', normal: 'config' };
    return Object.entries(bySeverity)
      .filter(([, events]) => events.length > 0)
      .map(([severity, events]) => ({ label: severity.charAt(0).toUpperCase() + severity.slice(1), category: catMap[severity], events }));
  }, [spec.lanes, grouping]);

  // Compute time range
  const timeRange = useMemo(() => {
    if (spec.timeRange) return spec.timeRange;
    let start = Infinity, end = -Infinity;
    for (const lane of lanes) {
      for (const evt of lane.events) {
        start = Math.min(start, evt.timestamp);
        end = Math.max(end, evt.endTimestamp || evt.timestamp);
      }
    }
    if (!isFinite(start) || !isFinite(end)) return { start: Date.now() - 3600000, end: Date.now() };
    const padding = (end - start) * 0.05;
    return { start: start - padding, end: end + padding };
  }, [lanes, spec.timeRange]);

  // SVG dimensions — responsive
  const LABEL_WIDTH = 160;
  const LANE_HEIGHT = 34;
  const PADDING_TOP = 8;
  const PADDING_BOTTOM = 28;
  const svgWidth = Math.max(containerWidth - 24, 400); // 24px = p-3 padding
  const chartWidth = svgWidth - LABEL_WIDTH - 20;
  const svgHeight = PADDING_TOP + lanes.length * LANE_HEIGHT + PADDING_BOTTOM;

  const timeSpan = timeRange.end - timeRange.start || 1;
  const timeToX = useCallback((ts: number) => LABEL_WIDTH + 10 + ((ts - timeRange.start) / timeSpan) * chartWidth, [timeRange, timeSpan, chartWidth]);

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const timeMarkers = useMemo(() => {
    const count = Math.min(Math.floor(chartWidth / 100), 8);
    return Array.from({ length: count + 1 }, (_, i) => {
      const ts = timeRange.start + (timeSpan * i) / count;
      return { x: timeToX(ts), label: formatTime(ts), ts };
    });
  }, [timeRange, timeSpan, timeToX, chartWidth]);

  // "Now" line position
  const now = Date.now();
  const nowX = now >= timeRange.start && now <= timeRange.end ? timeToX(now) : null;

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0 bg-slate-900/50">
      {/* Header */}
      <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700 text-xs font-medium text-slate-300 flex items-center justify-between">
        <div className="truncate">
          {spec.title && <span>{spec.title}</span>}
          {spec.description && <span className="text-[10px] text-slate-500 ml-2">{spec.description}</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center bg-slate-900 rounded-md border border-slate-700 overflow-hidden">
            <button
              onClick={() => setGrouping('source')}
              className={cn('px-2.5 py-1 text-[10px] font-medium transition-colors', grouping === 'source' ? 'bg-blue-600/20 text-blue-400 border-r border-slate-700' : 'text-slate-500 hover:text-slate-300 border-r border-slate-700')}
            >
              By Source
            </button>
            <button
              onClick={() => setGrouping('severity')}
              className={cn('px-2.5 py-1 text-[10px] font-medium transition-colors', grouping === 'severity' ? 'bg-blue-600/20 text-blue-400' : 'text-slate-500 hover:text-slate-300')}
            >
              By Severity
            </button>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div ref={containerRef} className="p-3 overflow-x-auto">
        <svg width={svgWidth} height={svgHeight} className="overflow-visible">
          <defs>
            <filter id="glow-critical">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Time grid lines */}
          {timeMarkers.map((marker, i) => (
            <line key={i} x1={marker.x} y1={PADDING_TOP} x2={marker.x} y2={svgHeight - PADDING_BOTTOM} stroke="#1e293b" strokeWidth="1" strokeDasharray="3,3" />
          ))}

          {/* Alternating lane backgrounds */}
          {lanes.map((_, laneIdx) => (
            <rect
              key={`bg-${laneIdx}`}
              x={0}
              y={PADDING_TOP + laneIdx * LANE_HEIGHT}
              width={svgWidth}
              height={LANE_HEIGHT}
              fill={laneIdx % 2 === 0 ? 'transparent' : '#0f172a'}
              opacity={0.3}
            />
          ))}

          {/* "Now" indicator */}
          {nowX && (
            <g>
              <line x1={nowX} y1={PADDING_TOP - 4} x2={nowX} y2={svgHeight - PADDING_BOTTOM} stroke="#10b981" strokeWidth="1.5" strokeDasharray="4,2" opacity={0.7} />
              <text x={nowX} y={PADDING_TOP - 6} fontSize="9" fill="#10b981" textAnchor="middle" fontWeight="600">NOW</text>
            </g>
          )}

          {/* Lanes */}
          {lanes.map((lane, laneIdx) => {
            const laneY = PADDING_TOP + laneIdx * LANE_HEIGHT + LANE_HEIGHT / 2;

            return (
              <g key={laneIdx}>
                {/* Lane track */}
                <line x1={LABEL_WIDTH + 10} y1={laneY} x2={svgWidth - 10} y2={laneY} stroke="#1e293b" strokeWidth="1" />

                {/* Lane label with colored dot and event count */}
                <circle cx={8} cy={laneY} r={3} fill={grouping === 'severity' ? (SEVERITY_COLORS[lane.label.toLowerCase()] || CATEGORY_COLORS[lane.category]) : CATEGORY_COLORS[lane.category]} />
                <text x={16} y={laneY - 1} fontSize="10" fill="#cbd5e1" dominantBaseline="middle" className="select-none" fontWeight="500">
                  {lane.label.length > 18 ? lane.label.slice(0, 18) + '...' : lane.label}
                </text>
                <text x={LABEL_WIDTH - 8} y={laneY} fontSize="9" fill="#475569" dominantBaseline="middle" textAnchor="end" className="select-none">
                  {lane.events.length}
                </text>

                {/* Events with jitter for overlapping */}
                {lane.events.map((evt, evtIdx) => {
                  const x = timeToX(evt.timestamp);
                  const isDuration = evt.endTimestamp !== undefined;
                  const endX = isDuration ? timeToX(evt.endTimestamp!) : x;
                  const width = isDuration ? endX - x : 0;
                  const color = SEVERITY_COLORS[evt.severity];
                  const isCritical = evt.severity === 'critical';
                  // Jitter overlapping events slightly
                  const jitter = (evtIdx % 3 - 1) * 3;

                  return (
                    <g
                      key={evtIdx}
                      onMouseEnter={(e) => {
                        const rect = (e.currentTarget as SVGGElement).getBoundingClientRect();
                        setHoveredEvent({ x: rect.left + rect.width / 2, y: rect.top, event: evt, lane: lane.label });
                      }}
                      onMouseLeave={() => setHoveredEvent(null)}
                      className="cursor-pointer"
                    >
                      {isDuration ? (
                        <rect x={x} y={laneY - 7} width={Math.max(width, 4)} height={14} fill={color} rx={3} opacity={0.75} />
                      ) : (
                        <>
                          {isCritical && <circle cx={x} cy={laneY + jitter} r={9} fill={color} opacity={0.15} filter="url(#glow-critical)" />}
                          <circle cx={x} cy={laneY + jitter} r={isCritical ? 6 : 4} fill={color} stroke="#0f172a" strokeWidth="1.5" opacity={0.9} />
                        </>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Correlation arrows */}
          {spec.correlations?.map((corr, i) => {
            const fromLane = lanes[corr.from];
            const toLane = lanes[corr.to];
            if (!fromLane || !toLane) return null;
            const fromY = PADDING_TOP + corr.from * LANE_HEIGHT + LANE_HEIGHT / 2;
            const toY = PADDING_TOP + corr.to * LANE_HEIGHT + LANE_HEIGHT / 2;
            const fromEvt = fromLane.events[0];
            const toEvt = toLane.events[0];
            if (!fromEvt || !toEvt) return null;
            const x1 = timeToX(fromEvt.timestamp);
            const x2 = timeToX(toEvt.timestamp);
            const midX = (x1 + x2) / 2;
            return (
              <g key={`corr-${i}`} opacity={0.4}>
                <path d={`M${x1},${fromY} C${midX},${fromY} ${midX},${toY} ${x2},${toY}`} fill="none" stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,2" />
                <text x={midX} y={(fromY + toY) / 2 - 4} fontSize="8" fill="#f59e0b" textAnchor="middle">{corr.label}</text>
              </g>
            );
          })}

          {/* Time axis markers */}
          {timeMarkers.map((marker, i) => (
            <text key={i} x={marker.x} y={svgHeight - 8} fontSize="9" fill="#475569" textAnchor="middle" className="select-none">{marker.label}</text>
          ))}
        </svg>

        {/* Tooltip */}
        {hoveredEvent && (
          <div
            className="fixed z-50 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 shadow-xl pointer-events-none max-w-xs"
            style={{ left: hoveredEvent.x, top: hoveredEvent.y - 12, transform: 'translate(-50%, -100%)' }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: SEVERITY_COLORS[hoveredEvent.event.severity] }} />
              <span className="text-[10px] font-medium uppercase" style={{ color: SEVERITY_COLORS[hoveredEvent.event.severity] }}>{hoveredEvent.event.severity}</span>
              <span className="text-[10px] text-slate-600">|</span>
              <span className="text-[10px] text-slate-400">{hoveredEvent.lane}</span>
            </div>
            <div className="text-xs font-medium text-slate-200">{hoveredEvent.event.label}</div>
            {hoveredEvent.event.detail && hoveredEvent.event.detail !== hoveredEvent.event.label && (
              <div className="text-[10px] text-slate-400 mt-0.5">{hoveredEvent.event.detail}</div>
            )}
            <div className="text-[10px] text-slate-500 mt-1">
              {formatTime(hoveredEvent.event.timestamp)} ({formatRelativeTime(hoveredEvent.event.timestamp)})
              {hoveredEvent.event.endTimestamp && ` — ${formatTime(hoveredEvent.event.endTimestamp)}`}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-3 pb-2 flex items-center gap-4 text-[10px]">
        <div className="flex items-center gap-3">
          <span className="text-slate-500 uppercase tracking-wider">Severity:</span>
          {Object.entries(SEVERITY_COLORS).map(([severity, color]) => (
            <div key={severity} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-slate-400 capitalize">{severity}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resource Counts
// ---------------------------------------------------------------------------

const RESOURCE_ICONS: Record<string, string> = {
  pods: '⊞',
  deployments: '⬡',
  statefulsets: '≡',
  daemonsets: '◈',
  services: '⊕',
  configmaps: '⊡',
  events: '△',
  secrets: '⊠',
  ingresses: '⇄',
  routes: '⇆',
  jobs: '▷',
  cronjobs: '↻',
  persistentvolumeclaims: '⊟',
  namespaces: '▣',
};

const RESOURCE_COLORS: Record<string, string> = {
  pods: 'text-emerald-400',
  deployments: 'text-blue-400',
  statefulsets: 'text-violet-400',
  daemonsets: 'text-amber-400',
  services: 'text-cyan-400',
  configmaps: 'text-slate-400',
  events: 'text-amber-400',
  secrets: 'text-red-400',
};

export function AgentResourceCounts({ spec }: { spec: ResourceCountsSpec }) {
  const navigate = useNavigate();
  const ns = spec.namespace;

  return (
    <div>
      {spec.title && <div className="text-xs font-medium text-slate-400 mb-2">{spec.title}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {(spec.items || []).map((item) => {
          const icon = RESOURCE_ICONS[item.resource] || '□';
          const color = RESOURCE_COLORS[item.resource] || 'text-slate-400';
          const statusColor = item.status === 'error' ? 'border-red-800/50' : item.status === 'warning' ? 'border-amber-800/50' : 'border-slate-800';
          const path = item.gvr ? (ns ? `/r/${item.gvr}?ns=${ns}` : `/r/${item.gvr}`) : undefined;

          return (
            <button
              key={item.resource}
              onClick={() => path && navigate(path)}
              disabled={!path}
              className={cn(
                'bg-slate-900 rounded-lg border p-3 text-center transition-colors',
                statusColor,
                path ? 'hover:bg-slate-800/80 hover:border-slate-600 cursor-pointer' : 'cursor-default',
              )}
            >
              <div className={cn('flex items-center justify-center gap-1.5 mb-1', color)}>
                <span className="text-base">{icon}</span>
                <span className="text-xl font-bold text-slate-100">{item.count}</span>
              </div>
              <div className="text-xs text-slate-500 capitalize">{item.resource}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log Viewer
// ---------------------------------------------------------------------------

const LOG_LEVEL_STYLES: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-amber-400',
  info: 'text-blue-400',
  debug: 'text-slate-500',
};

export function AgentLogViewer({ spec }: { spec: LogViewerSpec }) {
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  type LogLevel = 'error' | 'warn' | 'info' | 'debug';
  const [fetchedLines, setFetchedLines] = useState<Array<{ timestamp?: string; level: LogLevel; message: string; source?: string }>>([]);

  // Auto-fetch logs when spec has namespace/resource but no pre-populated lines
  const extra = spec as unknown as Record<string, unknown>;
  const ns = extra.namespace as string || '';
  const resource = extra.resource as string || '';
  const container = extra.container as string || '';
  const tail = (extra.tail as number) || 200;

  useEffect(() => {
    if ((spec.lines || []).length > 0 || !ns || !resource) return;
    let cancelled = false;
    const params = new URLSearchParams({ tailLines: String(tail) });
    if (container) params.set('container', container);
    // Try current logs first, then previous
    const fetchLogs = async (previous: boolean) => {
      if (previous) params.set('previous', 'true');
      const res = await fetch(`/api/kubernetes/api/v1/namespaces/${ns}/pods/${resource}/log?${params}`);
      if (!res.ok) return '';
      return res.text();
    };
    (async () => {
      let text = await fetchLogs(false);
      if (!text) text = await fetchLogs(true);
      if (cancelled || !text) return;
      const parsed = text.split('\n').filter(Boolean).map(line => {
        const level: LogLevel = /error|fatal|panic/i.test(line) ? 'error'
          : /warn/i.test(line) ? 'warn'
          : /info/i.test(line) ? 'info' : 'debug';
        const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s*/);
        return { timestamp: tsMatch?.[1] || '', level, message: tsMatch ? line.slice(tsMatch[0].length) : line, source: resource };
      });
      setFetchedLines(parsed);
    })();
    return () => { cancelled = true; };
  }, [ns, resource, container, tail]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveLines = (spec.lines || []).length > 0 ? spec.lines : fetchedLines;

  const filtered = useMemo(() => {
    let lines = effectiveLines || [];
    if (levelFilter) lines = lines.filter((l) => l.level === levelFilter);
    if (search) {
      const q = search.toLowerCase();
      lines = lines.filter((l) => l.message.toLowerCase().includes(q) || l.source?.toLowerCase().includes(q));
    }
    return lines;
  }, [effectiveLines, search, levelFilter]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
      {spec.title && (
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">{spec.title}</span>
          <span className="text-xs text-slate-500">{(effectiveLines || []).length} lines</span>
        </div>
      )}
      <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-2">
        <input
          type="text"
          placeholder="Search logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-hidden"
        />
        {['error', 'warn', 'info', 'debug'].map((lvl) => (
          <button
            key={lvl}
            onClick={() => setLevelFilter(levelFilter === lvl ? null : lvl)}
            className={cn('text-xs px-1.5 py-0.5 rounded-sm', levelFilter === lvl ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300')}
          >
            {lvl}
          </button>
        ))}
      </div>
      <div className="max-h-[500px] overflow-auto font-mono text-xs">
        {filtered.map((line, i) => (
          <div key={i} className="px-3 py-0.5 hover:bg-slate-900 flex gap-2 border-b border-slate-800/50">
            {line.timestamp && <span className="text-slate-600 whitespace-nowrap shrink-0">{line.timestamp}</span>}
            {line.level && <span className={cn('uppercase w-5 shrink-0', LOG_LEVEL_STYLES[line.level] || 'text-slate-500')}>{line.level.charAt(0)}</span>}
            {line.source && <span className="text-violet-400 shrink-0">[{line.source}]</span>}
            <span className={cn('flex-1', line.level === 'error' ? 'text-red-300' : 'text-slate-300')}>{line.message}</span>
          </div>
        ))}
        {filtered.length === 0 && <div className="px-3 py-4 text-center text-slate-600">No matching log lines</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// YAML Viewer
// ---------------------------------------------------------------------------

export function AgentYamlViewer({ spec }: { spec: YamlViewerSpec }) {
  const content = spec.content || '';
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">{spec.title || (spec.language === 'json' ? 'JSON' : 'YAML')}</span>
          <button onClick={handleCopy} className="text-xs text-slate-500 hover:text-slate-300">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      <pre className="p-3 overflow-auto max-h-96 text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap">{content}</pre>
    </div>
  );
}
