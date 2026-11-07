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
 * - Back/Forward to an entry without `?ns=` means all namespaces: that entry
 *   was unscoped when it was left.
 * - A page that does not scope by namespace says so with `applies: false`;
 *   the picker then reads "All namespaces on this page" instead of being
 *   silently ignored, and the scope is kept for the next scoped page.
 * - A scope names a namespace on the active cluster. Switching clusters
 *   resets it (fleetStore) and drops a `?ns=` left over from the old cluster.
 *
 * Writes go through `useSearchParamUpdater`, so a scope change and a tab
 * change made in the same click compose instead of clobbering each other.
 */
import { useCallback, useContext, useEffect, useRef } from 'react';
import { UNSAFE_NavigationContext, useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import { useSearchParamUpdater } from '../components/primitives/Tabs';
import { useUIStore } from '../store/uiStore';
import { useFleetStore } from '../store/fleetStore';

export const NS_PARAM = 'ns';
/** The older name used by Topology and Create links; read, then rewritten to `ns`. */
export const NS_ALIAS = 'namespace';
export const ALL_NAMESPACES = '*';

const NAMESPACE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** `*` or a valid namespace name. */
export function isScopeValue(value: string): boolean {
  return value === ALL_NAMESPACES || (value.length <= 63 && NAMESPACE_RE.test(value));
}

/** The scope named by `?ns=`, else `?namespace=`; null when absent or malformed. */
export function readNamespaceParam(params: URLSearchParams): string | null {
  const raw = params.get(NS_PARAM) ?? params.get(NS_ALIAS);
  return raw !== null && isScopeValue(raw) ? raw : null;
}

/** `path` with `?ns=<namespace>` set (all namespaces: no param). */
export function withNamespaceScope(path: string, namespace: string | undefined): string {
  if (!namespace || namespace === ALL_NAMESPACES) return path;
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.delete(NS_ALIAS);
  params.set(NS_PARAM, namespace);
  return `${base}?${params.toString()}`;
}

function writeScope(next: URLSearchParams, namespace: string) {
  next.delete(NS_ALIAS);
  if (namespace === ALL_NAMESPACES) next.delete(NS_PARAM);
  else next.set(NS_PARAM, namespace);
}

/**
 * The last location a scoped page synced from, the cluster it was on and the
 * router it came from. Module-level so every page shares it; tells
 * Back/Forward within one router from a fresh load, and a `?ns=` left in the
 * URL across a cluster switch (which remounts the router on the same entry)
 * from a new link.
 */
let lastSynced: { key: string; cluster: string; router: unknown } | null = null;

/** Tests only: forget the last synced location. */
export function resetNamespaceScopeSync() {
  lastSynced = null;
}

/** The store's scope now, not as of this render (a bare selector mock has no getState). */
function storedNow(fallback: string): string {
  const getState = (useUIStore as { getState?: () => { selectedNamespace?: string } }).getState;
  return (typeof getState === 'function' ? getState().selectedNamespace : undefined) ?? fallback;
}

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

export function useNamespaceScope({ applies = true }: { applies?: boolean } = {}): NamespaceScope {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const router = useContext(UNSAFE_NavigationContext).navigator;
  const update = useSearchParamUpdater();
  const stored = useUIStore((s) => s.selectedNamespace) ?? ALL_NAMESPACES;
  const setStored = useUIStore((s) => s.setSelectedNamespace);
  const register = useUIStore((s) => s.registerNamespaceScope);
  const clusterId = useFleetStore((s) => s.activeClusterId) ?? '';

  // The sync below runs when the URL changes, not when the store does: the
  // picker sets the store a moment before its URL write lands.
  const storedRef = useRef(stored);
  storedRef.current = stored;

  const fromUrl = readNamespaceParam(searchParams);
  const rawNs = searchParams.get(NS_PARAM);
  const rawAlias = searchParams.get(NS_ALIAS);
  const namespace = applies ? (fromUrl ?? stored) : ALL_NAMESPACES;

  useEffect(() => (register ? register(applies) : undefined), [register, applies]);

  useEffect(() => {
    if (!applies) return;
    const prev = lastSynced;
    lastSynced = { key: location.key, cluster: clusterId, router };
    // Several components on one page may sync; read the store as it is now.
    const current = storedNow(storedRef.current);

    // The same entry seen on another cluster: its `?ns=` named the old cluster's namespace.
    if (prev && prev.key === location.key && prev.cluster !== clusterId && (rawNs !== null || rawAlias !== null)) {
      if (current !== ALL_NAMESPACES) setStored?.(ALL_NAMESPACES);
      update((next) => writeScope(next, ALL_NAMESPACES));
      return;
    }

    if (fromUrl !== null) {
      if (fromUrl !== current) setStored?.(fromUrl);
      // Normalize: the old alias becomes `ns`, `ns=*` becomes no param.
      if (rawAlias !== null || rawNs !== fromUrl || fromUrl === ALL_NAMESPACES) {
        update((next) => writeScope(next, fromUrl));
      }
      return;
    }

    // No usable param. Drop a malformed one so the address bar matches the page.
    if (rawNs !== null || rawAlias !== null) update((next) => { next.delete(NS_PARAM); next.delete(NS_ALIAS); });
    const backForward = navigationType === 'POP' && prev !== null && prev.router === router && prev.key !== location.key;
    if (backForward) {
      if (current !== ALL_NAMESPACES) setStored?.(ALL_NAMESPACES);
    } else if (current !== ALL_NAMESPACES) {
      update((next) => writeScope(next, current));
    }
  }, [applies, location.key, clusterId, fromUrl, rawNs, rawAlias, navigationType, router, setStored, update]);

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
