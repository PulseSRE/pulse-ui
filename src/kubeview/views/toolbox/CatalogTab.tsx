import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, BarChart3, ArrowRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useToolUsageStore } from '../../store/toolUsageStore';
import { useVisibilityAwareInterval } from '../../hooks/useVisibilityAwareInterval';
import type { ToolInfo } from '../../store/toolUsageStore';
import { ToolCard } from './ToolCard';
import { ToolDetailDrawer } from './ToolDetailDrawer';
import { StatCard } from './StatCard';
import { METRIC_EXPLANATIONS } from '../../engine/analyticsExplanations';
import { UnusedToolsSection } from './UnusedToolsSection';

interface McpToolInfo extends ToolInfo {
  source: string;
  mcp_server?: string;
}

type EnrichedTool = ToolInfo & { source: string; mcp_server?: string };

export function CatalogTab() {
  const { tools, toolsLoading, loadTools } = useToolUsageStore(useShallow((s) => ({
    tools: s.tools, toolsLoading: s.toolsLoading, loadTools: s.loadTools,
  })));
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [selectedTool, setSelectedTool] = useState<EnrichedTool | null>(null);

  const { stats, statsLoading, loadStats, chains, chainsLoading, loadChains } = useToolUsageStore(useShallow((s) => ({
    stats: s.stats, statsLoading: s.statsLoading, loadStats: s.loadStats,
    chains: s.chains, chainsLoading: s.chainsLoading, loadChains: s.loadChains,
  })));

  useEffect(() => { loadTools(); loadStats(); loadChains(); }, [loadTools, loadStats, loadChains]);
  const refreshStats = useCallback(() => { loadStats(); loadChains(); }, [loadStats, loadChains]);
  useVisibilityAwareInterval(refreshStats, 10000);

  const allTools = useMemo(() => {
    const result: EnrichedTool[] = [];
    if (!tools) return result;
    const seen = new Set<string>();
    for (const t of tools.sre) { seen.add(t.name); result.push({ ...t, source: (t as unknown as { source?: string }).source || 'native' }); }
    for (const t of tools.security) {
      if (!seen.has(t.name)) { seen.add(t.name); result.push({ ...t, source: (t as unknown as { source?: string }).source || 'native' }); }
    }
    const mcpTools = (tools as unknown as { mcp?: McpToolInfo[] }).mcp;
    if (mcpTools) {
      for (const t of mcpTools) {
        if (!seen.has(t.name)) { seen.add(t.name); result.push({ ...t, source: 'mcp', mcp_server: t.mcp_server }); }
      }
    }
    return result;
  }, [tools]);

  const filtered = allTools.filter((t) => {
    if (sourceFilter !== 'all' && t.source !== sourceFilter) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const nativeCount = allTools.filter((t) => t.source === 'native').length;
  const mcpCount = allTools.filter((t) => t.source === 'mcp').length;
  const categories = [...new Set(filtered.map((t) => t.category).filter(Boolean))] as string[];

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      {stats && stats.total_calls > 0 && (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-slate-100">{stats.total_calls.toLocaleString()}</div>
            <div className="text-[10px] text-slate-500">Total Calls</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-slate-100">{stats.unique_tools_used}</div>
            <div className="text-[10px] text-slate-500">Tools Used</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className={`text-lg font-bold ${stats.error_rate > 0.05 ? 'text-red-400' : 'text-emerald-400'}`}>{(stats.error_rate * 100).toFixed(1)}%</div>
            <div className="text-[10px] text-slate-500">Error Rate</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-slate-100">{stats.avg_duration_ms}ms</div>
            <div className="text-[10px] text-slate-500">Avg Duration</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            aria-label="Search tools"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          aria-label="Filter by source"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All sources ({allTools.length})</option>
          <option value="native">Native ({nativeCount})</option>
          <option value="mcp">MCP ({mcpCount})</option>
        </select>
        <span className="text-xs text-slate-500">{filtered.length} tools</span>
      </div>

      {/* Tool list by category */}
      {toolsLoading ? (
        <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>
      ) : (
        <div className="space-y-4">
          {[...categories.sort(), ...(filtered.some((t) => !t.category) ? ['uncategorized'] : [])].map((cat) => {
            const catTools = filtered.filter((t) => cat === 'uncategorized' ? !t.category : t.category === cat);
            if (catTools.length === 0) return null;
            return (
              <div key={cat}>
                <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">{cat}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {catTools.map((t) => (
                    <ToolCard key={t.name} tool={t} source={t.source} mcpServer={t.mcp_server} onClick={() => setSelectedTool(t)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tool Usage Stats */}
      {stats && stats.total_calls > 0 && (
        <div className="border-t border-slate-800 pt-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-fuchsia-400" />
            Usage Analytics
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Calls" value={stats.total_calls.toLocaleString()} icon={<BarChart3 className="w-4 h-4 text-blue-400" />} explanation={METRIC_EXPLANATIONS.total_calls} />
            <StatCard label="Unique Tools" value={String(stats.unique_tools_used)} icon={<Search className="w-4 h-4 text-fuchsia-400" />} explanation={METRIC_EXPLANATIONS.unique_tools} />
            <StatCard label="Error Rate" value={`${(stats.error_rate * 100).toFixed(1)}%`} icon={<BarChart3 className="w-4 h-4 text-red-400" />} explanation={METRIC_EXPLANATIONS.error_rate} />
            <StatCard label="Avg Duration" value={`${stats.avg_duration_ms}ms`} icon={<BarChart3 className="w-4 h-4 text-emerald-400" />} explanation={METRIC_EXPLANATIONS.avg_duration} />
          </div>

          {/* Top tools */}
          {stats.by_tool && stats.by_tool.length > 0 && (() => {
            const byTool = stats.by_tool;
            const maxCount = Math.max(...byTool.slice(0, 10).map((t) => t.count), 1);
            return (
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <h3 className="text-xs font-medium text-slate-300 mb-3">Top Tools</h3>
                <div className="space-y-1.5">
                  {byTool.slice(0, 10).map((t) => (
                    <button
                      key={t.tool_name}
                      onClick={() => {
                        const match = allTools.find((at) => at.name === t.tool_name);
                        if (match) setSelectedTool(match);
                      }}
                      className="flex items-center gap-2 text-xs w-full hover:bg-slate-800/50 rounded px-1 py-0.5 transition-colors"
                    >
                      <span className="w-36 truncate font-mono text-slate-300 text-left">{t.tool_name}</span>
                      <div className="flex-1 h-4 bg-slate-800 rounded-sm overflow-hidden">
                        <div className="h-full bg-blue-600/60 rounded-sm" style={{ width: `${(t.count / maxCount) * 100}%` }} />
                      </div>
                      <span className="w-10 text-right text-slate-400">{t.count}</span>
                      {t.error_count > 0 && <span className="text-red-400 text-[10px]">{t.error_count} err</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Tool Chains */}
          {!chainsLoading && chains && chains.bigrams.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h3 className="text-xs font-medium text-slate-300 mb-1">Tool Chains</h3>
              <p className="text-[11px] text-slate-500 mb-3">Frequent tool-to-tool sequences.</p>
              <div className="space-y-1.5">
                {chains.bigrams.slice(0, 8).map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-slate-300">{b.from_tool}</span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                    <span className="font-mono text-slate-300">{b.to_tool}</span>
                    <span className="text-slate-500 ml-auto">{b.frequency}x</span>
                    <span className="text-blue-400">{Math.round(b.probability * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unused Tools */}
          {allTools.length > 0 && stats.by_tool && (
            <UnusedToolsSection tools={{ sre: allTools, security: [] }} usedTools={stats.by_tool} />
          )}
        </div>
      )}

      {selectedTool && <ToolDetailDrawer tool={selectedTool} onClose={() => setSelectedTool(null)} />}
    </div>
  );
}
