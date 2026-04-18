import { Outlet } from 'react-router-dom';
import { CommandBar } from './CommandBar';
import { TabBar } from './TabBar';
import { BottomDock } from './BottomDock';
import { AISidebar } from './sidebar/AISidebar';
import { StatusBar } from './StatusBar';
import { CommandPalette } from './CommandPalette';
import { ResourceBrowser } from './ResourceBrowser';
import { ToastContainer } from './feedback/Toast';
import { ErrorBoundary, CssHealthCheck } from './ErrorBoundary';
import { SaveViewWatcher } from './agent/SaveViewWatcher';
import { SessionTracker } from './SessionTracker';
import { GuidedTour } from './GuidedTour';

import { useKeyboardShortcuts, useDiscovery } from '../hooks';
import { useCapabilityDetection } from '../hooks/useCapabilityDetection';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '../store/uiStore';
import { useCustomViewStore } from '../store/customViewStore';
import { registerBuiltinEnhancers } from '../engine/enhancers/register';
import { startAgentNotifications, stopAgentNotifications } from '../engine/agentNotifications';
import { useAgentStore } from '../store/agentStore';
import { useEffect } from 'react';

registerBuiltinEnhancers();

export function Shell() {
  useKeyboardShortcuts();
  useDiscovery();
  useCapabilityDetection();

  useEffect(() => {
    startAgentNotifications();
    return () => stopAgentNotifications();
  }, []);

  useEffect(() => {
    useCustomViewStore.getState().loadViews();
  }, []);

  useEffect(() => {
    const state = useAgentStore.getState();
    if (!state.connected) state.connect();
  }, []);

  const { commandPaletteOpen, browserOpen, viewBuilderMode, exitViewBuilder, impersonateUser, clearImpersonation, sessionExpired } =
    useUIStore(useShallow((s) => ({
      commandPaletteOpen: s.commandPaletteOpen,
      browserOpen: s.browserOpen,
      viewBuilderMode: s.viewBuilderMode,
      exitViewBuilder: s.exitViewBuilder,
      impersonateUser: s.impersonateUser,
      clearImpersonation: s.clearImpersonation,
      sessionExpired: s.degradedReasons.has('session_expired'),
    })));

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      {/* Session expired modal */}
      {sessionExpired && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-red-700 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/50 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m11-5a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Session Expired</h2>
                <p className="text-sm text-slate-400">Your OAuth token has expired</p>
              </div>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              API requests are returning 401 Unauthorized. You need to re-authenticate to continue using Pulse. Your dashboards and settings are preserved.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => window.location.href = '/'}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
              >
                Re-authenticate
              </button>
              <button
                onClick={() => useUIStore.getState().removeDegradedReason('session_expired')}
                className="px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Impersonation banner */}
      {impersonateUser && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-amber-900/50 border-b border-amber-700 text-xs">
          <span className="text-amber-200">Impersonating <span className="font-mono font-bold">{impersonateUser}</span> — all API requests use this identity</span>
          <button onClick={clearImpersonation} className="px-2 py-0.5 text-amber-300 hover:text-white bg-amber-800 hover:bg-amber-700 rounded transition-colors">Stop</button>
        </div>
      )}

      <CommandBar />
      <TabBar />

      {viewBuilderMode && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-violet-900/50 border-b border-violet-700 text-xs">
          <span className="text-violet-200">Building View — add widgets from the chat, drag to arrange, resize to fit</span>
          <button onClick={() => { exitViewBuilder(); useCustomViewStore.getState().setActiveBuilderId(null); }} className="px-3 py-1 text-white bg-violet-700 hover:bg-violet-600 rounded font-medium transition-colors">Done</button>
        </div>
      )}

      {/* Main layout: content column + AI sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column: main content + bottom dock */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex-1 overflow-auto">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
          <BottomDock />
        </div>

        {/* AI Sidebar — always present on the right */}
        <AISidebar />
      </div>

      <StatusBar />

      {/* Overlay components */}
      {commandPaletteOpen && <CommandPalette />}
      {browserOpen && <ResourceBrowser />}
      <ToastContainer />
      <SaveViewWatcher />
      <SessionTracker />
      <CssHealthCheck />
      <GuidedTour />
    </div>
  );
}
