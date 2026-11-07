import { useEffect, useState } from 'react';
import { PageHeader } from '../components/primitives/PageHeader';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Trash2, Share2, ExternalLink, Check, Bot, Loader2, History, Undo2, Download, Upload, Copy } from 'lucide-react';
import { SearchInput } from '../components/primitives/SearchInput';
import { FilterButtonGroup } from '../components/primitives/FilterButtonGroup';
import { useCustomViewStore } from '../store/customViewStore';
import { useUIStore } from '../store/uiStore';
import { EmptyState } from '../components/primitives/EmptyState';
import { LoadError } from '../components/primitives/LoadError';
import { agentJson } from '../engine/safeQuery';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { formatRelativeTime } from '../engine/formatters';
import type { ViewSpec } from '../engine/agentComponents';
import { askPulse } from '../engine/askPulse';
import { GRID_COLS, LEGACY_GRID_COLS, toCurrentGrid } from './grid';
import { DrawerShell } from '../components/primitives/DrawerShell';

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
  const forceLoadViews = useCustomViewStore((s) => s.forceLoadViews);
  const deleteView = useCustomViewStore((s) => s.deleteView);
  const shareView = useCustomViewStore((s) => s.shareView);

  const [deleteTarget, setDeleteTarget] = useState<ViewSpec | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyViewId, setHistoryViewId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ViewVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);

  const [historyError, setHistoryError] = useState<{ title: string; error: unknown } | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cloningId, setCloningId] = useState<string | null>(null);

  const handleClone = async (view: ViewSpec) => {
    setCloningId(view.id);
    try {
      const { id } = await agentJson<{ id: string }>(`${AGENT_BASE}/views/${encodeURIComponent(view.id)}/clone`, { method: 'POST' });
      // Not throttled: the list loaded seconds ago and must show the copy now.
      await forceLoadViews();
      useUIStore.getState().addToast({
        type: 'success',
        title: `Cloned "${view.title}"`,
        action: { label: 'Open', onClick: () => navigate(`/custom/${id}`) },
      });
    } catch (e) {
      useUIStore.getState().addToast({ type: 'error', title: 'Clone failed', detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setCloningId(null);
    }
  };

  const openHistory = async (viewId: string) => {
    setHistoryViewId(viewId);
    setHistoryError(null);
    setVersions([]);
    setLoadingVersions(true);
    try {
      const data = await agentJson<{ versions?: ViewVersion[] }>(`${AGENT_BASE}/views/${viewId}/versions`);
      setVersions(data.versions || []);
    } catch (e) {
      // Showed "No version history yet" — a different and reassuring answer.
      setHistoryError({ title: 'Version history could not be loaded', error: e });
    }
    setLoadingVersions(false);
  };

  const restoreVersion = async (viewId: string, version: number) => {
    setRestoringVersion(version);
    setHistoryError(null);
    try {
      await agentJson(`${AGENT_BASE}/views/${viewId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      useUIStore.getState().addToast({ type: 'success', title: 'View restored', detail: `Restored to version ${version}`, duration: 3000 });
      loadViews();
      setHistoryViewId(null);
    } catch (e) {
      setHistoryError({ title: `Version ${version} was not restored`, error: e });
    }
    setRestoringVersion(null);
  };

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  const handleExport = (view: ViewSpec) => {
    const exportData = { title: view.title, description: view.description, layout: view.layout, positions: view.positions, gridColumns: GRID_COLS, templateId: view.templateId };
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
          // Files exported before the 12-column grid have no gridColumns.
          positions: toCurrentGrid(data.positions, typeof data.gridColumns === 'number' ? data.gridColumns : LEGACY_GRID_COLS),
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
    if (!token) {
      // Used to fail silently: the button just did nothing.
      useUIStore.getState().addToast({ type: 'error', title: 'Share failed', detail: 'The agent did not create a share link. Try again.' });
      return;
    }
    const basePath = window.location.pathname.split('/views')[0];
    const url = `${window.location.origin}${basePath}/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      useUIStore.getState().addToast({ type: 'success', title: 'Share link copied', detail: url, duration: 4000 });
      setCopiedId(view.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard refused (permissions, insecure context): show the link so it can be copied by hand.
      useUIStore.getState().addToast({ type: 'warning', title: 'Copy the share link', detail: url, duration: 0 });
    }
  };

  // Sort views by most recently created first
  const query = search.trim().toLowerCase();
  const sortedViews = [...views]
    .filter((v) => !typeFilter || (v.view_type ?? 'custom') === typeFilter)
    .filter((v) => !query || v.title.toLowerCase().includes(query) || (v.description ?? '').toLowerCase().includes(query))
    .sort((a, b) => b.generatedAt - a.generatedAt);
  const typeCounts = views.reduce<Record<string, number>>((acc, v) => {
    const t = v.view_type ?? 'custom';
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className={embedded ? '' : 'h-full overflow-auto bg-slate-950 p-6'}>
      <div className={embedded ? '' : 'max-w-6xl mx-auto'}>
        {/* Header — hidden when embedded as a tab */}
        {!embedded && (
          <PageHeader
            className="mb-6"
            icon={<LayoutDashboard className="w-6 h-6 text-violet-500" />}
            title="Your Views"
            subtitle="AI-generated dashboards saved to your account."
            actions={<button
              onClick={handleImport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" /> Import View
            </button>}
          />
        )}

        {/* Import button in embedded mode */}
        {embedded && (
          <div className="flex justify-end mb-3">
            <button onClick={handleImport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
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
        {error && <LoadError title="Views could not be loaded" error={error} onRetry={loadViews} className="my-4" />}

        {/* Type filter and search */}
        {views.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <FilterButtonGroup
              options={[
                { key: 'all', label: `All (${views.length})` },
                ...(['custom', 'incident', 'assessment', 'plan'] as const)
                  .filter((t) => typeCounts[t])
                  .map((t) => ({ key: t, label: `${t[0].toUpperCase()}${t.slice(1)} (${typeCounts[t]})` })),
              ]}
              value={typeFilter ?? 'all'}
              onChange={(v) => setTypeFilter(!v || v === 'all' ? null : v)}
            />
            <SearchInput value={search} onChange={setSearch} placeholder="Search views" className="w-56" />
          </div>
        )}

        {views.length > 0 && sortedViews.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">No views match this filter.</p>
        )}

        {/* Empty state */}
        {!loading && !error && views.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <EmptyState
              icon={<Bot className="w-12 h-12 text-slate-600" />}
              title="No views yet"
              description="Ask Pulse to build any dashboard you need."
              aiPrompts={[
                { label: 'Node health dashboard', onAsk: () => { askPulse('Create a dashboard showing node health: CPU/memory utilization, pod density, and node conditions'); } },
                { label: 'Workload overview', onAsk: () => { askPulse('Create a dashboard showing deployment status, pod restart trends, and OOM kills'); } },
                { label: 'Security posture', onAsk: () => { askPulse('Create a dashboard showing security audit score, cluster-admin bindings, unprotected namespaces, and SCC usage'); } },
                { label: 'Cost & capacity', onAsk: () => { askPulse('Create a dashboard showing resource utilization ratios, capacity projections, and idle workloads'); } },
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
                  'group relative rounded-lg border bg-linear-to-r from-slate-900 to-slate-900/80 transition-all cursor-pointer overflow-hidden',
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
                      className="p-1.5 rounded-sm text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      title="Export as JSON"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleShare(view)}
                      className="p-1.5 rounded-sm text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      title={copiedId === view.id ? 'Copied!' : 'Share'}
                      aria-label={`Share ${view.title}`}
                    >
                      {copiedId === view.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleClone(view)}
                      disabled={cloningId === view.id}
                      className="p-1.5 rounded-sm text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-40"
                      title="Clone"
                      aria-label={`Clone ${view.title}`}
                    >
                      {cloningId === view.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => openHistory(view.id)}
                      className="p-1.5 rounded-sm text-slate-500 hover:text-violet-400 hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-all"
                      title="Version history"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(view)}
                      className="p-1.5 rounded-sm text-slate-500 hover:text-red-400 hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-all"
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
          <DrawerShell
            title="Version History"
            icon={<History className="w-4 h-4 text-violet-400" />}
            onClose={() => setHistoryViewId(null)}
            width="max-w-xs"
            bodyClassName="p-4 space-y-2"
          >
              {loadingVersions && (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                </div>
              )}
              {historyError && (
                <LoadError
                  title={historyError.title}
                  error={historyError.error}
                  onRetry={() => historyViewId && openHistory(historyViewId)}
                />
              )}
              {!loadingVersions && !historyError && versions.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-8">No version history yet. Changes are snapshotted automatically when you edit a view.</p>
              )}
              {versions.map((v, i) => {
                const previous = versions[i + 1]; // versions are sorted newest-first
                return (
                <div key={v.version} className="flex items-center justify-between rounded-sm border border-slate-800 bg-slate-950 px-3 py-2">
                  <div>
                    <div className="text-xs text-slate-300">v{v.version} · {formatRelativeTime(new Date(v.created_at).getTime())}</div>
                    <div className="text-xs text-slate-500">{describeChanges(v, previous)}</div>
                    {v.layout && <div className="text-xs text-slate-600 mt-0.5">{v.layout.length} widget{v.layout.length !== 1 ? 's' : ''} · {v.title}</div>}
                  </div>
                  <button
                    onClick={() => restoreVersion(historyViewId, v.version)}
                    disabled={restoringVersion !== null}
                    className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs text-violet-400 hover:bg-slate-800 disabled:opacity-50 transition-colors"
                    title="Restore this version"
                  >
                    {restoringVersion === v.version ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                    Restore
                  </button>
                </div>
                );
              })}
          </DrawerShell>
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
