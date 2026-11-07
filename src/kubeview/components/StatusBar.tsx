import { useState } from 'react';
import { useVisibilityAwareInterval } from '../hooks/useVisibilityAwareInterval';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Bot, GitPullRequest } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { DEGRADED_MESSAGES } from '../engine/degradedMode';
import { useUIStore } from '../store/uiStore';
import { useFleetStore } from '../store/fleetStore';
import { useMonitorStore } from '../store/monitorStore';
import { isMultiCluster } from '../engine/clusterConnection';
import { cn } from '@/lib/utils';
import { formatRelative } from '../engine/format';
import { getNavByPath } from '../engine/navRegistry';
import { performLogout } from '../engine/auth';


export function StatusBar() {
  const {
    connectionStatus, lastSyncTime, selectedNamespace, activeOperation,
    tabs, aiSidebarExpanded, toggleAISidebar, degradedReasons,
  } = useUIStore(useShallow((s) => ({
    connectionStatus: s.connectionStatus,
    lastSyncTime: s.lastSyncTime,
    // On a page that shows every namespace the scope does not apply.
    selectedNamespace: s.namespaceScopeOptOuts > 0 ? '*' : s.selectedNamespace,
    activeOperation: s.activeOperation,
    tabs: s.tabs,
    aiSidebarExpanded: s.aiSidebarExpanded,
    toggleAISidebar: s.toggleAISidebar,
    degradedReasons: s.degradedReasons,
  })));
  const location = useLocation();
  const activeCluster = useFleetStore((s) => s.clusters.find(c => c.id === s.activeClusterId));

  const navigate = useNavigate();
  const pendingReviewCount = useMonitorStore((s) => s.pendingActions.length);

  const [relativeTime, setRelativeTime] = useState(formatRelative(lastSyncTime));
  const [isStale, setIsStale] = useState(false);

  useVisibilityAwareInterval(() => {
    setRelativeTime(formatRelative(lastSyncTime));
    setIsStale(Date.now() - lastSyncTime > 5 * 60 * 1000);
  }, 1000);

  // Derive current page info from URL
  const pageInfo = (() => {
    const path = location.pathname;
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
    if (path.startsWith('/create/')) return 'Create';
    if (path.startsWith('/yaml/')) return 'YAML Editor';
    if (path.startsWith('/logs/')) return 'Logs';
    if (path.startsWith('/metrics/')) return 'Metrics';
    return '';
  })();

  const openTabCount = tabs.filter((t) => t.closable).length;

  return (
    // One line at any width: the left side truncates and the right side drops
    // keyboard hints, tab count, namespace and version below `sm`.
    <div className="flex h-6 items-center justify-between gap-3 overflow-hidden whitespace-nowrap border-t border-slate-700 bg-slate-800 px-4 max-sm:px-2 text-xs text-slate-500">
      {/* Left */}
      <div className="flex min-w-0 items-center gap-3 overflow-hidden">
        <div className="flex shrink-0 items-center gap-1.5">
          <div className={cn('h-1.5 w-1.5 rounded-full', connectionStatus === 'connected' ? 'bg-emerald-500' : connectionStatus === 'reconnecting' ? 'bg-yellow-500' : 'bg-red-500')} />
          <span>{connectionStatus === 'connected' ? 'Connected' : connectionStatus}</span>
        </div>
        <span
          className={cn('truncate', isStale && 'text-amber-400')}
          title={isStale ? 'Data may be stale — session may be expired or connectivity lost' : undefined}
        >
          {/* formatRelative already ends in "ago" — appending another
              produced "synced 26s ago ago" in the status bar of every page. */}
          synced {relativeTime}
          {isStale && !degradedReasons.has('session_expired') && (
            <span className="ml-1 text-amber-400">· may be stale</span>
          )}
        </span>
        {degradedReasons.has('session_expired') && (
          <button
            onClick={() => performLogout()}
            className="ml-2 shrink-0 px-2 py-0.5 text-xs rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
          >
            Session expired — click to log in again
          </button>
        )}
        {activeOperation && <span className="truncate text-emerald-400" title={activeOperation}>{activeOperation}</span>}
        {isMultiCluster() && activeCluster && <span className="truncate text-blue-400">· {activeCluster.name}</span>}
        {pageInfo && <span className="truncate text-slate-400" title={pageInfo}>· {pageInfo}</span>}
      </div>

      {/* Right */}
      <div className="flex shrink-0 items-center gap-3 max-sm:gap-2">
        {/* The inbox count lives in one place: the CommandBar bell. */}
        {pendingReviewCount > 0 && (
          <button
            onClick={() => navigate('/inbox?preset=needs_attention')}
            className="flex items-center gap-1 text-amber-400 px-1.5 py-0.5 rounded-sm hover:bg-amber-500/10 transition-colors"
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
            <span className="text-xs max-sm:sr-only">Degraded</span>
          </span>
        )}
        <button
          onClick={toggleAISidebar}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded-sm transition-colors',
            aiSidebarExpanded ? 'bg-blue-600/30 text-blue-400' : 'text-slate-500 hover:text-slate-300'
          )}
          title="Toggle Agent (Cmd+Shift+A)"
        >
          <Bot className="h-3 w-3" />
          Agent
        </button>
        {openTabCount > 0 && <span className="max-sm:hidden">{openTabCount} tab{openTabCount !== 1 ? 's' : ''}</span>}
        <span className="max-sm:hidden">{selectedNamespace === '*' ? 'all namespaces' : selectedNamespace}</span>
        <span className="max-sm:hidden">⌘K search · ⌘B browse</span>
        <button
          onClick={() => navigate('/about')}
          className="max-sm:hidden px-1.5 py-0.5 rounded-sm text-slate-500 hover:text-slate-300 transition-colors"
          title="About OpenShift Pulse — versions, images, links"
        >
          v{__APP_VERSION__}
        </button>
      </div>
    </div>
  );
}
