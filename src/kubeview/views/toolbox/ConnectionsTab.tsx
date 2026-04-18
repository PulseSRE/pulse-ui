import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Server, Plus, RefreshCw, CheckCircle2, XCircle, X,
  Check, ChevronDown, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToolUsageStore } from '../../store/toolUsageStore';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { AddMcpServerDialog } from './AddMcpServerDialog';

export function ConnectionsTab() {
  const queryClient = useQueryClient();
  const loadTools = useToolUsageStore((s) => s.loadTools);
  const [expandedServer, setExpandedServer] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const { data: mcpData, isLoading } = useQuery({
    queryKey: ['admin', 'mcp'],
    queryFn: async () => {
      const res = await fetch('/api/agent/admin/mcp');
      if (!res.ok) return { connections: [], available_toolsets: [] };
      return res.json() as Promise<{
        connections: Array<Record<string, unknown>>;
        available_toolsets: string[];
      }>;
    },
  });

  const connections = mcpData?.connections || [];
  const availableToolsets = mcpData?.available_toolsets || [];

  const [mcpStatus, setMcpStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const toggleToolset = async (toolset: string, currentToolsets: string[]) => {
    const newToolsets = currentToolsets.includes(toolset)
      ? currentToolsets.filter((t) => t !== toolset)
      : [...currentToolsets, toolset];

    if (newToolsets.length === 0) return;

    setUpdating(true);
    setMcpStatus(null);
    try {
      const res = await fetch('/api/agent/admin/mcp/toolsets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolsets: newToolsets }),
      });
      const data = await res.json().catch(() => ({ detail: 'Unknown error' }));
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'mcp'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'skills'] });
        loadTools();
        setMcpStatus({ type: 'success', message: `Toolsets updated — ${data.tools_registered} tools registered` });
      } else {
        setMcpStatus({ type: 'error', message: data.detail || 'Failed to update toolsets' });
      }
    } catch {
      setMcpStatus({ type: 'error', message: 'Network error — could not reach agent' });
    } finally {
      setUpdating(false);
    }
  };

  const handleRemoveServer = async () => {
    if (!confirmRemove) return;
    setMcpStatus(null);
    try {
      const res = await fetch(`/api/agent/admin/mcp/${encodeURIComponent(confirmRemove)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({ detail: 'Unknown error' }));
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'mcp'] });
        setMcpStatus({ type: 'success', message: `Removed server '${confirmRemove}'` });
      } else {
        setMcpStatus({ type: 'error', message: data.detail || 'Failed to remove server' });
      }
    } catch {
      setMcpStatus({ type: 'error', message: 'Network error — could not reach agent' });
    } finally {
      setConfirmRemove(null);
    }
  };

  const connectedCount = connections.filter((c) => c.status === 'connected').length;
  const totalMcpTools = connections.reduce((sum, c) => sum + (Number(c.tools_count) || 0), 0);
  const activeToolsets = connections.reduce((sum, c) => sum + ((c.toolsets as string[])?.length || 0), 0);

  return (
    <div className="space-y-4">
      {/* Overview Stats */}
      {connections.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-slate-100">{connections.length}</div>
            <div className="text-[10px] text-slate-500">Servers</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className={`text-lg font-bold ${connectedCount === connections.length ? 'text-emerald-400' : 'text-amber-400'}`}>{connectedCount}</div>
            <div className="text-[10px] text-slate-500">Connected</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-slate-100">{totalMcpTools}</div>
            <div className="text-[10px] text-slate-500">MCP Tools</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-slate-100">{activeToolsets}</div>
            <div className="text-[10px] text-slate-500">Toolsets</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">{connections.length} MCP server{connections.length !== 1 ? 's' : ''} configured</div>
        <div className="flex items-center gap-2">
          {updating && (
            <div className="flex items-center gap-1.5 text-xs text-blue-400">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Updating toolsets...
            </div>
          )}
          <button
            onClick={() => setShowAddDialog(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Server
          </button>
        </div>
      </div>

      {mcpStatus && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 text-xs rounded-md border',
          mcpStatus.type === 'success'
            ? 'bg-emerald-950/30 border-emerald-800/30 text-emerald-400'
            : 'bg-red-950/30 border-red-800/30 text-red-400',
        )}>
          {mcpStatus.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {mcpStatus.message}
          <button onClick={() => setMcpStatus(null)} className="ml-auto text-slate-500 hover:text-slate-300">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {showAddDialog && (
        <AddMcpServerDialog
          onClose={() => setShowAddDialog(false)}
          onAdded={() => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'mcp'] });
            setShowAddDialog(false);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={handleRemoveServer}
        title="Remove MCP Server"
        description={`Disconnect and remove '${confirmRemove}'? Its tools will be unregistered.`}
        confirmLabel="Remove"
        variant="danger"
      />

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>
      ) : connections.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
          <Server className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400 mb-2">No MCP servers connected</p>
          <p className="text-xs text-slate-500 mb-4">Connect to an MCP server to extend the agent with additional tools.</p>
          <button
            onClick={() => setShowAddDialog(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Server
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map((conn: Record<string, unknown>, i: number) => {
            const tools = (conn.tools as string[]) || [];
            const enabledToolsets = (conn.toolsets as string[]) || [];
            const isStandalone = Boolean(conn.standalone);
            const expanded = expandedServer === i;

            return (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedServer(expanded ? null : i)}
                  onKeyDown={(e) => e.key === 'Enter' && setExpandedServer(expanded ? null : i)}
                  className="w-full p-4 text-left hover:bg-slate-800/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {conn.connected ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
                      <span className="text-sm font-medium text-slate-100">{String(conn.name)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded text-slate-500">{String(conn.transport)}</span>
                      {isStandalone && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-900/30 text-violet-400 border border-violet-800/30">custom</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{tools.length} tools</span>
                      {isStandalone && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmRemove(String(conn.name)); }}
                          className="p-1 text-slate-500 hover:text-red-400 transition-colors rounded hover:bg-slate-800"
                          title="Remove server"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <ChevronDown className={cn('w-3.5 h-3.5 text-slate-500 transition-transform', expanded && 'rotate-180')} />
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono">{String(conn.url)}</div>
                  {Boolean(conn.error) && <div className="text-xs text-red-400 mt-2">{String(conn.error)}</div>}
                </div>

                {expanded && (
                  <div className="border-t border-slate-800">
                    {!isStandalone && enabledToolsets.length > 0 && (
                      <div className="px-4 py-3 border-b border-slate-800/50">
                        <h4 className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-2">Toolsets</h4>
                        <p className="text-xs text-slate-500 mb-3">Toggle toolsets to add or remove capabilities. The MCP server will restart.</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {availableToolsets.map((ts) => {
                            const enabled = enabledToolsets.includes(ts);
                            return (
                              <button
                                key={ts}
                                disabled={updating || (enabled && enabledToolsets.length <= 1)}
                                onClick={(e) => { e.stopPropagation(); toggleToolset(ts, enabledToolsets); }}
                                className={cn(
                                  'flex items-center justify-between px-2.5 py-1.5 text-[11px] rounded-md border transition-colors',
                                  enabled
                                    ? 'bg-blue-900/30 text-blue-300 border-blue-700/50 hover:bg-blue-900/50'
                                    : 'bg-slate-800/50 text-slate-500 border-slate-700/30 hover:bg-slate-800 hover:text-slate-300',
                                  updating && 'opacity-50 cursor-not-allowed',
                                )}
                              >
                                <div className={cn(
                                  'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0',
                                  enabled ? 'bg-blue-600 border-blue-500' : 'border-slate-600',
                                )}>
                                  {enabled && <Check className="w-2.5 h-2.5 text-white" />}
                                </div>
                                <span className="font-medium">{ts}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {tools.length > 0 && (
                      <div className="px-4 py-3">
                        <h4 className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-2">
                          Registered Tools ({tools.length})
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {tools.map((tool) => (
                            <div key={tool} className="text-[11px] font-mono text-slate-300 bg-slate-800/50 rounded px-2 py-1 truncate" title={tool}>
                              {tool}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
