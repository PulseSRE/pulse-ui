import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Trash2, Share2, ExternalLink, Check, Bot, Loader2 } from 'lucide-react';
import { useCustomViewStore } from '../store/customViewStore';
import { EmptyState } from '../components/primitives/EmptyState';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { formatRelativeTime } from '../engine/formatters';
import type { ViewSpec } from '../engine/agentComponents';

export default function ViewsManagement() {
  const navigate = useNavigate();
  const views = useCustomViewStore((s) => s.views);
  const loading = useCustomViewStore((s) => s.loading);
  const loadViews = useCustomViewStore((s) => s.loadViews);
  const deleteView = useCustomViewStore((s) => s.deleteView);
  const shareView = useCustomViewStore((s) => s.shareView);

  const [deleteTarget, setDeleteTarget] = useState<ViewSpec | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-violet-500" />
            Your Views
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            AI-generated dashboards saved to your account.
          </p>
        </div>

        {/* Loading state */}
        {loading && views.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && views.length === 0 && (
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
                    onClick={() => setDeleteTarget(view)}
                    className="ml-auto p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-all"
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
