import React from 'react';
import { AlertCircle, CheckCircle2, Trash2, Bot, ShieldX, WifiOff, ServerCrash, XCircle, Filter } from 'lucide-react';
import { useErrorStore, type TrackedError } from '../../store/errorStore';
import type { ErrorCategory } from '../../engine/errors';
import { useUIStore } from '../../store/uiStore';
import { useAgentStore } from '../../store/agentStore';
import { cn } from '@/lib/utils';

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof AlertCircle; color: string }> = {
  permission: { label: 'Permission', icon: ShieldX, color: 'text-red-400' },
  not_found: { label: 'Not Found', icon: XCircle, color: 'text-amber-400' },
  conflict: { label: 'Conflict', icon: AlertCircle, color: 'text-amber-400' },
  validation: { label: 'Validation', icon: AlertCircle, color: 'text-yellow-400' },
  server: { label: 'Server', icon: ServerCrash, color: 'text-red-400' },
  network: { label: 'Network', icon: WifiOff, color: 'text-red-400' },
  quota: { label: 'Quota', icon: AlertCircle, color: 'text-orange-400' },
  unknown: { label: 'Unknown', icon: XCircle, color: 'text-slate-400' },
};

export function ErrorsTab() {
  const { errors, resolveError, clearResolved } = useErrorStore();
  const [filter, setFilter] = React.useState<'all' | 'unresolved' | ErrorCategory>('all');

  const filtered = React.useMemo(() => {
    if (filter === 'all') return errors;
    if (filter === 'unresolved') return errors.filter((e) => !e.resolved);
    return errors.filter((e) => e.category === filter);
  }, [errors, filter]);

  const categoryCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of errors) {
      counts[e.category] = (counts[e.category] || 0) + 1;
    }
    return counts;
  }, [errors]);

  const unresolvedCount = errors.filter((e) => !e.resolved).length;
  const resolvedCount = errors.length - unresolvedCount;

  const handleAskAI = (error: TrackedError) => {
    useUIStore.getState().expandAISidebar();
    useUIStore.getState().setAISidebarMode('chat');
    useAgentStore.getState().connectAndSend(
      `I got this error: "${error.userMessage}". ${error.message}. What does this mean and how can I fix it?`
    );
  };

  if (errors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <CheckCircle2 className="w-12 h-12 mb-4 text-emerald-600" />
        <p className="text-lg font-medium text-slate-300">No errors tracked</p>
        <p className="text-sm mt-1">Errors from K8s API operations will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Error filters">
        <button
          role="tab"
          aria-selected={filter === 'all'}
          onClick={() => setFilter('all')}
          className={cn('px-3 py-1.5 text-xs rounded-md transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500', filter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 bg-slate-800')}
        >
          All ({errors.length})
        </button>
        <button
          role="tab"
          aria-selected={filter === 'unresolved'}
          onClick={() => setFilter('unresolved')}
          className={cn('px-3 py-1.5 text-xs rounded-md transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500', filter === 'unresolved' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-slate-200 bg-slate-800')}
        >
          Unresolved ({unresolvedCount})
        </button>
        {Object.entries(categoryCounts).map(([cat, count]) => {
          const cfg = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.unknown;
          return (
            <button
              key={cat}
              role="tab"
              aria-selected={filter === cat}
              onClick={() => setFilter(cat as ErrorCategory)}
              className={cn('px-3 py-1.5 text-xs rounded-md transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500', filter === cat ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200 bg-slate-800')}
            >
              {cfg.label} ({count})
            </button>
          );
        })}
        {resolvedCount > 0 && (
          <button
            onClick={clearResolved}
            className="ml-auto px-3 py-1.5 text-xs text-slate-400 hover:text-red-400 bg-slate-800 rounded-md transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Clear Resolved
          </button>
        )}
      </div>

      {/* Error list */}
      <div className="space-y-2">
        {filtered.map((error) => {
          const cfg = CATEGORY_CONFIG[error.category] || CATEGORY_CONFIG.unknown;
          const Icon = cfg.icon;
          return (
            <div
              key={error.id}
              className={cn(
                'bg-slate-900 border rounded-lg p-4',
                error.resolved ? 'border-slate-800 opacity-60' : 'border-slate-700',
              )}
            >
              <div className="flex items-start gap-3">
                <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', cfg.color)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">{error.userMessage}</span>
                    <span className={cn('text-xs px-1.5 py-0.5 rounded-sm', cfg.color, 'bg-slate-800')}>
                      {cfg.label}
                    </span>
                    {error.statusCode > 0 && (
                      <span className="text-xs text-slate-500">{error.statusCode}</span>
                    )}
                    {error.resolved && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                  </div>
                  {error.message !== error.userMessage && (
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">{error.message}</p>
                  )}
                  {error.resourceKind && (
                    <p className="text-xs text-slate-500 mt-1">
                      {error.operation} {error.resourceKind}
                      {error.resourceName ? `/${error.resourceName}` : ''}
                      {error.namespace ? ` in ${error.namespace}` : ''}
                    </p>
                  )}
                  {error.suggestions.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {error.suggestions.map((s, i) => (
                        <li key={i} className="text-xs text-slate-400">&bull; {s}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-slate-600">
                      {new Date(error.timestamp).toLocaleTimeString()}
                    </span>
                    {!error.resolved && (
                      <>
                        <button
                          onClick={() => resolveError(error.id, 'dismissed')}
                          className="text-xs text-slate-400 hover:text-emerald-400 transition-colors"
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => handleAskAI(error)}
                          className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                        >
                          <Bot className="w-3 h-3" />
                          Ask AI
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
