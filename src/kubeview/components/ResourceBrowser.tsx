import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, ChevronDown, Star, Activity, Package, Globe, Server, HardDrive, Clock, Shield, Bell, Settings } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useClusterStore } from '../store/clusterStore';
import { getResourceIcon } from '../engine/iconRegistry';

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

function getResourceIconName(kind: string): string {
  const icons: Record<string, string> = {
    Pod: 'Box',
    Deployment: 'Package',
    Service: 'Network',
    ConfigMap: 'FileText',
    Secret: 'Lock',
    Node: 'Server',
    Namespace: 'Folder',
    Ingress: 'Globe',
    PersistentVolumeClaim: 'HardDrive',
    StatefulSet: 'Database',
    DaemonSet: 'Layers',
    Job: 'PlayCircle',
    CronJob: 'Clock',
    ReplicaSet: 'Copy',
    ServiceAccount: 'User',
    Role: 'Shield',
    RoleBinding: 'Link',
    ClusterRole: 'ShieldCheck',
    ClusterRoleBinding: 'Link2',
  };

  return icons[kind] || 'File';
}

export function ResourceBrowser() {
  const navigate = useNavigate();
  const closeBrowser = useUIStore((s) => s.closeBrowser);
  const addTab = useUIStore((s) => s.addTab);
  const resourceRegistry = useClusterStore((s) => s.resourceRegistry);

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
        className="fixed left-0 top-0 z-50 h-full w-80 border-r border-slate-700 bg-slate-800 shadow-2xl"
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

        {/* Views section */}
        <div className="border-b border-slate-700 p-3">
          <div className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Star className="h-3 w-3" />
            Views
          </div>
          {[
            { label: 'Cluster Pulse', icon: Activity, path: '/pulse', color: 'text-emerald-400' },
            { label: 'Incidents', icon: Bell, path: '/incidents', color: 'text-red-400' },
            { label: 'Workloads', icon: Package, path: '/workloads', color: 'text-blue-400' },
            { label: 'Networking', icon: Globe, path: '/networking', color: 'text-cyan-400' },
            { label: 'Compute', icon: Server, path: '/compute', color: 'text-blue-400' },
            { label: 'Storage', icon: HardDrive, path: '/storage', color: 'text-orange-400' },
            { label: 'Builds', icon: Clock, path: '/builds', color: 'text-orange-400' },
            { label: 'Custom Resources', icon: Settings, path: '/crds', color: 'text-purple-400' },
            { label: 'Identity & Access', icon: Shield, path: '/identity', color: 'text-teal-400' },
            { label: 'Alerts', icon: Bell, path: '/alerts', color: 'text-amber-400' },
            { label: 'Administration', icon: Settings, path: '/admin', color: 'text-slate-400' },
          ].map((page) => (
            <button
              key={page.path}
              onClick={() => {
                addTab({ title: page.label, icon: page.icon.displayName || '', path: page.path, pinned: false, closable: true });
                navigate(page.path);
                closeBrowser();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-700"
            >
              <page.icon className={`h-4 w-4 ${page.color}`} />
              {page.label}
            </button>
          ))}
        </div>

        {/* Resource groups */}
        <div className="flex-1 overflow-auto p-3">
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
