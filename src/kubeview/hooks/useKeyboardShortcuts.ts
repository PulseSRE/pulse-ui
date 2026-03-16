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
  const {
    toggleCommandPalette,
    closeCommandPalette,
    toggleBrowser,
    closeBrowser,
    openActionPanel,
    closeActionPanel,
    closeDock,
    dockPanel,
    commandPaletteOpen,
    browserOpen,
    actionPanelOpen,
  } = useUIStore();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+K - Command palette
      if (meta && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Cmd+B - Resource browser
      if (meta && e.key === 'b') {
        e.preventDefault();
        toggleBrowser();
        return;
      }

      // Cmd+. - Action panel
      if (meta && e.key === '.') {
        e.preventDefault();
        openActionPanel();
        return;
      }

      // Cmd+J - Toggle dock
      if (meta && e.key === 'j') {
        e.preventDefault();
        if (dockPanel) {
          closeDock();
        }
        // Note: Opening the dock requires specifying which panel, so Cmd+J only closes
        return;
      }

      // Escape - close overlays (priority order: command palette > browser > action panel > dock)
      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          e.preventDefault();
          closeCommandPalette();
        } else if (browserOpen) {
          e.preventDefault();
          closeBrowser();
        } else if (actionPanelOpen) {
          e.preventDefault();
          closeActionPanel();
        } else if (dockPanel) {
          e.preventDefault();
          closeDock();
        }
        return;
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    toggleCommandPalette,
    closeCommandPalette,
    toggleBrowser,
    closeBrowser,
    openActionPanel,
    closeActionPanel,
    closeDock,
    dockPanel,
    commandPaletteOpen,
    browserOpen,
    actionPanelOpen,
  ]);
}
