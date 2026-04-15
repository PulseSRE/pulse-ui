import { useState } from 'react';
import { useVisibilityAwareInterval } from '../hooks/useVisibilityAwareInterval';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Bot, Bell, GitPullRequest } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { DEGRADED_MESSAGES } from '../engine/degradedMode';
import { useUIStore } from '../store/uiStore';
import { useFleetStore } from '../store/fleetStore';
import { useMonitorStore } from '../store/monitorStore';
import { isMultiCluster } from '../engine/clusterConnection';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '../engine/formatters';
import { getNavByPath } from '../engine/navRegistry';


export function StatusBar() {
  const {
    connectionStatus, lastSyncTime, selectedNamespace, activeOperation,
    tabs, dockPanel, openDock, closeDock, degradedReasons,
  } = useUIStore(useShallow((s) => ({
    connectionStatus: s.connectionStatus,
    lastSyncTime: s.lastSyncTime,
    selectedNamespace: s.selectedNamespace,
    activeOperation: s.activeOperation,
    tabs: s.tabs,
    dockPanel: s.dockPanel,
    openDock: s.openDock,
    closeDock: s.closeDock,
    degradedReasons: s.degradedReasons,
  })));
  const location = useLocation();
  const activeCluster = useFleetStore((s) => s.clusters.find(c => c.id === s.activeClusterId));

  const navigate = useNavigate();
  const { findingsCount, pendingReviewCount } = useMonitorStore(useShallow((s) => ({
    findingsCount: s.findings.length,
    pendingReviewCount: s.pendingActions.length,
  })));

  const [relativeTime, setRelativeTime] = useState(formatRelativeTime(lastSyncTime));

  useVisibilityAwareInterval(() => setRelativeTime(formatRelativeTime(lastSyncTime)), 1000);

  // Derive current page info from URL
  const pageInfo = (() => {
    const path = location.pathname;
    if (path === '/welcome') return 'Welcome';
    const nav = getNavByPath(path);
    if (nav) return nav.label;
    if (path.startsWith('/r/')) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 2) {
        const gvr = parts[1].split('~');
        return gvr[gvr.length - 1];
      }
      if (parts.length >= 4) return `${parts[parts.length - 1]}`;
    }
    if (path.startsWith('/create/')) return 'Software';
    if (path.startsWith('/yaml/')) return 'YAML Editor';
    if (path.startsWith('/logs/')) return 'Logs';
    if (path.startsWith('/metrics/')) return 'Metrics';
    if (path.startsWith('/deps/')) return 'Dependencies';
    return '';
  })();

  const openTabCount = tabs.filter((t) => t.closable).length;

  return (
    <div className="flex h-6 items-center justify-between border-t border-slate-700 bg-slate-800 px-4 text-xs text-slate-500">
      {/* Left */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className={cn('h-1.5 w-1.5 rounded-full', connectionStatus === 'connected' ? 'bg-emerald-500' : connectionStatus === 'reconnecting' ? 'bg-yellow-500' : 'bg-red-500')} />
          <span>{connectionStatus === 'connected' ? 'Connected' : connectionStatus}</span>
        </div>
        <span>synced {relativeTime} ago</span>
        {activeOperation && <span className="text-emerald-400">{activeOperation}</span>}
        {isMultiCluster() && activeCluster && <span className="text-blue-400">· {activeCluster.name}</span>}
        {pageInfo && <span className="text-slate-400">· {pageInfo}</span>}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        {findingsCount > 0 && (
          <button
            onClick={() => navigate('/incidents')}
            className="flex items-center gap-1 text-red-400 px-1.5 py-0.5 rounded hover:bg-red-500/10 transition-colors"
            title={`${findingsCount} active finding${findingsCount !== 1 ? 's' : ''}`}
          >
            <Bell className="h-3 w-3" />
            <span>{findingsCount}</span>
          </button>
        )}
        {pendingReviewCount > 0 && (
          <button
            onClick={() => navigate('/incidents?tab=actions')}
            className="flex items-center gap-1 text-amber-400 px-1.5 py-0.5 rounded hover:bg-amber-500/10 transition-colors"
            title={`${pendingReviewCount} pending review${pendingReviewCount !== 1 ? 's' : ''}`}
          >
            <GitPullRequest className="h-3 w-3" />
            <span>{pendingReviewCount}</span>
          </button>
        )}
        {degradedReasons.size > 0 && (
          <span
            className="flex items-center gap-1 text-amber-400 px-1.5 py-0.5"
            title={Array.from(degradedReasons).map((r) => DEGRADED_MESSAGES[r].title).join(', ')}
          >
            <AlertTriangle className="h-3 w-3" />
            <span className="text-xs">Degraded</span>
          </span>
        )}
        <button
          onClick={() => dockPanel === 'agent' ? closeDock() : openDock('agent')}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
            dockPanel === 'agent' ? 'bg-blue-600/30 text-blue-400' : 'text-slate-500 hover:text-slate-300'
          )}
          title="Toggle Agent (Cmd+Shift+A)"
        >
          <Bot className="h-3 w-3" />
          Agent
        </button>
        {openTabCount > 0 && <span>{openTabCount} tab{openTabCount !== 1 ? 's' : ''}</span>}
        <span>{selectedNamespace === '*' ? 'all namespaces' : selectedNamespace}</span>
        <span>⌘K search · ⌘B browse</span>
      </div>
    </div>
  );
}
