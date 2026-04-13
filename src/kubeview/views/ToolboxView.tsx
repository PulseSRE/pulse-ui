import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import {
  Wrench, List, BarChart3, History, Search, ChevronLeft, ChevronRight,
  AlertTriangle, CheckCircle2, Clock, Database, Bot, Shield, Palette, ArrowRight,
  Puzzle, Server, Layers, RefreshCw, XCircle,
  Play, X, FileText, ChevronDown, Save, GitCompareArrows, Check,
  Cable, Trash2, Copy, Hash, TrendingUp, Target, LayoutDashboard, Plus, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToolUsageStore } from '../store/toolUsageStore';
import { fetchIntelligenceSections, fetchPromptStats } from '../engine/analyticsApi';
import type { ToolInfo, ToolUsageEntry } from '../store/toolUsageStore';

type ToolboxTab = 'catalog' | 'skills' | 'connections' | 'components' | 'usage' | 'analytics';

const SKILL_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Wrench, Shield, LayoutDashboard, TrendingUp, Puzzle, Bot, Database, Target,
};

function sortSkills(skills: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...skills].sort((a, b) => {
    const aBuiltin = a.builtin !== false;
    const bBuiltin = b.builtin !== false;
    if (aBuiltin !== bBuiltin) return aBuiltin ? -1 : 1;
    return String(a.display_name || a.name).localeCompare(String(b.display_name || b.name));
  });
}

const MODE_ICONS: Record<string, React.ReactNode> = {
  sre: <Bot className="w-4 h-4 text-violet-400" />,
  security: <Shield className="w-4 h-4 text-red-400" />,
  view_designer: <Palette className="w-4 h-4 text-emerald-400" />,
};

export default function ToolboxView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as ToolboxTab) || 'catalog';
  const [activeTab, setActiveTabState] = useState<ToolboxTab>(initialTab);

  const setActiveTab = (tab: ToolboxTab) => {
    setActiveTabState(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'catalog') next.delete('tab'); else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const tabs: Array<{ id: ToolboxTab; label: string; icon: React.ReactNode; activeIcon: React.ReactNode }> = [
    { id: 'catalog', label: 'Catalog', icon: <List className="w-3.5 h-3.5 text-fuchsia-400" />, activeIcon: <List className="w-3.5 h-3.5" /> },
    { id: 'skills', label: 'Skills', icon: <Puzzle className="w-3.5 h-3.5 text-violet-400" />, activeIcon: <Puzzle className="w-3.5 h-3.5" /> },
    { id: 'connections', label: 'Connections', icon: <Cable className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <Cable className="w-3.5 h-3.5" /> },
    { id: 'components', label: 'Components', icon: <Layers className="w-3.5 h-3.5 text-emerald-400" />, activeIcon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'usage', label: 'Usage Log', icon: <History className="w-3.5 h-3.5 text-amber-400" />, activeIcon: <History className="w-3.5 h-3.5" /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <BarChart3 className="w-3.5 h-3.5" /> },
  ];

  const tabIds = tabs.map((t) => t.id);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabIds.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabIds.length) % tabIds.length;
    }
    if (nextIndex !== null) {
      e.preventDefault();
      setActiveTab(tabIds[nextIndex]);
      tabRefs.current[nextIndex]?.focus();
    }
  }, [tabIds]);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Wrench className="w-6 h-6 text-fuchsia-400" />
            Toolbox
          </h1>
          <p className="text-sm text-slate-400 mt-1">Tools, skills, connections, and analytics</p>
        </div>

        <div className="flex gap-1 bg-slate-900 rounded-lg border border-slate-800 p-1" role="tablist" aria-label="Toolbox tabs">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[i] = el; }}
              role="tab"
              aria-selected={activeTab === t.id}
              tabIndex={activeTab === t.id ? 0 : -1}
              onClick={() => setActiveTab(t.id)}
              onKeyDown={(e) => handleTabKeyDown(e, i)}
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
        {activeTab === 'skills' && <SkillsTab />}
        {activeTab === 'connections' && <ConnectionsTab />}
        {activeTab === 'components' && <ComponentsTab />}
        {activeTab === 'usage' && <UsageTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Source Badge                                                         */
/* ------------------------------------------------------------------ */

function SourceBadge({ source, mcpServer }: { source?: string; mcpServer?: string }) {
  if (source === 'mcp') {
    return (
      <span
        className="text-[10px] px-1 py-0.5 rounded bg-cyan-900/30 text-cyan-400 border border-cyan-800/30 cursor-default"
        title={mcpServer ? `MCP server: ${mcpServer}` : 'MCP tool'}
      >
        mcp
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800/30">
      native
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Shared: ToolCard                                                    */
/* ------------------------------------------------------------------ */

function ToolCard({ tool, source, mcpServer }: { tool: ToolInfo; source?: string; mcpServer?: string }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-md px-3 py-2 space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono text-slate-200">{tool.name}</span>
        {tool.requires_confirmation && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/30">write</span>
        )}
        <SourceBadge source={source} mcpServer={mcpServer} />
      </div>
      <p className="text-[11px] text-slate-500 line-clamp-1">{tool.description}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Catalog Tab                                                         */
/* ------------------------------------------------------------------ */

interface McpToolInfo extends ToolInfo {
  source: string;
  mcp_server?: string;
}

function CatalogTab() {
  const { tools, toolsLoading, loadTools } = useToolUsageStore();
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  useEffect(() => { loadTools(); }, [loadTools]);

  const allTools: Array<ToolInfo & { source: string; mcp_server?: string }> = [];
  if (tools) {
    for (const t of tools.sre) allTools.push({ ...t, source: (t as unknown as { source?: string }).source || 'native' });
    for (const t of tools.security) {
      if (!allTools.some((x) => x.name === t.name)) allTools.push({ ...t, source: (t as unknown as { source?: string }).source || 'native' });
    }
    const mcpTools = (tools as unknown as { mcp?: McpToolInfo[] }).mcp;
    if (mcpTools) {
      for (const t of mcpTools) {
        if (!allTools.some((x) => x.name === t.name)) {
          allTools.push({ ...t, source: 'mcp', mcp_server: t.mcp_server });
        }
      }
    }
  }

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
                  {catTools.map((t) => <ToolCard key={t.name} tool={t} source={t.source} mcpServer={t.mcp_server} />)}
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
/* Skills Tab                                                          */
/* ------------------------------------------------------------------ */

function SkillsTab() {
  const queryClient = useQueryClient();
  const [testQuery, setTestQuery] = useState('');
  const [testResult, setTestResult] = useState<{ skill: string; description: string; degraded: boolean } | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ['admin', 'skills'],
    queryFn: async () => {
      const res = await fetch('/api/agent/skills');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const reloadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/agent/admin/skills/reload', { method: 'POST' });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'skills'] }),
  });

  const testRouting = async () => {
    if (!testQuery.trim()) return;
    try {
      const res = await fetch('/api/agent/admin/skills/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: testQuery }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestResult({ skill: data.skill, description: data.description, degraded: data.degraded });
      } else {
        setTestResult(null);
      }
    } catch {
      setTestResult(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{skills.length} skills loaded</span>
        <button
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-md disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', reloadMutation.isPending && 'animate-spin')} />
          Reload Skills
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sortSkills(skills).map((skill: Record<string, unknown>) => {
            const SkillIcon = SKILL_ICON_MAP[String(skill.icon)] || Puzzle;
            return (
              <button
                key={String(skill.name)}
                onClick={() => setSelectedSkill(String(skill.name))}
                className={cn(
                  'bg-slate-900 border rounded-lg p-4 space-y-2 text-left transition-colors hover:border-blue-700/50 hover:bg-slate-900/80 cursor-pointer',
                  skill.degraded ? 'border-amber-800/50' : 'border-slate-800',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <SkillIcon className={cn('w-4 h-4 shrink-0', skill.degraded ? 'text-amber-400' : 'text-violet-400')} />
                    <span className="text-sm font-medium text-slate-100 truncate">{String(skill.display_name || skill.name)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded text-slate-500 shrink-0">v{Number(skill.version)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!skill.builtin && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-violet-900/30 text-violet-400 rounded border border-violet-800/30">custom</span>
                    )}
                    {Boolean(skill.write_tools) && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-900/30 text-amber-400 rounded border border-amber-800/30">write</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-400">{String(skill.description)}</p>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{(skill.keywords as string[])?.length || 0} keywords</span>
                  <span>{(skill.categories as string[])?.length || 0} categories</span>
                  <span>{Number(skill.prompt_length)} chars</span>
                </div>
                {Boolean(skill.degraded) && (
                  <div className="text-xs text-amber-400">{String(skill.degraded_reason)}</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Routing tester */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-slate-300 mb-2 flex items-center gap-1.5">
          <Play className="w-3.5 h-3.5 text-blue-400" />
          Test Routing
        </h3>
        <div className="flex gap-2">
          <input
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && testRouting()}
            placeholder="Type a query to see which skill handles it..."
            className="flex-1 px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button onClick={testRouting} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md">Test</button>
        </div>
        {testResult && (
          <div className="flex items-center gap-2 mt-2 text-xs">
            <ArrowRight className="w-3 h-3 text-blue-400" />
            <span className={cn('font-medium', testResult.degraded ? 'text-amber-400' : 'text-emerald-400')}>
              {testResult.skill}
            </span>
            <span className="text-slate-500">{testResult.description}</span>
          </div>
        )}
      </div>

      {/* Skill detail drawer */}
      {selectedSkill && (
        <SkillDetailDrawer name={selectedSkill} onClose={() => setSelectedSkill(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skill Detail Drawer                                                 */
/* ------------------------------------------------------------------ */

type SkillFile = 'raw_content' | 'evals_content' | 'mcp_content' | 'layouts_content' | 'components_content';

const SKILL_FILES: Array<{ key: SkillFile; label: string; filename: string }> = [
  { key: 'raw_content', label: 'skill.md', filename: 'skill.md' },
  { key: 'evals_content', label: 'evals.yaml', filename: 'evals.yaml' },
  { key: 'mcp_content', label: 'mcp.yaml', filename: 'mcp.yaml' },
  { key: 'layouts_content', label: 'layouts.yaml', filename: 'layouts.yaml' },
  { key: 'components_content', label: 'components.yaml', filename: 'components.yaml' },
];

type DrawerPanel = 'editor' | 'versions' | 'diff';

interface VersionEntry {
  version: number;
  label: string;
  filename: string;
  timestamp: string;
  current: boolean;
}

function SkillDetailDrawer({ name, onClose }: { name: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [activeFile, setActiveFile] = useState<SkillFile>('raw_content');
  const [panel, setPanel] = useState<DrawerPanel>('editor');
  const [editContent, setEditContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [diffFiles, setDiffFiles] = useState<{ v1: string; v2: string } | null>(null);
  const [diffResult, setDiffResult] = useState('');
  const [showCloneInput, setShowCloneInput] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneStatus, setCloneStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const cloneInputRef = useRef<HTMLInputElement>(null);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['admin', 'skill-detail', name],
    queryFn: async () => {
      const res = await fetch(`/api/agent/skills/${name}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!dirty) setEditContent(data.raw_content || '');
      return data;
    },
  });

  const { data: versionsData } = useQuery({
    queryKey: ['admin', 'skill-versions', name],
    queryFn: async () => {
      const res = await fetch(`/api/agent/admin/skills/${name}/versions`);
      if (!res.ok) return { versions: [] };
      return res.json() as Promise<{ versions: VersionEntry[] }>;
    },
    enabled: panel === 'versions' || panel === 'diff',
  });

  const versions = versionsData?.versions || [];

  const handleSave = async () => {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const res = await fetch(`/api/agent/admin/skills/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        setSaveStatus('saved');
        setDirty(false);
        queryClient.invalidateQueries({ queryKey: ['admin', 'skill-detail', name] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'skill-versions', name] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'skills'] });
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        const err = await res.json().catch(() => ({ detail: 'Save failed' }));
        setSaveError(err.detail || 'Save failed');
        setSaveStatus('idle');
      }
    } catch {
      setSaveError('Network error');
      setSaveStatus('idle');
    }
  };

  const handleClone = async () => {
    if (!cloneName.trim()) return;
    setCloneStatus(null);
    try {
      const res = await fetch(`/api/agent/admin/skills/${name}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: cloneName.trim() }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'skills'] });
        setCloneStatus({ type: 'success', message: `Skill cloned as '${cloneName.trim()}'` });
        setCloneName('');
        setShowCloneInput(false);
      } else {
        const err = await res.json().catch(() => ({ detail: 'Clone failed' }));
        setCloneStatus({ type: 'error', message: err.detail || 'Clone failed' });
      }
    } catch {
      setCloneStatus({ type: 'error', message: 'Network error' });
    }
  };

  const handleDeleteSkill = async () => {
    setDeleteError(null);
    try {
      const res = await fetch(`/api/agent/admin/skills/${name}`, { method: 'DELETE' });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'skills'] });
        setConfirmDelete(false);
        onClose();
      } else {
        const err = await res.json().catch(() => ({ detail: 'Delete failed' }));
        setDeleteError(err.detail || 'Delete failed');
        setConfirmDelete(false);
      }
    } catch {
      setDeleteError('Network error');
      setConfirmDelete(false);
    }
  };

  const loadDiff = async (v1: string, v2: string) => {
    setDiffFiles({ v1, v2 });
    setDiffResult('Loading...');
    try {
      const res = await fetch(`/api/agent/admin/skills/${name}/diff?v1=${encodeURIComponent(v1)}&v2=${encodeURIComponent(v2)}`);
      if (res.ok) {
        const data = await res.json();
        setDiffResult(data.diff || '(no changes)');
      } else {
        setDiffResult('Failed to load diff');
      }
    } catch {
      setDiffResult('Network error');
    }
  };

  const availableFiles = SKILL_FILES.filter((f) => detail?.[f.key]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Skill detail: ${name}`}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-3xl bg-slate-950 border-l border-slate-800 h-full overflow-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Puzzle className="w-5 h-5 text-violet-400" />
              <div>
                <h2 className="text-base font-semibold text-slate-100">{name}</h2>
                {detail && (
                  <p className="text-xs text-slate-500">v{detail.version} &middot; {detail.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {dirty && (
                <button
                  onClick={handleSave}
                  disabled={saveStatus === 'saving'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-md disabled:opacity-50"
                >
                  {saveStatus === 'saving' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
              )}
              {saveStatus === 'saved' && (
                <span className="flex items-center gap-1 text-xs text-emerald-400"><Check className="w-3.5 h-3.5" /> Saved</span>
              )}
              <button
                onClick={() => { setShowCloneInput(!showCloneInput); setCloneStatus(null); setTimeout(() => cloneInputRef.current?.focus(), 50); }}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-md"
                title="Clone as template"
              >
                <Copy className="w-3.5 h-3.5" /> Clone
              </button>
              {!['sre', 'security', 'view_designer'].includes(name) && (
                <button
                  onClick={() => { setConfirmDelete(true); setDeleteError(null); }}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-md"
                  title="Delete skill"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
              <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Panel tabs */}
          <div className="flex gap-1">
            {([
              { id: 'editor' as const, label: 'Editor', icon: <FileText className="w-3.5 h-3.5" /> },
              { id: 'versions' as const, label: 'Versions', icon: <History className="w-3.5 h-3.5" /> },
              { id: 'diff' as const, label: 'Diff', icon: <GitCompareArrows className="w-3.5 h-3.5" /> },
            ]).map((t) => (
              <button
                key={t.id}
                onClick={() => setPanel(t.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
                  panel === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 bg-slate-900',
                )}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Clone input */}
        {showCloneInput && (
          <div className="mx-5 mt-3 flex items-center gap-2">
            <input
              ref={cloneInputRef}
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleClone(); if (e.key === 'Escape') { setShowCloneInput(false); setCloneName(''); } }}
              placeholder="new_skill_name (lowercase, underscores)"
              className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button onClick={handleClone} disabled={!cloneName.trim()} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50">Clone</button>
            <button onClick={() => { setShowCloneInput(false); setCloneName(''); }} className="p-1.5 text-slate-400 hover:text-slate-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Status messages */}
        {cloneStatus && (
          <div className={cn(
            'mx-5 mt-2 flex items-center gap-2 px-3 py-2 text-xs rounded-md border',
            cloneStatus.type === 'success' ? 'bg-emerald-950/30 border-emerald-800/30 text-emerald-400' : 'bg-red-950/30 border-red-800/30 text-red-400',
          )}>
            {cloneStatus.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {cloneStatus.message}
            <button onClick={() => setCloneStatus(null)} className="ml-auto text-slate-500 hover:text-slate-300"><X className="w-3 h-3" /></button>
          </div>
        )}
        {saveError && (
          <div className="mx-5 mt-2 flex items-center gap-2 px-3 py-2 text-xs rounded-md border bg-red-950/30 border-red-800/30 text-red-400">
            <XCircle className="w-3.5 h-3.5" />
            {saveError}
            <button onClick={() => setSaveError(null)} className="ml-auto text-slate-500 hover:text-slate-300"><X className="w-3 h-3" /></button>
          </div>
        )}
        {deleteError && (
          <div className="mx-5 mt-2 flex items-center gap-2 px-3 py-2 text-xs rounded-md border bg-red-950/30 border-red-800/30 text-red-400">
            <XCircle className="w-3.5 h-3.5" />
            {deleteError}
            <button onClick={() => setDeleteError(null)} className="ml-auto text-slate-500 hover:text-slate-300"><X className="w-3 h-3" /></button>
          </div>
        )}

        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={handleDeleteSkill}
          title="Delete Skill"
          description={`Delete skill '${name}'? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
        />

        {isLoading ? (
          <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>
        ) : detail ? (
          <div className="p-5 space-y-4">
            {panel === 'editor' && (
              <>
                {/* Metadata */}
                <div className="grid grid-cols-2 gap-3">
                  <MetaCard label="Keywords" value={detail.keywords?.length ?? 0} />
                  <MetaCard label="Categories" value={detail.categories?.join(', ') || 'none'} />
                  <MetaCard label="Priority" value={detail.priority} />
                  <MetaCard label="Write Tools" value={detail.write_tools ? 'Yes' : 'No'} />
                </div>

                {detail.degraded && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-950/30 border border-amber-800/30 rounded-md text-xs text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    {detail.degraded_reason}
                  </div>
                )}

                {/* Handoff rules */}
                {detail.handoff_to && Object.keys(detail.handoff_to).length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <h3 className="text-xs font-medium text-slate-300 mb-2">Handoff Rules</h3>
                    <div className="space-y-1">
                      {Object.entries(detail.handoff_to).map(([target, keywords]) => (
                        <div key={target} className="flex items-center gap-2 text-xs">
                          <ArrowRight className="w-3 h-3 text-blue-400" />
                          <span className="text-slate-200 font-medium">{target}</span>
                          <span className="text-slate-500">when: {(keywords as string[]).join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Required tools */}
                {detail.requires_tools?.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <h3 className="text-xs font-medium text-slate-300 mb-2">Required Tools</h3>
                    <div className="flex flex-wrap gap-1">
                      {detail.requires_tools.map((t: string) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono">{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* File tabs + editor */}
                {availableFiles.length > 0 && (
                  <div>
                    <div className="flex gap-1 mb-2 overflow-x-auto">
                      {availableFiles.map((f) => (
                        <button
                          key={f.key}
                          onClick={() => {
                            setActiveFile(f.key);
                            if (f.key === 'raw_content') setEditContent(detail.raw_content || '');
                          }}
                          className={cn(
                            'flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md whitespace-nowrap transition-colors',
                            activeFile === f.key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 bg-slate-900',
                          )}
                        >
                          <FileText className="w-3 h-3" />
                          {f.label}
                        </button>
                      ))}
                    </div>
                    {activeFile === 'raw_content' ? (
                      <textarea
                        value={editContent}
                        onChange={(e) => { setEditContent(e.target.value); setDirty(true); setSaveStatus('idle'); }}
                        className="w-full h-[500px] px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-800 rounded-lg text-slate-300 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500"
                        spellCheck={false}
                      />
                    ) : (
                      <textarea
                        readOnly
                        value={detail[activeFile] || ''}
                        className="w-full h-96 px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-800 rounded-lg text-slate-300 resize-y focus:outline-none"
                      />
                    )}
                  </div>
                )}

                {/* Configurable fields */}
                {detail.configurable?.length > 0 && (
                  <SkillConfigSection configurable={detail.configurable} />
                )}
              </>
            )}

            {panel === 'versions' && <VersionsPanel versions={versions} onDiff={(v1, v2) => { setPanel('diff'); loadDiff(v1, v2); }} />}

            {panel === 'diff' && (
              <DiffPanel
                versions={versions}
                diffFiles={diffFiles}
                diffResult={diffResult}
                onLoadDiff={loadDiff}
              />
            )}
          </div>
        ) : (
          <div className="flex justify-center py-12 text-sm text-slate-500">Skill not found</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Versions Panel                                                      */
/* ------------------------------------------------------------------ */

function VersionsPanel({ versions, onDiff }: { versions: VersionEntry[]; onDiff: (v1: string, v2: string) => void }) {
  if (versions.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-slate-500">
        <History className="w-8 h-8 mx-auto mb-2 text-slate-600" />
        No version history yet. Edit and save the skill to create versions.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-slate-300">Version History</h3>
      {versions.map((v, i) => (
        <div key={v.filename} className={cn(
          'bg-slate-900 border rounded-lg p-3 flex items-center justify-between',
          v.current ? 'border-blue-800/50' : 'border-slate-800',
        )}>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-100">{v.label}</span>
              {v.current && <span className="text-[10px] px-1.5 py-0.5 bg-blue-900/40 text-blue-400 rounded">current</span>}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {new Date(v.timestamp).toLocaleString()}
            </div>
          </div>
          {!v.current && i > 0 && (
            <button
              onClick={() => onDiff(v.filename, 'skill.md')}
              className="flex items-center gap-1 px-2 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
            >
              <GitCompareArrows className="w-3 h-3" /> Diff vs current
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diff Panel                                                          */
/* ------------------------------------------------------------------ */

function DiffPanel({
  versions, diffFiles, diffResult, onLoadDiff,
}: {
  versions: VersionEntry[];
  diffFiles: { v1: string; v2: string } | null;
  diffResult: string;
  onLoadDiff: (v1: string, v2: string) => void;
}) {
  const archived = versions.filter((v) => !v.current);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-slate-300">Compare Versions</h3>

      {archived.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {archived.map((v) => (
            <button
              key={v.filename}
              onClick={() => onLoadDiff(v.filename, 'skill.md')}
              className={cn(
                'px-2.5 py-1 text-[11px] rounded-md transition-colors',
                diffFiles?.v1 === v.filename
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200',
              )}
            >
              {v.label} vs current
            </button>
          ))}
        </div>
      ) : (
        <div className="text-xs text-slate-500">No previous versions to compare. Edit and save the skill to start tracking versions.</div>
      )}

      {diffResult && (
        <pre className="w-full max-h-[600px] overflow-auto px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-800 rounded-lg whitespace-pre-wrap">
          {diffResult.split('\n').map((line, i) => (
            <div
              key={i}
              className={cn(
                line.startsWith('+') && !line.startsWith('+++') ? 'text-emerald-400 bg-emerald-950/30' :
                line.startsWith('-') && !line.startsWith('---') ? 'text-red-400 bg-red-950/30' :
                line.startsWith('@@') ? 'text-blue-400' :
                'text-slate-400',
              )}
            >
              {line}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-md px-3 py-2">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-sm text-slate-200 mt-0.5">{value}</div>
    </div>
  );
}

function SkillConfigSection({ configurable }: { configurable: Array<Record<string, unknown>> }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-xs font-medium text-slate-300 w-full">
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
        Configurable Fields ({configurable.length})
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {configurable.map((cfg) => {
            const [fieldName, fieldDef] = Object.entries(cfg)[0] || [];
            if (!fieldName) return null;
            const def = fieldDef as Record<string, unknown> | undefined;
            return (
              <div key={fieldName} className="flex items-center justify-between text-xs border-t border-slate-800 pt-1.5">
                <span className="text-slate-200 font-mono">{fieldName}</span>
                <div className="flex items-center gap-2 text-slate-500">
                  <span>{String(def?.type || 'string')}</span>
                  {def?.default !== undefined && <span>default: {String(def.default)}</span>}
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
/* Connections Tab (formerly MCP Tab)                                   */
/* ------------------------------------------------------------------ */

function ConnectionsTab() {
  const queryClient = useQueryClient();
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

  return (
    <div className="space-y-4">
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
                    {/* Toolset toggles — only for skill-linked servers with toolsets */}
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

                    {/* Tool list */}
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

/* ------------------------------------------------------------------ */
/* Add MCP Server Dialog                                               */
/* ------------------------------------------------------------------ */

function AddMcpServerDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<'sse' | 'stdio'>('sse');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; tools_count: number; error: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await fetch('/api/agent/admin/mcp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, transport }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult(data);
      } else {
        setError(data.detail || 'Test failed');
      }
    } catch {
      setError('Network error — could not reach agent');
    } finally {
      setTesting(false);
    }
  };

  const handleAdd = async () => {
    setAdding(true);
    setError('');
    try {
      const res = await fetch('/api/agent/admin/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, transport }),
      });
      const data = await res.json();
      if (res.ok) {
        onAdded();
      } else {
        setError(data.detail || 'Failed to add server');
      }
    } catch {
      setError('Network error — could not reach agent');
    } finally {
      setAdding(false);
    }
  };

  const canTest = url.trim().length > 0;
  const canAdd = name.trim().length > 0 && url.trim().length > 0 && !adding;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-100">Add MCP Server</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. my-mcp-server"
            className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Transport</label>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as 'sse' | 'stdio')}
            className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="sse">SSE (HTTP)</option>
            <option value="stdio">stdio (subprocess)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[11px] text-slate-400 mb-1">
          {transport === 'sse' ? 'Server URL' : 'Command'}
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={transport === 'sse' ? 'http://localhost:8081' : 'npx @modelcontextprotocol/server-everything'}
          className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
        />
      </div>

      {testResult && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 text-xs rounded-md border',
          testResult.connected
            ? 'bg-emerald-950/30 border-emerald-800/30 text-emerald-400'
            : 'bg-red-950/30 border-red-800/30 text-red-400',
        )}>
          {testResult.connected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {testResult.connected
            ? `Connected — ${testResult.tools_count} tools available`
            : `Connection failed: ${testResult.error}`}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-md border bg-red-950/30 border-red-800/30 text-red-400">
          <XCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={handleTest}
          disabled={!canTest || testing}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors',
            canTest && !testing
              ? 'border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-slate-100'
              : 'border-slate-700 text-slate-600 cursor-not-allowed',
          )}
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          Test Connection
        </button>
        <button
          onClick={handleAdd}
          disabled={!canAdd}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
            canAdd
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-slate-700 text-slate-500 cursor-not-allowed',
          )}
        >
          {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add Server
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Components Tab                                                      */
/* ------------------------------------------------------------------ */

function ComponentsTab() {
  const { data: components, isLoading } = useQuery({
    queryKey: ['admin', 'components'],
    queryFn: async () => {
      const res = await fetch('/api/agent/components');
      if (!res.ok) return null;
      return res.json() as Promise<Record<string, { description: string; category: string; supports_mutations: string[]; is_container: boolean }>>;
    },
  });

  if (isLoading || !components) {
    return <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>;
  }

  const categories = [...new Set(Object.values(components).map((c) => c.category))].sort();

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-400">{Object.keys(components).length} component kinds registered</div>

      {categories.map((cat) => (
        <div key={cat}>
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">{cat}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.entries(components)
              .filter(([, c]) => c.category === cat)
              .map(([name, comp]) => (
                <div key={name} className="bg-slate-900/50 border border-slate-800/50 rounded-md px-3 py-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono text-slate-200">{name}</span>
                    {comp.is_container && <span className="text-[10px] px-1 py-0.5 bg-blue-900/30 text-blue-400 rounded">container</span>}
                  </div>
                  <p className="text-[11px] text-slate-500">{comp.description}</p>
                  {comp.supports_mutations.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {comp.supports_mutations.map((m) => (
                        <span key={m} className="text-[9px] px-1 py-0.5 bg-slate-800 text-slate-500 rounded">{m}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
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

  useEffect(() => { loadUsage(); const iv = setInterval(loadUsage, 5000); return () => clearInterval(iv); }, [loadUsage]);

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
      {usageLoading && !usage ? (
        <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>
      ) : usage && usage.entries.length > 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs" aria-label="Tool usage log">
            <thead>
              <tr className="border-b border-slate-800">
                <th scope="col" className="text-left py-2 px-3 text-slate-400 font-medium">Time</th>
                <th scope="col" className="text-left py-2 px-3 text-slate-400 font-medium">Tool</th>
                <th scope="col" className="text-left py-2 px-3 text-slate-400 font-medium">Source</th>
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
        <td className="py-1.5 px-3"><SourceBadge source={e.tool_source} /></td>
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
          <td colSpan={7} className="px-3 py-2 bg-slate-900/50">
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
/* Analytics Tab (merged: tool stats + skill usage)                    */
/* ------------------------------------------------------------------ */

function AnalyticsTab() {
  const { stats, statsLoading, loadStats, chains, chainsLoading, loadChains, tools, loadTools } = useToolUsageStore();

  const { data: intelligence } = useQuery({
    queryKey: ['analytics', 'intelligence'],
    queryFn: () => fetchIntelligenceSections().catch(() => null),
    staleTime: 60_000,
  });

  const { data: promptAnalytics } = useQuery({
    queryKey: ['analytics', 'prompt'],
    queryFn: () => fetchPromptStats().catch(() => null),
    staleTime: 60_000,
  });

  const { data: skillStats, isLoading: skillStatsLoading } = useQuery({
    queryKey: ['admin', 'skill-usage'],
    queryFn: async () => {
      const res = await fetch('/api/agent/skills/usage?days=30');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 30_000,
  });

  useEffect(() => { loadStats(); loadChains(); loadTools(); const iv = setInterval(() => { loadStats(); loadChains(); }, 10000); return () => clearInterval(iv); }, [loadStats, loadChains, loadTools]);

  if (statsLoading && !stats) {
    return <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>;
  }

  if (!stats || stats.total_calls === 0) {
    return <div className="text-center py-12 text-sm text-slate-500">No usage data yet. Tool calls will appear here once the agent is used.</div>;
  }

  const byTool = stats.by_tool || [];
  const maxCount = Math.max(...byTool.slice(0, 10).map((t) => t.count), 1);
  const rawBySource = (stats as unknown as { by_source?: Record<string, number> | Array<{ source: string; count: number }> }).by_source;
  const bySource = rawBySource
    ? Array.isArray(rawBySource)
      ? rawBySource
      : Object.entries(rawBySource).map(([source, count]) => ({ source, count }))
    : [];

  const skills = skillStats?.skills || [];
  const handoffs = skillStats?.handoffs || [];

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
          {byTool.slice(0, 10).map((t) => (
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

      {/* By mode + by category + by source */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">By Mode</h3>
          <div className="space-y-1">
            {(stats.by_mode || []).map((m) => (
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
            {(stats.by_category || []).map((c) => (
              <div key={c.category} className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{c.category}</span>
                <span className="text-slate-400">{c.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">By Source</h3>
          {bySource && bySource.length > 0 ? (
            <div className="space-y-1">
              {bySource.map((s) => (
                <div key={s.source} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 flex items-center gap-1.5">
                    <SourceBadge source={s.source} />
                  </span>
                  <span className="text-slate-400">{s.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500">No source data available</div>
          )}
        </div>
      </div>

      {/* Context hogs */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-slate-300 mb-3">Largest Results (Context Usage)</h3>
        <div className="space-y-1">
          {[...byTool].sort((a, b) => b.avg_result_bytes - a.avg_result_bytes).slice(0, 5).map((t) => (
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
      {tools && stats && <UnusedToolsSection tools={tools} usedTools={byTool} />}

      {/* Skill Usage (from AdminExtensionsView analytics) */}
      {!skillStatsLoading && skills.length > 0 && (
        <>
          <div className="border-t border-slate-800 pt-6">
            <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Puzzle className="w-4 h-4 text-violet-400" />
              Skill Usage (30 days)
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {skills.map((skill: Record<string, unknown>) => (
              <div key={String(skill.name)} className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-100">{String(skill.name)}</span>
                  <span className="text-lg font-bold text-slate-100">{Number(skill.invocations)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>avg {Number(skill.avg_tools)} tools</span>
                  <span>{Number(skill.avg_duration_ms)}ms avg</span>
                  <span className="text-emerald-400">{Number(skill.feedback_positive)} positive</span>
                  {(skill.feedback_negative as number) > 0 && (
                    <span className="text-red-400">{Number(skill.feedback_negative)} negative</span>
                  )}
                </div>
                {(skill.top_tools as Array<{ name: string; count: number }>)?.length > 0 && (
                  <div className="text-[10px] text-slate-600">
                    Top: {(skill.top_tools as Array<{ name: string; count: number }>).map((t) => t.name).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Handoff flow */}
          {handoffs.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h3 className="text-xs font-medium text-slate-300 mb-3">Skill Handoffs</h3>
              <div className="space-y-1.5">
                {handoffs.map((h: { from: string; to: string; count: number }, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-300">{h.from}</span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                    <span className="text-slate-300">{h.to}</span>
                    <span className="text-slate-500 ml-auto">{h.count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Harness Effectiveness */}
      {intelligence?.harness_effectiveness && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-medium text-slate-300">Harness Effectiveness</h3>
          </div>
          <div className="text-sm text-slate-200">
            Tool selection accuracy: <span className="font-semibold">{intelligence.harness_effectiveness.accuracy.toFixed(0)}%</span>
          </div>
          {intelligence.harness_effectiveness.wasted.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-xs text-slate-400">Wasted tools (offered frequently, rarely used):</div>
              {intelligence.harness_effectiveness.wasted.map((w) => (
                <div key={w.tool} className="text-xs text-amber-400/80">
                  {w.tool}: offered {w.offered}&times;, used {w.used}&times;
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Prompt Analytics */}
      {promptAnalytics?.stats && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-green-400" />
            <h3 className="text-xs font-medium text-slate-300">Prompt Analytics</h3>
          </div>
          <div className="text-sm text-slate-200">
            Avg tokens: {promptAnalytics.stats.avg_tokens.toLocaleString()} &middot; Cache hit rate: {(promptAnalytics.stats.cache_hit_rate * 100).toFixed(0)}%
          </div>
          {Object.keys(promptAnalytics.stats.section_avg).length > 0 && (
            <div className="mt-2 space-y-1">
              {Object.entries(promptAnalytics.stats.section_avg).map(([section, avg]) => (
                <div key={section} className="flex items-center gap-2 text-xs">
                  <span className="w-24 text-slate-500 truncate">{section}</span>
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500/60 rounded-full" style={{ width: `${Math.min((avg as number) / 100, 100)}%` }} />
                  </div>
                  <span className="w-12 text-right text-slate-500">{(avg as number).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PromQL Reliability */}
      {intelligence?.query_reliability && (intelligence.query_reliability.preferred.length > 0 || intelligence.query_reliability.unreliable.length > 0) && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-medium text-slate-300">PromQL Reliability</h3>
          </div>
          <div className="text-xs text-slate-400 mb-2">
            {intelligence.query_reliability.preferred.length} reliable &middot; {intelligence.query_reliability.unreliable.length} unreliable
          </div>
          {intelligence.query_reliability.unreliable.map((q) => (
            <div key={q.query} className="text-xs text-red-400/80 truncate">
              {q.query} &mdash; {(q.success_rate * 100).toFixed(0)}% success ({q.total} calls)
            </div>
          ))}
        </div>
      )}

      {/* Token Trending */}
      {intelligence?.token_trending && (intelligence.token_trending.input_delta_pct !== 0 || intelligence.token_trending.output_delta_pct !== 0 || intelligence.token_trending.cache_delta_pct !== 0) && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-medium text-slate-300">Token Trending (week-over-week)</h3>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center text-xs">
            <div>
              <div className="text-slate-400">Input</div>
              <div className={intelligence.token_trending.input_delta_pct > 0 ? 'text-red-400' : 'text-emerald-400'}>
                {intelligence.token_trending.input_delta_pct > 0 ? '+' : ''}{intelligence.token_trending.input_delta_pct.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-slate-400">Output</div>
              <div className={intelligence.token_trending.output_delta_pct > 0 ? 'text-red-400' : 'text-emerald-400'}>
                {intelligence.token_trending.output_delta_pct > 0 ? '+' : ''}{intelligence.token_trending.output_delta_pct.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-slate-400">Cache</div>
              <div className={intelligence.token_trending.cache_delta_pct > 0 ? 'text-emerald-400' : 'text-red-400'}>
                {intelligence.token_trending.cache_delta_pct > 0 ? '+' : ''}{intelligence.token_trending.cache_delta_pct.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Audit */}
      <PromptAuditSection />
    </div>
  );
}

function UnusedToolsSection({ tools, usedTools }: { tools: { sre: ToolInfo[]; security: ToolInfo[] }; usedTools: Array<{ tool_name: string; count: number }> }) {
  const usedNames = new Set((usedTools || []).map((t) => t.tool_name));
  const allTools: Array<{ name: string; category: string; mode: string }> = [];
  for (const t of (tools.sre || [])) allTools.push({ name: t.name, category: t.category || '', mode: 'sre' });
  for (const t of (tools.security || [])) {
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

/* ------------------------------------------------------------------ */
/* Prompt Audit Section                                                */
/* ------------------------------------------------------------------ */

interface PromptStats {
  avg_tokens: number;
  cache_hit_rate: number;
  static_chars: number;
  dynamic_chars: number;
  avg_static_chars: number;
  avg_dynamic_chars: number;
  total_prompts: number;
  section_avg: Record<string, number>;
}

interface PromptVersion {
  prompt_hash: string;
  label: string;
  first_seen: string;
  last_seen: string;
  count: number;
  duration_days: number;
  skill_version: number;
  avg_tokens: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  avg_cache_read: number;
  static_chars: number;
  avg_dynamic_chars: number;
  is_current: boolean;
  sections?: Record<string, number>;
  total_static_chars?: number;
}

function PromptAuditSection() {
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  const { data: promptStats, isLoading } = useQuery({
    queryKey: ['admin', 'prompt-stats'],
    queryFn: async () => {
      const res = await fetch('/api/agent/prompt/stats?days=30');
      if (!res.ok) return null;
      return res.json() as Promise<PromptStats>;
    },
    refetchInterval: 30_000,
  });

  const { data: promptVersions, isLoading: versionsLoading } = useQuery({
    queryKey: ['admin', 'prompt-versions', selectedSkill],
    queryFn: async () => {
      if (!selectedSkill) return null;
      const res = await fetch(`/api/agent/prompt/versions/${encodeURIComponent(selectedSkill)}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ versions: PromptVersion[] }>;
    },
    enabled: !!selectedSkill,
  });

  if (isLoading) {
    return (
      <div className="border-t border-slate-800 pt-6">
        <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" />
          Prompt Audit (30 days)
        </h2>
        <div className="flex justify-center py-8"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>
      </div>
    );
  }

  if (!promptStats) return null;

  const sectionEntries = Object.entries(promptStats.section_avg || {}).sort(([, a], [, b]) => b - a);
  const sc = promptStats.avg_static_chars || promptStats.static_chars || 0;
  const dc = promptStats.avg_dynamic_chars || promptStats.dynamic_chars || 0;
  const staticDynamic = sc + dc > 0
    ? `${Math.round((sc / (sc + dc)) * 100)}% / ${Math.round((dc / (sc + dc)) * 100)}%`
    : '- / -';

  // Use skill names from API (or derive from section keys as fallback)
  const statsAny = promptStats as unknown as Record<string, unknown>;
  const skillNames = Array.isArray(statsAny.skill_names)
    ? (statsAny.skill_names as string[])
    : [...new Set(sectionEntries.map(([name]) => name.split('.')[0]).filter(Boolean))];

  return (
    <div className="border-t border-slate-800 pt-6 space-y-4">
      <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
        <FileText className="w-4 h-4 text-cyan-400" />
        Prompt Audit (30 days)
      </h2>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Avg Prompt Tokens" value={promptStats.avg_tokens.toLocaleString()} icon={<Hash className="w-4 h-4 text-cyan-400" />} />
        <StatCard label="Cache Hit Rate" value={`${(promptStats.cache_hit_rate * 100).toFixed(1)}%`} icon={<Database className="w-4 h-4 text-emerald-400" />} />
        <StatCard label="Static / Dynamic" value={staticDynamic} icon={<BarChart3 className="w-4 h-4 text-violet-400" />} />
        <StatCard label="Prompts Logged" value={promptStats.total_prompts.toLocaleString()} icon={<FileText className="w-4 h-4 text-blue-400" />} />
      </div>

      {/* Section Breakdown */}
      {sectionEntries.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">Section Breakdown</h3>
          <div className="space-y-1">
            {sectionEntries.map(([name, avgChars]) => (
              <div key={name} className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-mono truncate mr-2">{name}</span>
                <span className="text-slate-400 whitespace-nowrap">{Math.round(avgChars).toLocaleString()} chars avg</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prompt Versions */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-slate-300 mb-3">Prompt Version History</h3>
        <p className="text-xs text-slate-500 mb-3">Track how skill prompts evolve — token costs, size changes, and active periods.</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {skillNames.map((name) => (
            <button
              key={name}
              onClick={() => setSelectedSkill(selectedSkill === name ? null : name)}
              className={cn(
                'px-2.5 py-1 text-[11px] rounded-md transition-colors',
                selectedSkill === name
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200',
              )}
            >
              {name}
            </button>
          ))}
        </div>

        {selectedSkill && (
          <div>
            {versionsLoading ? (
              <div className="flex justify-center py-4"><div className="kv-skeleton w-6 h-6 rounded-full" /></div>
            ) : promptVersions && promptVersions.versions.length > 0 ? (
              <div className="space-y-2">
                {promptVersions.versions.map((v, idx) => {
                  const prev = promptVersions.versions[idx + 1];
                  const tokenDelta = prev ? v.avg_tokens - prev.avg_tokens : 0;
                  const sizeDelta = prev && v.total_static_chars && prev.total_static_chars
                    ? v.total_static_chars - prev.total_static_chars
                    : 0;

                  return (
                    <div key={v.prompt_hash} className="bg-slate-800/50 rounded-lg px-4 py-3 space-y-2">
                      {/* Header row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded font-medium',
                            v.is_current
                              ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/40'
                              : 'bg-slate-700/50 text-slate-400',
                          )}>
                            {v.label || `v${promptVersions.versions.length - idx}`}
                          </span>
                          <span className="text-[10px] text-slate-500">skill v{v.skill_version}</span>
                          {v.is_current && <span className="text-[10px] text-emerald-500">current</span>}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <span>{v.count} turn{v.count !== 1 ? 's' : ''}</span>
                          <span>{v.duration_days > 0 ? `${v.duration_days}d active` : 'today'}</span>
                        </div>
                      </div>

                      {/* Metrics row */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                        <span className="text-slate-300">
                          {v.avg_tokens.toLocaleString()} tokens avg
                          {tokenDelta !== 0 && (
                            <span className={cn('ml-1', tokenDelta > 0 ? 'text-amber-400' : 'text-emerald-400')}>
                              ({tokenDelta > 0 ? '+' : ''}{tokenDelta.toLocaleString()})
                            </span>
                          )}
                        </span>
                        <span className="text-slate-500">
                          {v.avg_input_tokens.toLocaleString()} in / {v.avg_output_tokens.toLocaleString()} out
                        </span>
                        {v.avg_cache_read > 0 && (
                          <span className="text-emerald-500">{v.avg_cache_read.toLocaleString()} cached</span>
                        )}
                        {v.total_static_chars != null && (
                          <span className="text-slate-500">
                            {(v.total_static_chars / 1000).toFixed(1)}k chars
                            {sizeDelta !== 0 && (
                              <span className={cn('ml-1', sizeDelta > 0 ? 'text-amber-400' : 'text-emerald-400')}>
                                ({sizeDelta > 0 ? '+' : ''}{(sizeDelta / 1000).toFixed(1)}k)
                              </span>
                            )}
                          </span>
                        )}
                      </div>

                      {/* Date range */}
                      <div className="text-[10px] text-slate-600">
                        {new Date(v.first_seen).toLocaleDateString()} — {new Date(v.last_seen).toLocaleDateString()}
                        <span className="ml-2 font-mono text-slate-700">{v.prompt_hash?.slice(0, 8)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-500 text-center py-4">No version data for {selectedSkill}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
