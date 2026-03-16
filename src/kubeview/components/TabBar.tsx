import { useNavigate, useLocation } from 'react-router-dom';
import { X, Plus } from 'lucide-react';
import * as Icons from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';

// Helper to get icon component from string name
function getIcon(iconName?: string) {
  if (!iconName) return null;
  const IconComponent = (Icons as any)[iconName];
  return IconComponent || null;
}

export function TabBar() {
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = useUIStore((s) => s.tabs);
  const activeTabId = useUIStore((s) => s.activeTabId);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const closeTab = useUIStore((s) => s.closeTab);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const addTab = useUIStore((s) => s.addTab);

  // Sync active tab with current route
  useEffect(() => {
    const currentPath = location.pathname;
    const matchingTab = tabs.find((t) => t.path === currentPath);

    if (matchingTab) {
      // Activate existing tab if it matches current path
      if (activeTabId !== matchingTab.id) {
        setActiveTab(matchingTab.id);
      }
    } else if (currentPath !== '/pulse') {
      // Create a new tab for this path (unless it's the default pulse tab)
      const pathParts = currentPath.split('/').filter(Boolean);
      const title = pathParts[pathParts.length - 1] || 'Untitled';

      addTab({
        title: title.charAt(0).toUpperCase() + title.slice(1),
        path: currentPath,
        pinned: false,
        closable: true,
      });
    }
  }, [location.pathname]);

  // Navigate when user clicks a tab (not on store rehydration or URL-driven changes)
  const userClickedTab = useRef(false);
  useEffect(() => {
    if (!userClickedTab.current) return;
    userClickedTab.current = false;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab && location.pathname !== activeTab.path) {
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
    <div className="flex h-9 items-center gap-0.5 border-b border-slate-700 bg-slate-800 px-2">
      {tabs.map((tab) => {
        const Icon = getIcon(tab.icon);
        const isActive = tab.id === activeTabId;

        return (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            onMouseDown={(e) => handleMiddleClick(e, tab.id)}
            className={cn(
              'group flex h-7 items-center gap-1.5 rounded px-2.5 text-sm transition-colors',
              tab.pinned ? 'min-w-0 px-2' : 'min-w-[100px] max-w-[200px]',
              isActive
                ? 'bg-slate-900 text-slate-100 shadow-sm'
                : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            )}
          >
            {/* Icon */}
            {Icon && (
              <Icon
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  isActive ? 'text-emerald-400' : 'text-slate-500'
                )}
              />
            )}

            {/* Title (hidden for pinned tabs) */}
            {!tab.pinned && (
              <span className="flex-1 truncate">{tab.title}</span>
            )}

            {/* Close button (hidden for non-closable and shown on hover for others) */}
            {tab.closable && !tab.pinned && (
              <button
                onClick={(e) => handleTabClose(e, tab.id)}
                className="rounded p-0.5 opacity-0 transition-opacity hover:bg-slate-600 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </button>
        );
      })}

      {/* Add tab button */}
      <button
        onClick={openCommandPalette}
        className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
