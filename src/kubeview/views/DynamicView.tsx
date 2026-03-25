import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Trash2, Pin } from 'lucide-react';
import { useDynamicViewStore } from '../store/dynamicViewStore';
import { useUIStore } from '../store/uiStore';
import { AgentComponentRenderer } from '../components/agent/AgentComponentRenderer';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';

interface DynamicViewProps {
  viewId?: string;
}

export function DynamicView({ viewId: viewIdProp }: DynamicViewProps) {
  const params = useParams<{ viewId: string }>();
  const navigate = useNavigate();
  const viewId = viewIdProp ?? params.viewId;
  const viewSpec = useDynamicViewStore((s) => s.getView(viewId ?? ''));
  const deleteView = useDynamicViewStore((s) => s.deleteView);
  const addTab = useUIStore((s) => s.addTab);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!viewSpec) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <LayoutDashboard className="h-10 w-10 text-slate-600" />
        <p className="text-sm text-slate-400">View not found</p>
        <button
          onClick={() => navigate(-1)}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          Go back
        </button>
      </div>
    );
  }

  const handlePin = () => {
    addTab({
      title: viewSpec.title,
      path: `/dynamic/${viewSpec.id}`,
      pinned: true,
      closable: true,
    });
  };

  const handleDelete = () => {
    deleteView(viewSpec.id);
    navigate(-1);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start gap-3">
        <LayoutDashboard className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-slate-100">{viewSpec.title}</h1>
          {viewSpec.description && (
            <p className="text-sm text-slate-400 mt-0.5">{viewSpec.description}</p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            Generated {new Date(viewSpec.generatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handlePin}
            className="flex items-center gap-1 px-2 py-1 text-xs text-slate-300 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 transition-colors"
          >
            <Pin className="h-3 w-3" />
            Pin to Tabs
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 bg-slate-800 border border-slate-700 rounded hover:bg-red-900/30 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {viewSpec.layout.map((component, i) => (
          <AgentComponentRenderer key={i} spec={component} />
        ))}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete generated view"
        description={`Delete "${viewSpec.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
