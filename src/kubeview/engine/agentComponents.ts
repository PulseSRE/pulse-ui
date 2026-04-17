/**
 * Agent Component Specs — structured UI components returned by agent tools.
 *
 * Tools emit these as JSON over the WebSocket `component` event.
 * The frontend renders them inline in the chat using existing primitives.
 */

export type ComponentSpec =
  | DataTableSpec
  | InfoCardGridSpec
  | BadgeListSpec
  | StatusListSpec
  | KeyValueSpec
  | ChartSpec
  | TabsSpec
  | GridSpec
  | SectionSpec
  | RelationshipTreeSpec
  | LogViewerSpec
  | YamlViewerSpec
  | MetricCardSpec
  | NodeMapSpec
  | BarListSpec
  | ProgressListSpec
  | StatCardSpec
  | TimelineSpec
  | ResourceCountsSpec
  | TopologySpec;

export interface RelationshipTreeSpec {
  kind: 'relationship_tree';
  title?: string;
  description?: string;
  nodes: Array<{
    id: string;
    label: string;        // e.g. "Deployment/nginx"
    kind: string;         // e.g. "Deployment"
    name: string;         // e.g. "nginx"
    namespace?: string;
    status?: 'healthy' | 'warning' | 'error' | 'pending' | 'unknown';
    gvr?: string;         // for clickable links
    children?: string[];  // IDs of child nodes
    detail?: string;      // extra info
  }>;
  rootId: string;         // which node is the root
}

/** K8s API datasource — provides base rows via LIST + WATCH (real-time) */
export interface K8sDatasource {
  type: 'k8s';
  id: string;
  label: string;
  resource: string;
  namespace?: string;
  group?: string;
  version?: string;
  labelSelector?: string;
  fieldSelector?: string;
}

/** Prometheus datasource — enriches rows with a metric column (polled) */
export interface PromQLDatasource {
  type: 'promql';
  id: string;
  label: string;
  query: string;
  columnId: string;
  columnHeader: string;
  unit?: string;
  joinLabel: string;
  joinColumn: string;
}

/** Log datasource — enriches rows with a log-count column (polled) */
export interface LogDatasource {
  type: 'logs';
  id: string;
  label: string;
  namespace: string;
  labelSelector?: string;
  pattern?: string;
  columnId: string;
  columnHeader: string;
  tailLines?: number;
}

export type TableDatasource = K8sDatasource | PromQLDatasource | LogDatasource;

export interface DataTableSpec {
  kind: 'data_table';
  title?: string;
  description?: string;
  columns: Array<{ id: string; header: string; width?: string; type?: string }>;
  rows: Array<Record<string, string | number | boolean>>;
  query?: string;
  timeRange?: string;
  /** K8s resource type for auto-linking (e.g. 'pods', 'deployments', 'nodes') */
  resourceType?: string;
  /** API group~version~resource for detail links (e.g. 'v1~pods', 'apps~v1~deployments') */
  gvr?: string;
  /** Multi-datasource definition for live table with K8s watch + enrichment */
  datasources?: TableDatasource[];
  /** Column ID for row deduplication across K8s datasources (default: uid) */
  deduplicateBy?: string;
}

export interface InfoCardGridSpec {
  kind: 'info_card_grid';
  title?: string;
  description?: string;
  cards: Array<{ label: string; value: string; sub?: string }>;
}

export interface BadgeListSpec {
  kind: 'badge_list';
  badges: Array<{ text: string; variant: 'success' | 'warning' | 'error' | 'info' | 'default' }>;
}

export interface StatusListSpec {
  kind: 'status_list';
  title?: string;
  items: Array<{
    name: string;
    status: 'healthy' | 'warning' | 'error' | 'pending' | 'unknown';
    detail?: string;
  }>;
}

export interface KeyValueSpec {
  kind: 'key_value';
  title?: string;
  pairs: Array<{ key: string; value: string }>;
}

export interface ChartSpec {
  kind: 'chart';
  chartType?: 'line' | 'bar' | 'area' | 'pie' | 'donut' | 'stacked_bar' | 'stacked_area' | 'scatter' | 'radar' | 'treemap';
  title?: string;
  description?: string;
  series: Array<{
    label: string;
    data: Array<[number, number]>; // [timestamp, value]
    color?: string;
  }>;
  yAxisLabel?: string;
  xAxisLabel?: string;
  height?: number;
  query?: string;      // stored PromQL for live refresh + editing
  timeRange?: string;  // stored for refresh
  /** Warning/critical threshold lines on the chart */
  thresholds?: { warning?: number; critical?: number };
}

export interface TabsSpec {
  kind: 'tabs';
  tabs: Array<{
    label: string;
    icon?: string;
    components: ComponentSpec[];
  }>;
}

export interface GridSpec {
  kind: 'grid';
  title?: string;
  description?: string;
  columns?: number; // default 2
  items: ComponentSpec[];
}

export interface SectionSpec {
  kind: 'section';
  title: string;
  description?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  components: ComponentSpec[];
}

export interface LogViewerSpec {
  kind: 'log_viewer';
  title?: string;
  description?: string;
  lines: Array<{
    timestamp?: string;
    level?: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    source?: string;
  }>;
  /** Pod/container name for context */
  source?: string;
}

export interface YamlViewerSpec {
  kind: 'yaml_viewer';
  title?: string;
  description?: string;
  content: string;
  language?: 'yaml' | 'json';
}

export interface MetricCardSpec {
  kind: 'metric_card';
  title: string;
  value: string;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  status?: 'healthy' | 'warning' | 'error';
  description?: string;
  /** Optional PromQL query — renders a live sparkline chart when provided */
  query?: string;
  /** Sparkline color (default: auto from status) */
  color?: string;
  /** Threshold values for sparkline color changes */
  thresholds?: { warning: number; critical: number };
  /** Optional link — makes the card clickable, navigates to this path */
  link?: string;
}

export interface NodeMapSpec {
  kind: 'node_map';
  title?: string;
  description?: string;
  nodes: Array<{
    name: string;
    status: 'ready' | 'not-ready' | 'pressure' | 'cordoned';
    roles: string[];
    cpuPct?: number;
    memPct?: number;
    podCount: number;
    podCap: number;
    age?: string;
    instanceType?: string;
    conditions?: string[];
  }>;
  pods?: Record<string, Array<{
    name: string;
    namespace: string;
    status: string;
    restarts: number;
  }>>;
  maxVisible?: number;
}

export interface BarListSpec {
  kind: 'bar_list';
  title?: string;
  description?: string;
  items: Array<{
    label: string;
    value: number;
    color?: string;
    badge?: string;
    badgeVariant?: 'error' | 'warning' | 'info';
    href?: string;
    gvr?: string;
  }>;
  maxItems?: number;
  valueLabel?: string;
}

export interface ProgressListSpec {
  kind: 'progress_list';
  title?: string;
  description?: string;
  items: Array<{
    label: string;
    value: number;
    max: number;
    unit?: string;
    detail?: string;
  }>;
  thresholds?: { warning: number; critical: number };
}

export interface StatCardSpec {
  kind: 'stat_card';
  title: string;
  value: string;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  trendGood?: 'up' | 'down';
  description?: string;
  status?: 'healthy' | 'warning' | 'error';
}

export interface TimelineSpec {
  kind: 'timeline';
  title?: string;
  description?: string;
  lanes: Array<{
    label: string;
    category: 'alert' | 'event' | 'rollout' | 'config';
    events: Array<{
      timestamp: number;
      endTimestamp?: number;
      label: string;
      severity: 'critical' | 'warning' | 'info' | 'normal';
      detail?: string;
    }>;
  }>;
  correlations?: Array<{
    from: number;
    to: number;
    label: string;
  }>;
  timeRange?: { start: number; end: number };
}

export interface ViewSpec {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  layout: ComponentSpec[];
  positions?: Record<number, { x: number; y: number; w: number; h: number }>;
  generatedAt: number;
  owner?: string;
  templateId?: string;
}

/** Max rows persisted to localStorage to prevent bloat */
export const MAX_PERSISTED_ROWS = 50;

/** Truncate a component spec for persistence */
export function truncateForPersistence(spec: ComponentSpec): ComponentSpec {
  if (spec.kind === 'data_table' && spec.rows.length > MAX_PERSISTED_ROWS) {
    return { ...spec, rows: spec.rows.slice(0, MAX_PERSISTED_ROWS) };
  }
  if (spec.kind === 'log_viewer' && spec.lines.length > MAX_PERSISTED_ROWS) {
    return { ...spec, lines: spec.lines.slice(-MAX_PERSISTED_ROWS) };
  }
  if (spec.kind === 'tabs') {
    return {
      ...spec,
      tabs: spec.tabs.map((tab) => ({
        ...tab,
        components: tab.components.map(truncateForPersistence),
      })),
    };
  }
  if (spec.kind === 'grid') {
    return { ...spec, items: spec.items.map(truncateForPersistence) };
  }
  if (spec.kind === 'section') {
    return { ...spec, components: spec.components.map(truncateForPersistence) };
  }
  return spec;
}

export interface TopologySpec {
  kind: 'topology';
  title?: string;
  description?: string;
  nodes: Array<{
    id: string;
    kind: string;
    name: string;
    namespace: string;
    status?: 'healthy' | 'warning' | 'error';
    risk?: number;
    riskLevel?: 'critical' | 'high' | 'medium' | 'low';
    recentlyChanged?: boolean;
  }>;
  edges: Array<{
    source: string;
    target: string;
    relationship: string;
  }>;
}

export interface ResourceCountsSpec {
  kind: 'resource_counts';
  title?: string;
  namespace?: string;
  items: Array<{
    resource: string;
    count: number;
    gvr?: string;
    status?: 'healthy' | 'warning' | 'error';
  }>;
}
