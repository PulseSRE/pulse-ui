import React from 'react';
import { createPathFor } from '../../engine/routeTable';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSearchParamUpdater } from '../../components/primitives/Tabs';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

import { useK8sListWatch } from '../../hooks/useK8sListWatch';
import { useClusterStore } from '../../store/clusterStore';
import { useFleetStore } from '../../store/fleetStore';
import { useUIStore } from '../../store/uiStore';
import { useCanI } from '../../hooks/useCanI';
import { getColumnsForResource, getEnhancer } from '../../engine/enhancers';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { describePodRestart } from '../../engine/writeGuards';
import { PreviewPanel } from './PreviewPanel';
import { DeleteProgressOverlay } from './DeleteProgress';
import { DrainNodeDialog } from '../../components/DrainNodeDialog';
import { TableToolbar } from './TableToolbar';
import { TableBody } from './TableBody';
import { phoneHiddenColumns } from './columnTemplate';
import { useIsPhone } from '../../hooks/useIsPhone';
import { useTableActions } from './TableActions';
import { BulkDeleteDialog } from './BulkDeleteDialog';
import { DeleteRelatedDialog } from '../../components/workloads/DeleteRelatedDialog';
import { DELETE_WITH_RELATED_KINDS } from '../../components/workloads/WorkloadActionMenu';
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

const NAMESPACE_PARAM_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export default function TableView({ gvrKey, namespace: namespaceProp }: TableViewProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const resourceRegistry = useClusterStore((s) => s.resourceRegistry);
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const setSelectedNamespace = useUIStore((s) => s.setSelectedNamespace);
  const addTab = useUIStore((s) => s.addTab);

  // `?ns=<namespace>` (detail breadcrumbs, agent dashboards, resource_counts
  // cards) selects the namespace. It is applied to the global selector, then
  // dropped from the URL so the selector stays the one source afterwards.
  const [searchParams] = useSearchParams();
  const updateSearch = useSearchParamUpdater();
  const rawNsParam = searchParams.get('ns');
  const nsParam = rawNsParam && (rawNsParam === '*' || NAMESPACE_PARAM_RE.test(rawNsParam)) ? rawNsParam : null;
  React.useEffect(() => {
    if (rawNsParam === null) return;
    if (nsParam) setSelectedNamespace(nsParam);
    updateSearch((next) => next.delete('ns'));
  }, [rawNsParam, nsParam, setSelectedNamespace, updateSearch]);
  const effectiveSelectedNamespace = nsParam ?? selectedNamespace;

  // --- Resource type detection ---
  const resourceType = resourceRegistry?.get(gvrKey)
    ?? (gvrKey.split('/').length === 2 ? resourceRegistry?.get(`core/${gvrKey}`) : undefined);
  const resourceName = gvrKey.split('/').pop() || '';
  const likelyClusterScoped = resourceName.startsWith('cluster') || resourceName === 'nodes' || resourceName === 'namespaces' || resourceName === 'persistentvolumes' || resourceName.includes('customresourcedefinition');
  const isNamespaced = resourceType?.namespaced ?? !likelyClusterScoped;
  const activeNamespace = namespaceProp ?? (isNamespaced && effectiveSelectedNamespace !== '*' ? effectiveSelectedNamespace : undefined);

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
    updateSearch((next) => { if (value === defaultValue) next.delete(key); else next.set(key, value); });
  }, [updateSearch]);

  // Read once for the initial filter and sort; later changes are written back.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- initial values only
  const urlParams = React.useMemo(() => new URLSearchParams(searchParams), []);

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
    const next = typeof updater === 'function' ? updater(sortState) : updater;
    setSortStateInner(next);
    const defaultCol = enhancer?.defaultSort?.column || 'name';
    const defaultDir = enhancer?.defaultSort?.direction || 'asc';
    updateSearch((params) => {
      if (next.column === defaultCol) params.delete('sort'); else params.set('sort', next.column);
      if (next.direction === defaultDir) params.delete('dir'); else params.set('dir', next.direction);
    });
  }, [enhancer, sortState, updateSearch]);

  // --- Selection state ---
  const [selectedRows, setSelectedRows] = React.useState<Set<string>>(new Set());
  const [perPage, setPerPage] = React.useState(25);
  const [previewResource, setPreviewResource] = React.useState<K8sResource | null>(null);
  const [focusedRow, setFocusedRow] = React.useState(-1);

  // --- Column visibility ---
  const [userHiddenColumns, setHiddenColumns] = React.useState<Set<string>>(new Set());
  const [showColumnPicker, setShowColumnPicker] = React.useState(false);
  // At phone width only the key columns start visible; ones the user turns
  // back on in the picker are remembered here.
  const isPhone = useIsPhone();
  const [phoneShown, setPhoneShown] = React.useState<Set<string>>(new Set());
  const hiddenColumns = React.useMemo(() => {
    if (!isPhone) return userHiddenColumns;
    const hidden = new Set(userHiddenColumns);
    for (const id of phoneHiddenColumns(columns)) if (!phoneShown.has(id)) hidden.add(id);
    return hidden;
  }, [isPhone, userHiddenColumns, phoneShown, columns]);

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
      // Keys typed into a field, or Enter/Space on a focused button or link,
      // belong to that control, not to row navigation.
      const target = e.target as HTMLElement;
      if (target.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if ((e.key === 'Enter' || e.key === ' ') && target.closest?.('button, a')) return;

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
    const path = createPathFor(gvrKey);
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

  // "Select all" acts on the rows on this page only, matching what its checkbox
  // shows: every row here selected -> unselect them; otherwise select them.
  // Selections on other pages are kept either way.
  const handleSelectAll = () => {
    const pageUids = paginatedResources.map((r) => r.metadata.uid || '');
    setSelectedRows((prev) => {
      const allOnPage = pageUids.length > 0 && pageUids.every((uid) => prev.has(uid));
      const next = new Set(prev);
      for (const uid of pageUids) {
        if (allOnPage) next.delete(uid); else next.add(uid);
      }
      return next;
    });
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

  // Deployments, StatefulSets and DaemonSets delete through the related-objects
  // dialog, one workload at a time (also for a bulk selection).
  const [relatedQueue, setRelatedQueue] = React.useState<{ items: K8sResource[]; total: number } | null>(null);
  const queueDeleted = React.useRef<string[]>([]);
  const addToast = useUIStore((s) => s.addToast);
  const activeClusterId = useFleetStore((s) => s.activeClusterId);
  const withRelated = (r: K8sResource | undefined) => !!r && DELETE_WITH_RELATED_KINDS.has(r.kind) && !!r.metadata.namespace;
  // A selection survives a search: split it into the rows on screen and the
  // rows the search now hides, so the confirm can say exactly what goes.
  const selectedVisible = sortedResources.filter((r) => selectedRows.has(r.metadata.uid ?? ''));
  const shownUids = new Set(sortedResources.map((r) => r.metadata.uid ?? ''));
  const selectedHidden = stampedResources.filter((r) => selectedRows.has(r.metadata.uid ?? '') && !shownUids.has(r.metadata.uid ?? ''));
  const startRelatedQueue = (items: K8sResource[]) => { queueDeleted.current = []; setRelatedQueue({ items, total: items.length }); };
  // The cluster the confirm was opened on: the deletes go there or nowhere.
  const bulkCluster = React.useRef(activeClusterId);
  const bulkDelete = () => {
    bulkCluster.current = activeClusterId;
    if (selectedHidden.length === 0 && selectedVisible.length > 0 && selectedVisible.every(withRelated)) startRelatedQueue(selectedVisible);
    else actions.setShowBulkDeleteConfirm(true);
  };
  const [bulkDeleting, setBulkDeleting] = React.useState(false);
  const confirmBulkDelete = async (targets: K8sResource[]) => {
    if (targets.length > 0 && targets.every(withRelated)) {
      actions.setShowBulkDeleteConfirm(false);
      startRelatedQueue(targets);
      return;
    }
    setBulkDeleting(true);
    try { await actions.handleBulkDelete(targets, bulkCluster.current); } finally { setBulkDeleting(false); }
    actions.setShowBulkDeleteConfirm(false);
  };

  // Drop selections whose objects are gone (deleted elsewhere, another
  // namespace, another cluster), so the toolbar's count and the confirm's
  // list agree. Only once the list has answered, never mid-load.
  React.useEffect(() => {
    if (isLoading || error) return;
    setSelectedRows((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(stampedResources.map((r) => r.metadata.uid ?? ''));
      const next = new Set([...prev].filter((uid) => present.has(uid)));
      return next.size === prev.size ? prev : next;
    });
  }, [stampedResources, isLoading, error]);
  const queueSummary = (total: number, stopped: boolean) => {
    const done = queueDeleted.current;
    if (total < 2) return;
    addToast({
      type: done.length ? 'success' : 'warning',
      title: `Deleted ${done.length} of ${total} selected workload${total === 1 ? '' : 's'}${stopped ? ' (stopped)' : ''}`,
      detail: done.length ? done.join(', ') : undefined,
    });
  };
  // After a dialog ran: on to the next selected workload, or a summary at the end.
  const nextInQueue = () => {
    const q = relatedQueue;
    if (!q) return;
    if (q.items.length > 1) setRelatedQueue({ ...q, items: q.items.slice(1) });
    else { setRelatedQueue(null); queueSummary(q.total, false); }
  };
  // Cancel, Escape or X: stop the whole queue.
  const cancelQueue = () => {
    const q = relatedQueue;
    setRelatedQueue(null);
    if (q) queueSummary(q.total, true);
  };

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
          const show = hiddenColumns.has(colId);
          setHiddenColumns((prev) => {
            const next = new Set(prev);
            if (show) next.delete(colId); else next.add(colId);
            return next;
          });
          setPhoneShown((prev) => {
            const next = new Set(prev);
            if (show) next.add(colId); else next.delete(colId);
            return next;
          });
        }}
        onShowAllColumns={() => { setHiddenColumns(new Set()); setPhoneShown(new Set(columns.map((c) => c.id))); }}
        showColumnPicker={showColumnPicker}
        onToggleColumnPicker={() => setShowColumnPicker(!showColumnPicker)}
        selectedCount={selectedRows.size}
        canDelete={canDelete}
        onBulkDelete={bulkDelete}
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

      {/* Delete with related objects (row trash on a Deployment/StatefulSet/DaemonSet) */}
      {actions.pendingDelete && withRelated(actions.pendingDelete.resource) && (
        <DeleteRelatedDialog
          workload={actions.pendingDelete.resource}
          workloadRbac={{ group: resourceGroup, plural: resourcePlural }}
          onClose={() => actions.setPendingDelete(null)}
          onDeleted={() => queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] })}
        />
      )}
      {relatedQueue && (
        <DeleteRelatedDialog
          key={relatedQueue.items[0].metadata.uid ?? relatedQueue.items[0].metadata.name}
          workload={relatedQueue.items[0]}
          workloadRbac={{ group: resourceGroup, plural: resourcePlural }}
          queueNote={relatedQueue.total > 1 ? `${relatedQueue.total - relatedQueue.items.length + 1} of ${relatedQueue.total} selected` : undefined}
          onClose={nextInQueue}
          onCancel={cancelQueue}
          onDeleted={() => {
            const done = relatedQueue.items[0];
            queueDeleted.current.push(done.metadata.name);
            queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] });
            // Only this workload leaves the selection; rows the user kept stay selected.
            setSelectedRows((prev) => { const next = new Set(prev); next.delete(done.metadata.uid ?? ''); return next; });
          }}
        />
      )}

      {/* Single Delete Confirmation */}
      {actions.pendingDelete && !withRelated(actions.pendingDelete.resource) && (
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

      {/* Pod restart confirmation: says whether anything will recreate it */}
      {actions.pendingRestart && (() => {
        const plan = describePodRestart(actions.pendingRestart.resource);
        return (
          <ConfirmDialog
            open
            title={plan.title}
            description={plan.description}
            confirmLabel={plan.confirmLabel}
            variant={plan.variant}
            loading={actions.restarting}
            onConfirm={actions.executeRestart}
            onClose={() => actions.setPendingRestart(null)}
          />
        );
      })()}

      {/* Disruptive inline actions (scale to 0, rollout restart) */}
      {actions.pendingConfirm && (
        <ConfirmDialog
          open
          title={actions.pendingConfirm.title}
          description={actions.pendingConfirm.description}
          confirmLabel={actions.pendingConfirm.confirmLabel}
          variant="warning"
          loading={actions.confirming}
          onConfirm={actions.executeConfirm}
          onClose={() => actions.setPendingConfirm(null)}
        />
      )}

      {/* Node drain: confirm, cordon, evict with progress, summary */}
      {actions.pendingDrain && (
        <DrainNodeDialog
          node={actions.pendingDrain.node}
          clusterId={actions.pendingDrain.clusterId}
          onClose={() => actions.setPendingDrain(null)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] })}
        />
      )}

      {/* Bulk Delete Confirmation: lists exactly what will be deleted */}
      {actions.showBulkDeleteConfirm && (
        <BulkDeleteDialog
          visible={selectedVisible}
          hidden={selectedHidden}
          loading={bulkDeleting}
          onConfirm={confirmBulkDelete}
          onClose={() => actions.setShowBulkDeleteConfirm(false)}
        />
      )}

      {/* Footer with pagination */}
      {sortedResources.length > 0 && (
        <div className="border-t border-slate-800 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label htmlFor="resource-table-per-page" className="text-xs text-slate-500">Rows per page:</label>
            <select
              id="resource-table-per-page"
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
