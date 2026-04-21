import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { createInboxTask } from '../../engine/inboxApi';
import { useInboxStore } from '../../store/inboxStore';
import { useUIStore } from '../../store/uiStore';

export function NewTaskDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [namespace, setNamespace] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const refresh = useInboxStore((s) => s.refresh);
  const addToast = useUIStore((s) => s.addToast);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      await createInboxTask({
        title: title.trim(),
        summary: description.trim() || undefined,
        namespace: namespace.trim() || undefined,
      });
      addToast({ type: 'success', title: 'Task created' });
      refresh();
      setTitle('');
      setDescription('');
      setNamespace('');
      onClose();
    } catch {
      addToast({ type: 'error', title: 'Failed to create task' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-200">New Task</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="task-title" className="block text-sm text-slate-400 mb-1">Title *</label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Rotate TLS certs for ingress"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="task-desc" className="block text-sm text-slate-400 mb-1">Description</label>
            <textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details..."
              rows={3}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <div>
            <label htmlFor="task-ns" className="block text-sm text-slate-400 mb-1">Namespace</label>
            <Input
              id="task-ns"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="production"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
            <Button type="submit" disabled={!title.trim() || submitting}>
              {submitting ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
