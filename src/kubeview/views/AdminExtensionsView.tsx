import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Puzzle, Server, Layers, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, BarChart3, ArrowRight, Play, X, FileText, ChevronDown,
  Save, History, GitCompareArrows, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type ExtTab = 'skills' | 'mcp' | 'components' | 'analytics';

export default function AdminExtensionsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<ExtTab>((searchParams.get('tab') as ExtTab) || 'skills');

  const changeTab = (tab: ExtTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'skills') next.delete('tab'); else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const tabs: Array<{ id: ExtTab; label: string; icon: React.ReactNode }> = [
    { id: 'skills', label: 'Skills', icon: <Puzzle className="w-3.5 h-3.5 text-violet-400" /> },
    { id: 'mcp', label: 'MCP Servers', icon: <Server className="w-3.5 h-3.5 text-cyan-400" /> },
    { id: 'components', label: 'Components', icon: <Layers className="w-3.5 h-3.5 text-emerald-400" /> },
    { id: 'analytics', label: 'Skill Analytics', icon: <BarChart3 className="w-3.5 h-3.5 text-amber-400" /> },
  ];

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Puzzle className="w-6 h-6 text-violet-400" />
            Extensions
          </h1>
          <p className="text-sm text-slate-400 mt-1">Manage skills, MCP servers, and components</p>
        </div>

        <div className="flex gap-1 bg-slate-900 rounded-lg border border-slate-800 p-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => changeTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
                activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {activeTab === 'skills' && <SkillsTab />}
        {activeTab === 'mcp' && <MCPTab />}
        {activeTab === 'components' && <ComponentsTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
      </div>
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
          {skills.map((skill: Record<string, unknown>) => (
            <button
              key={String(skill.name)}
              onClick={() => setSelectedSkill(String(skill.name))}
              className={cn(
                'bg-slate-900 border rounded-lg p-4 space-y-2 text-left transition-colors hover:border-blue-700/50 hover:bg-slate-900/80 cursor-pointer',
                skill.degraded ? 'border-amber-800/50' : 'border-slate-800',
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {skill.degraded
                    ? <AlertTriangle className="w-4 h-4 text-amber-400" />
                    : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  <span className="text-sm font-medium text-slate-100">{String(skill.name)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded-sm text-slate-500">v{Number(skill.version)}</span>
                </div>
                {Boolean(skill.write_tools) && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-amber-900/30 text-amber-400 rounded-sm border border-amber-800/30">write</span>
                )}
              </div>
              <p className="text-xs text-slate-400">{String(skill.description)}</p>
              <div className="flex items-center gap-3 text-[10px] text-slate-500">
                <span>{(skill.keywords as string[])?.length || 0} keywords</span>
                <span>{(skill.categories as string[])?.length || 0} categories</span>
                <span>{Number(skill.prompt_length)} chars</span>
              </div>
              {Boolean(skill.degraded) && (
                <div className="text-[10px] text-amber-400">{String(skill.degraded_reason)}</div>
              )}
            </button>
          ))}
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
            className="flex-1 px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
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
  const [diffFiles, setDiffFiles] = useState<{ v1: string; v2: string } | null>(null);
  const [diffResult, setDiffResult] = useState('');

  const { data: detail, isLoading } = useQuery({
    queryKey: ['admin', 'skill-detail', name],
    queryFn: async () => {
      const res = await fetch(`/api/agent/skills/${name}`);
      if (!res.ok) return null;
      const data = await res.json();
      // Seed editor content on first load
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
        alert(err.detail || 'Save failed');
        setSaveStatus('idle');
      }
    } catch {
      alert('Network error');
      setSaveStatus('idle');
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
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
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
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
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
                        <span key={t} className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm font-mono">{t}</span>
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
                        className="w-full h-[500px] px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-800 rounded-lg text-slate-300 resize-y focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                        spellCheck={false}
                      />
                    ) : (
                      <textarea
                        readOnly
                        value={detail[activeFile] || ''}
                        className="w-full h-96 px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-800 rounded-lg text-slate-300 resize-y focus:outline-hidden"
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
              {v.current && <span className="text-[10px] px-1.5 py-0.5 bg-blue-900/40 text-blue-400 rounded-sm">current</span>}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {new Date(v.timestamp).toLocaleString()}
            </div>
          </div>
          {!v.current && i > 0 && (
            <button
              onClick={() => onDiff(v.filename, 'skill.md')}
              className="flex items-center gap-1 px-2 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-sm"
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

      {/* Quick selectors */}
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

      {/* Diff output */}
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
/* MCP Tab                                                             */
/* ------------------------------------------------------------------ */

function MCPTab() {
  const queryClient = useQueryClient();
  const [expandedServer, setExpandedServer] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);

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

  const toggleToolset = async (toolset: string, currentToolsets: string[]) => {
    const newToolsets = currentToolsets.includes(toolset)
      ? currentToolsets.filter((t) => t !== toolset)
      : [...currentToolsets, toolset];

    if (newToolsets.length === 0) return; // Must have at least one

    setUpdating(true);
    try {
      const res = await fetch('/api/agent/admin/mcp/toolsets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolsets: newToolsets }),
      });
      if (res.ok) {
        const data = await res.json();
        queryClient.invalidateQueries({ queryKey: ['admin', 'mcp'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'skills'] });
        alert(`Toolsets updated! ${data.tools_registered} tools registered.`);
      } else {
        const err = await res.json().catch(() => ({ detail: 'Failed' }));
        alert(err.detail || 'Failed to update toolsets');
      }
    } catch {
      alert('Network error');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">{connections.length} MCP server{connections.length !== 1 ? 's' : ''} configured</div>
        {updating && (
          <div className="flex items-center gap-1.5 text-xs text-blue-400">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Updating toolsets...
          </div>
        )}
      </div>

      {connections.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
          <Server className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400 mb-2">No MCP servers connected</p>
          <p className="text-xs text-slate-500">MCP servers are configured per-skill via mcp.yaml files.</p>
          <p className="text-xs text-slate-500 mt-1">See the Skill Developer Guide for details.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map((conn: Record<string, unknown>, i: number) => {
            const tools = (conn.tools as string[]) || [];
            const enabledToolsets = (conn.toolsets as string[]) || [];
            const expanded = expandedServer === i;

            return (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedServer(expanded ? null : i)}
                  className="w-full p-4 text-left hover:bg-slate-800/30 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {conn.connected ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
                      <span className="text-sm font-medium text-slate-100">{String(conn.name)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded-sm text-slate-500">{String(conn.transport)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{tools.length} tools</span>
                      <ChevronDown className={cn('w-3.5 h-3.5 text-slate-500 transition-transform', expanded && 'rotate-180')} />
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono">{String(conn.url)}</div>
                  {Boolean(conn.error) && <div className="text-[10px] text-red-400 mt-2">{String(conn.error)}</div>}
                </button>

                {expanded && (
                  <div className="border-t border-slate-800">
                    {/* Toolset toggles */}
                    <div className="px-4 py-3 border-b border-slate-800/50">
                      <h4 className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-2">Toolsets</h4>
                      <p className="text-[10px] text-slate-500 mb-3">Toggle toolsets to add or remove capabilities. The MCP server will restart.</p>
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
                              <span className="font-medium">{ts}</span>
                              {enabled && <CheckCircle2 className="w-3 h-3 text-blue-400" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Tool list */}
                    {tools.length > 0 && (
                      <div className="px-4 py-3">
                        <h4 className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-2">
                          Registered Tools ({tools.length})
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {tools.map((tool) => (
                            <div key={tool} className="text-[11px] font-mono text-slate-300 bg-slate-800/50 rounded-sm px-2 py-1 truncate" title={tool}>
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
                    {comp.is_container && <span className="text-[10px] px-1 py-0.5 bg-blue-900/30 text-blue-400 rounded-sm">container</span>}
                  </div>
                  <p className="text-[11px] text-slate-500">{comp.description}</p>
                  {comp.supports_mutations.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {comp.supports_mutations.map((m) => (
                        <span key={m} className="text-[9px] px-1 py-0.5 bg-slate-800 text-slate-500 rounded-sm">{m}</span>
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
/* Analytics Tab                                                       */
/* ------------------------------------------------------------------ */

function AnalyticsTab() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'skill-usage'],
    queryFn: async () => {
      const res = await fetch('/api/agent/skills/usage?days=30');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 30_000,
  });

  if (isLoading || !stats) {
    return <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>;
  }

  const skills = stats.skills || [];
  const handoffs = stats.handoffs || [];

  return (
    <div className="space-y-6">
      {skills.length === 0 ? (
        <div className="text-center py-12 text-sm text-slate-500">No skill usage data yet</div>
      ) : (
        <>
          {/* Per-skill cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {skills.map((skill: Record<string, unknown>) => (
              <div key={String(skill.name)} className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-100">{String(skill.name)}</span>
                  <span className="text-lg font-bold text-slate-100">{Number(skill.invocations)}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-500">
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
    </div>
  );
}
