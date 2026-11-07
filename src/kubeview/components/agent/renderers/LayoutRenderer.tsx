/**
 * Layout component renderers: tabs, grid, section.
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { TabsSpec, GridSpec, SectionSpec, ComponentSpec } from '../../../engine/agentComponents';

// AgentComponentRenderer is imported at the module level for recursive rendering.
// This is safe because LayoutRenderer is always consumed after the dispatcher is defined.
import { AgentComponentRenderer } from './index';

export interface LayoutContextProps {
  onAddToView?: (spec: ComponentSpec) => void;
  refreshInterval?: number;
  globalTimeRange?: string;
  hoverTimestamp?: number | null;
  onHoverTimestamp?: (ts: number | null) => void;
  onSpecChange?: (spec: ComponentSpec) => void;
  viewId?: string;
}

export function AgentTabs({ spec, depth = 0, onAddToView, refreshInterval, globalTimeRange, hoverTimestamp, onHoverTimestamp, onSpecChange, viewId }: { spec: TabsSpec; depth?: number } & LayoutContextProps) {
  const [activeTab, setActiveTab] = useState(0);

  if (!spec.tabs?.length) return null;

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0">
      <div className="flex border-b border-slate-700 bg-slate-800/50 overflow-x-auto">
        {(spec.tabs || []).map((tab, i) => (
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
        {(spec.tabs[activeTab]?.components || []).map((child, i) => (
          <AgentComponentRenderer key={i} spec={child} depth={depth + 1} onAddToView={onAddToView} refreshInterval={refreshInterval} globalTimeRange={globalTimeRange} hoverTimestamp={hoverTimestamp} onHoverTimestamp={onHoverTimestamp} onSpecChange={onSpecChange} viewId={viewId} />
        ))}
      </div>
    </div>
  );
}

/** Grid layout that arranges child components in columns */
export function AgentGrid({ spec, depth = 0, onAddToView, refreshInterval, globalTimeRange, hoverTimestamp, onHoverTimestamp, onSpecChange, viewId }: { spec: GridSpec; depth?: number } & LayoutContextProps) {
  const columns = spec.columns ?? 2;

  return (
    <div>
      {spec.title && (
        <div className="mb-2 text-xs font-medium text-slate-300 flex items-center justify-between">
          <div className="truncate">
            <span>{spec.title}</span>
            {spec.description && <span className="text-[10px] text-faint ml-2">{spec.description}</span>}
          </div>
        </div>
      )}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {(spec.items || []).map((item, i) => {
          const spanFull = item.kind === 'resource_counts' || item.kind === 'data_table' || item.kind === 'status_list';
          return (
            <div key={i} style={spanFull ? { gridColumn: `1 / -1` } : undefined}>
              <AgentComponentRenderer spec={item} depth={depth + 1} onAddToView={onAddToView} refreshInterval={refreshInterval} globalTimeRange={globalTimeRange} hoverTimestamp={hoverTimestamp} onHoverTimestamp={onHoverTimestamp} onSpecChange={onSpecChange} viewId={viewId} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Collapsible section with title and optional description */
export function AgentSection({ spec, depth = 0, onAddToView, refreshInterval, globalTimeRange, hoverTimestamp, onHoverTimestamp, onSpecChange, viewId }: { spec: SectionSpec; depth?: number } & LayoutContextProps) {
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
          {(spec.components || []).map((child, i) => (
            <AgentComponentRenderer key={i} spec={child} depth={depth + 1} onAddToView={onAddToView} refreshInterval={refreshInterval} globalTimeRange={globalTimeRange} hoverTimestamp={hoverTimestamp} onHoverTimestamp={onHoverTimestamp} onSpecChange={onSpecChange} viewId={viewId} />
          ))}
        </div>
      )}
    </div>
  );
}
