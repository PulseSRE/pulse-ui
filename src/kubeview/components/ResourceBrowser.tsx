import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, ChevronRight, ChevronDown, LayoutDashboard } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useClusterStore } from '../store/clusterStore';
import { useCustomViewStore } from '../store/customViewStore';
import { getResourceIcon, getResourceIconName } from '../engine/iconRegistry';
import { NAV_ITEMS, getNavItemsByGroup } from '../engine/navRegistry';

interface GroupedResources {
  [groupName: string]: Array<{
    kind: string;
    plural?: string;
    name?: string;
    group: string;
    version: string;
    namespaced: boolean;
  }>;
}

// Helper to get icon component
function getIcon(iconName: string) {
  return getResourceIcon(iconName);
}


export function ResourceBrowser() {
  const navigate = useNavigate();
  const location = useLocation();
  const closeBrowser = useUIStore((s) => s.closeBrowser);
  const addTab = useUIStore((s) => s.addTab);
  const resourceRegistry = useClusterStore((s) => s.resourceRegistry);
  const customViews = useCustomViewStore((s) => s.views);

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Core']));
  const browserRef = useRef<HTMLDivElement>(null);

  // Group resources by API group
  const groupedResources: GroupedResources = {};

  if (resourceRegistry) {
    for (const [, resource] of resourceRegistry) {
      const groupName = resource.group || 'Core';
      if (!groupedResources[groupName]) {
        groupedResources[groupName] = [];
      }
      groupedResources[groupName].push(resource);
    }
  }

  // Sort groups and resources
  const sortedGroups = Object.keys(groupedResources).sort((a, b) => {
    if (a === 'Core') return -1;
    if (b === 'Core') return 1;
    return a.localeCompare(b);
  });

  for (const group of sortedGroups) {
    groupedResources[group].sort((a, b) => a.kind.localeCompare(b.kind));
  }

  // Filter resources by search
  const filteredGroups = sortedGroups.filter((group) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      group.toLowerCase().includes(query) ||
      groupedResources[group].some((r) =>
        r.kind.toLowerCase().includes(query) || (r.plural || r.name || '').toLowerCase().includes(query)
      )
    );
  });

  function toggleGroup(group: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }

  function handleResourceClick(resource: any) {
    const plural = resource.plural || resource.kind;
    const path = resource.group
      ? `/r/${resource.group}~${resource.version}~${plural}`
      : `/r/${resource.version}~${plural}`;
    addTab({
      title: plural.charAt(0).toUpperCase() + plural.slice(1),
      icon: getResourceIconName(resource.kind),
      path,
      pinned: false,
      closable: true,
    });
    navigate(path);
    closeBrowser();
  }

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (browserRef.current && !browserRef.current.contains(e.target as Node)) {
        closeBrowser();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeBrowser]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" />

      {/* Sidebar */}
      <div
        ref={browserRef}
        className="fixed left-0 top-0 z-50 h-full w-80 flex flex-col border-r border-slate-700 bg-slate-800 shadow-2xl"
      >
        {/* Header */}
        <div className="border-b border-slate-700 p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Browse Resources</h2>
          <div className="flex items-center gap-2 rounded border border-slate-600 bg-slate-900 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search resources..."
              className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
            />
          </div>
        </div>

        {/* Views section — derived from canonical navRegistry */}
        <div className="border-b border-slate-700 p-3 space-y-3">
          {getNavItemsByGroup().map((section) => (
            <div key={section.group}>
              <div className="mb-1 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
                {section.label}
              </div>
              {section.items.map((page) => {
                const Icon = getResourceIcon(page.icon);
                return (
                  <button
                    key={page.path}
                    onClick={() => {
                      addTab({ title: page.label, icon: page.icon, path: page.path, pinned: false, closable: true });
                      navigate(page.path);
                      closeBrowser();
                    }}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors ${location.pathname === page.path ? 'bg-slate-700/60 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
                  >
                    <Icon className={`h-4 w-4 ${page.color || ''}`} />
                    {page.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Custom dashboards */}
        <div className="border-b border-slate-700 p-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <LayoutDashboard className="h-3 w-3" />
              Your Views
            </span>
            <button
              onClick={() => {
                addTab({ title: 'Manage Views', icon: 'LayoutDashboard', path: '/views', pinned: false, closable: true });
                navigate('/views');
                closeBrowser();
              }}
              className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
            >
              Manage
            </button>
          </div>
          {customViews.length === 0 ? (
            <p className="px-2 py-1 text-xs text-slate-600">No views yet. Ask the AI to create one.</p>
          ) : (
            customViews.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  addTab({ title: v.title, icon: 'LayoutDashboard', path: `/custom/${v.id}`, pinned: false, closable: true });
                  navigate(`/custom/${v.id}`);
                  closeBrowser();
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-700"
              >
                <LayoutDashboard className="h-4 w-4 text-violet-400" />
                <span className="truncate">{v.title}</span>
              </button>
            ))
          )}
        </div>

        {/* Resource groups */}
        <div className="flex-1 overflow-auto thin-scrollbar p-3">
          {filteredGroups.map((group) => {
            const isExpanded = expandedGroups.has(group);
            const resources = groupedResources[group];

            // Filter resources by search
            const filteredResources = searchQuery
              ? resources.filter(
                  (r) =>
                    r.kind.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (r.plural || r.name || '').toLowerCase().includes(searchQuery.toLowerCase())
                )
              : resources;

            if (filteredResources.length === 0) return null;

            return (
              <div key={group} className="mb-3">
                <button
                  onClick={() => toggleGroup(group)}
                  className="flex w-full items-center gap-2 px-2 py-1 text-sm font-semibold text-slate-300 transition-colors hover:text-slate-100"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  <span className="flex-1 text-left">
                    {group === 'Core' ? 'Core (v1)' : group}
                  </span>
                  <span className="text-xs text-slate-500">{filteredResources.length}</span>
                </button>

                {isExpanded && (
                  <div className="ml-5 mt-1 space-y-0.5">
                    {filteredResources.map((resource) => {
                      const Icon = getIcon(getResourceIconName(resource.kind));
                      return (
                        <button
                          key={`${resource.group}-${resource.version}-${resource.plural}`}
                          onClick={() => handleResourceClick(resource)}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span className="flex-1 truncate text-left">{resource.plural}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 p-3 text-xs text-slate-500">
          Press <kbd className="rounded bg-slate-700 px-1.5 py-0.5">⌘B</kbd> to close
        </div>
      </div>
    </>
  );
}
