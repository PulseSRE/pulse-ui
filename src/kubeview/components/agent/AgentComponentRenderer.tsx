/**
 * Renders agent ComponentSpec objects as interactive UI primitives.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { CheckCircle, AlertTriangle, XCircle, Clock, HelpCircle, ChevronDown, ChevronUp, ChevronRight, Plus, Radio, Pause, Loader2 } from 'lucide-react';
import { useMultiSourceTable } from '../../hooks/useMultiSourceTable';
import type { K8sResource } from '../../engine/renderers';
import { ResourceTable } from '../table/ResourceTable';

// Lazy-load the chart component to keep recharts (~150KB) out of the initial bundle
const LazyAgentChart = lazy(() => import('./AgentChart'));
import type {
  ComponentSpec,
  DataTableSpec,
  InfoCardGridSpec,
  BadgeListSpec,
  StatusListSpec,
  KeyValueSpec,
  TabsSpec,
  GridSpec,
  SectionSpec,
  RelationshipTreeSpec,
  LogViewerSpec,
  YamlViewerSpec,
  MetricCardSpec,
  BarListSpec,
  ProgressListSpec,
  StatCardSpec,
  TimelineSpec,
  ResourceCountsSpec,
  ActionButtonSpec,
  ConfidenceBadgeSpec,
  ResolutionTrackerSpec,
  BlastRadiusSpec,
} from '../../engine/agentComponents';
const LazyAgentNodeMap = lazy(() => import('./AgentNodeMap').then(m => ({ default: m.AgentNodeMap })));
const LazyAgentTopology = lazy(() => import('./AgentTopology'));
import { AgentActionButton } from './AgentActionButton';
import { AgentConfidenceBadge } from './AgentConfidenceBadge';
import { AgentResolutionTracker } from './AgentResolutionTracker';
import { AgentBlastRadius } from './AgentBlastRadius';
import { DynamicComponent } from './DynamicComponent';
import { Badge } from '../primitives/Badge';
import { InfoCard } from '../primitives/InfoCard';
import { MetricCard as SparklineMetricCard } from '../metrics/Sparkline';

const MAX_DEPTH = 5;

interface Props {
  spec: ComponentSpec;
  depth?: number;
  onAddToView?: (spec: ComponentSpec) => void;
  refreshInterval?: number;
  globalTimeRange?: string;
  hoverTimestamp?: number | null;
  onHoverTimestamp?: (ts: number | null) => void;
  onSpecChange?: (spec: ComponentSpec) => void;
  viewId?: string;
}

export function AgentComponentRenderer({ spec, depth = 0, onAddToView, refreshInterval, globalTimeRange, hoverTimestamp, onHoverTimestamp, onSpecChange, viewId }: Props) {
  if (depth > MAX_DEPTH) {
    return <div className="text-xs text-slate-500 italic">Content nested too deeply</div>;
  }
  switch (spec.kind) {
    case 'data_table':
      return <AgentDataTable spec={spec} onAddToView={onAddToView} refreshInterval={refreshInterval} />;
    case 'info_card_grid':
      return <AgentInfoCardGrid spec={spec} />;
    case 'badge_list':
      return <AgentBadgeList spec={spec} />;
    case 'status_list':
      return <AgentStatusList spec={spec} />;
    case 'key_value':
      return <AgentKeyValue spec={spec} />;
    case 'chart':
      return <Suspense fallback={<div className="h-48 flex items-center justify-center text-slate-500 text-xs">Loading chart...</div>}><LazyAgentChart spec={spec} onAddToView={onAddToView} refreshInterval={refreshInterval} globalTimeRange={globalTimeRange} hoverTimestamp={hoverTimestamp} onHoverTimestamp={onHoverTimestamp} onSpecChange={onSpecChange} /></Suspense>;
    case 'tabs':
      return <AgentTabs spec={spec} depth={depth} />;
    case 'grid':
      return <AgentGrid spec={spec} depth={depth} />;
    case 'section':
      return <AgentSection spec={spec} depth={depth} />;
    case 'relationship_tree':
      return <AgentRelationshipTree spec={spec} onAddToView={onAddToView} />;
    case 'log_viewer':
      return <AgentLogViewer spec={spec} />;
    case 'yaml_viewer':
      return <AgentYamlViewer spec={spec} />;
    case 'metric_card':
      return <AgentMetricCard spec={spec} />;
    case 'node_map':
      return <Suspense fallback={<div className="h-48 flex items-center justify-center text-slate-500 text-xs">Loading node map...</div>}><LazyAgentNodeMap spec={spec} /></Suspense>;
    case 'bar_list':
      return <AgentBarList spec={spec} />;
    case 'progress_list':
      return <AgentProgressList spec={spec} />;
    case 'stat_card':
      return <AgentStatCard spec={spec} />;
    case 'timeline':
      return <AgentTimeline spec={spec} />;
    case 'resource_counts':
      return <AgentResourceCounts spec={spec} />;
    case 'topology':
      return <Suspense fallback={<div className="h-48 flex items-center justify-center text-slate-500 text-xs">Loading topology...</div>}><LazyAgentTopology spec={spec} onAddToView={onAddToView} /></Suspense>;
    case 'action_button':
      return <AgentActionButton spec={spec as ActionButtonSpec} viewId={viewId} />;
    case 'confidence_badge':
      return <AgentConfidenceBadge spec={spec as ConfidenceBadgeSpec} />;
    case 'resolution_tracker':
      return <AgentResolutionTracker spec={spec as ResolutionTrackerSpec} />;
    case 'blast_radius':
      return <AgentBlastRadius spec={spec as BlastRadiusSpec} />;
    default:
      // Dynamic rendering for unknown kinds — uses layout templates from component registry
      return <DynamicComponentFallback spec={spec} />;
  }
}

/** Entry point — routes to live or static table */
function AgentDataTable({ spec, onAddToView, refreshInterval }: { spec: DataTableSpec; onAddToView?: (spec: ComponentSpec) => void; refreshInterval?: number }) {
  if (spec.datasources && spec.datasources.length > 0) {
    return <LiveAgentTable spec={spec} onAddToView={onAddToView} refreshInterval={refreshInterval} />;
  }
  return <StaticAgentTable spec={spec} onAddToView={onAddToView} />;
}

/** Live multi-source table — K8s watches + PromQL/log enrichment */
const LiveAgentTable = React.memo(function LiveAgentTable({ spec, onAddToView, refreshInterval }: { spec: DataTableSpec; onAddToView?: (spec: ComponentSpec) => void; refreshInterval?: number }) {
  const navigate = useNavigate();
  const result = useMultiSourceTable(spec.datasources!, refreshInterval);

  // Convert K8s resources to flat rows for ResourceTable
  const flatRows = useMemo(() =>
    result.resources.map((r) => {
      const row: Record<string, unknown> = { _resource: r };
      for (const col of result.columns) {
        row[col.id] = col.accessorFn(r);
      }
      row._gvr = (r as Record<string, unknown>)._gvrKey
        ? String((r as Record<string, unknown>)._gvrKey).replace(/\//g, '~')
        : '';
      row._namespace = r.metadata?.namespace || '';
      row._name = r.metadata?.name || '';
      return row;
    }),
  [result.resources, result.columns]);

  // Convert ColumnDef[] to TableColumn[] for ResourceTable
  const tableColumns = useMemo(() =>
    result.columns.map((c) => ({ id: c.id, header: c.header, width: c.width })),
  [result.columns]);

  const handleRowClick = useCallback((row: Record<string, unknown>) => {
    const gvr = row._gvr ? String(row._gvr) : '';
    const name = String(row._name || '');
    const ns = String(row._namespace || '');
    if (gvr && name) navigate(`/r/${gvr}/${ns || '_'}/${name}`);
  }, [navigate]);

  // O(1) column lookup for cell rendering
  const columnMap = useMemo(() => new Map(result.columns.map((c) => [c.id, c])), [result.columns]);

  const renderCell = useCallback((value: unknown, columnId: string, _type: string | undefined, row: Record<string, unknown>) => {
    const col = columnMap.get(columnId);
    if (col) return col.render(value, row._resource as K8sResource);
    return <>{String(value ?? '')}</>;
  }, [columnMap]);

  const liveIndicator = (
    <button
      onClick={result.togglePause}
      className={cn(
        'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
        result.isPaused
          ? 'bg-slate-700 text-slate-400 hover:text-slate-200'
          : result.isLive
            ? 'bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/60'
            : 'bg-slate-700 text-slate-400',
      )}
      title={result.isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
    >
      {result.isLoading ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : result.isPaused ? (
        <Pause className="w-3 h-3" />
      ) : (
        <Radio className="w-3 h-3" />
      )}
      {result.isPaused ? 'Paused' : result.isLive ? 'Live' : 'Connecting'}
    </button>
  );

  const footerExtra = (
    <>
      {result.sources.length > 1 && (
        <span>Sources: {result.sources.map((s) => `${s.label} (${s.count})`).join(' + ')}</span>
      )}
      {result.enrichmentUpdatedAt !== null && (
        <span>Enrichment: {Math.round((Date.now() - result.enrichmentUpdatedAt) / 1000)}s ago</span>
      )}
    </>
  );

  return (
    <ResourceTable
      title={spec.title}
      description={spec.description}
      columns={tableColumns}
      rows={flatRows}
      renderCell={renderCell}
      onRowClick={handleRowClick}
      onAddToView={onAddToView}
      spec={spec}
      headerExtra={liveIndicator}
      footerExtra={footerExtra}
      showActions
    />
  );
});

/** Static data table for inline chat rendering */
const StaticAgentTable = React.memo(function StaticAgentTable({ spec, onAddToView }: { spec: DataTableSpec; onAddToView?: (spec: ComponentSpec) => void }) {
  const navigate = useNavigate();

  const handleRowClick = useCallback((row: Record<string, unknown>) => {
    const gvr = row._gvr ? String(row._gvr) : '';
    const name = String(row.name || '');
    const ns = String(row.namespace || '');
    if (gvr && name) navigate(`/r/${gvr}/${ns || '_'}/${name}`);
  }, [navigate]);

  const renderCell = useCallback((value: unknown, columnId: string, columnType: string | undefined, row: Record<string, unknown>) => (
    <CellValue value={value} columnId={columnId} columnType={columnType} row={row} />
  ), []);

  return (
    <ResourceTable
      title={spec.title}
      description={spec.description}
      columns={spec.columns}
      rows={spec.rows as Array<Record<string, unknown>>}
      renderCell={renderCell}
      onRowClick={spec.rows.some((r) => r._gvr) ? handleRowClick : undefined}
      onAddToView={onAddToView}
      spec={spec}
      footerExtra={spec.query ? <span className="truncate" title={spec.query}>Query: {spec.query}</span> : undefined}
      showActions={spec.rows.some((r) => r._gvr)}
    />
  );
});

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
  const navigate = useNavigate();
  const type = columnType || _inferType(columnId, value);

  // resource_name with _gvr → in-app navigation
  if (type === 'resource_name' && row) {
    const str = String(value ?? '');
    const gvr = row._gvr ? String(row._gvr) : '';
    const ns = String(row.namespace || '');
    if (gvr) {
      return (
        <button
          onClick={() => navigate(`/r/${gvr}/${ns || '_'}/${str}`)}
          className="text-blue-400 hover:text-blue-300 hover:underline text-left"
        >
          {str}
        </button>
      );
    }
  }

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

const STATUS_LIST_BG: Record<string, string> = {
  healthy: 'bg-emerald-500/15',
  warning: 'bg-amber-500/15',
  error: 'bg-red-500/15',
  pending: 'bg-blue-500/15',
  unknown: 'bg-slate-500/15',
};

function AgentStatusList({ spec }: { spec: StatusListSpec }) {
  const navigate = useNavigate();

  // Map status list item names to navigable resource paths
  const KIND_GVR_MAP: Record<string, string> = {
    Deployment: 'apps~v1~deployments',
    StatefulSet: 'apps~v1~statefulsets',
    DaemonSet: 'apps~v1~daemonsets',
    Service: 'v1~services',
    Pod: 'v1~pods',
    Route: 'route.openshift.io~v1~routes',
    PVC: 'v1~persistentvolumeclaims',
    PersistentVolumeClaim: 'v1~persistentvolumeclaims',
  };

  // Detect resource type from title context or item content
  const TITLE_KIND_MAP: Record<string, string> = {
    'pvc': 'PVC',
    'persistentvolumeclaim': 'PVC',
    'service': 'Service',
    'deployment': 'Deployment',
    'pod': 'Pod',
    'statefulset': 'StatefulSet',
    'daemonset': 'DaemonSet',
    'route': 'Route',
  };

  function inferKind(titleLower: string): string | null {
    for (const [keyword, kind] of Object.entries(TITLE_KIND_MAP)) {
      if (titleLower.includes(keyword)) return kind;
    }
    return null;
  }

  const titleKind = inferKind((spec.title || '').toLowerCase());

  function resolveClickTarget(item: { name: string; detail?: string }): string | null {
    const itemName = item.name || '';
    if (!itemName) return null;

    // 1. Explicit "Kind/name" pattern
    const explicit = itemName.match(/^(\w+)\/(.+)$/);
    if (explicit) {
      const gvr = KIND_GVR_MAP[explicit[1]];
      if (gvr) return `/r/${gvr}/_/${explicit[2]}`;
    }

    // 2. Infer kind from section title (e.g., "PVC Status" → PVC, "Services" → Service)
    if (titleKind) {
      const nameMatch = itemName.match(/^([a-z][a-z0-9-]+(?:\.[a-z0-9-]+)*)/);
      if (nameMatch) {
        const gvr = KIND_GVR_MAP[titleKind];
        if (gvr) return `/r/${gvr}/_/${nameMatch[1]}`;
      }
    }

    return null;
  }

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0">
      {spec.title && (
        <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-700 text-xs font-semibold text-slate-200 tracking-wide">
          {spec.title}
        </div>
      )}
      <div className="divide-y divide-slate-800/60">
        {spec.items.map((item, i) => {
          const Icon = STATUS_ICONS[item.status] || HelpCircle;
          const clickTarget = resolveClickTarget(item);
          return (
            <div
              key={i}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 transition-colors',
                clickTarget && 'cursor-pointer hover:bg-slate-800/60 group',
              )}
              onClick={() => clickTarget && navigate(clickTarget)}
            >
              <div className={cn('flex items-center justify-center w-5 h-5 rounded-full shrink-0', STATUS_LIST_BG[item.status] || 'bg-slate-800')}>
                <Icon className={cn('h-3 w-3', STATUS_LIST_COLORS[item.status])} />
              </div>
              <span className={cn('text-sm font-medium', clickTarget ? 'text-blue-400 group-hover:text-blue-300' : 'text-slate-200')}>{item.name || item.detail}</span>
              {item.name && item.detail && <span className="text-xs text-slate-500 truncate ml-auto">{item.detail}</span>}
              {clickTarget && <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 shrink-0 ml-1" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentKeyValue({ spec }: { spec: KeyValueSpec }) {
  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0">
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
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0">
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
    <div>
      {spec.title && (
        <div className="mb-2 text-xs font-medium text-slate-300 flex items-center justify-between">
          <div className="truncate">
            <span>{spec.title}</span>
            {spec.description && <span className="text-[10px] text-slate-500 ml-2">{spec.description}</span>}
          </div>
        </div>
      )}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {spec.items.map((item, i) => {
          const spanFull = item.kind === 'resource_counts' || item.kind === 'data_table' || item.kind === 'status_list';
          return (
            <div key={i} style={spanFull ? { gridColumn: `1 / -1` } : undefined}>
              <AgentComponentRenderer spec={item} depth={depth + 1} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Collapsible section with title and optional description */
function AgentSection({ spec, depth = 0 }: { spec: SectionSpec; depth?: number }) {
  const [open, setOpen] = useState(spec.defaultOpen ?? true);
  const Toggle = open ? ChevronUp : ChevronDown;

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0">
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

// ─── Log Viewer ──────────────────────────────────────────────────────────────

const LOG_LEVEL_STYLES: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-amber-400',
  info: 'text-blue-400',
  debug: 'text-slate-500',
};

function AgentLogViewer({ spec }: { spec: LogViewerSpec }) {
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let lines = spec.lines;
    if (levelFilter) lines = lines.filter((l) => l.level === levelFilter);
    if (search) {
      const q = search.toLowerCase();
      lines = lines.filter((l) => l.message.toLowerCase().includes(q) || l.source?.toLowerCase().includes(q));
    }
    return lines;
  }, [spec.lines, search, levelFilter]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
      {spec.title && (
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">{spec.title}</span>
          <span className="text-xs text-slate-500">{spec.lines.length} lines</span>
        </div>
      )}
      <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-2">
        <input
          type="text"
          placeholder="Search logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none"
        />
        {['error', 'warn', 'info', 'debug'].map((lvl) => (
          <button
            key={lvl}
            onClick={() => setLevelFilter(levelFilter === lvl ? null : lvl)}
            className={cn('text-xs px-1.5 py-0.5 rounded', levelFilter === lvl ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300')}
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

// ─── YAML Viewer ─────────────────────────────────────────────────────────────

function AgentYamlViewer({ spec }: { spec: YamlViewerSpec }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(spec.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [spec.content]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
      {(spec.title || true) && (
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">{spec.title || (spec.language === 'json' ? 'JSON' : 'YAML')}</span>
          <button onClick={handleCopy} className="text-xs text-slate-500 hover:text-slate-300">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      )}
      <pre className="p-3 overflow-auto max-h-96 text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap">{spec.content}</pre>
    </div>
  );
}

/** Horizontal ranked bar chart — like "Top Tools" */
function AgentBarList({ spec }: { spec: BarListSpec }) {
  const maxItems = spec.maxItems ?? 10;
  const items = spec.items.slice(0, maxItems);
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
            <div className="flex-1 h-4 bg-slate-800 rounded-sm overflow-hidden">
              <div
                className="h-full rounded-sm"
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

/** Utilization/capacity progress bars with auto-coloring */
function AgentProgressList({ spec }: { spec: ProgressListSpec }) {
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
        {spec.items.map((item, i) => {
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

/** Single big number with trend indicator */
function AgentStatCard({ spec }: { spec: StatCardSpec }) {
  const goodDir = spec.trendGood || 'down';
  const trendIsGood = spec.trend === goodDir;
  const trendColor = !spec.trend || spec.trend === 'stable'
    ? 'text-slate-400'
    : trendIsGood ? 'text-emerald-400' : 'text-red-400';
  const trendArrow = spec.trend === 'up' ? '\u2191' : spec.trend === 'down' ? '\u2193' : '';

  return (
    <div className={cn(
      'bg-gradient-to-br from-slate-900 to-slate-900/70 rounded-lg border p-4 flex flex-col items-center justify-center text-center transition-all duration-200 hover:shadow-[0_0_12px_rgba(37,99,235,0.08)]',
      METRIC_STATUS_BORDER[spec.status || ''] || 'border-slate-800'
    )}>
      <span className="text-xs text-slate-400 mb-1">{spec.title}</span>
      <div className="text-2xl font-bold text-slate-100 font-mono">
        {spec.value}{spec.unit && <span className="text-sm text-slate-400 ml-0.5">{spec.unit}</span>}
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

// ─── Metric Card ─────────────────────────────────────────────────────────────

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

function AgentMetricCard({ spec }: { spec: MetricCardSpec }) {
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
        'bg-gradient-to-br from-slate-900 to-slate-900/70 rounded-lg border p-3 transition-all duration-200 hover:shadow-[0_0_12px_rgba(37,99,235,0.08)] h-full',
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

// ─── Timeline Swimlane ───────────────────────────────────────────────────────

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

function _relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function AgentTimeline({ spec }: { spec: TimelineSpec }) {
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
    if (grouping === 'source') return spec.lanes;
    const bySeverity: Record<string, Array<TimelineSpec['lanes'][0]['events'][0]>> = { critical: [], warning: [], info: [], normal: [] };
    for (const lane of spec.lanes) {
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
        <div className="flex items-center gap-1 flex-shrink-0">
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
              {formatTime(hoveredEvent.event.timestamp)} ({_relativeTime(hoveredEvent.event.timestamp)})
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

/* ------------------------------------------------------------------ */
/* Resource Counts                                                     */
/* ------------------------------------------------------------------ */

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

function AgentResourceCounts({ spec }: { spec: ResourceCountsSpec }) {
  const navigate = useNavigate();
  const ns = spec.namespace;

  return (
    <div>
      {spec.title && <div className="text-xs font-medium text-slate-400 mb-2">{spec.title}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {spec.items.map((item) => {
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

/* ------------------------------------------------------------------ */
/* Dynamic Component Fallback                                          */
/* ------------------------------------------------------------------ */

function DynamicComponentFallback({ spec }: { spec: ComponentSpec }) {
  const raw = spec as unknown as Record<string, unknown>;
  const title = raw.title as string | undefined;
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-lg p-4">
      {title && <div className="text-xs font-medium text-slate-300 mb-2">{title}</div>}
      <DynamicComponent spec={raw} />
    </div>
  );
}
