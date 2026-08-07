import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate } from 'react-router-dom';
import { ChevronUp, ChevronDown, Trash2, Loader2, FileEdit, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '../../store/uiStore';
import { EmptyState } from '../../components/primitives/EmptyState';
import type { K8sResource, ColumnDef } from '../../engine/renderers';
import type { ResourceEnhancer } from '../../engine/enhancers';

interface SortState {
  column: string;
  direction: 'asc' | 'desc';
}

interface TableBodyProps {
  paginatedResources: K8sResource[];
  stampedResources: K8sResource[];
  visibleColumns: ColumnDef[];
  sortState: SortState;
  showFilters: boolean;
  columnFilters: Record<string, string>;
  onColumnFilterChange: (colId: string, value: string) => void;
  selectedRows: Set<string>;
  focusedRow: number;
  onSort: (columnId: string) => void;
  onRowSelect: (uid: string) => void;
  onSelectAll: () => void;
  onRowClick: (resource: K8sResource, e: React.MouseEvent) => void;
  onFocusRow: (index: number) => void;
  // Loading / empty states
  isLoading: boolean;
  searchTerm: string;
  resourceKind: string;
  activeNamespace: string | undefined;
  canCreate: boolean;
  resourcePlural: string;
  onCreate: () => void;
  onClearFilters: () => void;
  // Inline actions
  enhancer: ResourceEnhancer | undefined;
  handleAction: (action: string, payload?: unknown) => Promise<void>;
  inlineActionLoading: string | null;
  canDelete: boolean;
  canUpdate: boolean;
  gvrKey: string;
  // Preview
  previewResource: K8sResource | null;
}

export function TableBody({
  paginatedResources,
  stampedResources,
  visibleColumns,
  sortState,
  showFilters,
  columnFilters,
  onColumnFilterChange,
  selectedRows,
  focusedRow,
  onSort,
  onRowSelect,
  onSelectAll,
  onRowClick,
  onFocusRow,
  isLoading,
  searchTerm,
  resourceKind,
  activeNamespace,
  canCreate,
  resourcePlural,
  onCreate,
  onClearFilters,
  enhancer,
  handleAction,
  inlineActionLoading,
  canDelete,
  canUpdate,
  gvrKey,
  previewResource,
}: TableBodyProps) {
  const navigate = useNavigate();
  const addTab = useUIStore((s) => s.addTab);

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: paginatedResources.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 36,
    overscan: 20,
  });

  if (isLoading) {
    return (
      <div ref={tableContainerRef} className={cn('overflow-auto', previewResource ? 'flex-1' : 'w-full')}>
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <div className="w-4 h-4 bg-slate-800 rounded-sm" />
              <div className="h-4 bg-slate-800 rounded-sm flex-1 max-w-[200px]" />
              <div className="h-4 bg-slate-800 rounded-sm flex-1 max-w-[120px]" />
              <div className="h-4 bg-slate-800 rounded-sm w-20" />
              <div className="h-4 bg-slate-800 rounded-sm w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const noData = stampedResources.length === 0 && !searchTerm && Object.values(columnFilters).every(v => !v);

  if (noData) {
    return (
      <div ref={tableContainerRef} className={cn('overflow-auto', previewResource ? 'flex-1' : 'w-full')}>
        <EmptyState
          icon={<Inbox className="w-8 h-8" />}
          title={`No ${resourceKind.toLowerCase()} found`}
          description={activeNamespace
            ? `There are no ${resourceKind.toLowerCase()} in the "${activeNamespace}" namespace.`
            : `There are no ${resourceKind.toLowerCase()} in this cluster.`}
          action={canCreate && resourcePlural !== 'nodes' ? {
            label: `Create ${resourceKind}`,
            onClick: onCreate,
          } : undefined}
          className="h-64"
        />
      </div>
    );
  }

  return (
    <div ref={tableContainerRef} className={cn('overflow-auto', previewResource ? 'flex-1' : 'w-full')}>
      {/* Header table for column alignment */}
      <table className="w-full">
        <thead className="bg-slate-900 sticky top-0 z-10">
          <tr>
            <th className="px-4 py-3 text-left w-12">
              <input
                type="checkbox"
                checked={selectedRows.size === paginatedResources.length && paginatedResources.length > 0}
                onChange={onSelectAll}
                className="w-4 h-4 rounded-sm border-slate-600 bg-slate-800 text-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </th>
            {visibleColumns.map((column) => (
              <th
                key={column.id}
                className={cn(
                  'px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide',
                  column.sortable && 'cursor-pointer hover:text-slate-300'
                )}
                style={{ width: column.width }}
                onClick={() => column.sortable && onSort(column.id)}
              >
                <div className="flex items-center gap-1">
                  {column.header}
                  {column.sortable && sortState.column === column.id && (
                    sortState.direction === 'asc' ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )
                  )}
                </div>
              </th>
            ))}
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Actions
            </th>
          </tr>
          {/* Column filter row */}
          {showFilters && (
            <tr className="bg-slate-900/80">
              <th className="px-4 py-1" />
              {visibleColumns.map((column) => (
                <th key={`filter-${column.id}`} className="px-4 py-1">
                  <input
                    type="text"
                    value={columnFilters[column.id] || ''}
                    onChange={(e) => onColumnFilterChange(column.id, e.target.value)}
                    placeholder={`Filter ${column.header}...`}
                    className="w-full px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded-sm text-slate-200 placeholder-slate-600 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                  />
                </th>
              ))}
              <th className="px-4 py-1" />
            </tr>
          )}
        </thead>
      </table>

      {/* Empty filtered state */}
      {paginatedResources.length === 0 && (
        <div className="px-4 py-12 text-center">
          <p className="text-slate-400 text-sm">
            0 of {stampedResources.length} {resourceKind.toLowerCase()} match your filters
          </p>
          {(searchTerm || Object.values(columnFilters).some(v => v)) && (
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
              {searchTerm && (
                <span>
                  Search: &quot;<span className="text-slate-300">{searchTerm}</span>&quot;
                </span>
              )}
              {Object.entries(columnFilters)
                .filter(([, v]) => v)
                .map(([colId, value]) => {
                  const col = visibleColumns.find((c) => c.id === colId);
                  return (
                    <span key={colId}>
                      {col?.header || colId}: &quot;<span className="text-slate-300">{value}</span>&quot;
                    </span>
                  );
                })}
            </div>
          )}
          {(searchTerm || Object.values(columnFilters).some(v => v)) && (
            <button
              onClick={onClearFilters}
              className="mt-2 text-xs text-blue-400 hover:text-blue-300"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Div-based virtualized body */}
      {paginatedResources.length > 0 && (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowIndex = virtualRow.index;
            const resource = paginatedResources[rowIndex];
            const uid = resource.metadata.uid || '';
            const isSelected = selectedRows.has(uid);
            const isFocused = rowIndex === focusedRow;

            return (
              <div
                key={uid}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={cn(
                  'flex items-center border-b border-slate-800/50 hover:bg-slate-800/70 transition-colors cursor-pointer',
                  isSelected && 'bg-slate-900/70',
                  isFocused && 'ring-1 ring-inset ring-blue-500/50 bg-blue-950/20'
                )}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={(e) => { onFocusRow(rowIndex); onRowClick(resource, e); }}
              >
                <div className="px-4 py-3 shrink-0" style={{ width: 48 }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onRowSelect(uid)}
                    className="w-4 h-4 rounded-sm border-slate-600 bg-slate-800 text-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {visibleColumns.map((column) => {
                  const value = column.accessorFn(resource);
                  return (
                    <div key={column.id} className="px-4 py-3 truncate" style={{ width: column.width, flex: column.width ? `0 0 ${column.width}` : '1 1 0%' }}>
                      {column.render(value, resource)}
                    </div>
                  );
                })}
                <div className="px-4 py-3 shrink-0">
                  <div className="flex items-center gap-1">
                    {enhancer?.inlineActions?.map((action) => (
                      <div key={action.id}>
                        {action.render(resource, handleAction)}
                      </div>
                    ))}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const gvrUrl = gvrKey.replace(/\//g, '~');
                        const ns = resource.metadata.namespace;
                        const yamlPath = ns ? `/yaml/${gvrUrl}/${ns}/${resource.metadata.name}` : `/yaml/${gvrUrl}/_/${resource.metadata.name}`;
                        addTab({ title: `${resource.metadata.name} (YAML)`, path: yamlPath, pinned: false, closable: true });
                        navigate(yamlPath);
                      }}
                      className={cn('inline-flex items-center px-1.5 py-1 text-xs rounded-sm transition-colors disabled:opacity-50', canUpdate ? 'text-slate-500 hover:bg-blue-900/50 hover:text-blue-400' : 'text-slate-700 cursor-not-allowed')}
                      title={canUpdate ? 'Edit YAML' : 'No update permission'}
                      disabled={!canUpdate}
                    >
                      <FileEdit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction('delete-single', { resource }); }}
                      disabled={!canDelete || inlineActionLoading === `${resource.metadata.uid}-delete-single`}
                      className={cn('inline-flex items-center px-1.5 py-1 text-xs rounded-sm transition-colors disabled:opacity-50',
                        canDelete ? 'text-slate-500 hover:bg-red-900/50 hover:text-red-400' : 'text-slate-700 cursor-not-allowed'
                      )}
                      title={canDelete ? 'Delete' : 'No delete permission'}
                    >
                      {inlineActionLoading === `${resource.metadata.uid}-delete-single`
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
