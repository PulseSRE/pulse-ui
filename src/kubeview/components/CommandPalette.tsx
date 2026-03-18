import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Command } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { getFavorites } from '../engine/favorites';
import { useClusterStore } from '../store/clusterStore';
import { cn } from '@/lib/utils';
import { getResourceIcon } from '../engine/iconRegistry';

/** Capitalize first letter of each word: "deployments" → "Deployments", "poddisruptionbudgets" → "Poddisruptionbudgets" */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface CommandItem {
  type: 'resource' | 'action' | 'recent' | 'nav';
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  path?: string;
  action?: () => void;
}

// Helper to get icon component
function getIcon(iconName?: string) {
  return getResourceIcon(iconName, Search);
}

// Load recent resources from localStorage
function loadRecents(): CommandItem[] {
  try {
    const stored = localStorage.getItem('shiftops-recents');
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

// Save recent resource to localStorage
function saveRecent(item: CommandItem) {
  try {
    const recents = loadRecents();
    const filtered = recents.filter((r) => r.id !== item.id);
    const newRecents = [item, ...filtered].slice(0, 10);
    localStorage.setItem('shiftops-recents', JSON.stringify(newRecents));
  } catch {
    // Ignore errors
  }
}

export function CommandPalette() {
  const navigate = useNavigate();
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);
  const addTab = useUIStore((s) => s.addTab);
  const resourceRegistry = useClusterStore((s) => s.resourceRegistry);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<'default' | 'browse' | 'action' | 'query'>('default');

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Determine mode from query prefix
  useEffect(() => {
    if (query.startsWith('/')) {
      setMode('browse');
    } else if (query.startsWith(':')) {
      setMode('action');
    } else if (query.startsWith('?')) {
      setMode('query');
    } else {
      setMode('default');
    }
    setSelectedIndex(0);
  }, [query]);

  // Build command items based on mode
  const items = getCommandItems(mode, query, resourceRegistry);

  const handleSelect = useCallback((item: CommandItem) => {
    if (item.action) {
      item.action();
    } else if (item.path) {
      addTab({
        title: item.title,
        icon: item.icon,
        path: item.path,
        pinned: false,
        closable: true,
      });
      navigate(item.path);

      if (item.type === 'resource') {
        saveRecent(item);
      }
    }

    closeCommandPalette();
  }, [addTab, navigate, closeCommandPalette]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === 'Enter' && items[selectedIndex]) {
        e.preventDefault();
        handleSelect(items[selectedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPalette();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, selectedIndex, handleSelect]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60"
        onClick={closeCommandPalette}
      />

      {/* Palette */}
      <div className="fixed left-1/2 top-20 z-50 w-full max-w-2xl -translate-x-1/2" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="rounded-lg border border-slate-600 bg-slate-800 shadow-2xl">
          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
            <Search className="h-5 w-5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search resources, actions, or queries..."
              className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 outline-none"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-activedescendant={items[selectedIndex] ? `cp-item-${items[selectedIndex].id}` : undefined}
              aria-label="Search"
            />
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-auto p-2" id="command-palette-results" role="listbox">
            {items.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                No results found
              </div>
            ) : (
              <div className="space-y-1">
                {renderGroups(items, selectedIndex, handleSelect)}
              </div>
            )}
          </div>

          {/* Hints */}
          <div className="border-t border-slate-700 px-4 py-2 text-xs text-slate-500">
            <span className="font-medium">/</span> browse{' '}
            <span className="mx-2">·</span>
            <span className="font-medium">:</span> action{' '}
            <span className="mx-2">·</span>
            <span className="font-medium">?</span> query{' '}
            <span className="mx-2">·</span>
            <span className="font-medium">⌘K</span> close
          </div>
        </div>
      </div>
    </>
  );
}

function getCommandItems(
  mode: string,
  query: string,
  resourceRegistry: Map<string, any> | null
): CommandItem[] {
  const cleanQuery = query.replace(/^[/:?]/, '').toLowerCase();

  if (mode === 'browse' || mode === 'default') {
    const items: CommandItem[] = [];

    // Favorites (shown first if any)
    const favorites = getFavorites();
    const matchingFavorites = favorites.filter((f) =>
      !cleanQuery || f.title.toLowerCase().includes(cleanQuery) || f.kind.toLowerCase().includes(cleanQuery)
    );
    for (const fav of matchingFavorites.slice(0, 5)) {
      items.push({
        type: 'recent' as const,
        id: `fav-${fav.path}`,
        title: fav.title,
        subtitle: `${fav.kind}${fav.namespace ? ` · ${fav.namespace}` : ''} ★`,
        icon: 'Star',
        path: fav.path,
      });
    }

    // Built-in pages
    const builtinPages: CommandItem[] = [
      { type: 'nav', id: 'welcome', title: 'Welcome', subtitle: 'Getting started guide', icon: 'Home', path: '/welcome' },
      { type: 'nav', id: 'pulse', title: 'Cluster Pulse', subtitle: 'Health overview', icon: 'Activity', path: '/pulse' },
      { type: 'nav', id: 'workloads', title: 'Workloads', subtitle: 'Deployments, StatefulSets, DaemonSets, Jobs, Pods', icon: 'Package', path: '/workloads' },
      { type: 'nav', id: 'networking', title: 'Networking', subtitle: 'Services, Routes, Ingresses, Network Policies', icon: 'Globe', path: '/networking' },
      { type: 'nav', id: 'compute', title: 'Compute', subtitle: 'Nodes, machines, cluster capacity', icon: 'Server', path: '/compute' },
      { type: 'nav', id: 'storage', title: 'Storage', subtitle: 'PVs, PVCs, StorageClasses', icon: 'HardDrive', path: '/storage' },
      { type: 'nav', id: 'access-control', title: 'Access Control', subtitle: 'RBAC roles, bindings, service accounts', icon: 'Shield', path: '/access-control' },
      { type: 'nav', id: 'alerts', title: 'Alerts', subtitle: 'Prometheus alerts, rules, silences', icon: 'Bell', path: '/alerts' },
      { type: 'nav', id: 'builds', title: 'Builds', subtitle: 'BuildConfigs, Builds, ImageStreams', icon: 'Hammer', path: '/builds' },
      { type: 'nav', id: 'software', title: 'Software', subtitle: 'Installed software, operators, deploy, Helm, templates', icon: 'Package', path: '/create/v1~pods' },
      { type: 'nav', id: 'admin', title: 'Administration', subtitle: 'Operators, cluster config, updates, snapshots, quotas', icon: 'Settings', path: '/admin' },
      { type: 'nav', id: 'users', title: 'User Management', subtitle: 'Users, groups, service accounts, impersonation', icon: 'Users', path: '/users' },
    ];

    const matchingPages = builtinPages.filter((page) =>
      !cleanQuery || page.title.toLowerCase().includes(cleanQuery) || page.subtitle!.toLowerCase().includes(cleanQuery)
    );
    items.push(...matchingPages);

    // Resource types from discovery — sorted by priority
    if (resourceRegistry) {
      const seen = new Set<string>();
      const coreResources: CommandItem[] = [];
      const crdResources: CommandItem[] = [];

      // Core K8s groups that should rank higher
      const coreGroups = new Set(['', 'apps', 'batch', 'rbac.authorization.k8s.io', 'networking.k8s.io', 'storage.k8s.io', 'policy', 'autoscaling']);

      for (const [, resource] of resourceRegistry) {
        const dedup = `${resource.group}/${resource.kind}`;
        if (!seen.has(dedup)) {
          seen.add(dedup);
          const kind = resource.kind || '';
          const plural = resource.plural || '';
          const shortNames = (resource.shortNames || []).join(', ');
          const match = !cleanQuery ||
            kind.toLowerCase().includes(cleanQuery) ||
            plural.toLowerCase().includes(cleanQuery) ||
            shortNames.toLowerCase().includes(cleanQuery);
          if (match) {
            const item: CommandItem = {
              type: 'resource',
              id: dedup,
              title: titleCase(plural || kind),
              subtitle: resource.group ? `${resource.group}/${resource.version}` : resource.version,
              icon: getResourceIconName(resource.kind),
              path: resource.group
                ? `/r/${resource.group}~${resource.version}~${plural}`
                : `/r/${resource.version}~${plural}`,
            };
            if (coreGroups.has(resource.group || '')) {
              coreResources.push(item);
            } else {
              crdResources.push(item);
            }
          }
        }
      }

      // Sort: core resources first (alphabetically), then CRDs
      coreResources.sort((a, b) => a.title.localeCompare(b.title));
      crdResources.sort((a, b) => a.title.localeCompare(b.title));
      items.push(...coreResources, ...crdResources);
    }

    // Show more results when searching, fewer when browsing
    return items.slice(0, cleanQuery ? 50 : 30);
  }

  if (mode === 'action') {
    // Show actions — navigate to relevant views
    return ([
      {
        type: 'nav' as const,
        id: 'scale',
        title: 'Scale deployment',
        subtitle: 'Navigate to deployments to scale',
        icon: 'ArrowUpDown',
        path: '/r/apps~v1~deployments',
      },
      {
        type: 'nav' as const,
        id: 'restart',
        title: 'Restart deployment',
        subtitle: 'Navigate to deployments to restart',
        icon: 'RotateCw',
        path: '/r/apps~v1~deployments',
      },
      {
        type: 'nav' as const,
        id: 'delete',
        title: 'Delete resource',
        subtitle: 'Browse resources to delete',
        icon: 'Trash2',
        path: '/workloads',
      },
    ] satisfies CommandItem[]).filter((item) =>
      item.title.toLowerCase().includes(cleanQuery) ||
      item.subtitle?.toLowerCase().includes(cleanQuery)
    );
  }

  if (mode === 'query') {
    // Show query suggestions — navigate to troubleshoot / pod list
    return ([
      {
        type: 'nav' as const,
        id: 'failing-pods',
        title: 'Show failing pods',
        subtitle: 'Pods with CrashLoopBackOff or Error',
        icon: 'AlertTriangle',
        path: '/pulse',
      },
      {
        type: 'nav' as const,
        id: 'high-memory',
        title: 'Show high memory pods',
        subtitle: 'Pods using >80% memory',
        icon: 'TrendingUp',
        path: '/pulse',
      },
    ] satisfies CommandItem[]).filter((item) =>
      item.title.toLowerCase().includes(cleanQuery)
    );
  }

  // Default mode: show recents + fuzzy search
  const recents = loadRecents().filter((item) =>
    item.title.toLowerCase().includes(cleanQuery)
  );

  return recents;
}

function renderGroups(
  items: CommandItem[],
  selectedIndex: number,
  onSelect: (item: CommandItem) => void
) {
  const grouped = new Map<string, CommandItem[]>();

  for (const item of items) {
    const group = item.type === 'recent' ? 'FAVORITES' :
                  item.type === 'resource' ? 'RESOURCES' :
                  item.type === 'action' ? 'ACTIONS' : 'PAGES';

    if (!grouped.has(group)) {
      grouped.set(group, []);
    }
    grouped.get(group)!.push(item);
  }

  const elements: React.JSX.Element[] = [];
  let currentIndex = 0;

  for (const [groupName, groupItems] of grouped) {
    elements.push(
      <div key={groupName} className="mb-2">
        <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          {groupName}
        </div>
        {groupItems.map((item) => {
          const itemIndex = currentIndex++;
          const Icon = getIcon(item.icon);

          return (
            <button
              key={item.id}
              id={`cp-item-${item.id}`}
              role="option"
              aria-selected={itemIndex === selectedIndex}
              onClick={() => onSelect(item)}
              className={cn(
                'flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors',
                itemIndex === selectedIndex
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <div className="flex-1 overflow-hidden">
                <div className="truncate text-sm font-medium">{item.title}</div>
                {item.subtitle && (
                  <div className="truncate text-xs opacity-75">{item.subtitle}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return elements;
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
  };

  return icons[kind] || 'File';
}
