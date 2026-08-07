import React, { lazy, Suspense } from 'react';
import { Search, Trash2, Plus, Filter, Columns3, Download, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import type { ColumnDef } from '../../engine/renderers';

const NLFilterBar = lazy(() => import('../../components/agent/NLFilterBar').then(m => ({ default: m.NLFilterBar })));

interface TableToolbarProps {
  resourceKind: string;
  groupVersion: string;
  isNamespaced: boolean;
  activeNamespace: string | undefined;
  sortedCount: number;
  resourcePlural: string;
  resourceName: string;
  resourceType: { kind?: string } | undefined;
  // Search
  searchInput: string;
  onSearchChange: (value: string) => void;
  // Filters
  showFilters: boolean;
  onToggleFilters: () => void;
  showNLFilter: boolean;
  onToggleNLFilter: () => void;
  // Column filter NL callback
  visibleColumns: ColumnDef[];
  onColumnFiltersApplied: (filters: Record<string, string>) => void;
  // Column picker
  columns: ColumnDef[];
  hiddenColumns: Set<string>;
  onToggleColumn: (colId: string) => void;
  onShowAllColumns: () => void;
  showColumnPicker: boolean;
  onToggleColumnPicker: () => void;
  // Bulk ops
  selectedCount: number;
  canDelete: boolean;
  onBulkDelete: () => void;
  // Create
  canCreate: boolean;
  onCreate: () => void;
  // Export
  showExport: boolean;
  onToggleExport: () => void;
  onExport: (format: 'csv' | 'json') => void;
  // Namespace toggle
  onToggleNamespace: () => void;
}

export function TableToolbar({
  resourceKind,
  groupVersion,
  isNamespaced,
  activeNamespace,
  sortedCount,
  resourcePlural,
  resourceName,
  resourceType,
  searchInput,
  onSearchChange,
  showFilters,
  onToggleFilters,
  showNLFilter,
  onToggleNLFilter,
  visibleColumns,
  onColumnFiltersApplied,
  columns,
  hiddenColumns,
  onToggleColumn,
  onShowAllColumns,
  showColumnPicker,
  onToggleColumnPicker,
  selectedCount,
  canDelete,
  onBulkDelete,
  canCreate,
  onCreate,
  showExport,
  onToggleExport,
  onExport,
  onToggleNamespace,
}: TableToolbarProps) {
  return (
    <>
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">{resourceKind}</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {groupVersion} · {isNamespaced ? 'namespaced' : 'cluster-scoped'} ·{' '}
              {sortedCount} found
              {isNamespaced && (
                <span>
                  {' in '}
                  <button
                    onClick={onToggleNamespace}
                    className="text-blue-400 hover:text-blue-300 hover:underline"
                    title="Click to switch namespace"
                  >
                    {activeNamespace || 'all namespaces'}
                  </button>
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Create button */}
            {canCreate && resourcePlural !== 'nodes' && <button
              onClick={onCreate}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-sm hover:bg-blue-500 flex items-center gap-1.5 font-medium"
            >
              <Plus className="w-3 h-3" />
              Create
            </button>}
            {/* Batch actions when items selected */}
            {selectedCount > 0 && (
              <div className="flex items-center gap-2 mr-4">
                <button
                  onClick={onBulkDelete}
                  disabled={!canDelete}
                  className={cn('px-3 py-1.5 text-xs text-white rounded-sm flex items-center gap-1.5',
                    canDelete ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 cursor-not-allowed opacity-50'
                  )}
                  title={canDelete ? `Delete ${selectedCount} selected` : 'No delete permission'}
                >
                  <Trash2 className="w-3 h-3" />
                  Delete {selectedCount}
                </button>
              </div>
            )}
            {/* Export */}
            <div className="relative">
              <button onClick={onToggleExport} className="p-1.5 bg-slate-900 border border-slate-700 rounded-sm text-slate-400 hover:text-slate-200 transition-colors" title="Export">
                <Download className="w-4 h-4" />
              </button>
              {showExport && (
                <>
                  <div className="fixed inset-0 z-40" onClick={onToggleExport} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-sm border border-slate-600 bg-slate-800 shadow-xl py-1">
                    <button onClick={() => onExport('csv')} className="w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-700">Export CSV</button>
                    <button onClick={() => onExport('json')} className="w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-700">Export JSON</button>
                  </div>
                </>
              )}
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search..."
                className="pl-9 pr-3 py-1.5 text-sm bg-slate-900 border border-slate-700 rounded-sm text-slate-200 placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
              />
            </div>
            {/* Filter toggle */}
            <button
              onClick={onToggleFilters}
              className={cn(
                'p-1.5 rounded-sm transition-colors',
                showFilters ? 'bg-blue-600 text-white' : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200'
              )}
              title="Column filters"
            >
              <Filter className="w-4 h-4" />
            </button>
            <button
              onClick={onToggleNLFilter}
              className={cn(
                'p-1.5 rounded-sm transition-colors',
                showNLFilter ? 'bg-amber-600 text-white' : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200'
              )}
              title="AI filter"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            {/* Column picker */}
            <div className="relative">
              <button
                onClick={onToggleColumnPicker}
                className="p-1.5 bg-slate-900 border border-slate-700 rounded-sm text-slate-400 hover:text-slate-200 transition-colors"
                title="Column picker"
              >
                <Columns3 className="w-4 h-4" />
              </button>
              {showColumnPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={onToggleColumnPicker} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-sm border border-slate-600 bg-slate-800 shadow-xl p-2 space-y-1 max-h-80 overflow-auto">
                    <div className="text-xs text-slate-500 px-2 py-1 font-semibold">Show/Hide Columns</div>
                    {columns.map((col) => (
                      <label key={col.id} className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-700 rounded-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!hiddenColumns.has(col.id)}
                          onChange={() => onToggleColumn(col.id)}
                          className="rounded-sm"
                        />
                        {col.header}
                      </label>
                    ))}
                    {hiddenColumns.size > 0 && (
                      <button
                        onClick={onShowAllColumns}
                        className="w-full text-xs text-blue-400 hover:text-blue-300 py-1"
                      >
                        Show all
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* NL Filter Bar */}
      {showNLFilter && (
        <div className="px-4 py-2 border-b border-slate-800">
          <ErrorBoundary fallbackTitle="AI filter failed to load">
            <Suspense fallback={
              <div className="flex items-center gap-3 animate-pulse">
                <div className="h-8 bg-slate-800 rounded-sm flex-1" />
                <div className="h-8 w-20 bg-slate-800 rounded-sm" />
              </div>
            }>
              <NLFilterBar
                resourceKind={resourceType?.kind || resourceName}
                columns={visibleColumns.map(c => c.id)}
                onFiltersApplied={onColumnFiltersApplied}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
    </>
  );
}
