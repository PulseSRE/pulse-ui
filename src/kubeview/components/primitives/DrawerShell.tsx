import { useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModalFocus } from './Dialog';

interface DrawerShellProps {
  /** Heading text; also the dialog's accessible name. */
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Shown before the title. */
  icon?: React.ReactNode;
  /** A line under the title. */
  subtitle?: React.ReactNode;
  /** Buttons placed before the close button. */
  actions?: React.ReactNode;
  /** Extra content inside the sticky header, under the title row (stats, tabs). */
  subheader?: React.ReactNode;
  /** Width class for the panel. Default `max-w-2xl`. */
  width?: string;
  /** Classes for the body. Default `p-5`. */
  bodyClassName?: string;
}

/**
 * A right-hand drawer: role="dialog", aria-modal, focus moved inside and
 * trapped, Escape and backdrop close, focus returned on close.
 */
export function DrawerShell({
  title,
  onClose,
  children,
  icon,
  subtitle,
  actions,
  subheader,
  width = 'max-w-2xl',
  bodyClassName = 'p-5',
}: DrawerShellProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useModalFocus(true, panelRef, { onEscape: onClose, initialFocusRef: closeRef });

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        ref={panelRef}
        className={cn('relative w-full bg-slate-950 border-l border-slate-800 h-full overflow-auto shadow-2xl', width)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {icon}
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-100 truncate">{title}</h2>
                {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {actions}
              <button ref={closeRef} onClick={onClose} aria-label="Close" className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          {subheader && <div className="mt-3">{subheader}</div>}
        </div>
        <div className={bodyClassName}>{children}</div>
      </div>
    </div>
  );
}
