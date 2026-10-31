/**
 * Route table — the single list of URL patterns the app serves.
 *
 * App.tsx, routes/resourceRoutes.tsx and routes/domainRoutes.tsx read their
 * `path` props from here, so a link checked with `isKnownRoute()` is checked
 * against the same patterns the router actually mounts. A route added to the
 * router without being added here fails `routeTable.test.ts`.
 *
 * Paths are relative to the Shell route (`/`), as React Router nests them.
 */
import { matchPath } from 'react-router-dom';

/** Top-level routes rendered outside the Shell. */
export const STANDALONE_ROUTES = {
  preview: '/preview',
} as const;

/** Routes mounted by App.tsx directly under the Shell. */
export const SHELL_ROUTES = {
  pulse: 'pulse',
  customView: 'custom/:viewId',
  share: 'share/:shareToken',
} as const;

/** Routes mounted by routes/resourceRoutes.tsx. */
export const RESOURCE_ROUTES = {
  list: 'r/:gvr',
  detail: 'r/:gvr/:namespace/:name',
  // `_` marks a cluster-scoped object; the static segment outranks
  // `:namespace`, so the page receives no namespace.
  detailClusterScoped: 'r/:gvr/_/:name',
  yaml: 'yaml/:gvr/:namespace/:name',
  yamlClusterScoped: 'yaml/:gvr/_/:name',
  logs: 'logs/:namespace/:name',
  nodeLogs: 'node-logs/:name',
  metrics: 'metrics/:gvr/:namespace/:name',
  metricsClusterScoped: 'metrics/:gvr/_/:name',
  create: 'create/:gvr',
  deps: 'deps/:gvr/:namespace/:name',
} as const;

/** Routes mounted by routes/domainRoutes.tsx. */
export const DOMAIN_ROUTES = {
  workloads: 'workloads',
  networking: 'networking',
  compute: 'compute',
  storage: 'storage',
  security: 'security',
  identity: 'identity',
  admin: 'admin',
  alerts: 'alerts',
  gitops: 'gitops',
  fleet: 'fleet',
  fleetCompare: 'fleet/compare',
  fleetCompliance: 'fleet/compliance',
  fleetWorkloads: 'fleet/workloads',
  fleetAlerts: 'fleet/alerts',
  fleetResource: 'fleet/r/:gvr',
  fleetDrift: 'fleet/drift',
  inbox: 'inbox',
  readiness: 'readiness',
  about: 'about',
  views: 'views',
  agent: 'agent',
  slo: 'slo',
  topology: 'topology',
  operators: 'operators',
  project: 'project/:namespace',
  timeline: 'timeline',
} as const;

/** Every mounted pattern, as an absolute path. `/` (index → /pulse) is included. */
export const ROUTE_PATTERNS: readonly string[] = [
  '/',
  ...Object.values(STANDALONE_ROUTES),
  ...[...Object.values(SHELL_ROUTES), ...Object.values(RESOURCE_ROUTES), ...Object.values(DOMAIN_ROUTES)]
    .map((p) => `/${p}`),
];

/**
 * A GVR URL segment: `v1~pods` (core) or `group~version~plural`.
 * Versions look like v1, v2, v1beta1, v1alpha1.
 */
const VERSION = 'v\\d+(?:(?:alpha|beta)\\d+)?';
const PLURAL = '[a-z][a-z0-9-]*';
const GROUP = '[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*';
const GVR_RE = new RegExp(`^(?:${VERSION}~${PLURAL}|${GROUP}~${VERSION}~${PLURAL})$`);

/** DNS-1123 label (namespace) or `_` for cluster-scoped objects. */
const NAMESPACE_RE = /^(_|[a-z0-9]([a-z0-9-]*[a-z0-9])?)$/;

export function isValidGvrSegment(gvr: string): boolean {
  return GVR_RE.test(gvr);
}

/** Strip query string and hash from a path. */
export function pathOnly(pathWithQuery: string): string {
  const cut = pathWithQuery.search(/[?#]/);
  return cut === -1 ? pathWithQuery : pathWithQuery.slice(0, cut);
}

/**
 * True when the router mounts a page for this path. Query string and hash are
 * ignored; `/r/:gvr`-style segments must be well-formed (`group~version~plural`
 * or `v1~plural`), and a namespace segment must be a DNS label or `_`.
 * External URLs (`http://…`, `//host`) are not routes and return false.
 */
export function isKnownRoute(pathWithQuery: string): boolean {
  if (typeof pathWithQuery !== 'string') return false;
  let path = pathOnly(pathWithQuery.trim());
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  // Empty segments (`/r/v1~nodes//name`) never match a route.
  if (path.includes('//')) return false;

  for (const pattern of ROUTE_PATTERNS) {
    const match = matchPath({ path: pattern, end: true, caseSensitive: true }, path);
    if (!match) continue;
    const { gvr, namespace, name } = match.params;
    if (gvr !== undefined && !isValidGvrSegment(gvr)) continue;
    if (namespace !== undefined && !NAMESPACE_RE.test(namespace)) continue;
    if (name !== undefined && name.length === 0) continue;
    return true;
  }
  return false;
}

/** True for an absolute http(s) URL. */
export function isExternalUrl(link: string): boolean {
  return /^https?:\/\//i.test(link.trim());
}
