import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Globe, Sparkles } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useAgentStore } from '../store/agentStore';
import { getFavorites } from '../engine/favorites';
import { useClusterStore } from '../store/clusterStore';
import { useCustomViewStore } from '../store/customViewStore';
import { useSmartPrompts, type SmartPromptItem } from '../hooks/useSmartPrompts';
import { AIIconStatic, AI_ACCENT, aiGlowClass } from './agent/AIBranding';
import type { K8sResource } from '../engine/renderers';
import type { ResourceType } from '../engine/discovery';
import { cn } from '@/lib/utils';
import { getResourceIcon } from '../engine/iconRegistry';
import { isMultiCluster } from '../engine/clusterConnection';
import { fleetSearch } from '../engine/fleet';
import type { FleetResult } from '../engine/fleet';
import { usePrefetchOnHover } from '../hooks/usePrefetchOnHover';
import { useAskPulse } from '../hooks/useAskPulse';
import { AskPulsePanel } from './AskPulsePanel';
import { isFeatureEnabled } from '../engine/featureFlags';
import { getRecentQueries } from '../engine/mockData/askPulseMocks';

/** Capitalize first letter of each word: "deployments" → "Deployments", "poddisruptionbudgets" → "Poddisruptionbudgets" */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface CommandItem {
  type: 'resource' | 'action' | 'recent' | 'nav' | 'ai';
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
    const stored = localStorage.getItem('openshiftpulse-recents');
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
    localStorage.setItem('openshiftpulse-recents', JSON.stringify(newRecents));
  } catch {
    // Ignore errors
  }
}

export function CommandPalette() {
  const navigate = useNavigate();
  const location = useLocation();
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);
  const openDock = useUIStore((s) => s.openDock);
  const addTab = useUIStore((s) => s.addTab);
  const resourceRegistry = useClusterStore((s) => s.resourceRegistry);
  const connectAndSend = useAgentStore((s) => s.connectAndSend);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<'default' | 'browse' | 'action' | 'query'>('default');
  const [searchAllClusters, setSearchAllClusters] = useState(false);
  const [fleetResults, setFleetResults] = useState<FleetResult<K8sResource>[]>([]);
  const [fleetLoading, setFleetLoading] = useState(false);
  const smartPrompts = useSmartPrompts();
  const askPulseEnabled = isFeatureEnabled('askPulse');
  const askPulse = useAskPulse(askPulseEnabled ? query : '');
  const showAskPulse = askPulseEnabled && askPulse.isNaturalLanguage && query.trim() && mode === 'default';
  const recentAskQueries = useMemo(() => askPulseEnabled ? getRecentQueries() : [], [askPulseEnabled, open]);

  const inputRef = useRef<HTMLInputElement>(null);
  const multiCluster = isMultiCluster();

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

  // Cross-cluster search: fan out when toggle is on and query is non-empty
  useEffect(() => {
    if (!searchAllClusters || !query.trim() || query.startsWith('/') || query.startsWith(':') || query.startsWith('?')) {
      setFleetResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setFleetLoading(true);
      try {
        const results = await fleetSearch('/api/v1/pods', query.trim());
        if (!cancelled) setFleetResults(results);
      } catch {
        if (!cancelled) setFleetResults([]);
      } finally {
        if (!cancelled) setFleetLoading(false);
      }
    }, 300); // debounce
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchAllClusters, query]);

  // Build command items based on mode
  const items = getCommandItems(mode, query, resourceRegistry, location.pathname, smartPrompts);

  const handleSelect = useCallback((item: CommandItem) => {
    // AI query items: send to dock agent panel
    if (item.type === 'ai') {
      connectAndSend(item.title);
      openDock('agent');
      closeCommandPalette();
      return;
    }

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
  }, [mode, addTab, navigate, closeCommandPalette, connectAndSend, openDock]);

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
        <div className={cn(
          'rounded-lg border bg-slate-800 shadow-2xl',
          mode === 'query' ? `border-violet-500/40 ${aiGlowClass}` : 'border-slate-600',
        )}>
          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
            {mode === 'query' ? (
              <AIIconStatic size={20} />
            ) : showAskPulse ? (
              <Sparkles className="h-5 w-5 text-violet-400" />
            ) : (
              <Search className="h-5 w-5 text-slate-400" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === 'query' ? 'Ask Pulse Agent anything...' : 'Search resources, actions, or queries...'}
              className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 outline-none"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-activedescendant={items[selectedIndex] ? `cp-item-${items[selectedIndex].id}` : undefined}
              aria-label="Search"
            />
            {multiCluster && (
              <button
                onClick={() => setSearchAllClusters(!searchAllClusters)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap',
                  searchAllClusters
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                )}
                aria-label={searchAllClusters ? 'Search all clusters' : 'Search this cluster'}
                aria-pressed={searchAllClusters}
              >
                <Globe className="h-3 w-3" />
                {searchAllClusters ? 'All Clusters' : 'This Cluster'}
              </button>
            )}
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-auto p-2" id="command-palette-results" role="listbox">
            {searchAllClusters && fleetLoading && (
              <div className="py-4 text-center text-sm text-slate-500">
                Searching all clusters...
              </div>
            )}
            {searchAllClusters && fleetResults.length > 0 && !fleetLoading && (
              <div className="space-y-1 mb-2">
                {fleetResults.map((clusterResult) => (
                  <div key={clusterResult.clusterId} className="mb-2">
                    <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <Globe className="h-3 w-3" />
                      {clusterResult.clusterName}
                      {clusterResult.status === 'rejected' && (
                        <span className="text-red-400 normal-case font-normal ml-1">
                          (unreachable{clusterResult.error ? `: ${clusterResult.error}` : ''})
                        </span>
                      )}
                    </div>
                    {clusterResult.data.length === 0 && clusterResult.status === 'fulfilled' && (
                      <div className="px-3 py-1 text-xs text-slate-500">No matches</div>
                    )}
                    {clusterResult.data.map((resource) => (
                      <button
                        key={`${clusterResult.clusterId}-${resource.metadata.namespace || ''}-${resource.metadata.name}`}
                        onClick={() => {
                          closeCommandPalette();
                        }}
                        className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-slate-300 hover:bg-slate-700 transition-colors"
                      >
                        <Search className="h-4 w-4 shrink-0 text-slate-500" />
                        <div className="flex-1 overflow-hidden">
                          <div className="truncate text-sm font-medium">{resource.metadata.name}</div>
                          <div className="truncate text-xs opacity-75">
                            {resource.kind || ''}{resource.metadata.namespace ? ` · ${resource.metadata.namespace}` : ''}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {showAskPulse && !searchAllClusters && (
              <AskPulsePanel
                query={query}
                response={askPulse.response}
                isLoading={askPulse.isLoading}
                onSuggestionClick={(suggestion) => setQuery(suggestion)}
                agentAvailable={askPulse.agentAvailable}
                onOpenInAgent={askPulse.openInAgent}
              />
            )}
            {!query.trim() && askPulseEnabled && !searchAllClusters && recentAskQueries.length > 0 && (
              <div className="mb-2">
                <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-violet-400 flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" />
                  Recent Questions
                </div>
                {recentAskQueries.map((q: string) => (
                  <button
                    key={q}
                    onClick={() => setQuery(q)}
                    className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    <Sparkles className="h-4 w-4 shrink-0 text-violet-400/60" />
                    <span className="truncate text-sm">{q}</span>
                  </button>
                ))}
              </div>
            )}
            {!showAskPulse && (!searchAllClusters || fleetResults.length === 0) && !fleetLoading && (
              items.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  No results found
                </div>
              ) : (
                <div className="space-y-1">
                  {renderGroups(items, selectedIndex, handleSelect)}
                </div>
              )
            )}
          </div>

          {/* Hints */}
          <div className="flex items-center justify-between border-t border-slate-700 px-4 py-2 text-xs text-slate-500">
            <div>
              <span className="font-medium">/</span> browse{' '}
              <span className="mx-2">·</span>
              <span className="font-medium">:</span> action{' '}
              <span className="mx-2">·</span>
              <span className={cn('font-medium', mode === 'query' && AI_ACCENT.text)}>?</span>
              {' '}
              <span className={cn(mode === 'query' && AI_ACCENT.text)}>ask AI</span>
              {' '}
              <span className="mx-2">·</span>
              <span className="font-medium">⌘K</span> close
            </div>
            {mode === 'query' && (
              <span className={cn('flex items-center gap-1', AI_ACCENT.text)}>
                <AIIconStatic size={10} /> Enter sends to Pulse Agent
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function getCommandItems(
  mode: string,
  query: string,
  resourceRegistry: Map<string, ResourceType> | null,
  currentPath: string = '/',
  smartPrompts: SmartPromptItem[] = [],
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
    const builtinViews: CommandItem[] = [
      { type: 'nav', id: 'welcome', title: 'Welcome', subtitle: 'Getting started guide', icon: 'Home', path: '/welcome' },
      { type: 'nav', id: 'pulse', title: 'Cluster Pulse', subtitle: 'Health overview', icon: 'Activity', path: '/pulse' },
      { type: 'nav', id: 'workloads', title: 'Workloads', subtitle: 'Deployments, StatefulSets, DaemonSets, Jobs, Pods', icon: 'Package', path: '/workloads' },
      { type: 'nav', id: 'networking', title: 'Networking', subtitle: 'Services, Routes, Ingresses, Network Policies', icon: 'Globe', path: '/networking' },
      { type: 'nav', id: 'compute', title: 'Compute', subtitle: 'Nodes, machines, cluster capacity', icon: 'Server', path: '/compute' },
      { type: 'nav', id: 'storage', title: 'Storage', subtitle: 'PVs, PVCs, StorageClasses', icon: 'HardDrive', path: '/storage' },
      { type: 'nav', id: 'security', title: 'Security', subtitle: 'Security audit, SCCs, network policies, access', icon: 'ShieldCheck', path: '/security' },
      { type: 'nav', id: 'identity', title: 'Identity & Access', subtitle: 'Users, groups, service accounts, RBAC, impersonation', icon: 'Shield', path: '/identity' },
      { type: 'nav', id: 'incidents', title: 'Incident Center', subtitle: 'Unified triage — findings, alerts, errors, auto-fix', icon: 'Bell', path: '/incidents' },
      { type: 'nav', id: 'alerts', title: 'Alerts', subtitle: 'Prometheus alert rules and silences (Incident Center)', icon: 'Bell', path: '/incidents?tab=alerts' },
      { type: 'nav', id: 'builds', title: 'Builds', subtitle: 'BuildConfigs, Builds, ImageStreams (Workloads tab)', icon: 'Hammer', path: '/workloads?tab=builds' },
      { type: 'nav', id: 'crds', title: 'Custom Resources', subtitle: 'CRDs, browse by API group (Admin tab)', icon: 'Puzzle', path: '/admin?tab=crds' },
      { type: 'nav', id: 'gitops', title: 'GitOps', subtitle: 'ArgoCD applications, sync status, drift detection, auto-PR', icon: 'GitBranch', path: '/gitops' },
      { type: 'nav', id: 'fleet', title: 'Fleet', subtitle: 'Multi-cluster dashboard, health scores, cluster switching, comparison', icon: 'Globe', path: '/fleet' },
      { type: 'nav', id: 'admin', title: 'Administration', subtitle: 'Operators, config, updates, snapshots, quotas, certificates', icon: 'Settings', path: '/admin' },
      { type: 'nav', id: 'onboarding', title: 'Production Readiness', subtitle: 'Readiness wizard — security, reliability, observability gates', icon: 'Shield', path: '/onboarding' },
      { type: 'nav', id: 'memory', title: "What I've Learned", subtitle: 'Learned runbooks, detected patterns, incident history', icon: 'Brain', path: '/memory' },
      { type: 'nav', id: 'reviews', title: 'Review Queue', subtitle: 'AI-proposed infrastructure changes — approve, reject, diff', icon: 'GitPullRequest', path: '/reviews' },
    ];

    const matchingPages = builtinViews.filter((page) =>
      !cleanQuery || page.title.toLowerCase().includes(cleanQuery) || page.subtitle!.toLowerCase().includes(cleanQuery)
    );
    items.push(...matchingPages);

    // Custom dashboards (AI-generated)
    const customViews = useCustomViewStore.getState().views;
    const matchingCustom: CommandItem[] = customViews
      .filter((v) => !cleanQuery || v.title.toLowerCase().includes(cleanQuery) || (v.description || '').toLowerCase().includes(cleanQuery))
      .map((v) => ({
        type: 'nav' as const,
        id: `custom-${v.id}`,
        title: v.title,
        subtitle: v.description || 'Custom dashboard',
        icon: 'LayoutDashboard',
        path: `/custom/${v.id}`,
      }));
    items.push(...matchingCustom);

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
    // AI-powered query mode — live cluster-aware smart prompts
    const promptItems: CommandItem[] = smartPrompts.slice(0, 8).map((sp, i) => ({
      type: 'ai' as const,
      id: `smart-${i}`,
      title: sp.prompt,
      subtitle: sp.context,
      icon: 'Sparkles',
    }));

    // If user typed a custom query, add it as the first "ask agent" item
    if (cleanQuery.length > 2) {
      promptItems.unshift({
        type: 'ai' as const,
        id: 'custom-query',
        title: cleanQuery,
        subtitle: 'Ask Pulse Agent',
        icon: 'Sparkles',
      });
    }

    return promptItems.filter((item) =>
      !cleanQuery || item.title.toLowerCase().includes(cleanQuery) || item.id === 'custom-query'
    );
  }

  // Default mode: show recents + fuzzy search
  const recents = loadRecents().filter((item) =>
    item.title.toLowerCase().includes(cleanQuery)
  );

  return recents;
}

function CommandPaletteItem({ item, isSelected, onSelect }: {
  item: CommandItem;
  isSelected: boolean;
  onSelect: (item: CommandItem) => void;
}) {
  const Icon = getIcon(item.icon);
  const prefetch = usePrefetchOnHover(item.path || '');
  const hoverProps = item.path ? { onMouseEnter: prefetch.onMouseEnter, onFocus: prefetch.onFocus, onMouseLeave: prefetch.onMouseLeave } : {};

  return (
    <button
      id={`cp-item-${item.id}`}
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(item)}
      {...hoverProps}
      className={cn(
        'flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors',
        isSelected
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
                  item.type === 'action' ? 'ACTIONS' :
                  item.type === 'ai' ? 'PULSE AI' : 'VIEWS';

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
        <div className={cn(
          'mb-1 px-2 text-xs font-semibold uppercase tracking-wider',
          groupName === 'PULSE AI' ? AI_ACCENT.text : 'text-slate-500',
        )}>
          {groupName}
        </div>
        {groupItems.map((item) => {
          const itemIndex = currentIndex++;
          return (
            <CommandPaletteItem
              key={item.id}
              item={item}
              isSelected={itemIndex === selectedIndex}
              onSelect={onSelect}
            />
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
