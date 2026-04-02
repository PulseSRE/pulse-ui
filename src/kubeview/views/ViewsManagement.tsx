import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Trash2, Share2, ExternalLink, Check, Bot, Loader2, History, Undo2, X } from 'lucide-react';
import { useCustomViewStore } from '../store/customViewStore';
import { useUIStore } from '../store/uiStore';
import { EmptyState } from '../components/primitives/EmptyState';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { formatRelativeTime } from '../engine/formatters';
import type { ViewSpec } from '../engine/agentComponents';

const AGENT_BASE = '/api/agent';

interface ViewVersion {
  version: number;
  action: string;
  title: string;
  created_at: string;
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
            <p className="text-sm text-slate-400 mt-1">
              AI-generated dashboards saved to your account.
            </p>
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
              description="Ask the AI to create one. Try: &quot;Create a dashboard showing node health and crashlooping pods.&quot;"
            />
          </div>
        )}

        {/* View cards grid */}
        {sortedViews.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedViews.map((view) => (
              <div
                key={view.id}
                className="group rounded-lg border border-slate-800 bg-slate-900 p-4 hover:border-slate-700 transition-colors"
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-100 truncate">
                      {view.title}
                    </h3>
                    {view.description && (
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                        {view.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Meta */}
                <div className="flex items-center gap-3 text-xs text-slate-500 mb-3">
                  <span>{view.layout.length} widget{view.layout.length !== 1 ? 's' : ''}</span>
                  <span>Updated {formatRelativeTime(view.generatedAt)}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => navigate(`/custom/${view.id}`)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-violet-700 hover:bg-violet-600 text-white transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open
                  </button>
                  <button
                    onClick={() => handleShare(view)}
                    className="flex items-center gap-1 px-2 py-1.5 rounded text-xs bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                    title={copiedId === view.id ? 'Link copied!' : 'Copy share link'}
                  >
                    {copiedId === view.id ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Share2 className="w-3 h-3" />
                    )}
                    {copiedId === view.id ? 'Copied' : 'Share'}
                  </button>
                  <button
                    onClick={() => openHistory(view.id)}
                    className="ml-auto p-1.5 rounded text-slate-500 hover:text-violet-400 hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-all"
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
            ))}
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
              {versions.map((v) => (
                <div key={v.version} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-3 py-2">
                  <div>
                    <div className="text-xs text-slate-300">v{v.version} — {v.action}</div>
                    <div className="text-xs text-slate-500">{v.title} · {formatRelativeTime(new Date(v.created_at).getTime())}</div>
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
              ))}
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
