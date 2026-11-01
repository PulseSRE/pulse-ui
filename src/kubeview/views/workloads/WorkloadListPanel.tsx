/**
 * A Workloads-page list of one kind: each row opens the object and carries
 * the shared WorkloadActionMenu, with optional filters (e.g. Unhealthy).
 */
import React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Panel } from '../../components/primitives/Panel';
import { EmptyState } from '../../components/primitives/EmptyState';
import { FilterButtonGroup } from '../../components/primitives/FilterButtonGroup';
import { WorkloadActionMenu } from '../../components/workloads/WorkloadActionMenu';
import type { K8sResource } from '../../engine/renderers';

export interface RowSummary {
  /** Dot colour. */
  tone: 'ok' | 'warn' | 'bad' | 'idle';
  /** Right-hand text (counts, schedule…). */
  detail: React.ReactNode;
  badges?: string[];
}

export interface ListFilter<T> { key: string; label: string; test: (item: T) => boolean }

const TONE: Record<RowSummary['tone'], string> = {
  ok: 'bg-green-500', warn: 'bg-amber-500', bad: 'bg-red-500', idle: 'bg-slate-500',
};

interface Props<T extends K8sResource> {
  id: string;
  title: string;
  icon: React.ReactNode;
  items: T[];
  gvr: string;
  browseLabel: string;
  emptyText: string;
  summarize: (item: T) => RowSummary;
  filters?: ListFilter<T>[];
  filter: string | null;
  onFilterChange: (key: string | null) => void;
  go: (path: string, title: string) => void;
  /** Extra buttons per row, before the actions menu (e.g. logs). */
  rowExtras?: (item: T) => React.ReactNode;
  limit?: number;
}

export function WorkloadListPanel<T extends K8sResource>({
  id, title, icon, items, gvr, browseLabel, emptyText, summarize, filters = [], filter, onFilterChange, go, rowExtras, limit = 50,
}: Props<T>) {
  const active = filters.find((f) => f.key === filter);
  const shown = active ? items.filter(active.test) : items;

  return (
    <div id={id} className="scroll-mt-4">
      <Panel title={`${title} (${items.length})`} icon={icon}>
        {items.length > 0 && filters.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
            <FilterButtonGroup
              options={[
                { key: null, label: `All (${items.length})` },
                ...filters.map((f) => ({ key: f.key, label: `${f.label} (${items.filter(f.test).length})` })),
              ]}
              value={filter}
              onChange={onFilterChange}
            />
          </div>
        )}
        {items.length === 0 ? (
          <EmptyState icon={icon} title={emptyText} className="py-6" />
        ) : shown.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">No {title.toLowerCase()} match this filter.</p>
        ) : (
          <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
            {shown.slice(0, limit).map((item) => {
              const s = summarize(item);
              const ns = item.metadata.namespace;
              return (
                <div key={item.metadata.uid ?? `${ns}/${item.metadata.name}`} className="flex items-center gap-1 pr-2 hover:bg-slate-800/50 transition-colors">
                  <button
                    onClick={() => go(`/r/${gvr}/${ns}/${item.metadata.name}`, item.metadata.name)}
                    className="flex-1 min-w-0 flex items-center justify-between px-3 py-2 text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn('w-2 h-2 rounded-full shrink-0', TONE[s.tone])} />
                      <span className="text-sm text-slate-200 truncate">{item.metadata.name}</span>
                      <span className="text-xs text-slate-500">{ns}</span>
                      {s.badges?.map((b) => (
                        <span key={b} className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded-sm">{b}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs">{s.detail}</div>
                  </button>
                  {rowExtras?.(item)}
                  <WorkloadActionMenu resource={item} />
                </div>
              );
            })}
          </div>
        )}
        <div className="px-3 py-2 border-t border-slate-800 flex items-center justify-between">
          <button onClick={() => go(`/r/${gvr}`, title)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            {browseLabel} <ArrowRight className="w-3 h-3" />
          </button>
          {shown.length > limit && <span className="text-xs text-slate-500">Showing {limit} of {shown.length}</span>}
        </div>
      </Panel>
    </div>
  );
}
