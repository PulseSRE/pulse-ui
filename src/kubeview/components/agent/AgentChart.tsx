/**
 * AgentChart — recharts-based chart renderer supporting 10 chart types.
 * Lazy-loaded to keep recharts (~150KB) out of the initial bundle.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Plus, ChevronDown, Radio, Pause, Loader2, Settings, X } from 'lucide-react';
import { useChartLiveData } from '../../hooks/useChartLiveData';
import {
  LineChart, BarChart, AreaChart, PieChart, ScatterChart, RadarChart, Treemap,
  Line, Bar, Area, Pie, Scatter, Radar, Cell,
  XAxis, YAxis, Tooltip, Legend, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import type { ChartSpec, ComponentSpec } from '../../engine/agentComponents';

const CHART_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#38bdf8', '#fb923c', '#e879f9', '#f472b6', '#2dd4bf'];

const _chartTimeFmt = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' });
function formatTimestamp(ts: number) {
  return _chartTimeFmt.format(ts);
}

/** Smart Y-axis formatter — detects large numbers and formats as K/M/G/T */
function formatYValue(value: number): string {
  if (!isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}G`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

/** Format "Updated Xs ago" from a dataUpdatedAt timestamp */
function formatUpdatedAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return 'Updated just now';
  if (sec < 60) return `Updated ${sec}s ago`;
  return `Updated ${Math.floor(sec / 60)}m ago`;
}

type ChartType = NonNullable<ChartSpec['chartType']>;

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  line: 'Line', bar: 'Bar', area: 'Area', pie: 'Pie', donut: 'Donut',
  stacked_bar: 'Stacked', stacked_area: 'Stack Area', scatter: 'Scatter',
  radar: 'Radar', treemap: 'Treemap',
};

export default function AgentChart({ spec, onAddToView, refreshInterval, globalTimeRange, hoverTimestamp, onHoverTimestamp, onSpecChange }: {
  spec: ChartSpec; onAddToView?: (spec: ComponentSpec) => void; refreshInterval?: number;
  globalTimeRange?: string; hoverTimestamp?: number | null; onHoverTimestamp?: (ts: number | null) => void;
  onSpecChange?: (spec: ComponentSpec) => void;
}) {
  const [chartType, setChartType] = useState<ChartType>(spec.chartType || 'line');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  // Editable chart properties
  const [activeQuery, setActiveQuery] = useState(spec.query || '');
  const [chartTitle, setChartTitle] = useState(spec.title || '');
  const [chartDesc, setChartDesc] = useState(spec.description || '');
  const [chartHeight, setChartHeight] = useState(spec.height || 300);
  const [yAxisLabel, setYAxisLabel] = useState(spec.yAxisLabel || '');
  const [xAxisLabel, setXAxisLabel] = useState(spec.xAxisLabel || '');
  const [timeRange, setTimeRange] = useState(spec.timeRange || '1h');
  const [showLegend, setShowLegend] = useState(true);
  const [seriesColors, setSeriesColors] = useState<Record<string, string>>(() => {
    const colors: Record<string, string> = {};
    for (const s of spec.series || []) {
      if (s.color) colors[s.label] = s.color;
    }
    return colors;
  });

  const [thresholds, setThresholds] = useState(spec.thresholds || {});

  const height = chartHeight;
  const isEdited = activeQuery !== (spec.query || '') || chartTitle !== (spec.title || '') || chartHeight !== (spec.height || 300);

  // Build a spec with all active (possibly edited) properties for the live data hook
  // globalTimeRange overrides per-chart timeRange when set
  const effectiveTimeRange = globalTimeRange || timeRange || spec.timeRange;
  const activeSpec = useMemo(() => ({
    ...spec,
    query: activeQuery || spec.query,
    timeRange: effectiveTimeRange,
  }), [spec, activeQuery, effectiveTimeRange]);

  // Live data hook — fetches fresh Prometheus data when spec.query is set
  const { series: liveSeries, isLive, isFetching, error: liveError, lastUpdated, isPaused, togglePause } = useChartLiveData(activeSpec, refreshInterval);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  // Transform series data for time-series charts: [{time, series1, series2, ...}]
  const rechartsData = useMemo(() => {
    const timeMap = new Map<number, Record<string, number>>();
    for (const series of liveSeries) {
      for (const [ts, val] of series.data) {
        const entry = timeMap.get(ts) || { time: ts };
        entry[series.label] = val;
        timeMap.set(ts, entry);
      }
    }
    return Array.from(timeMap.values()).sort((a, b) => a.time - b.time);
  }, [liveSeries]);

  // For pie/donut/treemap — aggregate latest values per series
  const pieData = useMemo(() => {
    return liveSeries.map((s, i) => ({
      name: s.label,
      value: s.data.length > 0 ? s.data[s.data.length - 1][1] : 0,
      color: s.color || CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [liveSeries]);

  // For radar — transform to radar format
  const radarData = useMemo(() => {
    if (liveSeries.length === 0) return [];
    // Each data point becomes a radar axis
    const latest = liveSeries.map((s) => ({
      subject: s.label,
      value: s.data.length > 0 ? s.data[s.data.length - 1][1] : 0,
    }));
    return latest;
  }, [liveSeries]);

  // For scatter — pair up data points
  const scatterData = useMemo(() => {
    return liveSeries.flatMap((s, i) =>
      s.data.map(([x, y]) => ({ x, y, series: s.label, color: s.color || CHART_COLORS[i % CHART_COLORS.length] }))
    );
  }, [liveSeries]);

  const renderChart = () => {
    switch (chartType) {
      case 'pie':
      case 'donut':
        return (
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={chartType === 'donut' ? '40%' : 0}
              outerRadius="80%"
              label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {pieData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10, color: '#94a3b8' }} />
          </PieChart>
        );

      case 'scatter':
        return (
          <ScatterChart margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="x" stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={formatTimestamp} />
            <YAxis dataKey="y" stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={formatYValue} />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }} />
            {liveSeries.map((s, i) => {
              const color = s.color || CHART_COLORS[i % CHART_COLORS.length];
              const data = s.data.map(([x, y]) => ({ x, y }));
              return <Scatter key={s.label} name={s.label} data={data} fill={color} />;
            })}
            {liveSeries.length <= 6 && <Legend wrapperStyle={{ fontSize: 10, color: '#94a3b8' }} />}
          </ScatterChart>
        );

      case 'radar':
        return (
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="80%">
            <PolarGrid stroke="#334155" />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: '#94a3b8' }} />
            <PolarRadiusAxis tick={{ fontSize: 8, fill: '#64748b' }} />
            <Radar dataKey="value" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.2} />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }} />
          </RadarChart>
        );

      case 'treemap':
        return (
          <Treemap
            data={pieData.map((d) => ({ name: d.name, size: Math.max(d.value, 0.01), color: d.color }))}
            dataKey="size"
            aspectRatio={4 / 3}
            stroke="#1e293b"
            content={({ x, y, width, height: h, name, color }: any) => (
              <g>
                <rect x={x} y={y} width={width} height={h} fill={color} fillOpacity={0.8} stroke="#1e293b" strokeWidth={1} />
                {width > 40 && h > 20 && (
                  <text x={x + width / 2} y={y + h / 2} fill="#fff" textAnchor="middle" dominantBaseline="middle" fontSize={10}>
                    {name}
                  </text>
                )}
              </g>
            )}
          />
        );

      case 'stacked_bar':
        return (
          <BarChart data={rechartsData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" tickFormatter={formatTimestamp} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={formatYValue} />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
              labelFormatter={(l) => typeof l === 'number' ? formatTimestamp(l) : String(l)} />
            {liveSeries.length <= 6 && <Legend wrapperStyle={{ fontSize: 10, color: '#94a3b8' }} />}
            {liveSeries.map((s, i) => (
              <Bar key={s.label} dataKey={s.label} stackId="stack" fill={s.color || CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </BarChart>
        );

      case 'stacked_area':
        return (
          <AreaChart data={rechartsData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" tickFormatter={formatTimestamp} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={formatYValue} />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
              labelFormatter={(l) => typeof l === 'number' ? formatTimestamp(l) : String(l)} />
            {liveSeries.length <= 6 && <Legend wrapperStyle={{ fontSize: 10, color: '#94a3b8' }} />}
            {liveSeries.map((s, i) => {
              const color = s.color || CHART_COLORS[i % CHART_COLORS.length];
              return <Area key={s.label} dataKey={s.label} stackId="stack" stroke={color} fill={color} fillOpacity={0.3} />;
            })}
          </AreaChart>
        );

      // Default: line, bar, area
      default: {
        const ChartComponent = chartType === 'bar' ? BarChart : chartType === 'area' ? AreaChart : LineChart;
        return (
          <ChartComponent data={rechartsData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" tickFormatter={formatTimestamp} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={{ stroke: '#334155' }} />
            <YAxis stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={{ stroke: '#334155' }}
              tickFormatter={formatYValue}
              label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 10 } } : undefined} />
            {xAxisLabel && <XAxis dataKey="time" label={{ value: xAxisLabel, position: 'insideBottom', offset: -5, style: { fill: '#94a3b8', fontSize: 10 } }} hide />}
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
              labelFormatter={(label) => typeof label === 'number' ? formatTimestamp(label) : String(label)}
              labelStyle={{ color: '#94a3b8' }}
              cursor={{ stroke: '#475569' }}
            />
            {hoverTimestamp != null && <ReferenceLine x={hoverTimestamp} stroke="#6366f1" strokeDasharray="3 3" />}
            {showLegend && liveSeries.length > 1 && liveSeries.length <= 6 && <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />}
            {liveSeries.map((s, i) => {
              const color = seriesColors[s.label] || s.color || CHART_COLORS[i % CHART_COLORS.length];
              if (chartType === 'bar') return <Bar key={s.label} dataKey={s.label} fill={color} fillOpacity={0.8} />;
              if (chartType === 'area') return <Area key={s.label} dataKey={s.label} stroke={color} fill={color} fillOpacity={0.15} strokeWidth={1.5} dot={false} />;
              return <Line key={s.label} dataKey={s.label} stroke={color} strokeWidth={1.5} dot={false} />;
            })}
            {thresholds.warning != null && (
              <ReferenceLine y={thresholds.warning} stroke="#f59e0b" strokeDasharray="6 3" label={{ value: `Warning: ${thresholds.warning}`, position: 'right', fill: '#f59e0b', fontSize: 10 }} />
            )}
            {thresholds.critical != null && (
              <ReferenceLine y={thresholds.critical} stroke="#ef4444" strokeDasharray="6 3" label={{ value: `Critical: ${thresholds.critical}`, position: 'right', fill: '#ef4444', fontSize: 10 }} />
            )}
          </ChartComponent>
        );
      }
    }
  };

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden bg-gradient-to-b from-slate-900/80 to-slate-900/40 min-w-0">
      <div className="px-3 py-1.5 border-b border-slate-700 flex items-center justify-between">
        <div className="truncate flex items-center gap-2">
          <span className="text-xs font-medium text-slate-300">{chartTitle || 'Chart'}</span>
          {chartDesc && <span className="text-[10px] text-slate-500">{chartDesc}</span>}
          {isEdited && <span className="text-[10px] text-violet-400">(edited)</span>}
          {/* Live indicator */}
          {spec.query && (
            <button
              onClick={togglePause}
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                isPaused
                  ? 'bg-slate-700 text-slate-400 hover:text-slate-200'
                  : isLive
                    ? 'bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/60'
                    : 'bg-slate-700 text-slate-400',
              )}
              title={isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
            >
              {isFetching ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : isPaused ? (
                <Pause className="w-3 h-3" />
              ) : (
                <Radio className="w-3 h-3" />
              )}
              {isPaused ? 'Paused' : isLive ? 'Live' : 'Static'}
            </button>
          )}
          {/* Last updated timestamp */}
          {isLive && lastUpdated && !isFetching && (
            <span className="text-[10px] text-slate-600">
              {formatUpdatedAgo(lastUpdated)}
            </span>
          )}
          {liveError && (
            <span className="text-[10px] text-red-400" title={liveError.message}>
              Fetch error
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              {CHART_TYPE_LABELS[chartType]}
              <ChevronDown className="w-3 h-3" />
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-md shadow-lg z-20 min-w-[100px] py-0.5">
                {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => { setChartType(type); setDropdownOpen(false); }}
                    className={cn(
                      'w-full text-left px-2.5 py-1 text-[10px] transition-colors',
                      chartType === type ? 'bg-violet-700 text-white' : 'text-slate-300 hover:bg-slate-700',
                    )}
                  >
                    {CHART_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setEditorOpen(true)}
            className="p-0.5 text-slate-500 hover:text-violet-400 hover:bg-slate-800 rounded transition-colors"
            title="Edit chart"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          {onAddToView && (
            <button
              onClick={() => onAddToView({ ...spec, chartType, query: activeQuery || spec.query, title: chartTitle, description: chartDesc, yAxisLabel, xAxisLabel, height: chartHeight })}
              className="p-0.5 text-slate-500 hover:text-emerald-400 hover:bg-slate-800 rounded transition-colors"
              title="Add to View"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-2" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>

      {activeQuery && (
        <div className="px-3 py-1 border-t border-slate-700 text-[10px] text-slate-500 flex items-center justify-between">
          <span>Range: {timeRange}</span>
          {isEdited && <span className="text-violet-400">edited</span>}
        </div>
      )}

      {/* Chart Editor Modal */}
      {editorOpen && (
        <ChartEditorModal
          query={activeQuery}
          title={chartTitle}
          description={chartDesc}
          chartType={chartType}
          chartHeight={chartHeight}
          yAxisLabel={yAxisLabel}
          xAxisLabel={xAxisLabel}
          timeRange={timeRange}
          showLegend={showLegend}
          seriesColors={seriesColors}
          thresholds={thresholds}
          seriesLabels={liveSeries.map((s) => s.label)}
          onApply={(edits) => {
            setActiveQuery(edits.query);
            setChartTitle(edits.title);
            setChartDesc(edits.description);
            setChartType(edits.chartType as ChartType);
            setChartHeight(edits.chartHeight);
            setYAxisLabel(edits.yAxisLabel);
            setXAxisLabel(edits.xAxisLabel);
            setTimeRange(edits.timeRange);
            setShowLegend(edits.showLegend);
            setSeriesColors(edits.seriesColors);
            setThresholds(edits.thresholds);
            setEditorOpen(false);
            // Persist changes to the saved view
            onSpecChange?.({ ...spec, ...edits, chartType: edits.chartType as ChartType, query: edits.query, title: edits.title, description: edits.description, height: edits.chartHeight });
          }}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}

/** Chart Editor Modal */
interface ChartEditorEdits {
  query: string;
  title: string;
  description: string;
  chartType: string;
  chartHeight: number;
  yAxisLabel: string;
  xAxisLabel: string;
  timeRange: string;
  showLegend: boolean;
  seriesColors: Record<string, string>;
  thresholds: { warning?: number; critical?: number };
}

const TIME_RANGE_OPTIONS = ['5m', '15m', '30m', '1h', '3h', '6h', '12h', '24h', '3d', '7d'];

function ChartEditorModal({
  query, title, description, chartType, chartHeight, yAxisLabel, xAxisLabel,
  timeRange, showLegend, seriesColors, thresholds, seriesLabels, onApply, onClose,
}: {
  query: string; title: string; description: string; chartType: string;
  chartHeight: number; yAxisLabel: string; xAxisLabel: string;
  timeRange: string; showLegend: boolean; seriesColors: Record<string, string>;
  thresholds: { warning?: number; critical?: number };
  seriesLabels: string[];
  onApply: (edits: ChartEditorEdits) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ChartEditorEdits>({
    query, title, description, chartType, chartHeight, yAxisLabel, xAxisLabel,
    timeRange, showLegend, seriesColors: { ...seriesColors }, thresholds: { ...thresholds },
  });

  const update = <K extends keyof ChartEditorEdits>(key: K, value: ChartEditorEdits[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const labelClass = 'text-[11px] text-slate-400 font-medium';
  const inputClass = 'w-full px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-600 outline-none focus:border-violet-500';
  const sectionClass = 'space-y-2';

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-slate-950 border border-slate-700 rounded-lg shadow-2xl w-full max-w-lg max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Edit Chart</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Data */}
          <div className={sectionClass}>
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Data</div>
            <div>
              <label className={labelClass}>PromQL Query</label>
              <textarea
                value={draft.query}
                onChange={(e) => update('query', e.target.value)}
                rows={3}
                className={cn(inputClass, 'font-mono resize-y')}
                placeholder="rate(container_cpu_usage_seconds_total[5m])"
              />
            </div>
            <div>
              <label className={labelClass}>Time Range</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {TIME_RANGE_OPTIONS.map((t) => (
                  <button
                    key={t}
                    onClick={() => update('timeRange', t)}
                    className={cn(
                      'px-2 py-0.5 text-[10px] rounded border transition-colors',
                      draft.timeRange === t
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Appearance */}
          <div className={sectionClass}>
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Appearance</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Title</label>
                <input value={draft.title} onChange={(e) => update('title', e.target.value)} className={inputClass} placeholder="Chart title" />
              </div>
              <div>
                <label className={labelClass}>Chart Type</label>
                <select
                  value={draft.chartType}
                  onChange={(e) => update('chartType', e.target.value)}
                  className={inputClass}
                >
                  {Object.entries(CHART_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <input value={draft.description} onChange={(e) => update('description', e.target.value)} className={inputClass} placeholder="Optional subtitle" />
            </div>
            <div>
              <label className={labelClass}>Height (px)</label>
              <input type="number" value={draft.chartHeight} onChange={(e) => update('chartHeight', Math.max(100, Math.min(800, Number(e.target.value) || 300)))} className={cn(inputClass, 'w-24')} />
            </div>
          </div>

          {/* Axes */}
          <div className={sectionClass}>
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Axes</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Y-Axis Label</label>
                <input value={draft.yAxisLabel} onChange={(e) => update('yAxisLabel', e.target.value)} className={inputClass} placeholder="e.g., CPU cores" />
              </div>
              <div>
                <label className={labelClass}>X-Axis Label</label>
                <input value={draft.xAxisLabel} onChange={(e) => update('xAxisLabel', e.target.value)} className={inputClass} placeholder="e.g., Time" />
              </div>
            </div>
          </div>

          {/* Thresholds */}
          <div className={sectionClass}>
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Thresholds</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Warning</label>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  <input
                    type="number"
                    value={draft.thresholds.warning ?? ''}
                    onChange={(e) => update('thresholds', { ...draft.thresholds, warning: e.target.value ? Number(e.target.value) : undefined })}
                    className={inputClass}
                    placeholder="e.g., 80"
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Critical</label>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  <input
                    type="number"
                    value={draft.thresholds.critical ?? ''}
                    onChange={(e) => update('thresholds', { ...draft.thresholds, critical: e.target.value ? Number(e.target.value) : undefined })}
                    className={inputClass}
                    placeholder="e.g., 95"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Legend & Colors */}
          <div className={sectionClass}>
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Legend & Colors</div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={draft.showLegend} onChange={(e) => update('showLegend', e.target.checked)} className="rounded" />
              <span className="text-xs text-slate-300">Show legend</span>
            </label>
            {seriesLabels.length > 0 && (
              <div className="space-y-1">
                {seriesLabels.map((label, i) => (
                  <div key={label} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={draft.seriesColors[label] || CHART_COLORS[i % CHART_COLORS.length]}
                      onChange={(e) => update('seriesColors', { ...draft.seriesColors, [label]: e.target.value })}
                      className="w-6 h-6 rounded border border-slate-700 cursor-pointer bg-transparent"
                    />
                    <span className="text-xs text-slate-400 truncate">{label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-slate-950 border-t border-slate-800 px-4 py-3 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 rounded transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onApply(draft)}
            className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded transition-colors font-medium"
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
