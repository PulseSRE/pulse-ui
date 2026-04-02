/**
 * AgentChart — recharts-based chart renderer supporting 10 chart types.
 * Lazy-loaded to keep recharts (~150KB) out of the initial bundle.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Plus, ChevronDown, Radio, Pause, Loader2 } from 'lucide-react';
import { useChartLiveData } from '../../hooks/useChartLiveData';
import {
  LineChart, BarChart, AreaChart, PieChart, ScatterChart, RadarChart, Treemap,
  Line, Bar, Area, Pie, Scatter, Radar, Cell,
  XAxis, YAxis, Tooltip, Legend, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { ChartSpec, ComponentSpec } from '../../engine/agentComponents';

const CHART_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#38bdf8', '#fb923c', '#e879f9', '#f472b6', '#2dd4bf'];

const _chartTimeFmt = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' });
function formatTimestamp(ts: number) {
  return _chartTimeFmt.format(ts);
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

export default function AgentChart({ spec, onAddToView }: { spec: ChartSpec; onAddToView?: (spec: ComponentSpec) => void }) {
  const [chartType, setChartType] = useState<ChartType>(spec.chartType || 'line');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const height = spec.height || 300;

  // Live data hook — fetches fresh Prometheus data when spec.query is set
  const { series: liveSeries, isLive, isFetching, error: liveError, lastUpdated, isPaused, togglePause } = useChartLiveData(spec);

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
            <YAxis dataKey="y" stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
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
            <YAxis stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
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
            <YAxis stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
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
              label={spec.yAxisLabel ? { value: spec.yAxisLabel, angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 10 } } : undefined} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
              labelFormatter={(label) => typeof label === 'number' ? formatTimestamp(label) : String(label)}
              labelStyle={{ color: '#94a3b8' }} />
            {liveSeries.length > 1 && liveSeries.length <= 6 && <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />}
            {liveSeries.map((s, i) => {
              const color = s.color || CHART_COLORS[i % CHART_COLORS.length];
              if (chartType === 'bar') return <Bar key={s.label} dataKey={s.label} fill={color} fillOpacity={0.8} />;
              if (chartType === 'area') return <Area key={s.label} dataKey={s.label} stroke={color} fill={color} fillOpacity={0.15} strokeWidth={1.5} dot={false} />;
              return <Line key={s.label} dataKey={s.label} stroke={color} strokeWidth={1.5} dot={false} />;
            })}
          </ChartComponent>
        );
      }
    }
  };

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50 min-w-0">
      <div className="px-3 py-1.5 border-b border-slate-700 flex items-center justify-between">
        <div className="truncate flex items-center gap-2">
          <span className="text-xs font-medium text-slate-300">{spec.title || 'Chart'}</span>
          {spec.description && <span className="text-[10px] text-slate-500">{spec.description}</span>}
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
          {onAddToView && (
            <button
              onClick={() => onAddToView({ ...spec, chartType })}
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

      {spec.query && (
        <div className="px-3 py-1 border-t border-slate-700 text-[10px] text-slate-600 truncate" title={spec.query}>
          PromQL: {spec.query}
        </div>
      )}
    </div>
  );
}
