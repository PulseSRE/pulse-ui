/**
 * The namespace scope lives in the URL as `?ns=<namespace>`, so a scoped page
 * can be reloaded, linked and stepped through with Back/Forward.
 *
 *   const { namespace } = useNamespaceScope();      // '*' means all namespaces
 *   useNamespaceScope({ applies: false });          // this page shows every namespace
 *
 * - The URL wins. `?ns=` (or the older `?namespace=`, rewritten to `?ns=`)
 *   sets the scope; the global picker and the store follow it.
 * - A page opened without `?ns=` (a sidebar link, a new tab) inherits the
 *   current scope and writes it into its URL, replacing the history entry.
 * - Each history entry a scoped page settles on is recorded with its cluster
 *   and scope (per browser tab, surviving reload). Back/Forward or a reload
 *   onto a recorded entry restores that scope; an entry without `?ns=` is all
 *   namespaces. An entry recorded on another cluster names that cluster's
 *   namespaces: its `?ns=` is ignored from the first render and dropped.
 * - The scope is resolved during render from the URL and that record, so
 *   every component on a page agrees, the first render after a cluster
 *   switch included. The store is only a mirror for readers elsewhere.
 * - A page that does not scope by namespace says so with `applies: false`;
 *   the picker then reads "All namespaces on this page" instead of being
 *   silently ignored, a `?ns=` is dropped, and the choice is kept for the
 *   next scoped page.
 *
 * Writes go through `useSearchParamUpdater`, so a scope change and a tab
 * change made in the same click compose instead of clobbering each other.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useSearchParamUpdater } from '../components/primitives/Tabs';
import { useUIStore } from '../store/uiStore';
import { useFleetStore } from '../store/fleetStore';
import { ALL_NAMESPACES, NS_ALIAS, NS_PARAM, isScopeValue, readNamespaceParam } from '../engine/namespaceScope';

export { ALL_NAMESPACES, NS_ALIAS, NS_PARAM, isScopeValue, readNamespaceParam, withNamespaceScope } from '../engine/namespaceScope';

function writeScope(next: URLSearchParams, namespace: string) {
  next.delete(NS_ALIAS);
  if (namespace === ALL_NAMESPACES) next.delete(NS_PARAM);
  else next.set(NS_PARAM, namespace);
}

/* ── Per-entry records: which cluster and scope each history entry settled on ── */

interface EntryScope { cluster: string; ns: string }
const ENTRY_STORAGE_KEY = 'openshiftpulse-ns-scope-entries';
const MAX_ENTRIES = 200;
let memoryEntries: Record<string, EntryScope> = {};

function readEntries(): Record<string, EntryScope> {
  try {
    const raw = window.sessionStorage.getItem(ENTRY_STORAGE_KEY);
    if (raw) return { ...JSON.parse(raw), ...memoryEntries };
  } catch {
    // Storage blocked or corrupt: fall back to this page load's records.
  }
  return memoryEntries;
}

function entryScope(key: string): EntryScope | undefined {
  return readEntries()[key];
}

function recordEntry(key: string, scope: EntryScope) {
  const current = readEntries()[key];
  if (current && current.cluster === scope.cluster && current.ns === scope.ns) return;
  const entries = { ...readEntries(), [key]: scope };
  const keys = Object.keys(entries);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete entries[old];
  memoryEntries = entries;
  try {
    window.sessionStorage.setItem(ENTRY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Kept in memory for this page load.
  }
}

/** Tests only: forget every recorded entry. */
export function resetNamespaceScopeSync() {
  memoryEntries = {};
  try { window.sessionStorage.removeItem(ENTRY_STORAGE_KEY); } catch { /* none stored */ }
}

/* ── Resolution (pure, during render) ── */

export interface ResolvedScope {
  /** The scope this entry shows on `clusterId`: a namespace or '*'. */
  namespace: string;
  /** The URL carries a scope param that must not apply (another cluster's, or malformed). */
  dropParam: boolean;
}

export function resolveNamespaceScope(
  params: URLSearchParams,
  entryKey: string,
  clusterId: string,
  stored: string,
): ResolvedScope {
  const hasParam = params.has(NS_PARAM) || params.has(NS_ALIAS);
  const entry = entryScope(entryKey);
  if (entry && entry.cluster !== clusterId) return { namespace: ALL_NAMESPACES, dropParam: hasParam };
  const fromUrl = readNamespaceParam(params);
  if (fromUrl !== null) return { namespace: fromUrl, dropParam: false };
  // An entry seen before without a usable param was left unscoped.
  if (entry) return { namespace: ALL_NAMESPACES, dropParam: hasParam };
  return { namespace: stored, dropParam: hasParam };
}

/** The store's scope if it belongs to this cluster, else all namespaces. */
function useStoredScope(clusterId: string): string {
  return useUIStore((s) => {
    const ns = s.selectedNamespace ?? ALL_NAMESPACES;
    // No cluster recorded yet ('' before anything was chosen; undefined in a
    // selector-only mock) is unbound, not another cluster's: take it as is.
    return !s.scopeClusterId || s.scopeClusterId === clusterId ? ns : ALL_NAMESPACES;
  });
}

/**
 * The scope for this location, without syncing anything: for components that
 * only need a starting value (Create's sub-tabs). Same rule as the hook.
 */
export function useNamespaceScopeValue(): string {
  const [searchParams] = useSearchParams();
  const { key } = useLocation();
  const clusterId = useFleetStore((s) => s.activeClusterId) ?? '';
  const stored = useStoredScope(clusterId);
  return resolveNamespaceScope(searchParams, key, clusterId, stored).namespace;
}

/* ── Hooks ── */

export interface NamespaceScope {
  /** The scoped namespace, or '*' for all (always '*' when the scope does not apply). */
  namespace: string;
  /** Change the scope; written to the URL and the picker. */
  setNamespace: (namespace: string) => void;
  /** Whether this page scopes by namespace. */
  applies: boolean;
  /** The cluster the scope belongs to. Include it in query keys. */
  clusterId: string;
}

/** Sets the scope from outside a page (the global picker). */
export function useSetNamespaceScope(): (namespace: string) => void {
  const update = useSearchParamUpdater();
  const setStored = useUIStore((s) => s.setSelectedNamespace);
  // Only a mounted scoped page reads `?ns=`; elsewhere (a detail page) the
  // URL is left alone and the next scoped page inherits the choice.
  const pageUsesScope = useUIStore((s) => s.namespaceScopeUsers > 0 && s.namespaceScopeOptOuts === 0);
  return useCallback(
    (namespace: string) => {
      setStored(namespace);
      if (pageUsesScope) update((next) => writeScope(next, namespace));
    },
    [setStored, pageUsesScope, update],
  );
}

/** Whether the current page shows all namespaces whatever the picker says. */
export function useNamespaceScopeApplies(): boolean {
  return useUIStore((s) => s.namespaceScopeOptOuts === 0);
}

export interface NamespaceScopeOptions {
  /** False on a page that shows every namespace. */
  applies?: boolean;
  /**
   * False while the page cannot yet tell whether the scope applies (a list
   * before API discovery says whether its kind is namespaced). Nothing is
   * registered, synced or written until it is ready.
   */
  ready?: boolean;
}

export function useNamespaceScope({ applies = true, ready = true }: NamespaceScopeOptions = {}): NamespaceScope {
  const [searchParams] = useSearchParams();
  const { key } = useLocation();
  const update = useSearchParamUpdater();
  const clusterId = useFleetStore((s) => s.activeClusterId) ?? '';
  const stored = useStoredScope(clusterId);
  const setStored = useUIStore((s) => s.setSelectedNamespace);
  const register = useUIStore((s) => s.registerNamespaceScope);

  const resolved = resolveNamespaceScope(searchParams, key, clusterId, stored);
  const namespace = applies ? resolved.namespace : ALL_NAMESPACES;
  const rawNs = searchParams.get(NS_PARAM);
  const rawAlias = searchParams.get(NS_ALIAS);

  // The sync below runs when the URL changes, not when the store does: the
  // picker sets the store a moment before its URL write lands, and reacting
  // to that would write the old URL value back.
  const storedRef = useRef(stored);
  storedRef.current = stored;

  useEffect(() => (ready && register ? register(applies) : undefined), [register, applies, ready]);

  useEffect(() => {
    if (!ready) return;
    if (!applies) {
      // This page shows every namespace; a `?ns=` here would claim otherwise.
      if (rawNs !== null || rawAlias !== null) update((next) => { next.delete(NS_PARAM); next.delete(NS_ALIAS); });
      return;
    }
    const scope = resolved.namespace;
    if (storedRef.current !== scope) setStored?.(scope);
    // Settle the URL on the canonical form: `?ns=<namespace>`, nothing for all.
    const wanted = scope === ALL_NAMESPACES ? null : scope;
    if (resolved.dropParam || rawAlias !== null || rawNs !== wanted) {
      update((next) => writeScope(next, scope));
      return; // the rewritten entry is recorded when it lands
    }
    recordEntry(key, { cluster: clusterId, ns: scope });
  }, [ready, applies, key, clusterId, resolved.namespace, resolved.dropParam, rawNs, rawAlias, setStored, update]);

  const setNamespace = useCallback(
    (next: string) => {
      if (!applies || !isScopeValue(next)) return;
      setStored?.(next);
      update((params) => writeScope(params, next));
    },
    [applies, setStored, update],
  );

  return { namespace, setNamespace, applies, clusterId };
}
