import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useToolUsageStore } from '../../store/toolUsageStore';
import { useVisibilityAwareInterval } from '../../hooks/useVisibilityAwareInterval';
import { UsageRow } from './UsageRow';
import { useQuery } from '@tanstack/react-query';
import { agentJson } from '../../engine/safeQuery';
import { LoadError } from '../../components/primitives/LoadError';

export function UsageTab() {
  const { usage, usageLoading, usageError, filters, loadUsage } = useToolUsageStore(useShallow((s) => ({
    usage: s.usage, usageLoading: s.usageLoading, usageError: s.usageError, filters: s.filters, loadUsage: s.loadUsage,
  })));
  // The skill list comes from the agent, so scaffolded and custom skills appear.
  const skillsQuery = useQuery({
    queryKey: ['admin', 'skills'],
    queryFn: () => agentJson<Record<string, unknown>[]>('/api/agent/skills'),
  });
  const skillNames = (skillsQuery.data ?? [])
    .map((sk) => String(sk.name ?? ''))
    .filter(Boolean)
    .sort();
  const [toolFilter, setToolFilter] = useState(filters.tool_name || '');
  const [modeFilter, setModeFilter] = useState(filters.agent_mode || '');
  const [statusFilter, setStatusFilter] = useState(filters.status || '');

  useEffect(() => { loadUsage(); }, [loadUsage]);
  useVisibilityAwareInterval(loadUsage, 5000);

  const totalPages = usage ? Math.ceil(usage.total / usage.per_page) : 0;

  return (
    <div className="space-y-4">
      {/* Filters row */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          aria-label="Filter by tool name"
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadUsage({ tool_name: toolFilter || undefined, page: 1 })}
          placeholder="Tool name..."
          className="px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-200 placeholder:text-slate-500 w-36 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
        />
        <select
          aria-label="Filter by skill"
          value={modeFilter}
          onChange={(e) => { setModeFilter(e.target.value); loadUsage({ agent_mode: e.target.value || undefined, page: 1 }); }}
          className="px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All skills</option>
          {skillNames.map((name) => (
            <option key={name} value={name}>{name.replace(/_/g, ' ')}</option>
          ))}
          {modeFilter && !skillNames.includes(modeFilter) && <option value={modeFilter}>{modeFilter.replace(/_/g, ' ')}</option>}
        </select>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); loadUsage({ status: e.target.value || undefined, page: 1 }); }}
          className="px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="denied">Denied</option>
        </select>
        {usage && <span className="text-xs text-slate-500 ml-auto">{usage.total} total</span>}
      </div>

      {usageError && usage && (
        <LoadError title={`${usageError}; showing the last page that loaded`} onRetry={() => loadUsage({})} />
      )}

      {/* Table */}
      {usageError && !usage ? (
        <LoadError title={usageError} onRetry={() => loadUsage({})} />
      ) : usageLoading && !usage ? (
        <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>
      ) : usage && usage.entries.length > 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs" aria-label="Tool usage log">
            <thead>
              <tr className="border-b border-slate-800">
                <th scope="col" className="text-left py-2 px-3 text-slate-400 font-medium">Time</th>
                <th scope="col" className="text-left py-2 px-3 text-slate-400 font-medium">Tool</th>
                <th scope="col" className="text-left py-2 px-3 text-slate-400 font-medium">Source</th>
                <th scope="col" className="text-left py-2 px-3 text-slate-400 font-medium">Skill</th>
                <th scope="col" className="text-left py-2 px-3 text-slate-400 font-medium">Status</th>
                <th scope="col" className="text-right py-2 px-3 text-slate-400 font-medium">Duration</th>
                <th scope="col" className="text-right py-2 px-3 text-slate-400 font-medium">Size</th>
              </tr>
            </thead>
            <tbody>
              {usage.entries.map((e) => (
                <UsageRow key={e.id} entry={e} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-12 text-sm text-slate-500">
          {filters.tool_name || filters.agent_mode || filters.status ? 'No tool usage matches these filters' : 'No tool usage recorded yet'}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            aria-label="Previous page"
            disabled={filters.page <= 1}
            onClick={() => loadUsage({ page: filters.page - 1 })}
            className="p-1 rounded-sm text-slate-400 hover:text-slate-200 disabled:opacity-30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-400">
            Page {filters.page} of {totalPages}
          </span>
          <button
            aria-label="Next page"
            disabled={filters.page >= totalPages}
            onClick={() => loadUsage({ page: filters.page + 1 })}
            className="p-1 rounded-sm text-slate-400 hover:text-slate-200 disabled:opacity-30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
