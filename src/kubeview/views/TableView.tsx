import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronUp, ChevronDown, Trash2, Tag, Plus, Filter, Columns3, X, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList, k8sPatch, k8sDelete } from '../engine/query';
import { jsonToYaml } from '../engine/yamlUtils';
import { useClusterStore } from '../store/clusterStore';
import { useUIStore } from '../store/uiStore';
import type { K8sResource, ColumnDef } from '../engine/renderers';
import { kindToPlural } from '../engine/renderers/index';
import { getColumnsForResource } from '../engine/enhancers';
import { getEnhancer } from '../engine/enhancers';

interface TableViewProps {
  gvrKey: string;
  namespace?: string;
}

type SortDirection = 'asc' | 'desc';

interface SortState {
  column: string;
  direction: SortDirection;
}

export default function TableView({ gvrKey, namespace: namespaceProp }: TableViewProps) {
  const navigate = useNavigate();
  const resourceRegistry = useClusterStore((s) => s.resourceRegistry);
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const addTab = useUIStore((s) => s.addTab);

  // Determine if resource is namespaced
  // Registry uses "core/v1/pods" for core resources, but URL-derived keys are "v1/pods"
  const resourceType = resourceRegistry?.get(gvrKey)
    ?? (gvrKey.split('/').length === 2 ? resourceRegistry?.get(`core/${gvrKey}`) : undefined);
  const isNamespaced = resourceType?.namespaced ?? true;

  // Use prop namespace, or selected namespace for namespaced resources, or undefined for cluster-scoped
  const activeNamespace = namespaceProp ?? (isNamespaced && selectedNamespace !== '*' ? selectedNamespace : undefined);

  // Build API path from GVR key
  const apiPath = React.useMemo(() => {
    const parts = gvrKey.split('/');
    if (parts.length === 2) {
      // Core API: v1/pods
      const [version, resource] = parts;
      return `/api/${version}/${resource}`;
    } else if (parts.length === 3) {
      // Named group: apps/v1/deployments
      const [group, version, resource] = parts;
      return `/apis/${group}/${version}/${resource}`;
    }
    return '';
  }, [gvrKey]);

  // Fetch resources
  const { data: resources = [], isLoading, error } = useQuery<K8sResource[]>({
    queryKey: ['table', apiPath, activeNamespace],
    queryFn: () => k8sList<K8sResource>(apiPath, activeNamespace),
    enabled: !!apiPath,
    refetchInterval: 30000,
  });

  // Stamp GVR key onto resources so renderers can build URLs
  const stampedResources = React.useMemo(
    () => resources.map((r) => ({ ...r, _gvrKey: gvrKey })),
    [resources, gvrKey]
  );

  // Get columns for this resource type (pass resources for auto-detection)
  const columns = React.useMemo(
    () => getColumnsForResource(gvrKey, isNamespaced, stampedResources),
    [gvrKey, isNamespaced, stampedResources]
  );

  // Get enhancer for inline actions
  const enhancer = getEnhancer(gvrKey);

  // State
  const [searchTerm, setSearchTerm] = React.useState('');
  const [columnFilters, setColumnFilters] = React.useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = React.useState(false);
  const [sortState, setSortState] = React.useState<SortState>({
    column: enhancer?.defaultSort?.column || 'name',
    direction: enhancer?.defaultSort?.direction || 'asc',
  });
  const [selectedRows, setSelectedRows] = React.useState<Set<string>>(new Set());
  const [perPage, setPerPage] = React.useState(25);
  const [previewResource, setPreviewResource] = React.useState<K8sResource | null>(null);
  const [focusedRow, setFocusedRow] = React.useState(-1);

  // Keyboard navigation for table
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Skip if typing in an input
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

  // Column visibility & ordering
  const [hiddenColumns, setHiddenColumns] = React.useState<Set<string>>(new Set());
  const [showColumnPicker, setShowColumnPicker] = React.useState(false);

  const visibleColumns = React.useMemo(
    () => columns.filter((c) => !hiddenColumns.has(c.id)),
    [columns, hiddenColumns]
  );

  // Filter resources by search term + column filters
  const filteredResources = React.useMemo(() => {
    let result = stampedResources;

    // Global search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((resource) => {
        if (resource.metadata.name.toLowerCase().includes(term)) return true;
        if (resource.metadata.namespace?.toLowerCase().includes(term)) return true;
        const labels = resource.metadata.labels || {};
        for (const [key, value] of Object.entries(labels)) {
          if (key.toLowerCase().includes(term) || value.toLowerCase().includes(term)) return true;
        }
        // Search in all visible column values
        for (const col of visibleColumns) {
          const val = String(col.accessorFn(resource) ?? '');
          if (val.toLowerCase().includes(term)) return true;
        }
        return false;
      });
    }

    // Per-column filters
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

  // Sort resources
  const sortedResources = React.useMemo(() => {
    const sorted = [...filteredResources];
    const column = columns.find((c) => c.id === sortState.column);

    if (!column || !column.sortable) return sorted;

    sorted.sort((a, b) => {
      const aValue = column.accessorFn(a);
      const bValue = column.accessorFn(b);

      // Handle null/undefined
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      // Compare as strings by default
      const aStr = String(aValue);
      const bStr = String(bValue);

      const comparison = aStr.localeCompare(bStr);
      return sortState.direction === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [filteredResources, sortState, columns]);

  // Paginate
  const [currentPage, setCurrentPage] = React.useState(0);
  const paginatedResources = React.useMemo(() => {
    const start = currentPage * perPage;
    return sortedResources.slice(start, start + perPage);
  }, [sortedResources, currentPage, perPage]);

  const totalPages = Math.ceil(sortedResources.length / perPage);

  // Extract resource kind for display
  const resourceKind = React.useMemo(() => {
    const parts = gvrKey.split('/');
    const resourceName = parts[parts.length - 1];
    // Capitalize first letter
    return resourceName.charAt(0).toUpperCase() + resourceName.slice(1);
  }, [gvrKey]);

  // Extract group/version info
  const groupVersion = React.useMemo(() => {
    const parts = gvrKey.split('/');
    if (parts.length === 2) {
      return parts[0]; // v1
    } else if (parts.length === 3) {
      return `${parts[0]}/${parts[1]}`; // apps/v1
    }
    return '';
  }, [gvrKey]);

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
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
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

  const addToast = useUIStore((s) => s.addToast);

  const handleAction = async (action: string, payload?: unknown) => {
    const p = payload as { resource?: any; delta?: number } | undefined;
    const resource = p?.resource;
    if (!resource) return;

    const resourceName = resource.metadata?.name || '';
    const resourceNs = resource.metadata?.namespace;
    const apiVersion = resource.apiVersion || '';
    const kind = resource.kind || '';

    // Build API path from resource
    const [group, version] = apiVersion.includes('/')
      ? apiVersion.split('/')
      : ['', apiVersion];
    let basePath = group ? `/apis/${apiVersion}` : `/api/${version}`;
    if (resourceNs) basePath += `/namespaces/${resourceNs}`;
    const plural = kindToPlural(kind);
    const resourcePath = `${basePath}/${plural}/${resourceName}`;

    try {
      if (action === 'restart') {
        // Delete pod to trigger recreation by controller
        await k8sDelete(resourcePath);
        addToast({ type: 'success', title: `Pod "${resourceName}" restarted` });
      } else if (action === 'restart-rollout') {
        // Patch deployment with restart annotation
        await k8sPatch(resourcePath, {
          spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } },
        });
        addToast({ type: 'success', title: `Rollout restart triggered for "${resourceName}"` });
      } else if (action === 'scale') {
        const delta = p?.delta ?? 0;
        const currentReplicas = resource.spec?.replicas ?? 0;
        const newReplicas = Math.max(0, currentReplicas + delta);
        await k8sPatch(resourcePath, { spec: { replicas: newReplicas } });
        addToast({ type: 'success', title: `Scaled "${resourceName}" to ${newReplicas} replicas` });
      } else if (action === 'cordon') {
        await k8sPatch(resourcePath, { spec: { unschedulable: true } });
        addToast({ type: 'success', title: `Node "${resourceName}" cordoned` });
      } else if (action === 'uncordon') {
        await k8sPatch(resourcePath, { spec: { unschedulable: false } });
        addToast({ type: 'success', title: `Node "${resourceName}" uncordoned` });
      } else if (action === 'drain') {
        await k8sPatch(resourcePath, { spec: { unschedulable: true } });
        addToast({ type: 'warning', title: `Drain started for "${resourceName}"`, detail: 'Node cordoned. Pod eviction requires manual intervention.' });
      }
    } catch (err) {
      addToast({
        type: 'error',
        title: `Action "${action}" failed`,
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  // Export table data
  const handleExport = React.useCallback((format: 'csv' | 'json') => {
    const data = sortedResources.map((r) => {
      const row: Record<string, string> = {};
      for (const col of visibleColumns) {
        row[col.header] = String(col.accessorFn(r) ?? '');
      }
      return row;
    });

    let content: string;
    let mimeType: string;
    let ext: string;

    if (format === 'csv') {
      const headers = visibleColumns.map((c) => c.header);
      const rows = data.map((row) => headers.map((h) => `"${(row[h] || '').replace(/"/g, '""')}"`).join(','));
      content = [headers.join(','), ...rows].join('\n');
      mimeType = 'text/csv';
      ext = 'csv';
    } else {
      content = JSON.stringify(sortedResources.map((r) => ({ apiVersion: r.apiVersion, kind: r.kind, metadata: r.metadata, spec: r.spec, status: r.status })), null, 2);
      mimeType = 'application/json';
      ext = 'json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resourceKind.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: `Exported ${sortedResources.length} ${resourceKind.toLowerCase()} as ${ext.toUpperCase()}` });
  }, [sortedResources, visibleColumns, resourceKind, addToast]);

  // Bulk delete
  const handleBulkDelete = React.useCallback(async () => {
    if (selectedRows.size === 0) return;
    const confirmed = window.confirm(`Delete ${selectedRows.size} selected resource${selectedRows.size !== 1 ? 's' : ''}?`);
    if (!confirmed) return;

    let deleted = 0;
    let failed = 0;
    for (const uid of selectedRows) {
      const resource = stampedResources.find((r) => r.metadata.uid === uid);
      if (!resource) continue;

      const apiVersion = resource.apiVersion || '';
      const kind = resource.kind || '';
      const [group, version] = apiVersion.includes('/') ? apiVersion.split('/') : ['', apiVersion];
      let basePath = group ? `/apis/${apiVersion}` : `/api/${version}`;
      if (resource.metadata.namespace) basePath += `/namespaces/${resource.metadata.namespace}`;
      const plural = kindToPlural(kind);
      const resourcePath = `${basePath}/${plural}/${resource.metadata.name}`;

      try {
        await k8sDelete(resourcePath);
        deleted++;
      } catch {
        failed++;
      }
    }

    setSelectedRows(new Set());
    if (failed > 0) {
      addToast({ type: 'warning', title: `Deleted ${deleted}, failed ${failed}`, detail: `${failed} resource${failed !== 1 ? 's' : ''} could not be deleted` });
    } else {
      addToast({ type: 'success', title: `Deleted ${deleted} resource${deleted !== 1 ? 's' : ''}` });
    }
  }, [selectedRows, stampedResources, addToast]);

  // Row click: single = preview, double = navigate
  const handleRowClick = React.useCallback((resource: K8sResource, e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input') || target.closest('button') || target.closest('a')) return;

    if (e.detail === 2) {
      // Double click → navigate
      const gvrUrl = gvrKey.replace(/\//g, '~');
      const ns = resource.metadata.namespace;
      const name = resource.metadata.name;
      const path = ns ? `/r/${gvrUrl}/${ns}/${name}` : `/r/${gvrUrl}/_/${name}`;
      addTab({ title: name, path, pinned: false, closable: true });
      navigate(path);
    } else {
      // Single click → toggle preview
      setPreviewResource((prev) => prev?.metadata.uid === resource.metadata.uid ? null : resource);
    }
  }, [gvrKey, navigate, addTab]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <p className="text-red-400 text-sm">Error loading resources</p>
          <p className="text-slate-500 text-xs mt-2">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-slate-100">{resourceKind}</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {groupVersion} · {isNamespaced ? 'namespaced' : 'cluster-scoped'} ·{' '}
              {sortedResources.length} found
              {activeNamespace && ` in ${activeNamespace}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Create button */}
            <button
              onClick={() => {
                const gvrUrl = gvrKey.replace(/\//g, '~');
                const path = `/create/${gvrUrl}`;
                addTab({ title: `Create ${resourceKind}`, path, pinned: false, closable: true });
                navigate(path);
              }}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 flex items-center gap-1.5 font-medium"
            >
              <Plus className="w-3 h-3" />
              Create
            </button>
            {/* Batch actions when items selected */}
            {selectedRows.size > 0 && (
              <div className="flex items-center gap-2 mr-4">
                <button
                  onClick={handleBulkDelete}
                  className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete {selectedRows.size}
                </button>
              </div>
            )}
            {/* Export */}
            <div className="relative group">
              <button className="p-1.5 bg-slate-900 border border-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors" title="Export">
                <Download className="w-4 h-4" />
              </button>
              <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded border border-slate-600 bg-slate-800 shadow-xl py-1 hidden group-hover:block">
                <button onClick={() => handleExport('csv')} className="w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-700">Export CSV</button>
                <button onClick={() => handleExport('json')} className="w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-700">Export JSON</button>
              </div>
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search..."
                className="pl-9 pr-3 py-1.5 text-sm bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
              />
            </div>
            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'p-1.5 rounded transition-colors',
                showFilters ? 'bg-blue-600 text-white' : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200'
              )}
              title="Column filters"
            >
              <Filter className="w-4 h-4" />
            </button>
            {/* Column picker */}
            <div className="relative">
              <button
                onClick={() => setShowColumnPicker(!showColumnPicker)}
                className="p-1.5 bg-slate-900 border border-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors"
                title="Column picker"
              >
                <Columns3 className="w-4 h-4" />
              </button>
              {showColumnPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowColumnPicker(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded border border-slate-600 bg-slate-800 shadow-xl p-2 space-y-1 max-h-80 overflow-auto">
                    <div className="text-xs text-slate-500 px-2 py-1 font-semibold">Show/Hide Columns</div>
                    {columns.map((col) => (
                      <label key={col.id} className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-700 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!hiddenColumns.has(col.id)}
                          onChange={() => {
                            setHiddenColumns((prev) => {
                              const next = new Set(prev);
                              if (next.has(col.id)) next.delete(col.id);
                              else next.add(col.id);
                              return next;
                            });
                          }}
                          className="rounded"
                        />
                        {col.header}
                      </label>
                    ))}
                    {hiddenColumns.size > 0 && (
                      <button
                        onClick={() => setHiddenColumns(new Set())}
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

      {/* Table + Preview */}
      <div className="flex-1 flex overflow-hidden">
      <div className={cn('overflow-auto', previewResource ? 'flex-1' : 'w-full')}>
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-slate-500 text-sm">Loading...</div>
          </div>
        ) : sortedResources.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <p className="text-slate-400 text-sm">
                No {resourceKind.toLowerCase()} found
                {activeNamespace && ` in ${activeNamespace}`}
              </p>
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300"
                >
                  Clear search
                </button>
              )}
            </div>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-900 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left w-12">
                  <input
                    type="checkbox"
                    checked={selectedRows.size === paginatedResources.length && paginatedResources.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-2 focus:ring-blue-500"
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
                    onClick={() => column.sortable && handleSort(column.id)}
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
                {enhancer?.inlineActions && enhancer.inlineActions.length > 0 && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Actions
                  </th>
                )}
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
                        onChange={(e) => setColumnFilters((prev) => ({ ...prev, [column.id]: e.target.value }))}
                        placeholder={`Filter ${column.header}...`}
                        className="w-full px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </th>
                  ))}
                  {enhancer?.inlineActions && enhancer.inlineActions.length > 0 && <th className="px-4 py-1" />}
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-slate-800">
              {paginatedResources.map((resource, rowIndex) => {
                const uid = resource.metadata.uid || '';
                const isSelected = selectedRows.has(uid);
                const isFocused = rowIndex === focusedRow;

                return (
                  <tr
                    key={uid}
                    onClick={(e) => { setFocusedRow(rowIndex); handleRowClick(resource, e); }}
                    className={cn(
                      'hover:bg-slate-900/50 transition-colors cursor-pointer',
                      isSelected && 'bg-slate-900/70',
                      isFocused && 'ring-1 ring-inset ring-blue-500/50 bg-blue-950/20'
                    )}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleRowSelect(uid)}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    {visibleColumns.map((column) => {
                      const value = column.accessorFn(resource);
                      return (
                        <td key={column.id} className="px-4 py-3">
                          {column.render(value, resource)}
                        </td>
                      );
                    })}
                    {enhancer?.inlineActions && enhancer.inlineActions.length > 0 && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {enhancer.inlineActions.map((action) => (
                            <div key={action.id}>
                              {action.render(resource, handleAction)}
                            </div>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Preview panel */}
      {previewResource && (
        <div className="w-80 border-l border-slate-800 bg-slate-900 overflow-auto flex-shrink-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
            <span className="text-sm font-semibold text-slate-200 truncate">{previewResource.metadata.name}</span>
            <button onClick={() => setPreviewResource(null)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-3 space-y-3 text-xs">
            <div>
              <span className="text-slate-500">Kind:</span>
              <span className="ml-2 text-slate-200">{previewResource.kind}</span>
            </div>
            {previewResource.metadata.namespace && (
              <div>
                <span className="text-slate-500">Namespace:</span>
                <span className="ml-2 text-slate-200">{previewResource.metadata.namespace}</span>
              </div>
            )}
            <div>
              <span className="text-slate-500">Created:</span>
              <span className="ml-2 text-slate-200">{previewResource.metadata.creationTimestamp ? new Date(previewResource.metadata.creationTimestamp).toLocaleString() : '—'}</span>
            </div>
            {previewResource.metadata.labels && Object.keys(previewResource.metadata.labels).length > 0 && (
              <div>
                <div className="text-slate-500 mb-1">Labels:</div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(previewResource.metadata.labels).slice(0, 8).map(([k, v]) => (
                    <span key={k} className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px] font-mono">{k.split('/').pop()}={v}</span>
                  ))}
                </div>
              </div>
            )}
            {previewResource.spec && (
              <div>
                <div className="text-slate-500 mb-1">Spec:</div>
                <pre className="text-[10px] text-emerald-400 font-mono bg-slate-950 p-2 rounded overflow-auto max-h-48">{jsonToYaml(previewResource.spec).slice(0, 500)}</pre>
              </div>
            )}
            <div className="pt-2 border-t border-slate-800">
              <button
                onClick={() => {
                  const gvrUrl = gvrKey.replace(/\//g, '~');
                  const ns = previewResource.metadata.namespace;
                  const name = previewResource.metadata.name;
                  const path = ns ? `/r/${gvrUrl}/${ns}/${name}` : `/r/${gvrUrl}/_/${name}`;
                  addTab({ title: name, path, pinned: false, closable: true });
                  navigate(path);
                }}
                className="w-full px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
              >
                Open Detail Page →
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

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
              className="text-xs bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
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
                className="px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage === totalPages - 1}
                className="px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
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
