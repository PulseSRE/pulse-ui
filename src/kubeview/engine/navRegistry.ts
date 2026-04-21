/**
 * Canonical registry of all navigable views.
 * CommandPalette, ResourceBrowser, WelcomeView, and TabBar all derive from this.
 */

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  path: string;
  group: 'cluster' | 'operations' | 'administration' | 'agent';
  subtitle?: string;
  keywords?: string[];
  color?: string;
}

export const GROUP_LABELS: Record<NavItem['group'], string> = {
  cluster: 'CLUSTER',
  operations: 'OPERATIONS',
  administration: 'ADMINISTRATION',
  agent: 'AGENT',
};

export const GROUP_ORDER: NavItem['group'][] = ['cluster', 'operations', 'administration', 'agent'];

export const NAV_ITEMS: NavItem[] = [
  // Cluster
  { id: 'pulse', label: 'Cluster Pulse', icon: 'Activity', path: '/pulse', group: 'cluster', subtitle: 'Cluster health verdict and attention items', keywords: ['health', 'overview', 'pulse', 'dashboard', 'status'], color: 'text-emerald-400' },
  { id: 'workloads', label: 'Workloads', icon: 'Package', path: '/workloads', group: 'cluster', subtitle: 'Pods, deployments, statefulsets, jobs, builds', keywords: ['pods', 'deployments', 'statefulsets', 'daemonsets', 'jobs', 'builds', 'replicasets'], color: 'text-blue-400' },
  { id: 'networking', label: 'Networking', icon: 'Globe', path: '/networking', group: 'cluster', subtitle: 'Services, ingresses, routes, network policies', keywords: ['services', 'routes', 'ingresses', 'network', 'dns', 'endpoints'], color: 'text-cyan-400' },
  { id: 'compute', label: 'Compute', icon: 'Server', path: '/compute', group: 'cluster', subtitle: 'Nodes, machines, machine sets, autoscaling', keywords: ['nodes', 'machines', 'capacity', 'autoscaling', 'cluster'], color: 'text-blue-400' },
  { id: 'storage', label: 'Storage', icon: 'HardDrive', path: '/storage', group: 'cluster', subtitle: 'PVCs, storage classes, CSI drivers', keywords: ['pvs', 'pvcs', 'storageclasses', 'csi', 'persistent', 'volumes'], color: 'text-orange-400' },

  // Operations
  { id: 'inbox', label: 'Inbox', icon: 'Inbox', path: '/inbox', group: 'operations', subtitle: 'Unified SRE worklist — findings, tasks, alerts, assessments', keywords: ['inbox', 'incidents', 'tasks', 'alerts', 'findings', 'queue', 'triage'], color: 'text-violet-400' },
  { id: 'topology', label: 'Impact Analysis', icon: 'Network', path: '/topology', group: 'operations', subtitle: 'Dependency graph and blast radius', keywords: ['topology', 'graph', 'dependencies', 'blast', 'radius', 'impact'], color: 'text-cyan-400' },
  { id: 'security', label: 'Security', icon: 'ShieldCheck', path: '/security', group: 'operations', subtitle: 'Pod security, RBAC analysis, image scanning', keywords: ['security', 'audit', 'sccs', 'rbac', 'network', 'policies', 'access', 'scanning'], color: 'text-red-400' },
  { id: 'gitops', label: 'GitOps', icon: 'GitBranch', path: '/gitops', group: 'operations', subtitle: 'ArgoCD applications, sync status, rollouts', keywords: ['argocd', 'sync', 'drift', 'detection', 'rollouts', 'git'], color: 'text-green-400' },
  { id: 'fleet', label: 'Fleet', icon: 'Layers', path: '/fleet', group: 'operations', subtitle: 'Multi-cluster management, compare, drift detection', keywords: ['multi-cluster', 'fleet', 'comparison', 'health', 'scores'], color: 'text-indigo-400' },
  { id: 'slo', label: 'Service Levels', icon: 'Activity', path: '/slo', group: 'operations', subtitle: 'SLO burn rates and service health targets', keywords: ['slo', 'service level', 'burn rate', 'error budget', 'availability'], color: 'text-teal-400' },

  // Administration
  { id: 'admin', label: 'Administration', icon: 'Settings', path: '/admin', group: 'administration', subtitle: 'Operators, config, updates, snapshots, quotas, certificates', keywords: ['operators', 'config', 'updates', 'quotas', 'certificates', 'crds'], color: 'text-slate-400' },
  { id: 'identity', label: 'Identity & Access', icon: 'Shield', path: '/identity', group: 'administration', subtitle: 'Users, groups, RBAC, impersonation', keywords: ['users', 'groups', 'service', 'accounts', 'rbac', 'impersonation'], color: 'text-teal-400' },
  { id: 'readiness', label: 'Production Readiness', icon: 'Rocket', path: '/readiness', group: 'administration', subtitle: 'Readiness wizard — security, reliability, observability gates', keywords: ['readiness', 'wizard', 'reliability', 'observability', 'gates', 'production'], color: 'text-amber-400' },

  // Agent
  { id: 'agent', label: 'Pulse Agent', icon: 'Bot', path: '/agent', group: 'agent', subtitle: 'Configure, monitor, and understand the AI assistant', keywords: ['agent', 'ai', 'trust', 'skills', 'tools', 'analytics', 'memory', 'mcp'], color: 'text-violet-400' },
  { id: 'views', label: 'Custom Views', icon: 'LayoutDashboard', path: '/views', group: 'agent', subtitle: 'AI-generated dashboards — manage, share, version history', keywords: ['views', 'dashboards', 'custom', 'ai', 'generated', 'share'], color: 'text-emerald-400' },
];

/** @deprecated Use NAV_ITEMS directly */
export const ALL_NAV_ITEMS: NavItem[] = NAV_ITEMS;

/** Group NAV_ITEMS by their group field, in canonical order */
export function getNavItemsByGroup(items: NavItem[] = NAV_ITEMS): Array<{ group: NavItem['group']; label: string; items: NavItem[] }> {
  return GROUP_ORDER
    .map((g) => ({
      group: g,
      label: GROUP_LABELS[g],
      items: items.filter((item) => item.group === g),
    }))
    .filter((section) => section.items.length > 0);
}

/** Match a nav item against a search query (label, subtitle, keywords) */
export function matchesNavQuery(item: NavItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.label.toLowerCase().includes(q) ||
    (item.subtitle?.toLowerCase().includes(q) ?? false) ||
    (item.keywords?.some((k) => k.includes(q)) ?? false)
  );
}

/** Look up a nav item by path */
export function getNavByPath(path: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.path === path);
}

/** Route-to-icon lookup (used by TabBar for auto-created tabs) */
export function getRouteIcon(path: string): string {
  const nav = getNavByPath(path);
  if (nav) return nav.icon;
  if (path.startsWith('/custom/')) return 'LayoutDashboard';
  return '';
}

/** Route-to-color lookup (used by TabBar for colored tab icons) */
export function getRouteColor(path: string): string {
  const nav = getNavByPath(path);
  if (nav) return nav.color || '';
  if (path.startsWith('/custom/')) return 'text-violet-400';
  return '';
}
