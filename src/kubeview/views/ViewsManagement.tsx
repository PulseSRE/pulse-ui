import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Trash2, Share2, ExternalLink, Check, Bot, Loader2, History, Undo2, X, Download, Upload } from 'lucide-react';
import { useCustomViewStore } from '../store/customViewStore';
import { useUIStore } from '../store/uiStore';
import { useAgentStore } from '../store/agentStore';
import { EmptyState } from '../components/primitives/EmptyState';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { formatRelativeTime } from '../engine/formatters';
import type { ViewSpec } from '../engine/agentComponents';

const AGENT_BASE = '/api/agent';

interface ViewVersion {
  version: number;
  action: string;
  title: string;
  description?: string;
  layout?: any[];
  created_at: string;
}

function describeChanges(current: ViewVersion, previous?: ViewVersion): string {
  if (current.action === 'created') return 'Initial version';
  if (!previous) return current.action;
  const changes: string[] = [];
  if (current.title !== previous.title) changes.push(`title: "${previous.title}" → "${current.title}"`);
  const curWidgets = current.layout?.length ?? 0;
  const prevWidgets = previous.layout?.length ?? 0;
  if (curWidgets !== prevWidgets) {
    const diff = curWidgets - prevWidgets;
    if (diff > 0 && current.layout && previous.layout) {
      // Find which widgets were added
      const prevKinds = previous.layout.map((w: any) => w.title || w.kind);
      const added = current.layout
        .filter((w: any) => !prevKinds.includes(w.title || w.kind))
        .map((w: any) => w.title || w.kind)
        .slice(0, 3);
      changes.push(`+${diff} widget${diff > 1 ? 's' : ''}${added.length ? ': ' + added.join(', ') : ''}`);
    } else {
      changes.push(`${diff} widget${Math.abs(diff) > 1 ? 's' : ''}`);
    }
  } else if (current.layout && previous.layout && JSON.stringify(current.layout) !== JSON.stringify(previous.layout)) {
    // Find which widgets changed
    const changed: string[] = [];
    for (let i = 0; i < curWidgets; i++) {
      if (JSON.stringify(current.layout[i]) !== JSON.stringify(previous.layout?.[i])) {
        changed.push((current.layout[i] as any)?.title || `widget ${i}`);
      }
    }
    changes.push(changed.length ? `modified: ${changed.slice(0, 3).join(', ')}` : 'layout modified');
  }
  if (current.description !== previous.description) changes.push('description updated');
  return changes.length > 0 ? changes.join(' · ') : current.action;
}

export default function ViewsManagement({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const views = useCustomViewStore((s) => s.views);
  const loading = useCustomViewStore((s) => s.loading);
  const error = useCustomViewStore((s) => s.error);
  const loadViews = useCustomViewStore((s) => s.loadViews);
  const deleteView = useCustomViewStore((s) => s.deleteView);
  const shareView = useCustomViewStore((s) => s.shareView);

  const [deleteTarget, setDeleteTarget] = useState<ViewSpec | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyViewId, setHistoryViewId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ViewVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);

  const openHistory = async (viewId: string) => {
    setHistoryViewId(viewId);
    setLoadingVersions(true);
    try {
      const res = await fetch(`${AGENT_BASE}/views/${viewId}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions || []);
      }
    } catch { /* ignore */ }
    setLoadingVersions(false);
  };

  const restoreVersion = async (viewId: string, version: number) => {
    setRestoringVersion(version);
    try {
      const res = await fetch(`${AGENT_BASE}/views/${viewId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      if (res.ok) {
        useUIStore.getState().addToast({ type: 'success', title: 'View restored', detail: `Restored to version ${version}`, duration: 3000 });
        loadViews();
        setHistoryViewId(null);
      }
    } catch { /* ignore */ }
    setRestoringVersion(null);
  };

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  const handleExport = (view: ViewSpec) => {
    const exportData = { title: view.title, description: view.description, layout: view.layout, positions: view.positions, templateId: view.templateId };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${view.title.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.title || !data.layout) { useUIStore.getState().addToast({ type: 'error', title: 'Import Failed', detail: 'File must contain title and layout fields' }); return; }
        const saveView = useCustomViewStore.getState().saveView;
        const viewSpec: ViewSpec = {
          id: `cv-${Date.now().toString(36)}`,
          title: data.title,
          description: data.description || '',
          layout: data.layout,
          positions: data.positions || {},
          templateId: data.templateId,
          generatedAt: Date.now(),
        };
        await saveView(viewSpec);
        loadViews();
      } catch { useUIStore.getState().addToast({ type: 'error', title: 'Import Failed', detail: 'Could not parse view file' }); }
    };
    input.click();
  };

  const handleShare = async (view: ViewSpec) => {
    const token = await shareView(view.id);
    if (token) {
      const basePath = window.location.pathname.split('/views')[0];
      const url = `${window.location.origin}${basePath}/share/${token}`;
      navigator.clipboard.writeText(url);
      setCopiedId(view.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // Sort views by most recently created first
  const sortedViews = [...views].sort((a, b) => b.generatedAt - a.generatedAt);

  return (
    <div className={embedded ? '' : 'h-full overflow-auto bg-slate-950 p-6'}>
      <div className={embedded ? '' : 'max-w-6xl mx-auto'}>
        {/* Header — hidden when embedded as a tab */}
        {!embedded && (
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <LayoutDashboard className="w-6 h-6 text-violet-500" />
              Your Views
            </h1>
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400 mt-1">
                AI-generated dashboards saved to your account.
              </p>
              <button
                onClick={handleImport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" /> Import View
              </button>
            </div>
          </div>
        )}

        {/* Import button in embedded mode */}
        {embedded && (
          <div className="flex justify-end mb-3">
            <button onClick={handleImport} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
              <Upload className="w-3.5 h-3.5" /> Import View
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && views.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex items-center justify-center py-10">
            <div className="text-center space-y-2">
              <p className="text-sm text-red-400">{error}</p>
              <button onClick={loadViews} className="text-xs text-violet-400 hover:text-violet-300">
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && views.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <EmptyState
              icon={<Bot className="w-12 h-12 text-slate-600" />}
              title="No views yet"
              description="Ask the AI to build any dashboard you need."
              aiPrompts={[
                { label: 'Node health dashboard', onAsk: () => { useAgentStore.getState().connectAndSend('Create a dashboard showing node health: CPU/memory utilization, pod density, and node conditions'); useUIStore.getState().expandAISidebar(); useUIStore.getState().setAISidebarMode('chat'); } },
                { label: 'Workload overview', onAsk: () => { useAgentStore.getState().connectAndSend('Create a dashboard showing deployment status, pod restart trends, and OOM kills'); useUIStore.getState().expandAISidebar(); useUIStore.getState().setAISidebarMode('chat'); } },
                { label: 'Security posture', onAsk: () => { useAgentStore.getState().connectAndSend('Create a dashboard showing security audit score, cluster-admin bindings, unprotected namespaces, and SCC usage'); useUIStore.getState().expandAISidebar(); useUIStore.getState().setAISidebarMode('chat'); } },
                { label: 'Cost & capacity', onAsk: () => { useAgentStore.getState().connectAndSend('Create a dashboard showing resource utilization ratios, capacity projections, and idle workloads'); useUIStore.getState().expandAISidebar(); useUIStore.getState().setAISidebarMode('chat'); } },
              ]}
            />
          </div>
        )}

        {/* View cards */}
        {sortedViews.length > 0 && (
          <div className="space-y-3">
            {sortedViews.map((view) => {
              // Count component types for mini-summary
              const kinds = new Map<string, number>();
              for (const w of view.layout) {
                const k = (w as any).kind || 'unknown';
                kinds.set(k, (kinds.get(k) || 0) + 1);
              }
              const kindSummary = Array.from(kinds.entries())
                .map(([k, n]) => `${n} ${k.replace('_', ' ')}`)
                .join(' · ');

              return (
              <div
                key={view.id}
                className={cn(
                  'group relative rounded-lg border bg-gradient-to-r from-slate-900 to-slate-900/80 transition-all cursor-pointer overflow-hidden',
                  view.view_type === 'incident' ? 'border-slate-800 hover:border-red-800/50 hover:to-red-950/20'
                    : view.view_type === 'assessment' ? 'border-slate-800 hover:border-amber-800/50 hover:to-amber-950/20'
                    : 'border-slate-800 hover:border-violet-800/50 hover:to-violet-950/20'
                )}
                onClick={() => navigate(`/custom/${view.id}`)}
              >
                {/* Left accent bar — color-coded by type */}
                <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l',
                  view.view_type === 'incident' ? 'bg-red-500' : view.view_type === 'assessment' ? 'bg-amber-500' : 'bg-violet-600'
                )} />

                <div className="flex items-center gap-4 p-4 pl-5">
                  {/* Icon */}
                  <div className={cn('shrink-0 w-10 h-10 rounded-lg border flex items-center justify-center',
                    view.view_type === 'incident' ? 'bg-red-600/10 border-red-800/30' : view.view_type === 'assessment' ? 'bg-amber-600/10 border-amber-800/30' : 'bg-violet-600/10 border-violet-800/30'
                  )}>
                    <LayoutDashboard className={cn('w-5 h-5',
                      view.view_type === 'incident' ? 'text-red-400' : view.view_type === 'assessment' ? 'text-amber-400' : 'text-violet-400'
                    )} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-100">{view.title}</h3>
                    {view.description && (
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{view.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <LayoutDashboard className="w-3 h-3" />
                        {view.layout.length} widget{view.layout.length !== 1 ? 's' : ''}
                      </span>
                      <span>·</span>
                      <span>{kindSummary}</span>
                      <span>·</span>
                      <span>Updated {formatRelativeTime(view.generatedAt)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleExport(view)}
                      className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      title="Export as JSON"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleShare(view)}
                      className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      title={copiedId === view.id ? 'Copied!' : 'Share'}
                    >
                      {copiedId === view.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => openHistory(view.id)}
                      className="p-1.5 rounded text-slate-500 hover:text-violet-400 hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-all"
                      title="Version history"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(view)}
                      className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete view"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Version history panel */}
      {historyViewId && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setHistoryViewId(null)} />
          <div className="fixed right-0 top-0 z-50 h-full w-80 border-l border-slate-700 bg-slate-900 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-700 p-4">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <History className="w-4 h-4 text-violet-400" />
                Version History
              </h3>
              <button onClick={() => setHistoryViewId(null)} className="p-1 rounded hover:bg-slate-800 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-2">
              {loadingVersions && (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                </div>
              )}
              {!loadingVersions && versions.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-8">No version history yet. Changes are snapshotted automatically when you edit a view.</p>
              )}
              {versions.map((v, i) => {
                const previous = versions[i + 1]; // versions are sorted newest-first
                return (
                <div key={v.version} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-3 py-2">
                  <div>
                    <div className="text-xs text-slate-300">v{v.version} · {formatRelativeTime(new Date(v.created_at).getTime())}</div>
                    <div className="text-xs text-slate-500">{describeChanges(v, previous)}</div>
                    {v.layout && <div className="text-xs text-slate-600 mt-0.5">{v.layout.length} widget{v.layout.length !== 1 ? 's' : ''} · {v.title}</div>}
                  </div>
                  <button
                    onClick={() => restoreVersion(historyViewId, v.version)}
                    disabled={restoringVersion !== null}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-violet-400 hover:bg-slate-800 disabled:opacity-50 transition-colors"
                    title="Restore this version"
                  >
                    {restoringVersion === v.version ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                    Restore
                  </button>
                </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteView(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        title="Delete View"
        description={`Delete "${deleteTarget?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
