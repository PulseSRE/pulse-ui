import { Outlet } from 'react-router-dom';
import { CommandBar } from './CommandBar';
import { TabBar } from './TabBar';
import { Sidebar } from './Sidebar';
import { Dock } from './Dock';
import { StatusBar } from './StatusBar';
import { CommandPalette } from './CommandPalette';
import { ResourceBrowser } from './ResourceBrowser';
import { ActionPanel } from './ActionPanel';
import { ToastContainer } from './feedback/Toast';
import { ErrorBoundary, CssHealthCheck } from './ErrorBoundary';
import { useKeyboardShortcuts, useDiscovery } from '../hooks';
import { useUIStore } from '../store/uiStore';
import { registerBuiltinEnhancers } from '../engine/enhancers/register';

// Register enhancers once at module load
registerBuiltinEnhancers();

export function Shell() {
  // Initialize keyboard shortcuts
  useKeyboardShortcuts();

  // Trigger API discovery on mount
  useDiscovery();

  // Get overlay state
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const browserOpen = useUIStore((s) => s.browserOpen);
  const actionPanelOpen = useUIStore((s) => s.actionPanelOpen);
  const dockPanel = useUIStore((s) => s.dockPanel);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      {/* Command bar at top */}
      <CommandBar />

      {/* Tab bar */}
      <TabBar />

      {/* Main content area with sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar navigation */}
        {sidebarOpen && <Sidebar />}

        {/* Content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex-1 overflow-auto">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>

          {/* Dock (collapsible bottom panel) */}
          {dockPanel && <Dock />}
        </div>
      </div>

      {/* Status bar at bottom */}
      <StatusBar />

      {/* Overlay components */}
      {commandPaletteOpen && <CommandPalette />}
      {browserOpen && <ResourceBrowser />}
      {actionPanelOpen && <ActionPanel />}
      <ToastContainer />
      <CssHealthCheck />
    </div>
  );
}
