import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronUp, ChevronDown, Trash2, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import { useClusterStore } from '../store/clusterStore';
import type { K8sResource, ColumnDef } from '../engine/renderers';
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

  // Determine if resource is namespaced
  // Registry uses "core/v1/pods" for core resources, but URL-derived keys are "v1/pods"
  const resourceType = resourceRegistry?.get(gvrKey)
    ?? (gvrKey.split('/').length === 2 ? resourceRegistry?.get(`core/${gvrKey}`) : undefined);
  const isNamespaced = resourceType?.namespaced ?? true;

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
    queryKey: ['table', apiPath, namespaceProp],
    queryFn: () => k8sList<K8sResource>(apiPath, namespaceProp),
    enabled: !!apiPath,
    refetchInterval: 30000,
  });

  // Stamp GVR key onto resources so renderers can build URLs
  const stampedResources = React.useMemo(
    () => resources.map((r) => ({ ...r, _gvrKey: gvrKey })),
    [resources, gvrKey]
  );

  // Get columns for this resource type
  const columns = React.useMemo(
    () => getColumnsForResource(gvrKey, isNamespaced),
    [gvrKey, isNamespaced]
  );

  // Get enhancer for inline actions
  const enhancer = getEnhancer(gvrKey);

  // State
  const [searchTerm, setSearchTerm] = React.useState('');
  const [sortState, setSortState] = React.useState<SortState>({
    column: enhancer?.defaultSort?.column || 'name',
    direction: enhancer?.defaultSort?.direction || 'asc',
  });
  const [selectedRows, setSelectedRows] = React.useState<Set<string>>(new Set());
  const [perPage, setPerPage] = React.useState(25);

  // Filter resources by search term
  const filteredResources = React.useMemo(() => {
    if (!searchTerm) return stampedResources;

    const term = searchTerm.toLowerCase();
    return stampedResources.filter((resource) => {
      // Search in name
      if (resource.metadata.name.toLowerCase().includes(term)) return true;

      // Search in namespace
      if (resource.metadata.namespace?.toLowerCase().includes(term)) return true;

      // Search in labels
      const labels = resource.metadata.labels || {};
      for (const [key, value] of Object.entries(labels)) {
        if (key.toLowerCase().includes(term) || value.toLowerCase().includes(term)) {
          return true;
        }
      }

      return false;
    });
  }, [resources, searchTerm]);

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

  const handleAction = (action: string, payload?: unknown) => {
    // Handle inline actions from enhancers
    console.log('Action:', action, payload);
    // TODO: Implement action handlers (scale, restart, etc.)
  };

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
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Batch actions when items selected */}
            {selectedRows.size > 0 && (
              <div className="flex items-center gap-2 mr-4">
                <button className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1.5">
                  <Trash2 className="w-3 h-3" />
                  Delete {selectedRows.size}
                </button>
                <button className="px-3 py-1.5 text-xs bg-slate-700 text-slate-200 rounded hover:bg-slate-600 flex items-center gap-1.5">
                  <Tag className="w-3 h-3" />
                  Add Label
                </button>
              </div>
            )}
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
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-slate-500 text-sm">Loading...</div>
          </div>
        ) : sortedResources.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <p className="text-slate-400 text-sm">
                No {resourceKind.toLowerCase()} found
                {namespaceProp && ` in ${namespaceProp}`}
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
                {columns.map((column) => (
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
            </thead>
            <tbody className="divide-y divide-slate-800">
              {paginatedResources.map((resource) => {
                const uid = resource.metadata.uid || '';
                const isSelected = selectedRows.has(uid);

                return (
                  <tr
                    key={uid}
                    className={cn(
                      'hover:bg-slate-900/50 transition-colors',
                      isSelected && 'bg-slate-900/70'
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
                    {columns.map((column) => {
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
