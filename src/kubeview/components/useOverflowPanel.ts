import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useIsPhone } from '../hooks/useIsPhone';

/**
 * The command bar's "More" panel below `sm`. The controls stay where they are
 * in the DOM; at phone width their container becomes a dropdown that this
 * hook opens and closes (a disclosure: the trigger has aria-expanded and
 * aria-controls, the panel is a labelled group).
 *
 * Keyboard: Enter/Space or ArrowDown on the trigger opens it and focuses the
 * first control; ArrowUp/ArrowDown/Home/End move between the panel's own
 * controls; Escape closes it and returns focus to the trigger. Keys pressed
 * inside a control's own dropdown (the namespace filter, the user menu) are
 * left to that dropdown.
 *
 * It closes on navigation, on a click outside, and when focus leaves it.
 */

/** The panel's own controls: its direct buttons and the trigger of each wrapped control. Not the controls inside their dropdowns. */
const TOP_LEVEL = ':scope > button, :scope > a[href], :scope > div > button, :scope > div > a[href]';

function topLevelItems(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(TOP_LEVEL)).filter((el) => {
    if ((el as HTMLButtonElement).disabled) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

export function useOverflowPanel() {
  const location = useLocation();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Open "at" a path: navigating anywhere closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  // Only a phone has the panel: widening the window to `sm` closes it.
  const isPhone = useIsPhone();
  const open = isPhone && openAt !== null && openAt === location.pathname;
  const focusFirst = useRef(false);

  const close = useCallback((restoreFocus = false) => {
    setOpenAt(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openPanel = useCallback(() => {
    focusFirst.current = true;
    setOpenAt(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    if (!open || !focusFirst.current || !panelRef.current) return;
    focusFirst.current = false;
    topLevelItems(panelRef.current)[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, close]);

  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!open || !panelRef.current) return;
    const items = topLevelItems(panelRef.current);
    const at = items.indexOf(e.target as HTMLElement);
    if (at < 0) return; // inside a control's own dropdown
    let next: HTMLElement | undefined;
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close(true);
        return;
      case 'ArrowDown': next = items[(at + 1) % items.length]; break;
      case 'ArrowUp': next = items[(at - 1 + items.length) % items.length]; break;
      case 'Home': next = items[0]; break;
      case 'End': next = items[items.length - 1]; break;
      default: return;
    }
    e.preventDefault();
    next?.focus();
  };

  const onPanelBlur = (e: React.FocusEvent<HTMLElement>) => {
    if (!open) return;
    const to = e.relatedTarget as Node | null;
    // null: a click on something that takes no focus; the mousedown handler decides.
    if (!to || panelRef.current?.contains(to) || triggerRef.current?.contains(to)) return;
    close();
  };

  const triggerProps = {
    ref: triggerRef,
    type: 'button' as const,
    'aria-expanded': open,
    'aria-controls': panelId,
    onClick: () => (open ? close() : openPanel()),
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowDown' && !open) { e.preventDefault(); openPanel(); }
      else if (e.key === 'Escape' && open) { e.preventDefault(); close(true); }
    },
  };

  const panelProps = {
    ref: panelRef,
    id: panelId,
    onKeyDown: onPanelKeyDown,
    onBlur: onPanelBlur,
  };

  return { open, close, triggerProps, panelProps };
}
