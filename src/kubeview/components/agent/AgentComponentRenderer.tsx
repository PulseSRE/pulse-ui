/**
 * Renders agent ComponentSpec objects as interactive UI primitives.
 */

import { useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle, AlertTriangle, XCircle, Clock, HelpCircle, ChevronDown, ChevronUp, Plus, ArrowUpDown, ArrowUp, ArrowDown, Settings2, Eye, EyeOff, Filter } from 'lucide-react';
import {
  LineChart, BarChart, AreaChart,
  Line, Bar, Area,
  XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type {
  ComponentSpec,
  DataTableSpec,
  InfoCardGridSpec,
  BadgeListSpec,
  StatusListSpec,
  KeyValueSpec,
  ChartSpec,
  TabsSpec,
  GridSpec,
  SectionSpec,
  RelationshipTreeSpec,
} from '../../engine/agentComponents';
import { Badge } from '../primitives/Badge';
import { InfoCard } from '../primitives/InfoCard';

const MAX_DEPTH = 5;

interface Props {
  spec: ComponentSpec;
  depth?: number;
  onAddToView?: (spec: ComponentSpec) => void;
}

export function AgentComponentRenderer({ spec, depth = 0, onAddToView }: Props) {
  if (depth > MAX_DEPTH) {
    return <div className="text-xs text-slate-500 italic">Content nested too deeply</div>;
  }
  switch (spec.kind) {
    case 'data_table':
      return <AgentDataTable spec={spec} onAddToView={onAddToView} />;
    case 'info_card_grid':
      return <AgentInfoCardGrid spec={spec} />;
    case 'badge_list':
      return <AgentBadgeList spec={spec} />;
    case 'status_list':
      return <AgentStatusList spec={spec} />;
    case 'key_value':
      return <AgentKeyValue spec={spec} />;
    case 'chart':
      return <AgentChart spec={spec} onAddToView={onAddToView} />;
    case 'tabs':
      return <AgentTabs spec={spec} depth={depth} />;
    case 'grid':
      return <AgentGrid spec={spec} depth={depth} />;
    case 'section':
      return <AgentSection spec={spec} depth={depth} />;
    case 'relationship_tree':
      return <AgentRelationshipTree spec={spec} onAddToView={onAddToView} />;
    default:
      return null;
  }
}

/** Compact data table for inline chat rendering */
function AgentDataTable({ spec, onAddToView }: { spec: DataTableSpec; onAddToView?: (spec: ComponentSpec) => void }) {
  const PAGE_SIZE = 15;
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // Auto-hide columns beyond 6 to prevent horizontal scrollbar
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    const MAX_DEFAULT_COLS = 6;
    if (spec.columns.length <= MAX_DEFAULT_COLS) return new Set<string>();
    return new Set(spec.columns.slice(MAX_DEFAULT_COLS).map((c) => c.id));
  });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showSettings, setShowSettings] = useState(false);

  const handleSort = useCallback((colId: string) => {
    if (sortCol === colId) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(colId);
      setSortDir('asc');
    }
  }, [sortCol]);

  const toggleCol = useCallback((colId: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      return next;
    });
  }, []);

  const visibleColumns = useMemo(
    () => spec.columns.filter((c) => !hiddenCols.has(c.id)),
    [spec.columns, hiddenCols],
  );

  const processedRows = useMemo(() => {
    let rows = [...spec.rows];
    // Apply filters
    for (const [colId, filterVal] of Object.entries(filters)) {
      if (!filterVal) continue;
      const lower = filterVal.toLowerCase();
      rows = rows.filter((row) => String(row[colId] ?? '').toLowerCase().includes(lower));
    }
    // Apply sort
    if (sortCol) {
      rows.sort((a, b) => {
        const av = a[sortCol] ?? '';
        const bv = b[sortCol] ?? '';
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [spec.rows, filters, sortCol, sortDir]);

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700 text-xs font-medium text-slate-300 flex items-center justify-between">
        <div className="truncate">
          <span>{spec.title || 'Table'}</span>
          {spec.description && <span className="text-[10px] text-slate-500 ml-2">{spec.description}</span>}
          {Object.values(filters).some(Boolean) && (
            <span className="text-[10px] text-violet-400 ml-2">
              ({processedRows.length}/{spec.rows.length} filtered)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn('p-0.5 rounded transition-colors', showSettings ? 'text-violet-400 bg-slate-700' : 'text-slate-500 hover:text-slate-300')}
            title="Table settings"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          {onAddToView && (
            <button
              onClick={() => onAddToView(spec)}
              className="p-0.5 text-slate-500 hover:text-emerald-400 hover:bg-slate-800 rounded transition-colors flex-shrink-0"
              title="Add to View"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Settings panel — column visibility + filters */}
      {showSettings && (
        <div className="px-3 py-2 bg-slate-800/80 border-b border-slate-700 space-y-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Columns</div>
          <div className="flex flex-wrap gap-1">
            {spec.columns.map((col) => (
              <button
                key={col.id}
                onClick={() => toggleCol(col.id)}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors',
                  hiddenCols.has(col.id)
                    ? 'bg-slate-900 text-slate-600'
                    : 'bg-slate-700 text-slate-300',
                )}
              >
                {hiddenCols.has(col.id) ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                {col.header}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">Filters</div>
          <div className="flex flex-wrap gap-2">
            {visibleColumns.slice(0, 5).map((col) => (
              <div key={col.id} className="flex items-center gap-1">
                <Filter className="w-2.5 h-2.5 text-slate-600" />
                <input
                  placeholder={col.header}
                  value={filters[col.id] || ''}
                  onChange={(e) => setFilters((f) => ({ ...f, [col.id]: e.target.value }))}
                  className="w-24 px-1.5 py-0.5 text-[10px] bg-slate-900 border border-slate-700 rounded text-slate-300 placeholder-slate-600 outline-none focus:border-violet-500"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800/30 sticky top-0 z-[1]">
              {visibleColumns.map((col) => (
                <th
                  key={col.id}
                  className="px-3 py-1.5 text-left text-slate-400 font-medium whitespace-nowrap cursor-pointer hover:text-slate-200 select-none bg-slate-800/80"
                  style={col.width ? { width: col.width } : undefined}
                  onClick={() => handleSort(col.id)}
                >
                  <span className="flex items-center gap-1">
                    {col.header}
                    {sortCol === col.id ? (
                      sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row, i) => (
              <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/30">
                {visibleColumns.map((col) => (
                  <td key={col.id} className="px-3 py-1.5 text-slate-300 whitespace-nowrap group/cell relative">
                    <CellValue value={row[col.id]} columnId={col.id} columnType={col.type} row={row} />
                    <button
                      onClick={() => navigator.clipboard.writeText(String(row[col.id] ?? ''))}
                      className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-100 text-slate-600 hover:text-slate-300 transition-opacity"
                      title="Copy"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/></svg>
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer with pagination */}
      <div className="px-3 py-1 bg-slate-800/30 border-t border-slate-700 text-[10px] text-slate-500 flex items-center justify-between">
        <span>
          {processedRows.length > PAGE_SIZE
            ? `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, processedRows.length)} of ${processedRows.length}`
            : `${processedRows.length} rows`}
          {processedRows.length !== spec.rows.length && ` (${spec.rows.length} total)`}
        </span>
        <div className="flex items-center gap-1">
          {spec.query && <span className="truncate mr-2" title={spec.query}>Query: {spec.query}</span>}
          {processedRows.length > PAGE_SIZE && (
            <>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ←
              </button>
              <span>{page + 1}/{Math.ceil(processedRows.length / PAGE_SIZE)}</span>
              <button
                onClick={() => setPage((p) => Math.min(Math.ceil(processedRows.length / PAGE_SIZE) - 1, p + 1))}
                disabled={(page + 1) * PAGE_SIZE >= processedRows.length}
                className="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column Renderer Registry — smart rendering based on column type
// ---------------------------------------------------------------------------

const LINK_STYLE = 'text-blue-400 hover:text-blue-300';
const KIND_GVR: Record<string, string> = { Deployment: 'apps~v1~deployments', StatefulSet: 'apps~v1~statefulsets', DaemonSet: 'apps~v1~daemonsets' };

const STATUS_COLORS: Record<string, string> = {
  running: 'text-emerald-400', active: 'text-emerald-400', available: 'text-emerald-400',
  true: 'text-emerald-400', healthy: 'text-emerald-400', ready: 'text-emerald-400',
  complete: 'text-emerald-400', bound: 'text-emerald-400',
  warning: 'text-amber-400', pending: 'text-amber-400', progressing: 'text-amber-400', unknown: 'text-amber-400',
  failed: 'text-red-400', error: 'text-red-400', crashloopbackoff: 'text-red-400',
  false: 'text-red-400', degraded: 'text-red-400', unavailable: 'text-red-400',
  'not ready': 'text-red-400', imagepullbackoff: 'text-red-400',
};

type CellRenderer = (value: unknown, row: Record<string, unknown>) => React.ReactNode;

const COLUMN_RENDERERS: Record<string, CellRenderer> = {
  resource_name: (v, row) => {
    const str = String(v ?? '');
    const link = row._link ? String(row._link) : null;
    if (link) return <a href={link} className={LINK_STYLE}>{str}</a>;
    const gvr = row._gvr ? String(row._gvr) : '';
    const ns = String(row.namespace || '');
    if (gvr) return <a href={`/r/${gvr}/${ns || '_'}/${str}`} className={LINK_STYLE}>{str}</a>;
    return <>{str}</>;
  },

  namespace: (v) => <a href={`/project/${String(v)}`} className={LINK_STYLE}>{String(v)}</a>,

  node: (v) => <a href={`/r/v1~nodes/_/${String(v)}`} className={LINK_STYLE}>{String(v)}</a>,

  status: (v) => {
    const str = String(v ?? '');
    return <span className={STATUS_COLORS[str.toLowerCase()] || 'text-slate-300'}>{str}</span>;
  },

  severity: (v) => {
    const str = String(v ?? '');
    const lower = str.toLowerCase();
    const color = lower === 'critical' || lower === 'error' ? 'text-red-400 font-medium' :
      lower === 'warning' ? 'text-amber-400' : 'text-blue-400';
    return <span className={color}>{str}</span>;
  },

  link: (v) => {
    const str = String(v ?? '');
    if (!str.startsWith('/') && !str.startsWith('http')) return <>{str}</>;
    const label = str.includes('/logs/') ? 'View Logs' : str.split('/').pop() || 'Open';
    return <a href={str} className="text-violet-400 hover:text-violet-300 underline underline-offset-2" title={str}>{label}</a>;
  },

  replicas: (v) => {
    const str = String(v ?? '');
    if (!str.includes('/')) return <>{str}</>;
    const [ready, total] = str.split('/').map(Number);
    const color = ready === total && total > 0 ? 'text-emerald-400' : ready > 0 ? 'text-amber-400' : 'text-red-400';
    return <span className={color}>{str}</span>;
  },

  progress: (v) => {
    const pct = typeof v === 'number' ? v : parseFloat(String(v ?? '0').replace('%', ''));
    if (isNaN(pct)) return <>{String(v)}</>;
    const color = pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500';
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className="text-[10px] text-slate-400">{pct.toFixed(0)}%</span>
      </div>
    );
  },

  sparkline: (v) => {
    const points = Array.isArray(v) ? v as number[] : [];
    if (points.length < 2) return <>{String(v)}</>;
    const max = Math.max(...points), min = Math.min(...points), range = max - min || 1;
    const w = 60, h = 16;
    const pts = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / range) * h}`).join(' ');
    return <svg width={w} height={h} className="inline-block"><polyline points={pts} fill="none" stroke="#60a5fa" strokeWidth="1.5" /></svg>;
  },

  timestamp: (v) => {
    const str = String(v ?? '');
    try {
      const date = new Date(str);
      if (isNaN(date.getTime())) return <>{str}</>;
      const ms = Date.now() - date.getTime();
      const sec = Math.floor(ms / 1000);
      const ago = sec < 60 ? `${sec}s ago` : sec < 3600 ? `${Math.floor(sec / 60)}m ago` : sec < 86400 ? `${Math.floor(sec / 3600)}h ago` : `${Math.floor(sec / 86400)}d ago`;
      return <span className="text-slate-400" title={str}>{ago}</span>;
    } catch { return <>{str}</>; }
  },

  labels: (v) => {
    const str = String(v ?? '');
    const pairs = str.split(',').map(s => s.trim()).filter(Boolean);
    if (!pairs.length) return <span className="text-slate-600">(none)</span>;
    return (
      <div className="flex flex-wrap gap-0.5">
        {pairs.slice(0, 3).map((p, i) => (
          <span key={i} className="px-1 py-0 text-[9px] rounded bg-slate-700 text-slate-300">{p}</span>
        ))}
        {pairs.length > 3 && <span className="text-[9px] text-slate-500">+{pairs.length - 3}</span>}
      </div>
    );
  },

  boolean: (v) => {
    const b = v === true || v === 'true' || v === 'True';
    return b ? <span className="text-emerald-400">✓</span> : <span className="text-slate-500">✗</span>;
  },

  age: (v) => <span className="text-slate-400">{String(v ?? '')}</span>,
  cpu: (v) => <span className="font-mono text-xs">{String(v ?? '')}</span>,
  memory: (v) => <span className="font-mono text-xs">{String(v ?? '')}</span>,
  text: (v) => <>{String(v ?? '')}</>,
};

/** Infer column type from ID when no type hint is provided */
function _inferType(columnId: string, value: unknown): string {
  if (columnId === 'name') return 'resource_name';
  if (columnId === 'namespace') return 'namespace';
  if (columnId === 'node') return 'node';
  if (columnId === 'age') return 'age';
  if (['status', 'phase', 'state'].includes(columnId)) return 'status';
  if (['severity'].includes(columnId)) return 'severity';
  if (['logs', 'link'].includes(columnId)) return 'link';
  if (['ready', 'replicas', 'completions'].includes(columnId)) return 'replicas';
  if (['labels', 'annotations'].includes(columnId)) return 'labels';
  if (columnId.endsWith('_pct') || columnId === 'utilization') return 'progress';
  if (['cpu', 'cpu_pct'].includes(columnId)) return 'cpu';
  if (['memory', 'mem_pct'].includes(columnId)) return 'memory';
  if (['suspended'].includes(columnId)) return 'boolean';
  const str = String(value ?? '');
  if (str.startsWith('/') || str.startsWith('http')) return 'link';
  if (str.length > 18 && str.includes('T') && !isNaN(Date.parse(str))) return 'timestamp';
  return 'text';
}

/** Smart cell renderer — dispatches to the right renderer based on column type */
function CellValue({ value, columnId, columnType, row }: { value: unknown; columnId: string; columnType?: string; row?: Record<string, unknown> }) {
  const type = columnType || _inferType(columnId, value);
  const renderer = COLUMN_RENDERERS[type] || COLUMN_RENDERERS.text;
  return <>{renderer(value, row || {})}</>;
}

function AgentInfoCardGrid({ spec }: { spec: InfoCardGridSpec }) {
  return (
    <div className="my-2 grid grid-cols-2 md:grid-cols-4 gap-2">
      {spec.cards.map((card, i) => (
        <InfoCard key={i} label={card.label} value={card.value} sub={card.sub} className="!p-2 !text-xs" />
      ))}
    </div>
  );
}

function AgentBadgeList({ spec }: { spec: BadgeListSpec }) {
  return (
    <div className="my-2 flex flex-wrap gap-1.5">
      {spec.badges.map((b, i) => (
        <Badge key={i} variant={b.variant} size="sm">{b.text}</Badge>
      ))}
    </div>
  );
}

const STATUS_ICONS = {
  healthy: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
  pending: Clock,
  unknown: HelpCircle,
};

const STATUS_LIST_COLORS: Record<string, string> = {
  healthy: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
  pending: 'text-blue-400',
  unknown: 'text-slate-400',
};

function AgentStatusList({ spec }: { spec: StatusListSpec }) {
  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden">
      {spec.title && (
        <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700 text-xs font-medium text-slate-300">
          {spec.title}
        </div>
      )}
      <div className="divide-y divide-slate-800">
        {spec.items.map((item, i) => {
          const Icon = STATUS_ICONS[item.status] || HelpCircle;
          return (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5">
              <Icon className={cn('h-3.5 w-3.5 shrink-0', STATUS_LIST_COLORS[item.status])} />
              <span className="text-xs text-slate-200 font-medium">{item.name}</span>
              {item.detail && <span className="text-xs text-slate-500 truncate ml-auto">{item.detail}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentKeyValue({ spec }: { spec: KeyValueSpec }) {
  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden">
      {spec.title && (
        <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700 text-xs font-medium text-slate-300">
          {spec.title}
        </div>
      )}
      <div className="divide-y divide-slate-800">
        {spec.pairs.map((pair, i) => (
          <div key={i} className="flex items-center px-3 py-1.5 gap-4">
            <span className="text-xs text-slate-400 w-32 shrink-0">{pair.key}</span>
            <span className="text-xs text-slate-200 font-mono truncate">{pair.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const CHART_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#38bdf8', '#fb923c', '#e879f9'];

const _chartTimeFmt = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' });
function formatTimestamp(ts: number) {
  return _chartTimeFmt.format(ts);
}

function AgentChart({ spec, onAddToView }: { spec: ChartSpec; onAddToView?: (spec: ComponentSpec) => void }) {
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>(spec.chartType || 'line');
  const height = spec.height || 300;

  // Transform series data into recharts format: [{time, series1, series2, ...}]
  const rechartsData = useMemo(() => {
    const timeMap = new Map<number, Record<string, number>>();
    for (const series of spec.series) {
      for (const [ts, val] of series.data) {
        const entry = timeMap.get(ts) || { time: ts };
        entry[series.label] = val;
        timeMap.set(ts, entry);
      }
    }
    return Array.from(timeMap.values()).sort((a, b) => a.time - b.time);
  }, [spec.series]);

  const ChartComponent = chartType === 'bar' ? BarChart : chartType === 'area' ? AreaChart : LineChart;

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50">
      {/* Header with title, chart type switcher, and add-to-view button */}
      <div className="px-3 py-1.5 border-b border-slate-700 flex items-center justify-between">
        <div className="truncate">
          <span className="text-xs font-medium text-slate-300">{spec.title || 'Chart'}</span>
          {spec.description && <span className="text-[10px] text-slate-500 ml-2">{spec.description}</span>}
        </div>
        <div className="flex items-center gap-1">
          {/* Chart type switcher */}
          {(['line', 'bar', 'area'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              className={cn(
                'px-1.5 py-0.5 text-[10px] rounded transition-colors',
                chartType === type
                  ? 'bg-violet-700 text-white'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800',
              )}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
          {/* Add to View button */}
          {onAddToView && (
            <button
              onClick={() => onAddToView({ ...spec, chartType })}
              className="ml-1 p-0.5 text-slate-500 hover:text-emerald-400 hover:bg-slate-800 rounded transition-colors"
              title="Add to View"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Chart body */}
      <div className="p-2" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent data={rechartsData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="time"
              tickFormatter={formatTimestamp}
              stroke="#64748b"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={{ stroke: '#334155' }}
            />
            <YAxis
              stroke="#64748b"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={{ stroke: '#334155' }}
              label={spec.yAxisLabel ? { value: spec.yAxisLabel, angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 10 } } : undefined}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
              labelFormatter={(label) => typeof label === 'number' ? formatTimestamp(label) : String(label)}
              labelStyle={{ color: '#94a3b8' }}
            />
            {spec.series.length > 1 && spec.series.length <= 6 && <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />}
            {spec.series.map((s, i) => {
              const color = s.color || CHART_COLORS[i % CHART_COLORS.length];
              if (chartType === 'bar') {
                return <Bar key={s.label} dataKey={s.label} fill={color} fillOpacity={0.8} />;
              }
              if (chartType === 'area') {
                return <Area key={s.label} dataKey={s.label} stroke={color} fill={color} fillOpacity={0.15} strokeWidth={1.5} dot={false} />;
              }
              return <Line key={s.label} dataKey={s.label} stroke={color} strokeWidth={1.5} dot={false} />;
            })}
          </ChartComponent>
        </ResponsiveContainer>
      </div>

      {/* Query info (if available) */}
      {spec.query && (
        <div className="px-3 py-1 border-t border-slate-700 text-[10px] text-slate-600 truncate" title={spec.query}>
          PromQL: {spec.query}
        </div>
      )}
    </div>
  );
}

/** Tabbed container that renders child components per tab */
// ---------------------------------------------------------------------------
// Relationship Tree — visual hierarchy with connecting lines
// ---------------------------------------------------------------------------

const KIND_ICONS: Record<string, string> = {
  Deployment: '🚀', StatefulSet: '📦', DaemonSet: '🔄', ReplicaSet: '📋',
  Pod: '🟢', Job: '⚡', CronJob: '⏰', Service: '🌐', ConfigMap: '📝',
  Secret: '🔒', Node: '🖥️', Namespace: '📁', Ingress: '🌍', Route: '🛣️',
  PersistentVolumeClaim: '💾', HorizontalPodAutoscaler: '📈',
};

const TREE_STATUS_COLORS: Record<string, string> = {
  healthy: 'border-emerald-500', warning: 'border-amber-500',
  error: 'border-red-500', pending: 'border-blue-500', unknown: 'border-slate-600',
};

const TREE_STATUS_BG: Record<string, string> = {
  healthy: 'bg-emerald-500/10', warning: 'bg-amber-500/10',
  error: 'bg-red-500/10', pending: 'bg-blue-500/10', unknown: 'bg-slate-800',
};

function TreeNode({ node, nodes, depth = 0, visited = new Set<string>() }: { node: RelationshipTreeSpec['nodes'][0]; nodes: Map<string, RelationshipTreeSpec['nodes'][0]>; depth?: number; visited?: Set<string> }) {
  // Guard against infinite recursion from cycles or excessive depth
  if (depth > 10 || visited.has(node.id)) return null;
  visited.add(node.id);
  const children = (node.children || []).map((id) => nodes.get(id)).filter(Boolean);
  const icon = KIND_ICONS[node.kind] || '📄';
  const statusBorder = TREE_STATUS_COLORS[node.status || 'unknown'] || TREE_STATUS_COLORS.unknown;
  const statusBg = TREE_STATUS_BG[node.status || 'unknown'] || TREE_STATUS_BG.unknown;
  const link = node.gvr && node.namespace
    ? `/r/${node.gvr}/${node.namespace}/${node.name}`
    : node.gvr ? `/r/${node.gvr}/_/${node.name}` : null;

  return (
    <div className={depth > 0 ? 'ml-6 relative' : ''}>
      {depth > 0 && (
        <>
          <div className="absolute left-[-16px] top-0 h-5 w-4 border-l-2 border-b-2 border-slate-700 rounded-bl" />
          {/* Vertical connector line for siblings */}
        </>
      )}
      <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border-l-2 mb-1', statusBorder, statusBg)}>
        <span className="text-sm">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {link ? (
              <a href={link} className="text-xs font-medium text-blue-400 hover:text-blue-300">{node.kind}/{node.name}</a>
            ) : (
              <span className="text-xs font-medium text-slate-200">{node.kind}/{node.name}</span>
            )}
            {node.status && node.status !== 'unknown' && (
              <span className={cn('text-[9px] px-1 rounded', node.status === 'healthy' ? 'bg-emerald-900/50 text-emerald-400' : node.status === 'error' ? 'bg-red-900/50 text-red-400' : 'bg-amber-900/50 text-amber-400')}>
                {node.status}
              </span>
            )}
          </div>
          {node.detail && <span className="text-[10px] text-slate-500">{node.detail}</span>}
        </div>
      </div>
      {children.length > 0 && (
        <div className="relative">
          {children.map((child) => child && (
            <TreeNode key={child.id} node={child} nodes={nodes} depth={depth + 1} visited={visited} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentRelationshipTree({ spec, onAddToView }: { spec: RelationshipTreeSpec; onAddToView?: (spec: ComponentSpec) => void }) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, RelationshipTreeSpec['nodes'][0]>();
    for (const n of spec.nodes) m.set(n.id, n);
    return m;
  }, [spec.nodes]);

  const root = nodeMap.get(spec.rootId);

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50">
      <div className="px-3 py-1.5 border-b border-slate-700 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-slate-300">{spec.title || 'Resource Relationships'}</span>
          {spec.description && <span className="text-[10px] text-slate-500 ml-2">{spec.description}</span>}
        </div>
        {onAddToView && (
          <button onClick={() => onAddToView(spec)} className="p-0.5 text-slate-500 hover:text-emerald-400 rounded transition-colors" title="Add to View">
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="p-3">
        {root ? (
          <TreeNode node={root} nodes={nodeMap} />
        ) : (
          <span className="text-xs text-slate-500">No root node found</span>
        )}
      </div>
    </div>
  );
}

function AgentTabs({ spec, depth = 0 }: { spec: TabsSpec; depth?: number }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!spec.tabs.length) return null;

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden">
      <div className="flex border-b border-slate-700 bg-slate-800/50 overflow-x-auto">
        {spec.tabs.map((tab, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
              i === activeTab
                ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-800/80'
                : 'text-slate-400 hover:text-slate-300',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="p-2">
        {spec.tabs[activeTab].components.map((child, i) => (
          <AgentComponentRenderer key={i} spec={child} depth={depth + 1} />
        ))}
      </div>
    </div>
  );
}

/** Grid layout that arranges child components in columns */
function AgentGrid({ spec, depth = 0 }: { spec: GridSpec; depth?: number }) {
  const columns = spec.columns ?? 2;

  return (
    <div
      className="my-2 grid gap-4"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
    >
      {spec.items.map((item, i) => (
        <AgentComponentRenderer key={i} spec={item} depth={depth + 1} />
      ))}
    </div>
  );
}

/** Collapsible section with title and optional description */
function AgentSection({ spec, depth = 0 }: { spec: SectionSpec; depth?: number }) {
  const [open, setOpen] = useState(spec.defaultOpen ?? true);
  const Toggle = open ? ChevronUp : ChevronDown;

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => spec.collapsible !== false && setOpen(!open)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 bg-slate-800/50 text-left',
          spec.collapsible !== false && 'cursor-pointer hover:bg-slate-800/80',
        )}
      >
        <span className="text-sm font-medium text-slate-200 flex-1">{spec.title}</span>
        {spec.collapsible !== false && (
          <Toggle className="h-4 w-4 text-slate-400 shrink-0" />
        )}
      </button>
      {spec.description && (
        <div className="px-3 pb-1 text-xs text-slate-400 bg-slate-800/50">
          {spec.description}
        </div>
      )}
      {open && (
        <div className="p-2">
          {spec.components.map((child, i) => (
            <AgentComponentRenderer key={i} spec={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
