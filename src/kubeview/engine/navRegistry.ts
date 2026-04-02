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
  color?: string;
}

export const NAV_ITEMS: NavItem[] = [
  // Cluster
  { id: 'pulse', label: 'Cluster Pulse', icon: 'Activity', path: '/pulse', group: 'cluster', subtitle: 'Health overview, topology, insights', color: 'text-emerald-400' },
  { id: 'workloads', label: 'Workloads', icon: 'Package', path: '/workloads', group: 'cluster', subtitle: 'Pods, deployments, statefulsets, jobs, builds', color: 'text-blue-400' },
  { id: 'networking', label: 'Networking', icon: 'Globe', path: '/networking', group: 'cluster', subtitle: 'Services, ingresses, routes, network policies', color: 'text-cyan-400' },
  { id: 'compute', label: 'Compute', icon: 'Server', path: '/compute', group: 'cluster', subtitle: 'Nodes, machines, machine sets, autoscaling', color: 'text-blue-400' },
  { id: 'storage', label: 'Storage', icon: 'HardDrive', path: '/storage', group: 'cluster', subtitle: 'PVCs, storage classes, CSI drivers', color: 'text-orange-400' },

  // Operations
  { id: 'incidents', label: 'Incident Center', icon: 'Bell', path: '/incidents', group: 'operations', subtitle: 'Real-time incidents, correlation, auto-remediation', color: 'text-red-400' },
  { id: 'security', label: 'Security', icon: 'ShieldCheck', path: '/security', group: 'operations', subtitle: 'Pod security, RBAC analysis, image scanning', color: 'text-red-400' },
  { id: 'gitops', label: 'GitOps', icon: 'GitBranch', path: '/gitops', group: 'operations', subtitle: 'ArgoCD applications, sync status, rollouts', color: 'text-green-400' },
  { id: 'fleet', label: 'Fleet', icon: 'Layers', path: '/fleet', group: 'operations', subtitle: 'Multi-cluster management, compare, drift detection', color: 'text-indigo-400' },

  // Administration
  { id: 'admin', label: 'Administration', icon: 'Settings', path: '/admin', group: 'administration', subtitle: 'Operators, config, updates, snapshots, quotas, certificates', color: 'text-slate-400' },
  { id: 'identity', label: 'Identity & Access', icon: 'Shield', path: '/identity', group: 'administration', subtitle: 'Users, groups, RBAC, impersonation', color: 'text-teal-400' },
  { id: 'readiness', label: 'Production Readiness', icon: 'Rocket', path: '/readiness', group: 'administration', subtitle: 'Readiness wizard — security, reliability, observability gates', color: 'text-amber-400' },

  // Agent
  { id: 'agent', label: 'Agent Settings', icon: 'Bot', path: '/agent', group: 'agent', subtitle: 'Trust level, monitoring, memory, views management', color: 'text-violet-400' },
];

/** Group label for each nav group */
export const NAV_GROUP_LABELS: Record<NavItem['group'], string> = {
  cluster: 'CLUSTER',
  operations: 'OPERATIONS',
  administration: 'ADMINISTRATION',
  agent: 'AGENT',
};

/** Get nav items for a specific group */
export function getNavGroup(group: NavItem['group']): NavItem[] {
  return NAV_ITEMS.filter((item) => item.group === group);
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
