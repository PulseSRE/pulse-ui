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
  | SectionSpec;

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
  chartType?: 'line' | 'bar' | 'area';  // default 'line'
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

export interface ViewSpec {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  layout: ComponentSpec[];
  positions?: Record<number, { x: number; y: number; w: number; h: number }>;
  generatedAt: number;
  owner?: string;
}

/** Max rows persisted to localStorage to prevent bloat */
export const MAX_PERSISTED_ROWS = 50;

/** Truncate a component spec for persistence */
export function truncateForPersistence(spec: ComponentSpec): ComponentSpec {
  if (spec.kind === 'data_table' && spec.rows.length > MAX_PERSISTED_ROWS) {
    return { ...spec, rows: spec.rows.slice(0, MAX_PERSISTED_ROWS) };
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
