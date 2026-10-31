import { useRef, useState } from 'react';
import { Dialog } from '../../components/primitives/Dialog';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { useInboxStore } from '../../store/inboxStore';

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
  const createTask = useInboxStore((s) => s.createTask);
  const titleRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      const ok = await createTask({
        title: title.trim(),
        summary: description.trim() || undefined,
        namespace: namespace.trim() || undefined,
      });
      if (ok) {
        setTitle('');
        setDescription('');
        setNamespace('');
      onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New Task"
      initialFocusRef={titleRef}
      dismissible={!submitting}
      className="bg-slate-900 rounded-xl shadow-2xl"
      bodyClassName="pb-6"
    >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="task-title" className="block text-sm text-slate-400 mb-1">Title *</label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Rotate TLS certs for ingress"
              ref={titleRef}
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
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-hidden focus:ring-1 focus:ring-violet-500"
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
    </Dialog>
  );
}
