import React from 'react';
import { cn } from '@/lib/utils';
import { Dialog } from '../primitives/Dialog';

interface WaiverDialogProps {
  gateTitle: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/** Modal dialog for capturing a waiver reason when marking a gate as accepted-risk. */
export function WaiverDialog({ gateTitle, open, onClose, onConfirm }: WaiverDialogProps) {
  const [reason, setReason] = React.useState('');

  const reasonRef = React.useRef<HTMLTextAreaElement>(null);

  // Reset on open
  React.useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim()) onConfirm(reason.trim());
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Waive Gate"
      initialFocusRef={reasonRef}
      className="bg-slate-900 rounded-xl shadow-2xl"
      bodyClassName="pb-6"
      description={
        <>
          You are waiving <span className="text-slate-200 font-medium">{gateTitle}</span>.
          Please provide a reason for accepting this risk.
        </>
      }
    >
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
            ref={reasonRef}
            aria-label="Waiver reason"
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
    </Dialog>
  );
}
