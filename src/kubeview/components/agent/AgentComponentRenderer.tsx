/**
 * Renders agent ComponentSpec objects as interactive UI primitives.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle, AlertTriangle, XCircle, Clock, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';
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
} from '../../engine/agentComponents';
import { Badge } from '../primitives/Badge';
import { InfoCard } from '../primitives/InfoCard';

const MAX_DEPTH = 5;

interface Props {
  spec: ComponentSpec;
  depth?: number;
}

export function AgentComponentRenderer({ spec, depth = 0 }: Props) {
  if (depth > MAX_DEPTH) {
    return <div className="text-xs text-slate-500 italic">Content nested too deeply</div>;
  }
  switch (spec.kind) {
    case 'data_table':
      return <AgentDataTable spec={spec} />;
    case 'info_card_grid':
      return <AgentInfoCardGrid spec={spec} />;
    case 'badge_list':
      return <AgentBadgeList spec={spec} />;
    case 'status_list':
      return <AgentStatusList spec={spec} />;
    case 'key_value':
      return <AgentKeyValue spec={spec} />;
    case 'chart':
      return <AgentChart spec={spec} />;
    case 'tabs':
      return <AgentTabs spec={spec} depth={depth} />;
    case 'grid':
      return <AgentGrid spec={spec} depth={depth} />;
    case 'section':
      return <AgentSection spec={spec} depth={depth} />;
    default:
      return null;
  }
}

/** Compact data table for inline chat rendering */
function AgentDataTable({ spec }: { spec: DataTableSpec }) {
  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden">
      {spec.title && (
        <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700 text-xs font-medium text-slate-300">
          {spec.title}
        </div>
      )}
      <div className="overflow-x-auto max-h-64">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800/30">
              {spec.columns.map((col) => (
                <th
                  key={col.id}
                  className="px-3 py-1.5 text-left text-slate-400 font-medium whitespace-nowrap"
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/30">
                {spec.columns.map((col) => (
                  <td key={col.id} className="px-3 py-1.5 text-slate-300 whitespace-nowrap">
                    <CellValue value={row[col.id]} columnId={col.id} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {spec.rows.length > 20 && (
        <div className="px-3 py-1 bg-slate-800/30 border-t border-slate-700 text-[10px] text-slate-500">
          Showing {spec.rows.length} rows
        </div>
      )}
    </div>
  );
}

/** Render cell values with status coloring for known patterns */
function CellValue({ value, columnId }: { value: unknown; columnId: string }) {
  const str = String(value ?? '');
  // Auto-color status-like columns
  if (columnId === 'status' || columnId === 'phase' || columnId === 'state') {
    const lower = str.toLowerCase();
    if (['running', 'active', 'available', 'true', 'healthy', 'ready'].includes(lower)) {
      return <span className="text-emerald-400">{str}</span>;
    }
    if (['warning', 'pending', 'progressing', 'unknown'].includes(lower)) {
      return <span className="text-amber-400">{str}</span>;
    }
    if (['failed', 'error', 'crashloopbackoff', 'false', 'degraded', 'not ready', 'imagepullbackoff'].includes(lower)) {
      return <span className="text-red-400">{str}</span>;
    }
  }
  // Auto-color severity columns
  if (columnId === 'severity' || columnId === 'type') {
    const lower = str.toLowerCase();
    if (lower === 'critical' || lower === 'error') return <span className="text-red-400 font-medium">{str}</span>;
    if (lower === 'warning') return <span className="text-amber-400">{str}</span>;
    if (lower === 'info' || lower === 'normal') return <span className="text-blue-400">{str}</span>;
  }
  return <>{str}</>;
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

const STATUS_COLORS = {
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
              <Icon className={cn('h-3.5 w-3.5 shrink-0', STATUS_COLORS[item.status])} />
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

function AgentChart({ spec }: { spec: ChartSpec }) {
  // Minimal inline SVG sparkline chart for agent responses
  const height = spec.height || 120;
  const width = 500;
  const padding = { top: 10, right: 10, bottom: 20, left: 40 };

  const allValues = spec.series.flatMap((s) => s.data.map(([, v]) => v));
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;

  const allTimes = spec.series.flatMap((s) => s.data.map(([t]) => t));
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const timeRange = maxTime - minTime || 1;

  const scaleX = (t: number) => padding.left + ((t - minTime) / timeRange) * (width - padding.left - padding.right);
  const scaleY = (v: number) => height - padding.bottom - ((v - minVal) / range) * (height - padding.top - padding.bottom);

  const colors = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa'];

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50">
      {spec.title && (
        <div className="px-3 py-1.5 border-b border-slate-700 text-xs font-medium text-slate-300">
          {spec.title}
        </div>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: height }}>
        {/* Y-axis labels */}
        <text x={padding.left - 4} y={padding.top + 4} className="text-[9px] fill-slate-500" textAnchor="end">
          {maxVal.toFixed(1)}
        </text>
        <text x={padding.left - 4} y={height - padding.bottom} className="text-[9px] fill-slate-500" textAnchor="end">
          {minVal.toFixed(1)}
        </text>
        {spec.yAxisLabel && (
          <text x={8} y={height / 2} className="text-[8px] fill-slate-500" textAnchor="middle" transform={`rotate(-90, 8, ${height / 2})`}>
            {spec.yAxisLabel}
          </text>
        )}
        {/* Grid line */}
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#334155" strokeWidth={0.5} />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#334155" strokeWidth={0.5} />
        {/* Series */}
        {spec.series.map((series, si) => {
          if (series.data.length < 2) return null;
          const color = series.color || colors[si % colors.length];
          const points = series.data.map(([t, v]) => `${scaleX(t)},${scaleY(v)}`).join(' ');
          return <polyline key={si} points={points} fill="none" stroke={color} strokeWidth={1.5} />;
        })}
      </svg>
      {spec.series.length > 1 && (
        <div className="px-3 py-1 border-t border-slate-700 flex gap-3">
          {spec.series.map((s, i) => (
            <span key={i} className="text-[10px] text-slate-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color || colors[i % colors.length] }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tabbed container that renders child components per tab */
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
