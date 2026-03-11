import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/store/useUIStore';

interface CommandItem {
  id: string;
  label: string;
  section: string;
  description?: string;
  href?: string;
  action?: () => void;
  shortcut?: string;
  icon?: string;
}

interface K8sSearchResult {
  kind: string;
  name: string;
  namespace?: string;
  href: string;
}

const BASE = '/api/kubernetes';

// --- Navigation items (aligned with new 5-section structure) ---
const navigationItems: CommandItem[] = [
  // Dashboard
  { id: 'dashboard', label: 'Dashboard', section: 'Pages', href: '/home/overview', shortcut: 'G D', icon: '📊' },
  { id: 'topology', label: 'Topology', section: 'Pages', href: '/home/topology', icon: '🔗' },
  { id: 'search', label: 'Search', section: 'Pages', href: '/home/search', icon: '🔍' },
  // Applications
  { id: 'deploy-new', label: 'Deploy New', section: 'Pages', href: '/developer/add', icon: '🚀' },
  { id: 'deployments', label: 'Deployments', section: 'Pages', href: '/workloads/deployments', icon: '📦' },
  { id: 'pods', label: 'Pods', section: 'Pages', href: '/workloads/pods', shortcut: 'G P', icon: '🫛' },
  { id: 'statefulsets', label: 'StatefulSets', section: 'Pages', href: '/workloads/statefulsets', icon: '📦' },
  { id: 'daemonsets', label: 'DaemonSets', section: 'Pages', href: '/workloads/daemonsets', icon: '📦' },
  { id: 'jobs', label: 'Jobs & CronJobs', section: 'Pages', href: '/workloads/jobs', icon: '⏱' },
  { id: 'services', label: 'Services', section: 'Pages', href: '/networking/services', icon: '🌐' },
  { id: 'routes', label: 'Routes & Ingress', section: 'Pages', href: '/networking/routes', icon: '🌐' },
  { id: 'storage', label: 'Storage (PVCs)', section: 'Pages', href: '/storage/persistentvolumeclaims', icon: '💾' },
  { id: 'secrets', label: 'Secrets & ConfigMaps', section: 'Pages', href: '/workloads/secrets', icon: '🔑' },
  { id: 'helm', label: 'Helm Releases', section: 'Pages', href: '/helm/releases', icon: '⎈' },
  { id: 'pipelines', label: 'Pipelines', section: 'Pages', href: '/pipelines/pipelines', icon: '🔄' },
  // Observe
  { id: 'alerts', label: 'Alerts', section: 'Pages', href: '/observe/alerts', shortcut: 'G A', icon: '🔔' },
  { id: 'metrics', label: 'Metrics', section: 'Pages', href: '/observe/metrics', icon: '📈' },
  { id: 'dashboards', label: 'Dashboards', section: 'Pages', href: '/observe/dashboards', icon: '📉' },
  { id: 'events', label: 'Events', section: 'Pages', href: '/home/events', icon: '📋' },
  { id: 'security', label: 'Security Overview', section: 'Pages', href: '/security/overview', icon: '🛡' },
  // Cluster
  { id: 'nodes', label: 'Nodes', section: 'Pages', href: '/compute/nodes', shortcut: 'G N', icon: '🖥' },
  { id: 'operators', label: 'Installed Operators', section: 'Pages', href: '/operators/installed', icon: '🧩' },
  { id: 'operatorhub', label: 'OperatorHub', section: 'Pages', href: '/operators/operatorhub', icon: '🏪' },
  { id: 'cluster-settings', label: 'Cluster Settings', section: 'Pages', href: '/administration/cluster-settings', icon: '⚙' },
  // Access Control
  { id: 'namespaces', label: 'Namespaces', section: 'Pages', href: '/administration/namespaces', icon: '📁' },
  { id: 'roles', label: 'Roles & Bindings', section: 'Pages', href: '/administration/roles', icon: '👤' },
  { id: 'serviceaccounts', label: 'Service Accounts', section: 'Pages', href: '/administration/serviceaccounts', icon: '🤖' },
];

// --- Quick actions ---
function parseAction(query: string): { verb: string; resource: string; name: string; arg?: string } | null {
  const match = query.match(/^(restart|scale|delete|logs)\s+(pod|deploy|deployment|svc|service|node)\s+(\S+)(?:\s+(?:to\s+)?(\d+))?$/i);
  if (!match) return null;
  let resource = match[2].toLowerCase();
  if (resource === 'deploy') resource = 'deployment';
  if (resource === 'svc') resource = 'service';
  return { verb: match[1].toLowerCase(), resource, name: match[3], arg: match[4] };
}

// --- Recent items (persisted in localStorage) ---
const RECENT_KEY = 'cmdpalette_recent';
const MAX_RECENT = 8;

function getRecent(): CommandItem[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch { return []; }
}

function addRecent(item: CommandItem) {
  const recent = getRecent().filter((r) => r.id !== item.id);
  recent.unshift({ id: item.id, label: item.label, section: 'Recent', href: item.href, icon: item.icon });
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // Substring match first (more intuitive)
  if (t.includes(q)) return true;
  // Then fuzzy
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const { commandPaletteOpen, closeCommandPalette } = useUIStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<K8sSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // K8s resource search (debounced)
  const searchResources = useCallback(async (q: string) => {
    if (q.length < 2 || parseAction(q)) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const results: K8sSearchResult[] = [];
    const searches = [
      { api: '/api/v1/pods', kind: 'Pod', pathFn: (ns: string, n: string) => `/workloads/pods/${ns}/${n}` },
      { api: '/apis/apps/v1/deployments', kind: 'Deployment', pathFn: (ns: string, n: string) => `/workloads/deployments/${ns}/${n}` },
      { api: '/api/v1/services', kind: 'Service', pathFn: (ns: string, n: string) => `/networking/services/${ns}/${n}` },
      { api: '/api/v1/namespaces', kind: 'Namespace', pathFn: (_ns: string, n: string) => `/administration/namespaces/${n}` },
      { api: '/api/v1/nodes', kind: 'Node', pathFn: (_ns: string, n: string) => `/compute/nodes/${n}` },
    ];

    await Promise.allSettled(
      searches.map(async ({ api, kind, pathFn }) => {
        try {
          const res = await fetch(`${BASE}${api}`);
          if (!res.ok) return;
          const json = await res.json() as { items?: { metadata: { name: string; namespace?: string } }[] };
          const items = json.items ?? [];
          const lower = q.toLowerCase();
          for (const item of items) {
            if (item.metadata.name.toLowerCase().includes(lower)) {
              results.push({
                kind,
                name: item.metadata.name,
                namespace: item.metadata.namespace,
                href: pathFn(item.metadata.namespace ?? '', item.metadata.name),
              });
            }
          }
        } catch { /* ignore */ }
      }),
    );

    // Sort by relevance (exact prefix match first)
    const lower = q.toLowerCase();
    results.sort((a, b) => {
      const aPrefix = a.name.toLowerCase().startsWith(lower) ? 0 : 1;
      const bPrefix = b.name.toLowerCase().startsWith(lower) ? 0 : 1;
      return aPrefix - bPrefix || a.name.localeCompare(b.name);
    });

    setSearchResults(results.slice(0, 15));
    setSearching(false);
  }, []);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      setSearchResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    setSelectedIndex(0);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (query.length >= 2) {
      searchTimerRef.current = setTimeout(() => searchResources(query), 300);
    } else {
      setSearchResults([]);
    }
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [query, searchResources]);

  const executeNav = useCallback((item: CommandItem) => {
    addRecent(item);
    if (item.href) navigate(item.href);
    if (item.action) item.action();
    closeCommandPalette();
  }, [navigate, closeCommandPalette]);

  const executeResource = useCallback((result: K8sSearchResult) => {
    addRecent({ id: `${result.kind}-${result.name}`, label: result.name, section: 'Recent', href: result.href, icon: result.kind === 'Pod' ? '🫛' : result.kind === 'Deployment' ? '📦' : '🌐' });
    navigate(result.href);
    closeCommandPalette();
  }, [navigate, closeCommandPalette]);

  const executeAction = useCallback(async (action: { verb: string; resource: string; name: string; arg?: string }) => {
    closeCommandPalette();
    // Find the resource first
    const apiMap: Record<string, string> = {
      pod: '/api/v1', deployment: '/apis/apps/v1', service: '/api/v1', node: '/api/v1',
    };
    const pluralMap: Record<string, string> = {
      pod: 'pods', deployment: 'deployments', service: 'services', node: 'nodes',
    };
    const apiBase = apiMap[action.resource];
    const plural = pluralMap[action.resource];
    if (!apiBase || !plural) return;

    if (action.verb === 'logs' && action.resource === 'pod') {
      // Find pod namespace, then navigate
      try {
        const res = await fetch(`${BASE}/api/v1/pods`);
        if (!res.ok) return;
        const json = await res.json() as { items?: { metadata: { name: string; namespace: string } }[] };
        const pod = json.items?.find((p) => p.metadata.name.includes(action.name));
        if (pod) navigate(`/workloads/pods/${pod.metadata.namespace}/${pod.metadata.name}?tab=logs`);
      } catch { /* ignore */ }
      return;
    }

    if (action.verb === 'restart' && action.resource === 'pod') {
      try {
        const res = await fetch(`${BASE}/api/v1/pods`);
        if (!res.ok) return;
        const json = await res.json() as { items?: { metadata: { name: string; namespace: string } }[] };
        const pod = json.items?.find((p) => p.metadata.name.includes(action.name));
        if (pod) {
          await fetch(`${BASE}/api/v1/namespaces/${pod.metadata.namespace}/pods/${pod.metadata.name}`, { method: 'DELETE' });
        }
      } catch { /* ignore */ }
      return;
    }

    if (action.verb === 'scale' && action.resource === 'deployment' && action.arg) {
      try {
        const res = await fetch(`${BASE}/apis/apps/v1/deployments`);
        if (!res.ok) return;
        const json = await res.json() as { items?: { metadata: { name: string; namespace: string } }[] };
        const dep = json.items?.find((d) => d.metadata.name.includes(action.name));
        if (dep) {
          await fetch(`${BASE}/apis/apps/v1/namespaces/${dep.metadata.namespace}/deployments/${dep.metadata.name}/scale`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiVersion: 'autoscaling/v1', kind: 'Scale', metadata: { name: dep.metadata.name, namespace: dep.metadata.namespace }, spec: { replicas: parseInt(action.arg) } }),
          });
        }
      } catch { /* ignore */ }
      return;
    }
  }, [navigate, closeCommandPalette]);

  if (!commandPaletteOpen) return null;

  // Build display list
  const recent = getRecent();
  const action = parseAction(query);

  const filteredNav = query
    ? navigationItems.filter((item) => fuzzyMatch(query, item.label) || fuzzyMatch(query, item.section))
    : navigationItems;

  // Collect all items for keyboard navigation
  const allItems: { type: 'nav' | 'resource' | 'action' | 'recent'; item: CommandItem | K8sSearchResult | ReturnType<typeof parseAction>; key: string }[] = [];

  if (!query && recent.length > 0) {
    recent.forEach((r) => allItems.push({ type: 'recent', item: r, key: `recent-${r.id}` }));
  }

  if (action) {
    allItems.push({ type: 'action', item: action, key: 'action-exec' });
  }

  searchResults.forEach((r) => allItems.push({ type: 'resource', item: r, key: `res-${r.kind}-${r.name}` }));
  filteredNav.forEach((item) => allItems.push({ type: 'nav', item, key: `nav-${item.id}` }));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = allItems[selectedIndex];
      if (!selected) return;
      if (selected.type === 'nav' || selected.type === 'recent') executeNav(selected.item as CommandItem);
      else if (selected.type === 'resource') executeResource(selected.item as K8sSearchResult);
      else if (selected.type === 'action') executeAction(selected.item as NonNullable<ReturnType<typeof parseAction>>);
    } else if (e.key === 'Escape') {
      closeCommandPalette();
    }
  };

  let itemIndex = 0;

  return (
    <div className="compass-command-palette-overlay" onClick={closeCommandPalette}>
      <div className="compass-command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="compass-command-palette__input-wrapper">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="os-command-palette__search-icon">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="compass-command-palette__input"
            placeholder="Search resources, pages, or type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="compass-command-palette__kbd">ESC</kbd>
        </div>

        <div className="compass-command-palette__results">
          {allItems.length === 0 && !searching ? (
            <div className="compass-command-palette__empty">
              {query ? 'No results found' : 'Start typing to search...'}
            </div>
          ) : (
            <>
              {/* Recent items */}
              {!query && recent.length > 0 && (
                <>
                  <div className="compass-command-palette__section">Recent</div>
                  {recent.map((item) => {
                    const idx = itemIndex++;
                    return (
                      <div
                        key={`recent-${item.id}`}
                        className={`compass-command-palette__item ${idx === selectedIndex ? 'compass-command-palette__item--selected' : ''}`}
                        onClick={() => executeNav(item)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <span>{item.icon && <span className="os-cmd__icon">{item.icon}</span>} {item.label}</span>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Quick action */}
              {action && (
                <>
                  <div className="compass-command-palette__section">Quick Action</div>
                  {(() => {
                    const idx = itemIndex++;
                    return (
                      <div
                        className={`compass-command-palette__item compass-command-palette__item--action ${idx === selectedIndex ? 'compass-command-palette__item--selected' : ''}`}
                        onClick={() => executeAction(action)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <span>⚡ {action.verb} {action.resource} <strong>{action.name}</strong>{action.arg ? ` to ${action.arg}` : ''}</span>
                        <kbd className="compass-command-palette__shortcut">Enter to run</kbd>
                      </div>
                    );
                  })()}
                </>
              )}

              {/* Resource search results */}
              {searchResults.length > 0 && (
                <>
                  <div className="compass-command-palette__section">
                    Resources {searching && '(searching...)'}
                  </div>
                  {searchResults.map((result) => {
                    const idx = itemIndex++;
                    return (
                      <div
                        key={`res-${result.kind}-${result.name}`}
                        className={`compass-command-palette__item ${idx === selectedIndex ? 'compass-command-palette__item--selected' : ''}`}
                        onClick={() => executeResource(result)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <span className="os-cmd__result">
                          <span className="os-cmd__result-kind">{result.kind}</span>
                          <span className="os-cmd__result-name">{result.name}</span>
                          {result.namespace && <span className="os-cmd__result-ns">{result.namespace}</span>}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Navigation items */}
              {filteredNav.length > 0 && (
                <>
                  <div className="compass-command-palette__section">Pages</div>
                  {filteredNav.slice(0, query ? 10 : 27).map((item) => {
                    const idx = itemIndex++;
                    return (
                      <div
                        key={`nav-${item.id}`}
                        className={`compass-command-palette__item ${idx === selectedIndex ? 'compass-command-palette__item--selected' : ''}`}
                        onClick={() => executeNav(item)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <span>{item.icon && <span className="os-cmd__icon">{item.icon}</span>} {item.label}</span>
                        {item.shortcut && (
                          <kbd className="compass-command-palette__shortcut">{item.shortcut}</kbd>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {/* Help text */}
              {!query && (
                <div className="compass-command-palette__help">
                  <span>Try: <code>restart pod nginx</code> &middot; <code>scale deploy api to 3</code> &middot; <code>logs pod worker</code></span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        .os-cmd__icon { margin-right: 6px; font-size: 14px; }
        .os-cmd__result { display: flex; align-items: center; gap: 8px; }
        .os-cmd__result-kind { font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; background: var(--theme-color-1, #0066cc); color: #fff; }
        .os-cmd__result-name { font-weight: 500; }
        .os-cmd__result-ns { font-size: 12px; color: var(--pf-t--global--color--disabled--default, #6a6e73); }
        .compass-command-palette__item--action { border-left: 3px solid var(--theme-color-1, #0066cc); }
        .compass-command-palette__help { padding: 8px 16px; font-size: 12px; color: var(--pf-t--global--color--disabled--default, #6a6e73); border-top: 1px solid var(--glass-border, rgba(255,255,255,0.1)); }
        .compass-command-palette__help code { padding: 1px 5px; border-radius: 3px; background: rgba(0,0,0,0.1); font-size: 11px; }
        .dark .compass-command-palette__help code { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
}
