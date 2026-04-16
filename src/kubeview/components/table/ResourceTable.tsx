/**
 * ResourceTable — shared table rendering core used by both
 * LiveAgentTable and StaticAgentTable.
 *
 * Handles: header, body, footer, sort, search, column visibility,
 * per-column filters, export, pagination.
 *
 * Does NOT handle: data fetching, watches, live indicators,
 * bulk actions, preview panels, keyboard nav, virtualization.
 */

import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  ArrowUp, ArrowDown, ArrowUpDown, Search, Download,
  Settings2, Eye, EyeOff, Filter, Plus,
} from 'lucide-react';
import type { ComponentSpec } from '../../engine/agentComponents';

export interface TableColumn {
  id: string;
  header: string;
  width?: string;
  type?: string;
}

export interface ResourceTableProps {
  /** Table title */
  title?: string;
  /** Table description */
  description?: string;
  /** Column definitions */
  columns: TableColumn[];
  /** Row data — flat key-value records */
  rows: Array<Record<string, unknown>>;
  /** Max columns visible by default (extra ones auto-hidden) */
  maxDefaultCols?: number;
  /** Rows per page */
  pageSize?: number;
  /** Max height CSS value (e.g. '60vh'). Null = no constraint. */
  maxHeight?: string;
  /** Custom cell renderer. Falls back to CellValue if not provided. */
  renderCell?: (value: unknown, columnId: string, columnType: string | undefined, row: Record<string, unknown>) => React.ReactNode;
  /** Row click handler */
  onRowClick?: (row: Record<string, unknown>) => void;
  /** Add to view callback */
  onAddToView?: (spec: ComponentSpec) => void;
  /** The full spec for onAddToView */
  spec?: ComponentSpec;
  /** Extra header elements (e.g. live indicator, source info) */
  headerExtra?: React.ReactNode;
  /** Extra footer elements */
  footerExtra?: React.ReactNode;
  /** Total rows before filtering (for "X of Y" display) */
  totalRows?: number;
}

export function ResourceTable({
  title,
  description,
  columns,
  rows,
  maxDefaultCols = 6,
  pageSize = 15,
  maxHeight = '60vh',
  renderCell,
  onRowClick,
  onAddToView,
  spec,
  headerExtra,
  footerExtra,
  totalRows,
}: ResourceTableProps) {
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    if (columns.length <= maxDefaultCols) return new Set<string>();
    return new Set(columns.slice(maxDefaultCols).map((c) => c.id));
  });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showSettings, setShowSettings] = useState(false);

  const handleSort = useCallback((colId: string) => {
    if (sortCol === colId) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(colId);
      setSortDir('asc');
    }
  }, [sortCol]);

  const toggleCol = useCallback((colId: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      return next;
    });
  }, []);

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenCols.has(c.id)),
    [columns, hiddenCols],
  );

  const processedRows = useMemo(() => {
    let result = [...rows];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((row) =>
        Object.entries(row).some(([k, v]) => !k.startsWith('_') && String(v ?? '').toLowerCase().includes(q)),
      );
    }
    for (const [colId, filterVal] of Object.entries(filters)) {
      if (!filterVal) continue;
      const lower = filterVal.toLowerCase();
      result = result.filter((row) => String(row[colId] ?? '').toLowerCase().includes(lower));
    }
    if (sortCol) {
      result.sort((a, b) => {
        const av = a[sortCol] ?? '';
        const bv = b[sortCol] ?? '';
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [rows, search, filters, sortCol, sortDir]);

  const handleExport = useCallback((format: 'csv' | 'json') => {
    const cols = columns.filter((c) => !c.id.startsWith('_'));
    const exportTitle = title || 'export';
    const date = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      const header = cols.map((c) => c.header).join(',');
      const csvRows = processedRows.map((row) =>
        cols.map((c) => {
          const val = String(row[c.id] ?? '').replace(/"/g, '""');
          return val.includes(',') || val.includes('"') ? `"${val}"` : val;
        }).join(','),
      );
      const blob = new Blob([header + '\n' + csvRows.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${exportTitle}-${date}.csv`;
      a.click();
    } else {
      const data = processedRows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (const c of cols) obj[c.id] = row[c.id];
        return obj;
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${exportTitle}-${date}.json`;
      a.click();
    }
  }, [columns, title, processedRows]);

  const actualTotal = totalRows ?? rows.length;

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0">
      {/* Header */}
      <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700 text-xs font-medium text-slate-300 flex items-center justify-between gap-2">
        <div className="truncate flex-shrink-0 flex items-center gap-2">
          <span>{title || 'Table'}</span>
          {description && <span className="text-[10px] text-slate-500">{description}</span>}
          {(search || Object.values(filters).some(Boolean)) && (
            <span className="text-[10px] text-violet-400">
              ({processedRows.length}/{actualTotal})
            </span>
          )}
          {headerExtra}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search..."
              className="w-28 pl-5 pr-1.5 py-0.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-300 placeholder-slate-600 outline-none focus:border-violet-500 focus:w-40 transition-all"
              aria-label="Search table"
            />
          </div>
          <div className="relative group/export">
            <button className="p-0.5 text-slate-500 hover:text-slate-300 rounded transition-colors" title="Export">
              <Download className="w-3.5 h-3.5" />
            </button>
            <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded shadow-lg hidden group-hover/export:block z-20">
              <button onClick={() => handleExport('csv')} className="block w-full px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 whitespace-nowrap">Export CSV</button>
              <button onClick={() => handleExport('json')} className="block w-full px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 whitespace-nowrap">Export JSON</button>
            </div>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn('p-0.5 rounded transition-colors', showSettings ? 'text-violet-400 bg-slate-700' : 'text-slate-500 hover:text-slate-300')}
            title="Table settings"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          {onAddToView && spec && (
            <button
              onClick={() => onAddToView(spec)}
              className="p-0.5 text-slate-500 hover:text-emerald-400 hover:bg-slate-800 rounded transition-colors flex-shrink-0"
              title="Add to View"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="px-3 py-2 bg-slate-800/80 border-b border-slate-700 space-y-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Columns</div>
          <div className="flex flex-wrap gap-1">
            {columns.map((col) => (
              <button
                key={col.id}
                onClick={() => toggleCol(col.id)}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors',
                  hiddenCols.has(col.id) ? 'bg-slate-900 text-slate-600' : 'bg-slate-700 text-slate-300',
                )}
              >
                {hiddenCols.has(col.id) ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                {col.header}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">Filters</div>
          <div className="flex flex-wrap gap-2">
            {visibleColumns.slice(0, 5).map((col) => (
              <div key={col.id} className="flex items-center gap-1">
                <Filter className="w-2.5 h-2.5 text-slate-600" />
                <input
                  placeholder={col.header}
                  value={filters[col.id] || ''}
                  onChange={(e) => setFilters((f) => ({ ...f, [col.id]: e.target.value }))}
                  className="w-24 px-1.5 py-0.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-300 placeholder-slate-600 outline-none focus:border-violet-500"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table body */}
      <div className={cn('overflow-auto', maxHeight && `max-h-[${maxHeight}]`)} role="region" aria-label={title || 'Data table'}>
        <table className="w-full text-xs" role="table">
          <thead>
            <tr className="bg-slate-800/30 sticky top-0 z-[1]">
              {visibleColumns.map((col) => (
                <th
                  key={col.id}
                  className="px-3 py-1.5 text-left text-slate-400 font-medium whitespace-nowrap cursor-pointer hover:text-slate-200 select-none bg-slate-800/80"
                  style={col.width ? { width: col.width } : undefined}
                  onClick={() => handleSort(col.id)}
                >
                  <span className="flex items-center gap-1">
                    {col.header}
                    {sortCol === col.id ? (
                      sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processedRows.slice(page * pageSize, (page + 1) * pageSize).map((row, i) => (
              <tr
                key={i}
                className={cn('border-t border-slate-800 hover:bg-slate-800/40 transition-colors', onRowClick && 'cursor-pointer')}
                onClick={() => onRowClick?.(row)}
              >
                {visibleColumns.map((col) => (
                  <td key={col.id} className="px-3 py-1.5 text-slate-300 whitespace-nowrap group/cell relative">
                    {renderCell
                      ? renderCell(row[col.id], col.id, col.type, row)
                      : <DefaultCellValue value={row[col.id]} />
                    }
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(String(row[col.id] ?? '')); }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-100 text-slate-600 hover:text-slate-300 transition-opacity"
                      title="Copy"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/></svg>
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-3 py-1 bg-slate-800/30 border-t border-slate-700 text-[10px] text-slate-500 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>
            {processedRows.length > pageSize
              ? `${page * pageSize + 1}-${Math.min((page + 1) * pageSize, processedRows.length)} of ${processedRows.length}`
              : `${processedRows.length} rows`}
            {processedRows.length !== actualTotal && ` (${actualTotal} total)`}
          </span>
          {footerExtra}
        </div>
        {processedRows.length > pageSize && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ←
            </button>
            <span>{page + 1}/{Math.ceil(processedRows.length / pageSize)}</span>
            <button
              onClick={() => setPage((p) => Math.min(Math.ceil(processedRows.length / pageSize) - 1, p + 1))}
              disabled={(page + 1) * pageSize >= processedRows.length}
              className="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Simple default cell renderer for string/number/boolean values */
function DefaultCellValue({ value }: { value: unknown }) {
  if (value == null) return <span className="text-slate-600">-</span>;
  return <>{String(value)}</>;
}
