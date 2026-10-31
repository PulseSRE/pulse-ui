import { useRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog } from '../primitives/Dialog';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Label for the dismiss button. Default "Cancel". */
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
  /** Keep the confirm button disabled, e.g. until a required checkbox is ticked. */
  confirmDisabled?: boolean;
  children?: React.ReactNode;
}

/**
 * A yes/no confirmation built on the Dialog primitive. Danger dialogs focus
 * Cancel so Enter cannot delete by accident; while `loading`, it cannot be
 * dismissed.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  confirmDisabled = false,
  children,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      dismissible={!loading}
      showClose={false}
      initialFocusRef={variant === 'danger' ? cancelButtonRef : confirmButtonRef}
      icon={
        <div className={cn('shrink-0 rounded-full p-2', variant === 'danger' ? 'bg-red-500/10' : 'bg-amber-500/10')}>
          <AlertTriangle className={cn('h-6 w-6', variant === 'danger' ? 'text-red-500' : 'text-amber-500')} />
        </div>
      }
      footer={
        <>
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              variant === 'danger' ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600',
            )}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
