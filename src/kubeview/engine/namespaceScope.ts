/**
 * The namespace scope's URL form, shared by the hook (hooks/useNamespaceScope)
 * and the stores, which strip it when the cluster changes.
 */

export const NS_PARAM = 'ns';
/** The older name used by Topology and Create links; read, then rewritten to `ns`. */
export const NS_ALIAS = 'namespace';
export const ALL_NAMESPACES = '*';

const NAMESPACE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** `*` or a valid namespace name. */
export function isScopeValue(value: string): boolean {
  return value === ALL_NAMESPACES || (value.length <= 63 && NAMESPACE_RE.test(value));
}

/** The scope named by a valid `?ns=`, else a valid `?namespace=`; null when neither is usable. */
export function readNamespaceParam(params: URLSearchParams): string | null {
  for (const name of [NS_PARAM, NS_ALIAS]) {
    const raw = params.get(name);
    if (raw !== null && isScopeValue(raw)) return raw;
  }
  return null;
}

/** `path` with `?ns=<namespace>` set (all namespaces: no param). */
export function withNamespaceScope(path: string, namespace: string | undefined): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.delete(NS_ALIAS);
  if (!namespace || namespace === ALL_NAMESPACES) params.delete(NS_PARAM);
  else params.set(NS_PARAM, namespace);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** `path` (which may carry a `#hash`) without the scope params; unchanged when it has none. */
export function stripNamespaceScope(path: string): string {
  const hashAt = path.indexOf('#');
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  const beforeHash = hashAt === -1 ? path : path.slice(0, hashAt);
  const [base, query] = beforeHash.split('?');
  if (query === undefined) return path;
  const params = new URLSearchParams(query);
  if (!params.has(NS_PARAM) && !params.has(NS_ALIAS)) return path;
  params.delete(NS_PARAM);
  params.delete(NS_ALIAS);
  const qs = params.toString();
  return `${base}${qs ? `?${qs}` : ''}${hash}`;
}

/**
 * Drop the scope from the browser's current URL, keeping its history state
 * (the router's entry key). Used before a cluster switch remounts the router,
 * so its first render already reads an unscoped URL.
 */
export function stripNamespaceScopeFromWindow(): void {
  try {
    const { pathname, search, hash } = window.location;
    const next = stripNamespaceScope(pathname + search + hash);
    if (next !== pathname + search + hash) window.history.replaceState(window.history.state, '', next);
  } catch {
    // No window (SSR/tests without a DOM): nothing to strip.
  }
}
