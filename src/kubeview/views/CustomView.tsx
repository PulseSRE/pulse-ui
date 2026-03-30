import { useParams } from 'react-router-dom';
import { Trash2, Plus, LayoutDashboard, Bot } from 'lucide-react';
import { useCustomViewStore } from '../store/customViewStore';
import { useUIStore } from '../store/uiStore';
import { useAgentStore } from '../store/agentStore';
import { AgentComponentRenderer } from '../components/agent/AgentComponentRenderer';
import { EmptyState } from '../components/primitives/EmptyState';
import { formatRelativeTime } from '../engine/formatters';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { useState } from 'react';

export default function CustomView() {
  const { viewId } = useParams<{ viewId: string }>();
  const view = useCustomViewStore((s) => s.getView(viewId || ''));
  const deleteView = useCustomViewStore((s) => s.deleteView);
  const removeWidget = useCustomViewStore((s) => s.removeWidget);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [widgetToRemove, setWidgetToRemove] = useState<number | null>(null);

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

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <LayoutDashboard className="w-6 h-6 text-violet-500" />
              {view.title}
            </h1>
            {view.description && (
              <p className="text-sm text-slate-400 mt-1">{view.description}</p>
            )}
            <p className="text-xs text-slate-600 mt-1">
              Created {formatRelativeTime(view.generatedAt)} · {view.layout.length} widget{view.layout.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                useUIStore.getState().openDock('agent');
                useAgentStore.getState().connectAndSend(`Update my "${view.title}" dashboard — add or modify widgets`);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-700 hover:bg-violet-600 text-white rounded transition-colors"
            >
              <Bot className="w-3.5 h-3.5" />
              Edit with AI
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-red-900/50 text-slate-400 hover:text-red-400 rounded transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </div>

        {/* Widgets */}
        {view.layout.length === 0 ? (
          <EmptyState
            icon={<Plus className="w-8 h-8 text-slate-600" />}
            title="No widgets yet"
            description="Ask the agent to add widgets to this dashboard."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {view.layout.map((spec, i) => (
              <div key={i} className="rounded-lg border border-slate-800 bg-slate-900 p-4 relative group">
                <button
                  onClick={() => setWidgetToRemove(i)}
                  className="absolute top-2 right-2 p-1 rounded bg-slate-800 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove widget"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                <AgentComponentRenderer spec={spec} />
              </div>
            ))}
          </div>
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
