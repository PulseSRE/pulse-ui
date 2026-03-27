import { Outlet } from 'react-router-dom';
import { CommandBar } from './CommandBar';
import { TabBar } from './TabBar';
import { Dock } from './Dock';
import { StatusBar } from './StatusBar';
import { CommandPalette } from './CommandPalette';
import { ResourceBrowser } from './ResourceBrowser';
import { ToastContainer } from './feedback/Toast';
import { ErrorBoundary, CssHealthCheck } from './ErrorBoundary';
import { useKeyboardShortcuts, useDiscovery } from '../hooks';
import { useUIStore } from '../store/uiStore';
import { registerBuiltinEnhancers } from '../engine/enhancers/register';
import { startAgentNotifications, stopAgentNotifications } from '../engine/agentNotifications';
import { useEffect } from 'react';

// Register enhancers once at module load
registerBuiltinEnhancers();

export function Shell() {
  // Initialize keyboard shortcuts
  useKeyboardShortcuts();

  // Trigger API discovery on mount
  useDiscovery();

  // Start background agent notifications
  useEffect(() => {
    startAgentNotifications();
    return () => stopAgentNotifications();
  }, []);

  // Get overlay state
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const browserOpen = useUIStore((s) => s.browserOpen);
  const dockPanel = useUIStore((s) => s.dockPanel);
  const impersonateUser = useUIStore((s) => s.impersonateUser);
  const clearImpersonation = useUIStore((s) => s.clearImpersonation);
  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      {/* Impersonation banner */}
      {impersonateUser && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-amber-900/50 border-b border-amber-700 text-xs">
          <span className="text-amber-200">Impersonating <span className="font-mono font-bold">{impersonateUser}</span> — all API requests use this identity</span>
          <button onClick={clearImpersonation} className="px-2 py-0.5 text-amber-300 hover:text-white bg-amber-800 hover:bg-amber-700 rounded transition-colors">Stop</button>
        </div>
      )}

      {/* Command bar at top */}
      <CommandBar />

      {/* Tab bar */}
      <TabBar />

      {/* Main content area + right dock */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-auto">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>

        {/* Dock (right-side panel) */}
        {dockPanel && <Dock />}
      </div>

      {/* Status bar at bottom */}
      <StatusBar />

      {/* Overlay components */}
      {commandPaletteOpen && <CommandPalette />}
      {browserOpen && <ResourceBrowser />}
      <ToastContainer />
      <CssHealthCheck />
    </div>
  );
}
