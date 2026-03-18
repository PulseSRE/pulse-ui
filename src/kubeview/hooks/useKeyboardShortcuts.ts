import { useEffect } from 'react';
import { useUIStore } from '../store/uiStore';

/**
 * Global keyboard shortcut handler for OpenShiftView.
 *
 * Shortcuts:
 * - Cmd+K / Ctrl+K: Open command palette
 * - Cmd+B / Ctrl+B: Toggle resource browser
 * - Cmd+. / Ctrl+.: Open action panel
 * - Cmd+J / Ctrl+J: Toggle dock
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

      // Cmd+. - Resource browser (same as Cmd+B)
      if (meta && e.key === '.') {
        e.preventDefault();
        state.toggleBrowser();
        return;
      }

      // Cmd+J - Toggle dock
      if (meta && e.key === 'j') {
        e.preventDefault();
        if (state.dockPanel) {
          state.closeDock();
        }
        // Note: Opening the dock requires specifying which panel, so Cmd+J only closes
        return;
      }

      // Escape - close overlays (priority order: command palette > browser > action panel > dock)
      if (e.key === 'Escape') {
        if (state.commandPaletteOpen) {
          e.preventDefault();
          state.closeCommandPalette();
        } else if (state.browserOpen) {
          e.preventDefault();
          state.closeBrowser();
        } else if (state.dockPanel) {
          e.preventDefault();
          state.closeDock();
        }
        return;
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
