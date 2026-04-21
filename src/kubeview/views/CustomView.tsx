import { useParams } from 'react-router-dom';
import { Trash2, Plus, LayoutDashboard, Bot, Share2, Check, GripVertical, Pencil, Eye, RefreshCw, Settings2, Clock } from 'lucide-react';
import { ChartEditPopover } from '../components/agent/ChartEditPopover';
import { useCustomViewStore } from '../store/customViewStore';
import { useUIStore } from '../store/uiStore';
import { useAgentStore } from '../store/agentStore';
import { AgentComponentRenderer } from '../components/agent/AgentComponentRenderer';
import { EmptyState } from '../components/primitives/EmptyState';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { formatRelativeTime } from '../engine/formatters';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { ComponentSpec } from '../engine/agentComponents';

// react-grid-layout (npm install react-grid-layout @types/react-grid-layout)
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGrid = WidthProvider(Responsive);

/* Layout is backend-authoritative. The engine computes positions
   via compute_layout() and the frontend renders them verbatim.
   No idealWidth/idealHeight/generateDefaultLayout/applyTemplate. */

/** Convert react-grid-layout Layout[] to our positions map */
function layoutToPositions(layout: ReactGridLayout.Layout[]): Record<number, { x: number; y: number; w: number; h: number }> {
  const positions: Record<number, { x: number; y: number; w: number; h: number }> = {};
  for (const item of layout) {
    positions[Number(item.i)] = { x: item.x, y: item.y, w: item.w, h: item.h };
  }
  return positions;
}

/** Convert positions map to react-grid-layout Layout[].
 *  Backend computes all positions — frontend just renders them.
 *  Missing positions get a safe full-width default appended below existing widgets. */
export function positionsToLayout(positions: Record<string | number, { x: number; y: number; w: number; h: number }>, specs: ComponentSpec[]): ReactGridLayout.Layout[] {
  // Compute max_y from existing positions for appending missing widgets
  let maxY = 0;
  for (const pos of Object.values(positions)) {
    if (pos && pos.y + pos.h > maxY) maxY = pos.y + pos.h;
  }

  return Array.from({ length: specs.length }, (_, i) => {
    const pos = positions[i] || positions[String(i)];
    if (pos) {
      return { i: String(i), x: pos.x, y: pos.y, w: pos.w, h: pos.h || 8, minW: 1, minH: 2 };
    }
    // Missing position — append below existing widgets with kind-aware heights
    const kind = specs[i]?.kind || '';
    const kindHeights: Record<string, number> = {
      topology: 24, chart: 12, data_table: 12, node_map: 12,
      grid: 7, info_card_grid: 5, resource_counts: 4, section: 10,
    };
    const h = kindHeights[kind] || 8;
    const fallbackY = maxY > 0 ? maxY : i * h;
    maxY = fallbackY + h;
    return { i: String(i), x: 0, y: fallbackY, w: 4, h, minW: 1, minH: 2 };
  });
}

export default function CustomView() {
  const { viewId } = useParams<{ viewId: string }>();
  const view = useCustomViewStore((s) => s.getView(viewId || ''));
  const deleteView = useCustomViewStore((s) => s.deleteView);
  const updateView = useCustomViewStore((s) => s.updateView);
  const removeWidget = useCustomViewStore((s) => s.removeWidget);
  const updateWidget = useCustomViewStore((s) => s.updateWidget);
  const shareView = useCustomViewStore((s) => s.shareView);

  // Load views if the requested view isn't in the store yet (once per viewId)
  const loadViews = useCustomViewStore((s) => s.loadViews);
  const attemptedLoad = useRef<string | null>(null);
  useEffect(() => {
    if (viewId && !view && attemptedLoad.current !== viewId) {
      attemptedLoad.current = viewId;
      loadViews();
    }
  }, [viewId, view, loadViews]);

  // Update tab title to match view title
  const updateTab = useUIStore((s) => s.updateTab);
  useEffect(() => {
    if (view?.title) {
      const tabs = useUIStore.getState().tabs;
      const tab = tabs.find((t) => t.path === `/custom/${viewId}`);
      if (tab && tab.title !== view.title) {
        updateTab(tab.id, { title: view.title });
      }
    }
  }, [view?.title, viewId, updateTab]);

  // Auto-set active builder when viewing a custom view — so new widgets
  // from the agent dock get added here instead of creating a new view
  useEffect(() => {
    if (viewId) {
      useCustomViewStore.getState().setActiveBuilderId(viewId);
    }
    return () => {
      if (useCustomViewStore.getState().activeBuilderId === viewId) {
        useCustomViewStore.getState().setActiveBuilderId(null);
      }
    };
  }, [viewId]);

  // Force grid remount when sidebar toggles so WidthProvider remeasures
  const sidebarExpanded = useUIStore((s) => s.aiSidebarExpanded);
  const [gridKey, setGridKey] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setGridKey((k) => k + 1), 350);
    return () => clearTimeout(timer);
  }, [sidebarExpanded]);

  // Derive layout from already-subscribed view to avoid redundant selector
  const viewLayout = view?.layout;

  const REFRESH_OPTIONS = [
    { label: '5s', ms: 5000 },
    { label: '10s', ms: 10000 },
    { label: '30s', ms: 30000 },
    { label: '1m', ms: 60000 },
    { label: '5m', ms: 300000 },
    { label: 'Off', ms: 0 },
  ];
  const [refreshInterval, setRefreshInterval] = useState(60000);
  const TIME_RANGE_OPTIONS = ['1h', '6h', '24h', '3d', '7d'];
  const [globalTimeRange, setGlobalTimeRange] = useState('1h');
  const [hoverTimestamp, setHoverTimestamp] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [widgetToRemove, setWidgetToRemove] = useState<number | null>(null);
  const [editingChart, setEditingChart] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editingTitle && titleRef.current) titleRef.current.focus();
  }, [editingTitle]);

  useEffect(() => {
    if (editingDesc && descRef.current) descRef.current.focus();
  }, [editingDesc]);

  // Inject resize handle styles when in edit mode
  useEffect(() => {
    if (!editMode) return;
    const style = document.createElement('style');
    style.textContent = `
      .react-resizable-handle { background: none !important; width: 28px !important; height: 28px !important; }
      .react-resizable-handle::after { content: ''; position: absolute; right: 4px; bottom: 4px; width: 14px; height: 14px; border-right: 3px solid #7c3aed; border-bottom: 3px solid #7c3aed; border-radius: 2px; }
      .react-grid-item.react-grid-placeholder { background: rgba(124,58,237,0.15) !important; border: 1px dashed #7c3aed !important; border-radius: 8px; }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, [editMode]);

  const currentLayout = useMemo(() => {
    if (!view) return [];
    // Backend-authoritative: positions come from compute_layout()
    return positionsToLayout(view.positions || {}, view.layout);
  }, [view]);

  const handleLayoutChange = useCallback(
    (layout: ReactGridLayout.Layout[]) => {
      if (!view || !editMode) return;
      // Debounce saves
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        updateView(view.id, { positions: layoutToPositions(layout) });
      }, 500);
    },
    [view, editMode, updateView],
  );

  if (!view) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <EmptyState
          icon={<LayoutDashboard className="w-12 h-12 text-slate-600" />}
          title="View not found"
          description="This custom view may have been deleted."
        />
      </div>
    );
  }

  const handleTitleSave = () => {
    if (titleDraft.trim() && titleDraft !== view.title) {
      updateView(view.id, { title: titleDraft.trim() }, true);
    }
    setEditingTitle(false);
  };

  const handleDescSave = () => {
    if (descDraft !== view.description) {
      updateView(view.id, { description: descDraft.trim() }, true);
    }
    setEditingDesc(false);
  };

  const handleShare = async () => {
    const token = await shareView(view.id);
    if (token) {
      // Use pathname to respect any base path the app is deployed under
      const basePath = window.location.pathname.split('/custom/')[0];
      const url = `${window.location.origin}${basePath}/share/${token}`;
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="w-full max-w-[1800px] mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            {editingTitle ? (
              <input
                ref={titleRef}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleSave();
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
                className="text-2xl font-bold text-slate-100 bg-transparent border-b border-violet-500 outline-none w-full"
              />
            ) : (
              <h1
                className="text-2xl font-bold text-slate-100 flex items-center gap-2 cursor-pointer hover:text-violet-300 transition-colors"
                onClick={() => {
                  setTitleDraft(view.title);
                  setEditingTitle(true);
                }}
              >
                <LayoutDashboard className="w-6 h-6 text-violet-500" />
                {view.title}
              </h1>
            )}
            {editingDesc ? (
              <input
                ref={descRef}
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                onBlur={handleDescSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleDescSave();
                  if (e.key === 'Escape') setEditingDesc(false);
                }}
                className="text-sm text-slate-400 bg-transparent border-b border-slate-600 outline-none w-full mt-1"
                placeholder="Add a description..."
              />
            ) : (
              <p
                className="text-sm text-slate-400 mt-1 cursor-pointer hover:text-slate-300 transition-colors"
                onClick={() => {
                  setDescDraft(view.description || '');
                  setEditingDesc(true);
                }}
              >
                {view.description || 'Click to add description...'}
              </p>
            )}
            <p className="text-xs text-slate-600 mt-1">
              Created {formatRelativeTime(view.generatedAt)} · {view.layout.length} widget{view.layout.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Refresh interval selector */}
            <div className="flex items-center gap-0.5 bg-slate-800 rounded px-1 py-0.5">
              <RefreshCw className="w-3 h-3 text-slate-500" />
              {REFRESH_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setRefreshInterval(opt.ms)}
                  className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
                    refreshInterval === opt.ms
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {/* Time range selector */}
            <div className="flex items-center gap-0.5 bg-slate-800 rounded px-1 py-0.5">
              <Clock className="w-3 h-3 text-slate-500" />
              {TIME_RANGE_OPTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => setGlobalTimeRange(t)}
                  className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
                    globalTimeRange === t ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              onClick={() => setEditMode(!editMode)}
              className={`p-1.5 rounded transition-colors ${editMode ? 'bg-amber-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              title={editMode ? 'Done editing' : 'Edit layout'}
            >
              {editMode ? <Eye className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
            </button>
            <button
              onClick={handleShare}
              className="p-1.5 rounded bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              title={copied ? 'Link copied!' : 'Share view'}
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                useUIStore.getState().expandAISidebar();
                useUIStore.getState().setAISidebarMode('chat');
                useAgentStore.getState().connectAndSend(`Update my view "${view.title}" (ID: ${view.id}). It has ${view.layout.length} widgets. Use get_view_details("${view.id}") to see the current widgets, then modify as needed.`);
              }}
              className="p-1.5 rounded bg-violet-700 hover:bg-violet-600 text-white transition-colors"
              title="Edit with AI"
            >
              <Bot className="w-4 h-4" />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded bg-slate-800 text-slate-400 hover:text-red-400 transition-colors"
              title="Delete view"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Edit mode hint */}
        {editMode && (
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-amber-900/20 border border-amber-800/50 text-xs text-amber-300">
            <GripVertical className="w-4 h-4" />
            Drag widgets to reorder. Resize from bottom-right corner. Click "Done Editing" when finished.
          </div>
        )}

        {/* Widgets */}
        {view.layout.length === 0 ? (
          <EmptyState
            icon={<Plus className="w-8 h-8 text-slate-600" />}
            title="No widgets yet"
            description="Ask the agent to add widgets to this dashboard."
            aiPrompts={[
              { label: 'Add a table of pods with high restart counts', onAsk: () => { useAgentStore.getState().connectAndSend('Add a data_table widget showing pods with the most restarts'); useUIStore.getState().expandAISidebar(); useUIStore.getState().setAISidebarMode('chat'); } },
              { label: 'Show CPU and memory trends', onAsk: () => { useAgentStore.getState().connectAndSend('Add chart widgets showing CPU utilization and memory usage trends'); useUIStore.getState().expandAISidebar(); useUIStore.getState().setAISidebarMode('chat'); } },
              { label: 'Add a deployment status grid', onAsk: () => { useAgentStore.getState().connectAndSend('Add a status_list widget showing all deployments with their health status'); useUIStore.getState().expandAISidebar(); useUIStore.getState().setAISidebarMode('chat'); } },
            ]}
          />
        ) : (
          <ResponsiveGrid
            key={gridKey}
            layouts={{ lg: currentLayout }}
            breakpoints={{ lg: 1024, md: 768, sm: 480 }}
            cols={{ lg: 4, md: 2, sm: 1 }}
            rowHeight={24}
            isDraggable={editMode}
            isResizable={editMode}
            onLayoutChange={handleLayoutChange}
            draggableHandle=".widget-drag-handle"
            margin={[12, 8]}
            useCSSTransforms={true}
            compactType="vertical"
          >
            {view.layout.map((spec, i) => (
              <div key={String(i)} className={`rounded-lg border bg-slate-900/80 p-3 relative group overflow-hidden transition-all duration-200 ${editMode ? 'border-slate-700 border-dashed' : 'border-slate-800 hover:border-slate-600 hover:shadow-[0_0_15px_rgba(37,99,235,0.06)]'}`} style={{ animationDelay: `${i * 50}ms` }}>
                {editMode && (
                  <>
                    <div className="widget-drag-handle absolute inset-x-0 top-0 h-6 cursor-grab active:cursor-grabbing flex items-center px-2 bg-slate-800/30 rounded-t-lg z-10">
                      <GripVertical className="w-3 h-3 text-slate-600" />
                    </div>
                    <div className="absolute top-1.5 right-2 flex items-center gap-1 z-10">
                      {spec.kind === 'chart' && (
                        <button
                          onClick={() => setEditingChart(editingChart === i ? null : i)}
                          className="p-1 rounded bg-slate-800 text-slate-500 hover:text-blue-400 transition-colors"
                          title="Edit chart"
                        >
                          <Settings2 className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={() => setWidgetToRemove(i)}
                        className="p-1 rounded bg-slate-800 text-slate-500 hover:text-red-400 transition-colors"
                        title="Remove widget"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                )}
                {/* Widget removal only in edit mode — prevents accidental deletes during incidents */}
                <div className={editMode ? 'pt-6' : ''}>
                  {/* Editable widget title and description in edit mode (skip for self-titled components) */}
                  {editMode && spec.kind !== 'stat_card' && spec.kind !== 'metric_card' && (
                    <>
                      {(spec as any).title && (
                        <input
                          defaultValue={(spec as any).title}
                          onBlur={(e) => {
                            if (e.target.value !== (spec as any).title) {
                              updateWidget(view.id, i, { title: e.target.value } as any);
                            }
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-full text-xs font-medium text-slate-300 bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none mb-1 px-1 py-0.5"
                        />
                      )}
                      {((spec as any).description || (spec as any).title) && (
                        <input
                          defaultValue={(spec as any).description || ''}
                          placeholder="Add description..."
                          onBlur={(e) => {
                            if (e.target.value !== ((spec as any).description || '')) {
                              updateWidget(view.id, i, { description: e.target.value } as any);
                            }
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-full text-[10px] text-slate-500 bg-transparent border-b border-slate-700/50 focus:border-violet-500 outline-none mb-1 px-1 py-0.5"
                        />
                      )}
                    </>
                  )}
                  <ErrorBoundary>
                    <AgentComponentRenderer
                      spec={spec}
                      viewId={viewId}
                      refreshInterval={refreshInterval || undefined}
                      globalTimeRange={globalTimeRange}
                      hoverTimestamp={hoverTimestamp}
                      onHoverTimestamp={setHoverTimestamp}
                      onSpecChange={(newSpec) => {
                        if (!view) return;
                        const newLayout = [...view.layout];
                        newLayout[i] = newSpec;
                        updateView(view.id, { layout: newLayout });
                      }}
                    />
                  </ErrorBoundary>
                  {/* Chart edit popover */}
                  {editingChart === i && spec.kind === 'chart' && (
                    <ChartEditPopover
                      spec={spec as any}
                      viewId={view.id}
                      widgetIndex={i}
                      onClose={() => setEditingChart(null)}
                    />
                  )}
                </div>
              </div>
            ))}
          </ResponsiveGrid>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteView(view.id);
          setConfirmDelete(false);
          window.history.back();
        }}
        title="Delete Dashboard"
        description={`Delete "${view.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />

      <ConfirmDialog
        open={widgetToRemove !== null}
        onClose={() => setWidgetToRemove(null)}
        onConfirm={() => {
          if (widgetToRemove !== null) {
            removeWidget(view.id, widgetToRemove);
            setWidgetToRemove(null);
          }
        }}
        title="Remove Widget"
        description="Remove this widget from the dashboard?"
        confirmLabel="Remove"
        variant="warning"
      />
    </div>
  );
}
