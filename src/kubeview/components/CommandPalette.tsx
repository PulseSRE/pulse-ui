import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Command } from 'lucide-react';
import * as Icons from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { getFavorites } from '../engine/favorites';
import { useClusterStore } from '../store/clusterStore';
import { cn } from '@/lib/utils';

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
  if (!iconName) return Search;
  const IconComponent = (Icons as any)[iconName];
  return IconComponent || Search;
}

// Load recent resources from localStorage
function loadRecents(): CommandItem[] {
  try {
    const stored = localStorage.getItem('openshiftview-recents');
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
    localStorage.setItem('openshiftview-recents', JSON.stringify(newRecents));
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
      <div className="fixed left-1/2 top-20 z-50 w-full max-w-2xl -translate-x-1/2">
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
            />
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-auto p-2">
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
      { type: 'nav', id: 'timeline', title: 'Timeline', subtitle: 'Cluster event feed', icon: 'Clock', path: '/timeline' },
      { type: 'nav', id: 'storage', title: 'Storage', subtitle: 'PVs, PVCs, StorageClasses', icon: 'HardDrive', path: '/storage' },
      { type: 'nav', id: 'access-control', title: 'Access Control', subtitle: 'RBAC roles, bindings, service accounts', icon: 'Shield', path: '/access-control' },
      { type: 'nav', id: 'operators', title: 'Operators', subtitle: 'ClusterOperator health & versions', icon: 'Puzzle', path: '/operators' },
      { type: 'nav', id: 'alerts', title: 'Alerts', subtitle: 'Prometheus alerts, rules, silences', icon: 'Bell', path: '/alerts' },
      { type: 'nav', id: 'admin', title: 'Administration', subtitle: 'Cluster settings, nodes, CRDs, quotas', icon: 'Settings', path: '/admin' },
      { type: 'nav', id: 'troubleshoot', title: 'Troubleshoot', subtitle: 'Auto-diagnose cluster issues', icon: 'Stethoscope', path: '/troubleshoot' },
      { type: 'nav', id: 'config-compare', title: 'Config Snapshots', subtitle: 'Capture & compare cluster config', icon: 'GitCompare', path: '/admin' },
      { type: 'nav', id: 'create', title: 'Create Resource', subtitle: 'Create from YAML', icon: 'FilePlus', path: '/create/v1~pods' },
    ];

    const matchingPages = builtinPages.filter((page) =>
      !cleanQuery || page.title.toLowerCase().includes(cleanQuery) || page.subtitle!.toLowerCase().includes(cleanQuery)
    );
    items.push(...matchingPages);

    // Resource types from discovery
    if (resourceRegistry) {
      const seen = new Set<string>();
      for (const [, resource] of resourceRegistry) {
        const dedup = `${resource.group}/${resource.kind}`;
        if (!seen.has(dedup)) {
          seen.add(dedup);
          const kind = resource.kind || '';
          const plural = resource.plural || '';
          const match = !cleanQuery ||
            kind.toLowerCase().includes(cleanQuery) ||
            plural.toLowerCase().includes(cleanQuery);
          if (match) {
            items.push({
              type: 'resource',
              id: dedup,
              title: plural || kind,
              subtitle: resource.group ? `${resource.group}/${resource.version}` : resource.version,
              icon: getResourceIcon(resource.kind),
              path: resource.group
                ? `/r/${resource.group}~${resource.version}~${plural}`
                : `/r/${resource.version}~${plural}`,
            });
          }
        }
      }
    }

    return items.slice(0, 25);
  }

  if (mode === 'action') {
    // Show actions
    return ([
      {
        type: 'action' as const,
        id: 'scale',
        title: 'Scale deployment',
        subtitle: 'Change replica count',
        icon: 'ArrowUpDown',
      },
      {
        type: 'action' as const,
        id: 'restart',
        title: 'Restart deployment',
        subtitle: 'Trigger rollout restart',
        icon: 'RotateCw',
      },
      {
        type: 'action' as const,
        id: 'delete',
        title: 'Delete resource',
        subtitle: 'Remove resource from cluster',
        icon: 'Trash2',
      },
    ] satisfies CommandItem[]).filter((item) =>
      item.title.toLowerCase().includes(cleanQuery) ||
      item.subtitle?.toLowerCase().includes(cleanQuery)
    );
  }

  if (mode === 'query') {
    // Show query suggestions
    return ([
      {
        type: 'nav' as const,
        id: 'failing-pods',
        title: 'Show failing pods',
        subtitle: 'Pods with CrashLoopBackOff or Error',
        icon: 'AlertTriangle',
      },
      {
        type: 'nav' as const,
        id: 'high-memory',
        title: 'Show high memory pods',
        subtitle: 'Pods using >80% memory',
        icon: 'TrendingUp',
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

function getResourceIcon(kind: string): string {
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
