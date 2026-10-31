import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Everything a keyboard user can reach, not only buttons: a dialog whose
 * confirm is disabled until a checkbox is ticked must let Tab reach the box.
 */
const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  'area[href]',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Hidden elements (hidden attribute, display:none, visibility:hidden, inert) cannot take focus. */
function isReachable(el: HTMLElement, root: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node && node !== root.parentElement; node = node.parentElement) {
    if (node.hidden || node.hasAttribute('inert')) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

/** The elements inside `root` that Tab can land on, in document order. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => isReachable(el, root));
}

/**
 * Modal focus behaviour shared by Dialog and DrawerShell: focus moves inside
 * on open (to `initialFocusRef`, else the first focusable element), Tab and
 * Shift+Tab cycle within the container, Escape calls `onEscape`, and focus
 * returns to whatever had it before when the modal closes.
 */
/**
 * Open modals, innermost last. Only the top one answers Escape and traps Tab,
 * so Escape in a confirm dialog opened from a drawer closes the dialog, not
 * both.
 */
interface ModalEntry { id: symbol; container: () => HTMLElement | null }
const modalStack: ModalEntry[] = [];

/**
 * The modal that owns the keyboard: the most recently opened one that has no
 * other open modal inside it. (A confirm rendered inside a drawer mounts in the
 * same commit as the drawer and its effect runs first, so push order alone
 * would wrongly pick the drawer.)
 */
function topModal(): symbol | undefined {
  for (let i = modalStack.length - 1; i >= 0; i--) {
    const el = modalStack[i].container();
    const hasInner = modalStack.some((other, j) => j !== i && el && other.container() && el !== other.container() && el.contains(other.container()));
    if (!hasInner) return modalStack[i].id;
  }
  return undefined;
}

export function useModalFocus(
  active: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
  { onEscape, initialFocusRef }: { onEscape?: () => void; initialFocusRef?: React.RefObject<HTMLElement | null> } = {},
) {
  // Keep the latest callback without re-running the effect (which would steal
  // focus back to the initial element on every parent render).
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const id = Symbol('modal');
    modalStack.push({ id, container: () => containerRef.current });
    const previous = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const initial = initialFocusRef?.current ?? (container ? focusableWithin(container)[0] : undefined) ?? container;
    // A modal opened inside this one in the same commit has already taken focus.
    if (!container?.contains(document.activeElement)) initial?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (topModal() !== id) return;
      if (e.key === 'Escape') {
        if (escapeRef.current) {
          e.stopPropagation();
          escapeRef.current();
        }
        return;
      }
      if (e.key !== 'Tab' || !containerRef.current) return;
      const focusable = focusableWithin(containerRef.current);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = containerRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const at = modalStack.findIndex((m) => m.id === id);
      if (at >= 0) modalStack.splice(at, 1);
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; run once per open
  }, [active]);
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Shown under the title and wired to aria-describedby. */
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Action row, right-aligned under the body. */
  footer?: React.ReactNode;
  /** Element to focus on open. Defaults to the first focusable element. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** While false, Escape, the backdrop and the close button do nothing (e.g. a request is in flight). */
  dismissible?: boolean;
  /** Show the X in the header. Default true. */
  showClose?: boolean;
  /** Something to put before the title, such as a status icon. */
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
  /** Classes for the panel. */
  className?: string;
  /** Classes for the body wrapper. */
  bodyClassName?: string;
  /** Classes for the backdrop, e.g. a higher z-index for a dialog opened over a drawer. */
  overlayClassName?: string;
}

const SIZES: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
};

/**
 * A centred modal: role="dialog", aria-modal, labelled by its title, focus
 * trapped inside and restored on close, Escape and backdrop dismiss.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  dismissible = true,
  showClose = true,
  icon,
  size = 'md',
  className,
  bodyClassName,
  overlayClassName,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useModalFocus(open, panelRef, { onEscape: dismissible ? onClose : undefined, initialFocusRef });

  if (!open) return null;

  return (
    <div
      className={cn('fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4', overlayClassName)}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'w-full max-h-[90vh] flex flex-col rounded-lg bg-slate-800 border border-slate-700 shadow-xl focus:outline-hidden',
          SIZES[size],
          className,
        )}
      >
        <div className="flex items-start gap-3 px-6 pt-5 pb-3">
          {icon}
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-slate-100">{title}</h2>
            {description && <div id={descId} className="mt-1 text-sm text-slate-300">{description}</div>}
          </div>
          {showClose && (
            <button
              type="button"
              onClick={onClose}
              disabled={!dismissible}
              aria-label="Close"
              className="rounded-sm p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {children !== undefined && children !== null && (
          <div className={cn('flex-1 overflow-auto px-6 pb-4', bodyClassName)}>{children}</div>
        )}
        {footer && <div className="flex justify-end gap-3 px-6 pb-5 pt-1">{footer}</div>}
      </div>
    </div>
  );
}
