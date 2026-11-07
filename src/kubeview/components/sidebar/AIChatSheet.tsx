import { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useModalFocus } from '../primitives/Dialog';

interface AIChatSheetProps {
  onClose: () => void;
  /** Buttons before the close button (e.g. back to the dashboard). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Pulse AI on a phone: a bottom sheet instead of the right-hand sidebar.
 * role="dialog" and aria-modal, focus moved inside and trapped, Escape, the
 * backdrop and a visible Close button dismiss it, focus returns to whatever
 * opened it, and the bottom keeps clear of the home indicator.
 */
export function AIChatSheet({ onClose, actions, children }: AIChatSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useModalFocus(true, panelRef, { onEscape: onClose, initialFocusRef: closeRef });

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" data-testid="ai-sheet-backdrop" onMouseDown={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-[85dvh] max-h-[calc(100dvh-2rem)] flex-col rounded-t-2xl border-t border-slate-700 bg-slate-900 pb-[env(safe-area-inset-bottom)] shadow-2xl focus:outline-hidden"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-700" aria-hidden="true" />
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 shrink-0">
          <h2 id={titleId} className="text-sm font-semibold text-slate-200">Pulse AI</h2>
          <div className="flex items-center gap-1">
            {actions}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
