import { useState, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Puzzle, RefreshCw, Save, Check, Copy, Trash2, X,
  FileText, History, GitCompareArrows, AlertTriangle,
  ArrowRight, CheckCircle2, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { VersionsPanel } from './VersionsPanel';
import type { VersionEntry } from './VersionsPanel';
import { DiffPanel } from './DiffPanel';
import { MetaCard } from './MetaCard';
import { SkillConfigSection } from './SkillConfigSection';

type SkillFile = 'raw_content' | 'evals_content' | 'mcp_content' | 'components_content';

const SKILL_FILES: Array<{ key: SkillFile; label: string; filename: string }> = [
  { key: 'raw_content', label: 'skill.md', filename: 'skill.md' },
  { key: 'evals_content', label: 'evals.yaml', filename: 'evals.yaml' },
  { key: 'mcp_content', label: 'mcp.yaml', filename: 'mcp.yaml' },
  { key: 'components_content', label: 'components.yaml', filename: 'components.yaml' },
];

type DrawerPanel = 'editor' | 'versions' | 'diff';

export function SkillDetailDrawer({ name, onClose }: { name: string; onClose: () => void }) {
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

  const { data: usageStats } = useQuery({
    queryKey: ['skill-usage-detail', name],
    queryFn: async () => {
      const res = await fetch(`/api/agent/skills/usage/${encodeURIComponent(name)}/trend?days=30`);
      if (!res.ok) return null;
      return res.json() as Promise<{ runs: number; sparkline?: number[]; duration_sparkline?: number[]; days_active?: number }>;
    },
    staleTime: 60_000,
  });

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

          {/* Usage stats + sparkline */}
          {usageStats && usageStats.runs > 0 && (
            <div className="flex items-center gap-4 mb-3 px-1">
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-500">30d:</span>
                <span className="text-slate-200 font-medium">{usageStats.runs} runs</span>
                {usageStats.days_active && <span className="text-slate-500">{usageStats.days_active} days active</span>}
              </div>
              {usageStats.sparkline && usageStats.sparkline.length > 1 && (
                <div className="flex items-end gap-px h-5 flex-1 max-w-32">
                  {usageStats.sparkline.map((v, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-violet-500/40 rounded-sm min-h-[2px]"
                      style={{ height: `${(v / Math.max(...usageStats.sparkline!, 1)) * 100}%` }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

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
