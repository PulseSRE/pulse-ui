import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Wrench, List, BarChart3, History, Search, ChevronLeft, ChevronRight,
  AlertTriangle, CheckCircle2, Clock, Database, Bot, Shield, Palette, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToolUsageStore } from '../store/toolUsageStore';
import type { ToolInfo, ToolUsageEntry } from '../store/toolUsageStore';

type ToolsTab = 'catalog' | 'usage' | 'stats';

const MODE_ICONS: Record<string, React.ReactNode> = {
  sre: <Bot className="w-4 h-4 text-violet-400" />,
  security: <Shield className="w-4 h-4 text-red-400" />,
  view_designer: <Palette className="w-4 h-4 text-emerald-400" />,
};

export default function ToolsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as ToolsTab) || 'catalog';
  const [activeTab, setActiveTabState] = useState<ToolsTab>(initialTab);

  const setActiveTab = (tab: ToolsTab) => {
    setActiveTabState(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'catalog') next.delete('tab'); else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const tabs: Array<{ id: ToolsTab; label: string; icon: React.ReactNode; activeIcon: React.ReactNode }> = [
    { id: 'catalog', label: 'Catalog', icon: <List className="w-3.5 h-3.5 text-fuchsia-400" />, activeIcon: <List className="w-3.5 h-3.5" /> },
    { id: 'usage', label: 'Usage Log', icon: <History className="w-3.5 h-3.5 text-amber-400" />, activeIcon: <History className="w-3.5 h-3.5" /> },
    { id: 'stats', label: 'Analytics', icon: <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <BarChart3 className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Wrench className="w-6 h-6 text-fuchsia-400" />
            Tools & Agents
          </h1>
          <p className="text-sm text-slate-400 mt-1">Tool catalog, usage analytics, and agent modes</p>
        </div>

        <div className="flex gap-1 bg-slate-900 rounded-lg border border-slate-800 p-1" role="tablist" aria-label="Tools tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              tabIndex={activeTab === t.id ? 0 : -1}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {activeTab === t.id ? t.activeIcon : t.icon}{t.label}
            </button>
          ))}
        </div>

        {activeTab === 'catalog' && <CatalogTab />}
        {activeTab === 'usage' && <UsageTab />}
        {activeTab === 'stats' && <StatsTab />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared: ToolCard                                                    */
/* ------------------------------------------------------------------ */

function ToolCard({ tool }: { tool: ToolInfo }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-md px-3 py-2 space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono text-slate-200">{tool.name}</span>
        {tool.requires_confirmation && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/30">write</span>
        )}
      </div>
      <p className="text-[11px] text-slate-500 line-clamp-1">{tool.description}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Catalog Tab                                                         */
/* ------------------------------------------------------------------ */

function CatalogTab() {
  const { tools, agents, toolsLoading, agentsLoading, loadTools, loadAgents } = useToolUsageStore();
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState<string>('all');

  useEffect(() => { loadTools(); loadAgents(); }, [loadTools, loadAgents]);

  const allTools: Array<ToolInfo & { mode: string }> = [];
  if (tools) {
    for (const t of tools.sre) allTools.push({ ...t, mode: 'sre' });
    for (const t of tools.security) {
      if (!allTools.some((x) => x.name === t.name)) allTools.push({ ...t, mode: 'security' });
    }
  }

  const filtered = allTools.filter((t) => {
    if (modeFilter !== 'all' && t.mode !== modeFilter) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const categories = [...new Set(filtered.map((t) => t.category).filter(Boolean))] as string[];

  return (
    <div className="space-y-6">
      {/* Agents overview */}
      {!agentsLoading && agents.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {agents.map((a) => (
            <div key={a.name} className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                {MODE_ICONS[a.name] || <Bot className="w-4 h-4 text-slate-400" />}
                <span className="text-sm font-medium text-slate-100 capitalize">{a.name === 'view_designer' ? 'View Designer' : a.name.toUpperCase()}</span>
              </div>
              <p className="text-xs text-slate-400">{a.description}</p>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>{a.tools_count} tools</span>
                {a.has_write_tools && <span className="text-amber-400">write ops</span>}
              </div>
            </div>
          ))}
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
          aria-label="Filter by agent mode"
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value)}
          className="px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All modes</option>
          <option value="sre">SRE</option>
          <option value="security">Security</option>
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
                  {catTools.map((t) => <ToolCard key={t.name} tool={t} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Usage Log Tab                                                       */
/* ------------------------------------------------------------------ */

function UsageTab() {
  const { usage, usageLoading, filters, loadUsage } = useToolUsageStore();
  const [toolFilter, setToolFilter] = useState(filters.tool_name || '');
  const [modeFilter, setModeFilter] = useState(filters.agent_mode || '');
  const [statusFilter, setStatusFilter] = useState(filters.status || '');

  useEffect(() => { loadUsage(); }, [loadUsage]);

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
          className="px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-200 placeholder:text-slate-500 w-36 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          aria-label="Filter by agent mode"
          value={modeFilter}
          onChange={(e) => { setModeFilter(e.target.value); loadUsage({ agent_mode: e.target.value || undefined, page: 1 }); }}
          className="px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All modes</option>
          <option value="sre">SRE</option>
          <option value="security">Security</option>
          <option value="view_designer">View Designer</option>
        </select>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); loadUsage({ status: e.target.value || undefined, page: 1 }); }}
          className="px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="denied">Denied</option>
        </select>
        {usage && <span className="text-xs text-slate-500 ml-auto">{usage.total} total</span>}
      </div>

      {/* Table */}
      {usageLoading ? (
        <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>
      ) : usage && usage.entries.length > 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs" aria-label="Tool usage log">
            <thead>
              <tr className="border-b border-slate-800">
                <th scope="col" className="text-left py-2 px-3 text-slate-400 font-medium">Time</th>
                <th scope="col" className="text-left py-2 px-3 text-slate-400 font-medium">Tool</th>
                <th scope="col" className="text-left py-2 px-3 text-slate-400 font-medium">Mode</th>
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
        <div className="text-center py-12 text-sm text-slate-500">No tool usage recorded yet</div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            aria-label="Previous page"
            disabled={filters.page <= 1}
            onClick={() => loadUsage({ page: filters.page - 1 })}
            className="p-1 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
            className="p-1 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function UsageRow({ entry: e }: { entry: ToolUsageEntry }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(e.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const handleKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      setExpanded(!expanded);
    }
  };

  return (
    <>
      <tr
        className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
        aria-label={`${e.tool_name} — ${e.status} — ${e.duration_ms}ms`}
      >
        <td className="py-1.5 px-3 text-slate-400">{time}</td>
        <td className="py-1.5 px-3 font-mono text-slate-200">{e.tool_name}</td>
        <td className="py-1.5 px-3 text-slate-400 capitalize">{e.agent_mode}</td>
        <td className="py-1.5 px-3">
          {e.status === 'success' ? (
            <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> ok</span>
          ) : e.status === 'denied' ? (
            <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> denied</span>
          ) : (
            <span className="text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> error</span>
          )}
        </td>
        <td className="py-1.5 px-3 text-right text-slate-400">{e.duration_ms}ms</td>
        <td className="py-1.5 px-3 text-right text-slate-500">{e.result_bytes > 0 ? `${(e.result_bytes / 1024).toFixed(1)}KB` : '-'}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-800/50">
          <td colSpan={6} className="px-3 py-2 bg-slate-900/50">
            <div className="space-y-1 text-[11px]">
              {e.query_summary && <div><span className="text-slate-500">Query:</span> <span className="text-slate-300">{e.query_summary}</span></div>}
              {e.input_summary && <div><span className="text-slate-500">Input:</span> <code className="text-slate-400">{JSON.stringify(e.input_summary)}</code></div>}
              {e.error_message && <div><span className="text-slate-500">Error:</span> <span className="text-red-400">{e.error_message}</span></div>}
              <div className="text-slate-600">Session: {e.session_id} | Turn: {e.turn_number} | Category: {e.tool_category || 'none'}</div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Stats Tab                                                           */
/* ------------------------------------------------------------------ */

function StatsTab() {
  const { stats, statsLoading, loadStats, chains, chainsLoading, loadChains, tools, loadTools } = useToolUsageStore();

  useEffect(() => { loadStats(); loadChains(); loadTools(); }, [loadStats, loadChains, loadTools]);

  if (statsLoading) {
    return <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>;
  }

  if (!stats || stats.total_calls === 0) {
    return <div className="text-center py-12 text-sm text-slate-500">No usage data yet. Tool calls will appear here once the agent is used.</div>;
  }

  const maxCount = Math.max(...stats.by_tool.slice(0, 10).map((t) => t.count), 1);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Calls" value={stats.total_calls.toLocaleString()} icon={<Database className="w-4 h-4 text-blue-400" />} />
        <StatCard label="Unique Tools" value={String(stats.unique_tools_used)} icon={<Wrench className="w-4 h-4 text-fuchsia-400" />} />
        <StatCard label="Error Rate" value={`${(stats.error_rate * 100).toFixed(1)}%`} icon={<AlertTriangle className="w-4 h-4 text-red-400" />} />
        <StatCard label="Avg Duration" value={`${stats.avg_duration_ms}ms`} icon={<Clock className="w-4 h-4 text-emerald-400" />} />
      </div>

      {/* Top tools bar chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-slate-300 mb-3">Top Tools</h3>
        <div className="space-y-1.5">
          {stats.by_tool.slice(0, 10).map((t) => (
            <div key={t.tool_name} className="flex items-center gap-2 text-xs">
              <span className="w-36 truncate font-mono text-slate-300">{t.tool_name}</span>
              <div
                className="flex-1 h-4 bg-slate-800 rounded-sm overflow-hidden"
                role="meter"
                aria-label={`${t.tool_name}: ${t.count} calls`}
                aria-valuenow={t.count}
                aria-valuemin={0}
                aria-valuemax={maxCount}
              >
                <div
                  className="h-full bg-blue-600/60 rounded-sm"
                  style={{ width: `${(t.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="w-10 text-right text-slate-400">{t.count}</span>
              {t.error_count > 0 && <span className="text-red-400 text-[10px]">{t.error_count} err</span>}
            </div>
          ))}
        </div>
      </div>

      {/* By mode + by category */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">By Mode</h3>
          <div className="space-y-1">
            {stats.by_mode.map((m) => (
              <div key={m.mode} className="flex items-center justify-between text-xs">
                <span className="text-slate-300 capitalize flex items-center gap-1.5">
                  {MODE_ICONS[m.mode] || <Bot className="w-3 h-3 text-slate-500" />}
                  {m.mode}
                </span>
                <span className="text-slate-400">{m.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">By Category</h3>
          <div className="space-y-1">
            {stats.by_category.map((c) => (
              <div key={c.category} className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{c.category}</span>
                <span className="text-slate-400">{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Context hogs */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-slate-300 mb-3">Largest Results (Context Usage)</h3>
        <div className="space-y-1">
          {[...stats.by_tool].sort((a, b) => b.avg_result_bytes - a.avg_result_bytes).slice(0, 5).map((t) => (
            <div key={t.tool_name} className="flex items-center justify-between text-xs">
              <span className="font-mono text-slate-300">{t.tool_name}</span>
              <span className="text-slate-400">{(t.avg_result_bytes / 1024).toFixed(1)} KB avg</span>
            </div>
          ))}
        </div>
      </div>

      {/* Common Patterns */}
      {!chainsLoading && chains && chains.bigrams.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">Common Tool Chains</h3>
          <div className="space-y-1.5">
            {chains.bigrams.slice(0, 10).map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-slate-300">{b.from_tool}</span>
                <ArrowRight className="w-3 h-3 text-slate-600" />
                <span className="font-mono text-slate-300">{b.to_tool}</span>
                <span className="text-slate-500 ml-auto">{b.frequency}x</span>
                <span className="text-blue-400">{Math.round(b.probability * 100)}%</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-600 mt-2">{chains.total_sessions_analyzed} sessions analyzed</p>
        </div>
      )}

      {/* Unused Tools */}
      {tools && stats && <UnusedToolsSection tools={tools} usedTools={stats.by_tool} />}
    </div>
  );
}

function UnusedToolsSection({ tools, usedTools }: { tools: { sre: ToolInfo[]; security: ToolInfo[] }; usedTools: Array<{ tool_name: string; count: number }> }) {
  const usedNames = new Set(usedTools.map((t) => t.tool_name));
  const allTools: Array<{ name: string; category: string; mode: string }> = [];
  for (const t of tools.sre) allTools.push({ name: t.name, category: t.category || '', mode: 'sre' });
  for (const t of tools.security) {
    if (!allTools.some((x) => x.name === t.name)) allTools.push({ name: t.name, category: t.category || '', mode: 'security' });
  }

  const unused = allTools.filter((t) => !usedNames.has(t.name));
  const usedCount = allTools.length - unused.length;
  const usagePct = allTools.length > 0 ? Math.round((usedCount / allTools.length) * 100) : 0;

  const byCategory: Record<string, string[]> = {};
  for (const t of unused) {
    const cat = t.category || 'uncategorized';
    (byCategory[cat] ??= []).push(t.name);
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-slate-300">Tool Coverage</h3>
        <span className="text-xs text-slate-500">{usedCount}/{allTools.length} used ({usagePct}%)</span>
      </div>

      <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-4" role="meter" aria-label={`Tool coverage: ${usagePct}%`} aria-valuenow={usagePct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-emerald-600/70 rounded-full" style={{ width: `${usagePct}%` }} />
      </div>

      {unused.length === 0 ? (
        <p className="text-xs text-emerald-400">All tools have been used</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-amber-400">{unused.length} tools never called</p>
          {Object.entries(byCategory).sort(([, a], [, b]) => b.length - a.length).map(([cat, names]) => (
            <div key={cat}>
              <div className="text-[11px] text-slate-400 mb-1">{cat} ({names.length})</div>
              <div className="flex flex-wrap gap-1">
                {names.map((n) => (
                  <span key={n} className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 text-slate-500 rounded border border-slate-700">{n}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-[11px] text-slate-400">{label}</span></div>
      <div className="text-lg font-semibold text-slate-100">{value}</div>
    </div>
  );
}
