/**
 * Frontend Component Registry — fetches component kind definitions from the backend.
 *
 * Used by DynamicComponent to render unknown component kinds
 * using layout templates defined in the backend registry.
 */

import { agentFetch } from './safeQuery';

export interface ComponentLayout {
  type: string;  // primitive type: stat_card, grid, bar_list, progress_list, key_value, status_list
  label?: string;
  value?: string;
  unit?: string;
  status?: string;
  description?: string;
  link?: string;
  columns?: string | number;
  items?: string;
  item_template?: ComponentLayout;
}

export interface ComponentKindDef {
  description: string;
  category: string;
  required_fields: string[];
  optional_fields: string[];
  supports_mutations: string[];
  example: Record<string, unknown>;
  is_container: boolean;
  layout?: ComponentLayout;
}

let _cache: Record<string, ComponentKindDef> | null = null;
let _fetching = false;

export async function fetchComponentRegistry(): Promise<Record<string, ComponentKindDef>> {
  if (_cache) return _cache;
  if (_fetching) {
    // Wait for in-flight fetch
    await new Promise((resolve) => setTimeout(resolve, 100));
    return _cache || {};
  }

  _fetching = true;
  try {
    const res = await agentFetch('/api/agent/components');
    if (!res.ok) return {};
    _cache = await res.json();
    return _cache || {};
  } catch {
    return {};
  } finally {
    _fetching = false;
  }
}

export function invalidateComponentRegistry(): void {
  _cache = null;
}

export function getKnownKinds(): string[] {
  // Hardcoded kinds that have native renderers — DynamicComponent skips these
  return [
    'data_table', 'info_card_grid', 'badge_list', 'status_list', 'key_value',
    'chart', 'tabs', 'grid', 'section', 'relationship_tree', 'log_viewer',
    'yaml_viewer', 'metric_card', 'node_map', 'bar_list', 'progress_list',
    'stat_card', 'timeline', 'resource_counts',
  ];
}
