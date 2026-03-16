import { Outlet } from 'react-router-dom';
import { CommandBar } from './CommandBar';
import { TabBar } from './TabBar';
import { Dock } from './Dock';
import { StatusBar } from './StatusBar';
import { CommandPalette } from './CommandPalette';
import { ResourceBrowser } from './ResourceBrowser';
import { ActionPanel } from './ActionPanel';
import { useKeyboardShortcuts, useDiscovery } from '../hooks';
import { useUIStore } from '../store/uiStore';
import { registerBuiltinEnhancers } from '../engine/enhancers/register';
import { cn } from '@/lib/utils';

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

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      {/* Command bar at top */}
      <CommandBar />

      {/* Tab bar */}
      <TabBar />

      {/* Main content area - takes remaining space */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>

        {/* Dock (collapsible bottom panel) */}
        {dockPanel && <Dock />}
      </div>

      {/* Status bar at bottom */}
      <StatusBar />

      {/* Overlay components */}
      {commandPaletteOpen && <CommandPalette />}
      {browserOpen && <ResourceBrowser />}
      {actionPanelOpen && <ActionPanel />}
    </div>
  );
}
