import { useEffect } from 'react';
import { useUIStore } from '../store/uiStore';

/**
 * Global keyboard shortcut handler for OpenShift Pulse.
 *
 * Shortcuts:
 * - Cmd+K / Ctrl+K: Open command palette
 * - Cmd+B / Ctrl+B: Toggle resource browser
 * - Cmd+. / Ctrl+.: Open action panel
 * - Cmd+J / Ctrl+J: Toggle dock (may be intercepted by Chrome for Downloads)
 * - Cmd+Shift+A / Ctrl+Shift+A: Toggle agent dock panel
 * - Escape: Close open overlays (command palette, browser, action panel, dock)
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      // Read current state at event time — no reactive subscription needed
      const state = useUIStore.getState();

      // Cmd+K - Command palette
      if (meta && e.key === 'k') {
        e.preventDefault();
        state.toggleCommandPalette();
        return;
      }

      // Cmd+B - Resource browser
      if (meta && e.key === 'b') {
        e.preventDefault();
        state.toggleBrowser();
        return;
      }

      // Cmd+. - Open command palette (quick actions)
      if (meta && e.key === '.') {
        e.preventDefault();
        state.openCommandPalette();
        return;
      }

      // Cmd+J - Toggle AI sidebar
      if (meta && e.key === 'j') {
        e.preventDefault();
        state.toggleAISidebar();
        return;
      }

      // Cmd+Shift+A - Toggle AI sidebar (reliable, no browser conflict)
      if (meta && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        state.toggleAISidebar();
        return;
      }

      // Escape - close overlays (priority order: command palette > browser > sidebar)
      if (e.key === 'Escape') {
        if (state.commandPaletteOpen) {
          e.preventDefault();
          state.closeCommandPalette();
        } else if (state.browserOpen) {
          e.preventDefault();
          state.closeBrowser();
        } else if (state.aiSidebarExpanded) {
          e.preventDefault();
          state.collapseAISidebar();
        }
        return;
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
