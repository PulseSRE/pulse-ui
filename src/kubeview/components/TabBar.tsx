import React from 'react';
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { X, Plus, Pin, PinOff } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore, tabKey } from '../store/uiStore';
import { useCustomViewStore } from '../store/customViewStore';
import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';
import { getResourceIcon } from '../engine/iconRegistry';
import { getRouteIcon, getRouteColor, getNavByPath } from '../engine/navRegistry';
import { pluralToKind } from '../engine/renderers/index';
import { isKnownRoute } from '../engine/routeTable';

// Helper to get icon component from string name
function getIcon(iconName?: string) {
  if (!iconName) return null;
  return getResourceIcon(iconName);
}

export function getTabTitle(url: string): string {
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  const params = new URLSearchParams(end === -1 ? '' : url.slice(end).split('#')[0]);
  const parts = path.split('/').filter(Boolean);

  // /r/v1~nodes → "Nodes"
  // /r/apps~v1~deployments → "Deployments"
  if (parts[0] === 'r' && parts.length >= 2) {
    const gvrParts = parts[1].split('~');
    const resource = gvrParts[gvrParts.length - 1];
    // /r/v1~pods/kube-system/coredns → "coredns (Pod)"
    // /r/apps~v1~deployments/default/nginx → "nginx (Deployment)"
    if (parts.length >= 4) {
      const name = parts[parts.length - 1];
      const kind = pluralToKind(resource);
      return `${name} (${kind})`;
    }
    const title = resource.charAt(0).toUpperCase() + resource.slice(1);
    // A list opened for one namespace is its own tab; say which.
    const ns = params.get('ns') || params.get('namespace');
    return ns && ns !== '*' ? `${title} (${ns})` : title;
  }

  // /yaml/... → "YAML: name"
  if (parts[0] === 'yaml' && parts.length >= 4) {
    return `${parts[parts.length - 1]} (YAML)`;
  }

  // /logs/ns/name → "name (Logs)"
  if (parts[0] === 'logs' && parts.length >= 3) {
    const kind = params.get('kind');
    return `${parts[parts.length - 1]} (${kind ? `${kind} logs` : 'Logs'})`;
  }

  // /metrics/... → "name (Metrics)"
  if (parts[0] === 'metrics' && parts.length >= 4) {
    return `${parts[parts.length - 1]} (Metrics)`;
  }

  // /custom/cv-xxx → look up view title from store
  if (parts[0] === 'custom' && parts.length >= 2) {
    const viewId = parts[1];
    const view = useCustomViewStore.getState().views.find((v) => v.id === viewId);
    if (view) return view.title;
  }

  // /timeline, /dashboard, etc.
  const last = parts[parts.length - 1] || 'Untitled';
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** A tab title for a URL the shell reached without a caller naming it. */
export function titleForUrl(url: string): string {
  const end = url.search(/[?#]/);
  const nav = getNavByPath(end === -1 ? url : url.slice(0, end));
  return nav?.label ?? getTabTitle(url);
}

export function TabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();

  const {
    tabs, activeTabId, setActiveTab, closeTab, reorderTabs,
    pinTab, unpinTab, openCommandPalette, addTab, updateTab,
    _pendingNavigate: pendingNavigate,
  } = useUIStore(useShallow((s) => ({
    tabs: s.tabs,
    activeTabId: s.activeTabId,
    setActiveTab: s.setActiveTab,
    closeTab: s.closeTab,
    reorderTabs: s.reorderTabs,
    pinTab: s.pinTab,
    unpinTab: s.unpinTab,
    openCommandPalette: s.openCommandPalette,
    addTab: s.addTab,
    updateTab: s.updateTab,
    _pendingNavigate: s._pendingNavigate,
  })));

  // Handle navigation after tab close (via React Router, not full reload)
  // Clear _pendingNavigate only after the route has actually changed,
  // otherwise the sync-tab useEffect may re-create the closed tab.
  useEffect(() => {
    if (pendingNavigate) {
      navigate(pendingNavigate);
    }
  }, [pendingNavigate, navigate]);

  useEffect(() => {
    if (pendingNavigate && location.pathname === tabKey(pendingNavigate).split('?')[0]) {
      useUIStore.setState({ _pendingNavigate: null });
    }
  }, [location.pathname, pendingNavigate]);

  const [draggedIdx, setDraggedIdx] = React.useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = React.useState<number | null>(null);
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number; tabId: string } | null>(null);

  const handleCloseOthers = (keepId: string) => {
    for (const tab of tabs) {
      if (tab.id !== keepId && tab.closable && !tab.pinned) {
        closeTab(tab.id);
      }
    }
  };

  const handleCloseAll = () => {
    for (const tab of tabs) {
      if (tab.closable && !tab.pinned) {
        closeTab(tab.id);
      }
    }
  };

  // Sync active tab with current route. A page has one tab whatever its
  // query; the tab remembers the page's latest URL (e.g. its `?tab=`).
  useEffect(() => {
    // Don't create tabs while a close-triggered navigation is pending
    if (pendingNavigate) return;

    const currentPath = location.pathname;
    const currentUrl = currentPath + location.search;
    const matchingTab = tabs.find((t) => tabKey(t.path) === tabKey(currentUrl));
    const activeTab = tabs.find((t) => t.id === activeTabId);

    if (matchingTab) {
      if (activeTabId !== matchingTab.id) {
        setActiveTab(matchingTab.id);
      }
      // A pinned tab keeps the URL it was pinned with; another tab follows
      // the page's URL and the title that URL describes.
      if (!matchingTab.pinned && matchingTab.path !== currentUrl) {
        updateTab(matchingTab.id, { path: currentUrl, title: titleForUrl(currentUrl) });
      }
    } else if (navigationType === 'REPLACE' && activeTab && tabKey(activeTab.path).split('?')[0] === currentPath) {
      // The page rewrote its own URL in place. A new `?ns=` (the picker) re-scopes
      // this tab, which follows; a page dropping another param that named the
      // tab keeps the URL that opens it.
      const nsOf = (url: string) => new URLSearchParams(url.split('?')[1] ?? '').get('ns');
      if (!activeTab.pinned && nsOf(currentUrl) !== nsOf(activeTab.path)) {
        updateTab(activeTab.id, { path: currentUrl, title: titleForUrl(currentUrl) });
      }
    } else if (currentPath !== '/' && isKnownRoute(currentPath)) {
      // Unknown paths show the Not Found page; they get no tab.
      // Create a new tab for this path (skip redirects and pinned defaults)
      addTab({
        title: titleForUrl(currentUrl),
        icon: getRouteIcon(currentPath),
        path: currentUrl,
        pinned: false,
        closable: true,
      });
    }
  }, [location.pathname, location.search, pendingNavigate]);

  // Navigate when user clicks a tab (not on store rehydration or URL-driven changes)
  const userClickedTab = useRef(false);
  useEffect(() => {
    if (!userClickedTab.current) return;
    userClickedTab.current = false;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab && location.pathname + location.search !== activeTab.path) {
      navigate(activeTab.path);
    }
  }, [activeTabId]);

  function handleTabClick(tabId: string) {
    userClickedTab.current = true;
    setActiveTab(tabId);
  }

  function handleTabClose(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    closeTab(tabId);
  }

  function handleMiddleClick(e: React.MouseEvent, tabId: string) {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tabId);
    }
  }

  return (
    <div role="tablist" aria-label="Open tabs" className="flex h-9 items-center gap-0.5 border-b border-slate-700 bg-slate-800 px-2 overflow-x-auto hide-scrollbar">
      {tabs.map((tab, tabIndex) => {
        const Icon = getIcon(tab.icon);
        const isActive = tab.id === activeTabId;
        const isDragOver = dragOverIdx === tabIndex && draggedIdx !== tabIndex;

        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            draggable={!tab.pinned}
            onDragStart={() => setDraggedIdx(tabIndex)}
            onDragOver={(e) => { e.preventDefault(); setDragOverIdx(tabIndex); }}
            onDragLeave={() => setDragOverIdx(null)}
            onDrop={() => {
              if (draggedIdx !== null && draggedIdx !== tabIndex) {
                reorderTabs(draggedIdx, tabIndex);
              }
              setDraggedIdx(null);
              setDragOverIdx(null);
            }}
            onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null); }}
            onClick={() => handleTabClick(tab.id)}
            onMouseDown={(e) => handleMiddleClick(e, tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
            }}
            className={cn(
              'group flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-sm transition-colors cursor-pointer select-none',
              tab.pinned ? 'px-2.5 shrink-0' : 'min-w-[100px] max-w-[200px]',
              isActive
                ? 'bg-slate-900 text-slate-100 shadow-xs'
                : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200',
              isDragOver && 'border-l-2 border-blue-500',
              draggedIdx === tabIndex && 'opacity-50'
            )}
          >
            {/* Pin indicator for pinned tabs */}
            {tab.pinned && (
              <Pin className="h-2.5 w-2.5 shrink-0 text-blue-400/60 group-hover:hidden" />
            )}

            {/* Icon */}
            {Icon && !tab.pinned && (
              <Icon
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  isActive ? (getRouteColor(tab.path) || 'text-emerald-400') : 'text-slate-500'
                )}
              />
            )}
            {Icon && tab.pinned && (
              <Icon
                className={cn(
                  'h-3.5 w-3.5 shrink-0 hidden group-hover:block',
                  isActive ? 'text-emerald-400' : 'text-slate-500'
                )}
              />
            )}

            {/* Title */}
            <span className={cn('truncate', tab.pinned ? 'text-xs' : 'flex-1')}>
              {tab.title}
            </span>

            {/* Pin/Unpin button (hover) */}
            {tab.pinned ? (
              <button
                onClick={(e) => { e.stopPropagation(); unpinTab(tab.id); }}
                className="rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-slate-600 group-hover:opacity-100 text-blue-400"
                title="Unpin tab"
              >
                <PinOff className="h-3 w-3" />
              </button>
            ) : tab.closable && !tab.pinned ? (
              <button
                onClick={(e) => { e.stopPropagation(); pinTab(tab.id); }}
                className="rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-slate-600 group-hover:opacity-100"
                title="Pin tab"
              >
                <Pin className="h-3 w-3" />
              </button>
            ) : null}

            {/* Close button */}
            {tab.closable && (
              <button
                onClick={(e) => handleTabClose(e, tab.id)}
                className="rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-slate-600 group-hover:opacity-100"
                aria-label="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}

      {/* Add tab button */}
      <button
        onClick={openCommandPalette}
        className="flex h-7 w-7 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
        title="New tab (⌘K)"
      >
        <Plus className="h-4 w-4" />
      </button>

      {/* Close all (shown when many tabs) */}
      {tabs.filter((t) => t.closable && !t.pinned).length > 2 && (
        <button
          onClick={handleCloseAll}
          className="ml-auto flex h-7 items-center gap-1 rounded-sm px-2 text-xs text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
          title="Close all tabs"
        >
          <X className="h-3 w-3" />
          Close all
        </button>
      )}

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 w-48 rounded-lg border border-slate-600 bg-slate-800 shadow-xl py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {(() => {
              const tab = tabs.find((t) => t.id === contextMenu.tabId);
              if (!tab) return null;
              return (
                <>
                  {tab.closable && !tab.pinned && (
                    <button
                      onClick={() => { pinTab(tab.id); setContextMenu(null); }}
                      className="w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-700"
                    >
                      📌 Pin tab
                    </button>
                  )}
                  {tab.pinned && (
                    <button
                      onClick={() => { unpinTab(tab.id); setContextMenu(null); }}
                      className="w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-700"
                    >
                      Unpin tab
                    </button>
                  )}
                  {tab.closable && (
                    <button
                      onClick={() => { closeTab(tab.id); setContextMenu(null); }}
                      className="w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-700"
                    >
                      Close
                    </button>
                  )}
                  <button
                    onClick={() => { handleCloseOthers(tab.id); setContextMenu(null); }}
                    className="w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-700"
                  >
                    Close others
                  </button>
                  <div className="border-t border-slate-700 my-1" />
                  <button
                    onClick={() => { handleCloseAll(); setContextMenu(null); }}
                    className="w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-slate-700"
                  >
                    Close all tabs
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
