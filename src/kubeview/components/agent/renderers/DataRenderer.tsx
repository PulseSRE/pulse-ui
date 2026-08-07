/**
 * Data-oriented component renderers: data_table, info_card_grid, badge_list, status_list, key_value.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { CheckCircle, AlertTriangle, XCircle, Clock, HelpCircle, ChevronRight, Radio, Pause, Loader2 } from 'lucide-react';
import { useMultiSourceTable } from '../../../hooks/useMultiSourceTable';
import type { K8sResource } from '../../../engine/renderers';
import { ResourceTable } from '../../table/ResourceTable';
import { Badge } from '../../primitives/Badge';
import { InfoCard } from '../../primitives/InfoCard';
import type {
  ComponentSpec,
  DataTableSpec,
  InfoCardGridSpec,
  BadgeListSpec,
  StatusListSpec,
  KeyValueSpec,
} from '../../../engine/agentComponents';

// ---------------------------------------------------------------------------
// Column Renderer Registry — smart rendering based on column type
// ---------------------------------------------------------------------------

const LINK_STYLE = 'text-blue-400 hover:text-blue-300';

const STATUS_COLORS: Record<string, string> = {
  running: 'text-emerald-400', active: 'text-emerald-400', available: 'text-emerald-400',
  true: 'text-emerald-400', healthy: 'text-emerald-400', ready: 'text-emerald-400',
  complete: 'text-emerald-400', bound: 'text-emerald-400',
  warning: 'text-amber-400', pending: 'text-amber-400', progressing: 'text-amber-400', unknown: 'text-amber-400',
  failed: 'text-red-400', error: 'text-red-400', crashloopbackoff: 'text-red-400',
  false: 'text-red-400', degraded: 'text-red-400', unavailable: 'text-red-400',
  'not ready': 'text-red-400', imagepullbackoff: 'text-red-400',
};

const STATUS_LIST_KIND_GVR: Record<string, string> = {
  Deployment: 'apps~v1~deployments', StatefulSet: 'apps~v1~statefulsets',
  DaemonSet: 'apps~v1~daemonsets', Service: 'v1~services', Pod: 'v1~pods',
  Route: 'route.openshift.io~v1~routes', PVC: 'v1~persistentvolumeclaims',
  PersistentVolumeClaim: 'v1~persistentvolumeclaims',
};

const TITLE_KIND_MAP: Record<string, string> = {
  pvc: 'PVC', persistentvolumeclaim: 'PVC', service: 'Service',
  deployment: 'Deployment', pod: 'Pod', statefulset: 'StatefulSet',
  daemonset: 'DaemonSet', route: 'Route',
};

function _inferKindFromTitle(titleLower: string): string | null {
  for (const [keyword, kind] of Object.entries(TITLE_KIND_MAP)) {
    if (titleLower.includes(keyword)) return kind;
  }
  return null;
}

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
          <span key={i} className="px-1 py-0 text-[9px] rounded-sm bg-slate-700 text-slate-300">{p}</span>
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
  if (!columnId) return 'text';
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

// ---------------------------------------------------------------------------
// Data Table
// ---------------------------------------------------------------------------

/** Entry point — routes to live or static table */
export function AgentDataTable({ spec, onAddToView, refreshInterval }: { spec: DataTableSpec; onAddToView?: (spec: ComponentSpec) => void; refreshInterval?: number }) {
  if (spec.datasources && spec.datasources.length > 0) {
    return <LiveAgentTable spec={spec} onAddToView={onAddToView} refreshInterval={refreshInterval} />;
  }
  return <StaticAgentTable spec={spec} onAddToView={onAddToView} />;
}

/** Live multi-source table — K8s watches + PromQL/log enrichment */
export const LiveAgentTable = React.memo(function LiveAgentTable({ spec, onAddToView, refreshInterval }: { spec: DataTableSpec; onAddToView?: (spec: ComponentSpec) => void; refreshInterval?: number }) {
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
        'flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-medium transition-colors',
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
export const StaticAgentTable = React.memo(function StaticAgentTable({ spec, onAddToView }: { spec: DataTableSpec; onAddToView?: (spec: ComponentSpec) => void }) {
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

  const safeColumns = useMemo(
    () => spec.columns.map((c) => ({ ...c, id: c.id || c.header?.toLowerCase().replace(/\s+/g, '_') || `col_${Math.random().toString(36).slice(2, 6)}` })),
    [spec.columns],
  );

  return (
    <ResourceTable
      title={spec.title}
      description={spec.description}
      columns={safeColumns}
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
// Info Card Grid
// ---------------------------------------------------------------------------

export function AgentInfoCardGrid({ spec }: { spec: InfoCardGridSpec }) {
  return (
    <div className="my-2 grid grid-cols-2 md:grid-cols-4 gap-2">
      {(spec.cards || []).map((card, i) => (
        <InfoCard key={i} label={card.label} value={card.value} sub={card.sub} className="p-2! text-xs!" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge List
// ---------------------------------------------------------------------------

export function AgentBadgeList({ spec }: { spec: BadgeListSpec }) {
  return (
    <div className="my-2 flex flex-wrap gap-1.5">
      {(spec.badges || []).map((b, i) => (
        <Badge key={i} variant={b.variant} size="sm">{b.text}</Badge>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status List
// ---------------------------------------------------------------------------

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

export function AgentStatusList({ spec }: { spec: StatusListSpec }) {
  const navigate = useNavigate();
  const [fetchedItems, setFetchedItems] = useState<Array<{ name: string; status: string; detail?: string }>>([]);

  // Auto-fetch pod status when spec has resources instead of items
  const extra = spec as unknown as Record<string, unknown>;
  const resources = (extra.resources || (extra.props as Record<string, unknown>)?.resources || []) as Array<{ kind: string; name: string; namespace: string }>;

  useEffect(() => {
    if ((spec.items || []).length > 0 || resources.length === 0) return;
    let cancelled = false;
    const fetches = resources.map(async (r) => {
      try {
        const apiPath = r.kind === 'Pod' ? 'v1' : r.kind === 'Deployment' ? 'apis/apps/v1' : 'v1';
        const plural = r.kind.toLowerCase() + 's';
        const res = await fetch(`/api/kubernetes/${apiPath}/namespaces/${r.namespace}/${plural}/${r.name}`);
        if (!res.ok) return { name: `${r.kind}/${r.name}`, status: 'unknown' as const, detail: r.namespace };
        const data = await res.json();
        const phase = data.status?.phase || '';
        const status = phase === 'Running' || phase === 'Active' ? 'healthy'
          : phase === 'Pending' ? 'pending'
          : phase === 'Failed' || phase === 'CrashLoopBackOff' ? 'error'
          : data.status?.conditions?.find((c: { type: string; status: string }) => c.type === 'Available')?.status === 'True' ? 'healthy'
          : data.status?.conditions?.find((c: { type: string; status: string }) => c.type === 'Available')?.status === 'False' ? 'error'
          : 'warning';
        const restarts = data.status?.containerStatuses?.[0]?.restartCount;
        const detail = restarts != null ? `${r.namespace} · ${restarts} restarts` : r.namespace;
        return { name: `${r.kind}/${r.name}`, status, detail };
      } catch {
        return { name: `${r.kind}/${r.name}`, status: 'unknown' as const, detail: r.namespace };
      }
    });
    Promise.all(fetches).then(items => { if (!cancelled) setFetchedItems(items); });
    return () => { cancelled = true; };
  }, [resources.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveItems = (spec.items || []).length > 0 ? spec.items : fetchedItems;

  const titleKind = _inferKindFromTitle((spec.title || '').toLowerCase());

  function resolveClickTarget(item: { name: string; detail?: string }): string | null {
    const itemName = item.name || '';
    if (!itemName) return null;

    // 1. Explicit "Kind/name" pattern
    const explicit = itemName.match(/^(\w+)\/(.+)$/);
    if (explicit) {
      const gvr = STATUS_LIST_KIND_GVR[explicit[1]];
      if (gvr) return `/r/${gvr}/_/${explicit[2]}`;
    }

    // 2. Infer kind from section title (e.g., "PVC Status" → PVC, "Services" → Service)
    if (titleKind) {
      const nameMatch = itemName.match(/^([a-z][a-z0-9-]+(?:\.[a-z0-9-]+)*)/);
      if (nameMatch) {
        const gvr = STATUS_LIST_KIND_GVR[titleKind];
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
        {(effectiveItems || []).map((item, i) => {
          const Icon = STATUS_ICONS[item.status as keyof typeof STATUS_ICONS] || HelpCircle;
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

// ---------------------------------------------------------------------------
// Key-Value
// ---------------------------------------------------------------------------

export function AgentKeyValue({ spec }: { spec: KeyValueSpec }) {
  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0">
      {spec.title && (
        <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700 text-xs font-medium text-slate-300">
          {spec.title}
        </div>
      )}
      <div className="divide-y divide-slate-800">
        {(spec.pairs || []).map((pair, i) => (
          <div key={i} className="flex items-center px-3 py-1.5 gap-4">
            <span className="text-xs text-slate-400 w-32 shrink-0">{pair.key}</span>
            <span className="text-xs text-slate-200 font-mono truncate">{pair.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
