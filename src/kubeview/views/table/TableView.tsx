import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

import { useK8sListWatch } from '../../hooks/useK8sListWatch';
import { useClusterStore } from '../../store/clusterStore';
import { useUIStore } from '../../store/uiStore';
import { useCanI } from '../../hooks/useCanI';
import { getColumnsForResource, getEnhancer } from '../../engine/enhancers';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { PreviewPanel } from './PreviewPanel';
import { DeleteProgressOverlay } from './DeleteProgress';
import { TableToolbar } from './TableToolbar';
import { TableBody } from './TableBody';
import { useTableActions } from './TableActions';
import type { K8sResource } from '../../engine/renderers';

interface TableViewProps {
  gvrKey: string;
  namespace?: string;
}

type SortDirection = 'asc' | 'desc';

interface SortState {
  column: string;
  direction: SortDirection;
}

/**
 * Compare two values according to the column's sortType.
 * Exported for unit testing.
 */
export function compareValues(aValue: unknown, bValue: unknown, sortType?: 'string' | 'number' | 'date'): number {
  if (aValue == null && bValue == null) return 0;
  if (aValue == null) return 1;
  if (bValue == null) return -1;

  if (sortType === 'number') {
    const aNum = Number(aValue);
    const bNum = Number(bValue);
    const aSafe = Number.isFinite(aNum) ? aNum : 0;
    const bSafe = Number.isFinite(bNum) ? bNum : 0;
    return aSafe - bSafe;
  }

  if (sortType === 'date') {
    const aTime = new Date(String(aValue)).getTime();
    const bTime = new Date(String(bValue)).getTime();
    const aSafe = Number.isFinite(aTime) ? aTime : 0;
    const bSafe = Number.isFinite(bTime) ? bTime : 0;
    return aSafe - bSafe;
  }

  return String(aValue).localeCompare(String(bValue));
}

export default function TableView({ gvrKey, namespace: namespaceProp }: TableViewProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const resourceRegistry = useClusterStore((s) => s.resourceRegistry);
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const addTab = useUIStore((s) => s.addTab);

  // --- Resource type detection ---
  const resourceType = resourceRegistry?.get(gvrKey)
    ?? (gvrKey.split('/').length === 2 ? resourceRegistry?.get(`core/${gvrKey}`) : undefined);
  const resourceName = gvrKey.split('/').pop() || '';
  const likelyClusterScoped = resourceName.startsWith('cluster') || resourceName === 'nodes' || resourceName === 'namespaces' || resourceName === 'persistentvolumes' || resourceName.includes('customresourcedefinition');
  const isNamespaced = resourceType?.namespaced ?? !likelyClusterScoped;
  const activeNamespace = namespaceProp ?? (isNamespaced && selectedNamespace !== '*' ? selectedNamespace : undefined);

  // --- API path ---
  const apiPath = React.useMemo(() => {
    const parts = gvrKey.split('/');
    if (parts.length === 2) {
      const [version, resource] = parts;
      return `/api/${version}/${resource}`;
    } else if (parts.length === 3) {
      const [group, version, resource] = parts;
      return `/apis/${group}/${version}/${resource}`;
    }
    return '';
  }, [gvrKey]);

  // --- Data fetching ---
  const { data: resources = [], isLoading, error } = useK8sListWatch<K8sResource>({
    apiPath,
    namespace: activeNamespace,
    enabled: !!apiPath,
  });

  const stampedResources = React.useMemo(
    () => resources.map((r) => ({ ...r, _gvrKey: gvrKey })),
    [resources, gvrKey]
  );

  // --- Column detection ---
  const columnStructureKey = React.useMemo(() => {
    if (stampedResources.length === 0) return '';
    const sample = stampedResources[0];
    return [
      sample.kind,
      Object.keys(sample).sort().join(','),
      Object.keys(sample.spec || {}).slice(0, 10).sort().join(','),
      Object.keys((sample as K8sResource & { status?: Record<string, unknown> }).status || {}).slice(0, 10).sort().join(','),
    ].join('|');
  }, [stampedResources]);

  const columns = React.useMemo(
    () => getColumnsForResource(gvrKey, isNamespaced, stampedResources),
    [gvrKey, isNamespaced, columnStructureKey]
  );

  const enhancer = getEnhancer(gvrKey);

  // --- RBAC ---
  const gvrParts = gvrKey.split('/');
  const resourceGroup = gvrParts.length === 3 ? gvrParts[0] : '';
  const resourcePlural = gvrParts[gvrParts.length - 1];
  const { allowed: canDelete } = useCanI('delete', resourceGroup, resourcePlural, activeNamespace);
  const { allowed: canUpdate } = useCanI('update', resourceGroup, resourcePlural, activeNamespace);
  const { allowed: canCreate } = useCanI('create', resourceGroup, resourcePlural, activeNamespace);

  // --- URL param helpers ---
  const updateUrlParam = React.useCallback((key: string, value: string, defaultValue: string) => {
    const url = new URL(window.location.href);
    if (value === defaultValue) url.searchParams.delete(key); else url.searchParams.set(key, value);
    window.history.replaceState(null, '', url.toString());
  }, []);

  const urlParams = React.useMemo(() => new URLSearchParams(window.location.search), []);

  // --- Filter / search state ---
  const [searchInput, setSearchInput] = React.useState(urlParams.get('q') || '');
  const [searchTerm, setSearchTerm] = React.useState(urlParams.get('q') || '');
  const [columnFilters, setColumnFilters] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
      updateUrlParam('q', searchInput, '');
    }, 200);
    return () => clearTimeout(timer);
  }, [searchInput, updateUrlParam]);

  const [showFilters, setShowFilters] = React.useState(false);
  const [showNLFilter, setShowNLFilter] = React.useState(false);

  // --- Sort state ---
  const [sortState, setSortStateInner] = React.useState<SortState>({
    column: urlParams.get('sort') || enhancer?.defaultSort?.column || 'name',
    direction: (urlParams.get('dir') as SortDirection) || enhancer?.defaultSort?.direction || 'asc',
  });
  const setSortState = React.useCallback((updater: SortState | ((prev: SortState) => SortState)) => {
    setSortStateInner((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const defaultCol = enhancer?.defaultSort?.column || 'name';
      const defaultDir = enhancer?.defaultSort?.direction || 'asc';
      const url = new URL(window.location.href);
      if (next.column === defaultCol) url.searchParams.delete('sort'); else url.searchParams.set('sort', next.column);
      if (next.direction === defaultDir) url.searchParams.delete('dir'); else url.searchParams.set('dir', next.direction);
      window.history.replaceState(null, '', url.toString());
      return next;
    });
  }, [enhancer]);

  // --- Selection state ---
  const [selectedRows, setSelectedRows] = React.useState<Set<string>>(new Set());
  const [perPage, setPerPage] = React.useState(25);
  const [previewResource, setPreviewResource] = React.useState<K8sResource | null>(null);
  const [focusedRow, setFocusedRow] = React.useState(-1);

  // --- Column visibility ---
  const [hiddenColumns, setHiddenColumns] = React.useState<Set<string>>(new Set());
  const [showColumnPicker, setShowColumnPicker] = React.useState(false);

  const visibleColumns = React.useMemo(
    () => columns.filter((c) => !hiddenColumns.has(c.id)),
    [columns, hiddenColumns]
  );

  // --- Filtering ---
  const filteredResources = React.useMemo(() => {
    let result = stampedResources;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((resource) => {
        if (resource.metadata.name.toLowerCase().includes(term)) return true;
        if (resource.metadata.namespace?.toLowerCase().includes(term)) return true;
        const labels = resource.metadata.labels || {};
        for (const [key, value] of Object.entries(labels)) {
          if (key.toLowerCase().includes(term) || value.toLowerCase().includes(term)) return true;
        }
        for (const col of visibleColumns) {
          const val = String(col.accessorFn(resource) ?? '');
          if (val.toLowerCase().includes(term)) return true;
        }
        return false;
      });
    }

    for (const [colId, filterVal] of Object.entries(columnFilters)) {
      if (!filterVal) continue;
      const col = columns.find((c) => c.id === colId);
      if (!col) continue;
      const term = filterVal.toLowerCase();
      result = result.filter((resource) => {
        const val = String(col.accessorFn(resource) ?? '');
        return val.toLowerCase().includes(term);
      });
    }

    return result;
  }, [stampedResources, searchTerm, columnFilters, visibleColumns, columns]);

  // --- Sorting ---
  const sortedResources = React.useMemo(() => {
    const sorted = [...filteredResources];
    const column = columns.find((c) => c.id === sortState.column);
    if (!column || !column.sortable) return sorted;

    sorted.sort((a, b) => {
      const aValue = column.accessorFn(a);
      const bValue = column.accessorFn(b);
      const comparison = compareValues(aValue, bValue, column.sortType);
      return sortState.direction === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [filteredResources, sortState, columns]);

  // --- Pagination ---
  const urlPage = parseInt(urlParams.get('page') || '0', 10);
  const [currentPage, setCurrentPageInner] = React.useState(isNaN(urlPage) ? 0 : urlPage);
  const setCurrentPage = React.useCallback((updater: number | ((prev: number) => number)) => {
    setCurrentPageInner((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      updateUrlParam('page', String(next), '0');
      return next;
    });
  }, [updateUrlParam]);
  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setCurrentPage(0);
  }, [searchTerm, columnFilters, activeNamespace]);
  const paginatedResources = React.useMemo(() => {
    const start = currentPage * perPage;
    return sortedResources.slice(start, start + perPage);
  }, [sortedResources, currentPage, perPage]);
  const totalPages = Math.ceil(sortedResources.length / perPage);

  // --- Keyboard navigation ---
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      const maxRow = paginatedResources.length - 1;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedRow((prev) => Math.min(prev + 1, maxRow));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedRow((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && focusedRow >= 0 && focusedRow <= maxRow) {
        e.preventDefault();
        const resource = paginatedResources[focusedRow];
        if (resource) {
          const gvrUrl = gvrKey.replace(/\//g, '~');
          const ns = resource.metadata.namespace;
          const name = resource.metadata.name;
          const path = ns ? `/r/${gvrUrl}/${ns}/${name}` : `/r/${gvrUrl}/_/${name}`;
          addTab({ title: name, path, pinned: false, closable: true });
          navigate(path);
        }
      } else if (e.key === 'x' && focusedRow >= 0 && focusedRow <= maxRow) {
        const resource = paginatedResources[focusedRow];
        if (resource) {
          const uid = resource.metadata.uid || '';
          setSelectedRows((prev) => {
            const next = new Set(prev);
            if (next.has(uid)) next.delete(uid); else next.add(uid);
            return next;
          });
        }
      } else if (e.key === ' ' && focusedRow >= 0 && focusedRow <= maxRow) {
        e.preventDefault();
        setPreviewResource(paginatedResources[focusedRow] || null);
      } else if (e.key === 'Escape') {
        setPreviewResource(null);
        setFocusedRow(-1);
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusedRow, paginatedResources, gvrKey, navigate, addTab]);

  // --- Derived display values ---
  const resourceKind = React.useMemo(() => {
    const parts = gvrKey.split('/');
    const rn = parts[parts.length - 1];
    return rn.charAt(0).toUpperCase() + rn.slice(1);
  }, [gvrKey]);

  const groupVersion = React.useMemo(() => {
    const parts = gvrKey.split('/');
    if (parts.length === 2) return parts[0];
    if (parts.length === 3) return `${parts[0]}/${parts[1]}`;
    return '';
  }, [gvrKey]);

  const handleCreate = React.useCallback(() => {
    const gvrUrl = gvrKey.replace(/\//g, '~');
    const path = `/create/${gvrUrl}?tab=yaml`;
    addTab({ title: `Create ${resourceKind}`, path, pinned: false, closable: true });
    navigate(path);
  }, [gvrKey, resourceKind, addTab, navigate]);

  // --- Event handlers ---
  const handleSort = (columnId: string) => {
    const column = columns.find((c) => c.id === columnId);
    if (!column?.sortable) return;
    setSortState((prev) => ({
      column: columnId,
      direction: prev.column === columnId && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const handleRowSelect = (uid: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedRows.size === paginatedResources.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(paginatedResources.map((r) => r.metadata.uid || '')));
    }
  };

  const handleRowClick = React.useCallback((resource: K8sResource, e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input') || target.closest('button') || target.closest('a')) return;

    if (e.detail === 2) {
      const gvrUrl = gvrKey.replace(/\//g, '~');
      const ns = resource.metadata.namespace;
      const name = resource.metadata.name;
      const path = ns ? `/r/${gvrUrl}/${ns}/${name}` : `/r/${gvrUrl}/_/${name}`;
      addTab({ title: name, path, pinned: false, closable: true });
      navigate(path);
    } else {
      setPreviewResource((prev) => prev?.metadata.uid === resource.metadata.uid ? null : resource);
    }
  }, [gvrKey, navigate, addTab]);

  // --- Actions hook ---
  const actions = useTableActions({
    apiPath,
    gvrKey,
    sortedResources,
    stampedResources,
    visibleColumns,
    resourceKind,
    selectedRows,
    setSelectedRows,
  });

  // --- Error state ---
  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <div className="text-center max-w-md">
          <div className="mb-4 mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-950/50 border border-red-900/50">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-slate-100 mb-1">Error loading resources</h2>
          <p className="text-sm text-red-400 mb-2">{(error as Error).message}</p>
          <p className="text-xs text-slate-500 mb-6">Check your cluster connection and ensure you have permission to list {resourceKind.toLowerCase()}.</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['k8s', 'list', apiPath] })}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-2 font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 text-sm bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 border border-slate-700"
            >
              <Home className="w-4 h-4" />
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Render ---
  return (
    <div className="h-full flex flex-col bg-slate-950">
      <TableToolbar
        resourceKind={resourceKind}
        groupVersion={groupVersion}
        isNamespaced={isNamespaced}
        activeNamespace={activeNamespace}
        sortedCount={sortedResources.length}
        resourcePlural={resourcePlural}
        resourceName={resourceName}
        resourceType={resourceType as { kind?: string } | undefined}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters(!showFilters)}
        showNLFilter={showNLFilter}
        onToggleNLFilter={() => setShowNLFilter(!showNLFilter)}
        visibleColumns={visibleColumns}
        onColumnFiltersApplied={(filters) => setColumnFilters(prev => ({ ...prev, ...filters }))}
        columns={columns}
        hiddenColumns={hiddenColumns}
        onToggleColumn={(colId) => {
          setHiddenColumns((prev) => {
            const next = new Set(prev);
            if (next.has(colId)) next.delete(colId); else next.add(colId);
            return next;
          });
        }}
        onShowAllColumns={() => setHiddenColumns(new Set())}
        showColumnPicker={showColumnPicker}
        onToggleColumnPicker={() => setShowColumnPicker(!showColumnPicker)}
        selectedCount={selectedRows.size}
        canDelete={canDelete}
        onBulkDelete={() => actions.setShowBulkDeleteConfirm(true)}
        canCreate={canCreate}
        onCreate={handleCreate}
        showExport={actions.showExport}
        onToggleExport={() => actions.setShowExport(!actions.showExport)}
        onExport={(format) => { actions.handleExport(format); actions.setShowExport(false); }}
        onToggleNamespace={() => {
          const next = activeNamespace ? '*' : 'default';
          useUIStore.getState().setSelectedNamespace(next);
        }}
      />

      {/* Table + Preview */}
      <div className="flex-1 flex overflow-hidden">
        <TableBody
          paginatedResources={paginatedResources}
          stampedResources={stampedResources}
          visibleColumns={visibleColumns}
          sortState={sortState}
          showFilters={showFilters}
          columnFilters={columnFilters}
          onColumnFilterChange={(colId, value) => setColumnFilters((prev) => ({ ...prev, [colId]: value }))}
          selectedRows={selectedRows}
          focusedRow={focusedRow}
          onSort={handleSort}
          onRowSelect={handleRowSelect}
          onSelectAll={handleSelectAll}
          onRowClick={handleRowClick}
          onFocusRow={setFocusedRow}
          isLoading={isLoading}
          searchTerm={searchTerm}
          resourceKind={resourceKind}
          activeNamespace={activeNamespace}
          canCreate={canCreate}
          resourcePlural={resourcePlural}
          onCreate={handleCreate}
          onClearFilters={() => { setSearchInput(''); setSearchTerm(''); setColumnFilters({}); }}
          enhancer={enhancer}
          handleAction={actions.handleAction}
          inlineActionLoading={actions.inlineActionLoading}
          canDelete={canDelete}
          canUpdate={canUpdate}
          gvrKey={gvrKey}
          previewResource={previewResource}
        />

        {/* Preview panel */}
        {previewResource && (
          <PreviewPanel
            resource={previewResource}
            gvrKey={gvrKey}
            onClose={() => setPreviewResource(null)}
          />
        )}
      </div>

      {/* Delete Progress */}
      {actions.deleteProgress.length > 0 && (
        <DeleteProgressOverlay
          items={actions.deleteProgress}
          onClose={() => actions.setDeleteProgress([])}
        />
      )}

      {/* Single Delete Confirmation */}
      {actions.pendingDelete && (
        <ConfirmDialog
          open={!!actions.pendingDelete}
          title={`Delete ${actions.pendingDelete.resource.kind}`}
          description={`Are you sure you want to delete "${actions.pendingDelete.resource.metadata?.name}"${actions.pendingDelete.resource.metadata?.namespace ? ` from ${actions.pendingDelete.resource.metadata.namespace}` : ''}? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          loading={actions.singleDeleting}
          onConfirm={actions.executeDelete}
          onClose={() => actions.setPendingDelete(null)}
        />
      )}

      {/* Bulk Delete Confirmation */}
      {actions.showBulkDeleteConfirm && (
        <ConfirmDialog
          open={actions.showBulkDeleteConfirm}
          title={`Delete ${selectedRows.size} resource${selectedRows.size !== 1 ? 's' : ''}`}
          description={`Are you sure you want to delete ${selectedRows.size} selected resource${selectedRows.size !== 1 ? 's' : ''}? This action cannot be undone.`}
          confirmLabel="Delete All"
          variant="danger"
          onConfirm={async () => { await actions.handleBulkDelete(); actions.setShowBulkDeleteConfirm(false); }}
          onClose={() => actions.setShowBulkDeleteConfirm(false)}
        />
      )}

      {/* Footer with pagination */}
      {sortedResources.length > 0 && (
        <div className="border-t border-slate-800 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Rows per page:</span>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setCurrentPage(0);
              }}
              className="text-xs bg-slate-900 border border-slate-700 rounded-sm px-2 py-1 text-slate-200"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500">
              {currentPage * perPage + 1}-{Math.min((currentPage + 1) * perPage, sortedResources.length)} of{' '}
              {sortedResources.length}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage === totalPages - 1}
                className="px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
