import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WaiverDialogProps {
  gateTitle: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/** Modal dialog for capturing a waiver reason when marking a gate as accepted-risk. */
export function WaiverDialog({ gateTitle, open, onClose, onConfirm }: WaiverDialogProps) {
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Reset on open
  React.useEffect(() => {
    if (open) setReason('');
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim()) onConfirm(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-label="Waive gate">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-slate-900 rounded-xl border border-slate-700 shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-100">Waive Gate</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 rounded-sm" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-slate-400 mb-4">
          You are waiving <span className="text-slate-200 font-medium">{gateTitle}</span>.
          Please provide a reason for accepting this risk.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for waiving this gate..."
            rows={3}
            className={cn(
              'w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200',
              'placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-violet-500 focus:border-transparent',
              'resize-none',
            )}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reason.trim()}
              className={cn(
                'px-4 py-1.5 text-sm rounded-lg font-medium transition-colors',
                reason.trim()
                  ? 'bg-violet-600 hover:bg-violet-500 text-white'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed',
              )}
            >
              Waive
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
