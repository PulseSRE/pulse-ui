import { useUIStore } from '../store/uiStore';
import { getClusterBase } from './clusterConnection';

export interface ClusterSnapshot {
  id: string;
  label: string;
  timestamp: string;
  clusterId?: string;
  clusterVersion: string;
  platform: string;
  controlPlaneTopology: string;
  nodes: { count: number; versions: string[] };
  clusterOperators: Array<{ name: string; version: string; available: boolean; degraded: boolean }>;
  crds: string[];
  storageClasses: string[];
  namespaceCount: number;
  rbac?: {
    clusterAdminSubjects: string[];
    clusterRoleBindingCount: number;
    roleBindingCount: number;
  };
  config?: {
    identityProviders: string[];
    tlsProfile: string;
    proxyEnabled: boolean;
    encryptionType: string;
    schedulerProfile: string;
    ingressDomain: string;
  };
  /**
   * Sources that could not be read (403, 5xx, network). A field built from an
   * unavailable source is unknown, not '' / 0 / a default, and is never
   * counted as matching.
   */
  unavailable?: SnapshotSource[];
}

export type SnapshotSource =
  | 'clusterVersion' | 'infrastructure' | 'nodes' | 'clusterOperators' | 'crds' | 'storageClasses'
  | 'namespaces' | 'clusterRoleBindings' | 'roleBindings' | 'oauth' | 'apiServer' | 'ingress' | 'scheduler' | 'proxy';

/** OpenShift's scheduler profile when `spec.profile` is unset. */
export const DEFAULT_SCHEDULER_PROFILE = 'LowNodeUtilization';

export interface DiffRow {
  field: string;
  category: string;
  left: string;
  right: string;
  changed: boolean;
  /** One side could not be read, so this row is neither a match nor a difference. */
  unavailable?: boolean;
}

const SNAPSHOTS_KEY = 'openshiftpulse-snapshots';
const MAX_SNAPSHOTS = 10;

export function loadSnapshots(): ClusterSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
  } catch { return []; }
}

export function saveSnapshots(snapshots: ClusterSnapshot[]) {
  const trimmed = snapshots.slice(-MAX_SNAPSHOTS);
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(trimmed));
  } catch {
    const reduced = trimmed.slice(-5);
    try { localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(reduced)); } catch (err) { console.warn('Failed to save snapshot to localStorage:', err); }
  }
}

/**
 * Fetch one source. A 404 is an answer (the resource is not there: null); any
 * other failure records the source as unavailable.
 */
async function fetchJson<T>(path: string, base: string, source: SnapshotSource, unavailable: Set<SnapshotSource>): Promise<T | null> {
  try {
    const { impersonateUser, impersonateGroups } = useUIStore.getState();
    const headers: Record<string, string> = {};
    if (impersonateUser) {
      headers['Impersonate-User'] = impersonateUser.replace(/[\r\n]/g, '');
      if (impersonateGroups.length > 0) {
        headers['Impersonate-Group'] = impersonateGroups.map(g => g.replace(/[\r\n]/g, '')).join(',');
      }
    }
    const res = await fetch(`${base}${path}`, { headers });
    if (!res.ok) {
      if (res.status !== 404) unavailable.add(source);
      return null;
    }
    return await res.json();
  } catch {
    unavailable.add(source);
    return null;
  }
}

export async function captureSnapshot(label: string, clusterId?: string): Promise<ClusterSnapshot> {
  const base = getClusterBase(clusterId);
  const snapshot: ClusterSnapshot = {
    id: `snap-${Date.now()}`,
    label,
    timestamp: new Date().toISOString(),
    clusterId,
    clusterVersion: '',
    platform: '',
    controlPlaneTopology: '',
    nodes: { count: 0, versions: [] },
    clusterOperators: [],
    crds: [],
    storageClasses: [],
    namespaceCount: 0,
  };

  const unavailable = new Set<SnapshotSource>();
  const get = <T,>(path: string, source: SnapshotSource) => fetchJson<T>(path, base, source, unavailable);
  const [cv, infra, nodesData, coData, crdData, scData, nsData, crbData, rbData, oauthData, apiServerData, ingressData, schedulerData, proxyData] = await Promise.all([
    get<any>('/apis/config.openshift.io/v1/clusterversions/version', 'clusterVersion'),
    get<any>('/apis/config.openshift.io/v1/infrastructures/cluster', 'infrastructure'),
    get<any>('/api/v1/nodes', 'nodes'),
    get<any>('/apis/config.openshift.io/v1/clusteroperators', 'clusterOperators'),
    get<any>('/apis/apiextensions.k8s.io/v1/customresourcedefinitions', 'crds'),
    get<any>('/apis/storage.k8s.io/v1/storageclasses', 'storageClasses'),
    get<any>('/api/v1/namespaces', 'namespaces'),
    get<any>('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings', 'clusterRoleBindings'),
    get<any>('/apis/rbac.authorization.k8s.io/v1/rolebindings', 'roleBindings'),
    get<any>('/apis/config.openshift.io/v1/oauths/cluster', 'oauth'),
    get<any>('/apis/config.openshift.io/v1/apiservers/cluster', 'apiServer'),
    get<any>('/apis/config.openshift.io/v1/ingresses/cluster', 'ingress'),
    get<any>('/apis/config.openshift.io/v1/schedulers/cluster', 'scheduler'),
    get<any>('/apis/config.openshift.io/v1/proxies/cluster', 'proxy'),
  ]);

  if (cv) snapshot.clusterVersion = cv.status?.desired?.version || cv.status?.history?.[0]?.version || '';
  if (infra) {
    snapshot.platform = infra.status?.platform || infra.status?.platformStatus?.type || '';
    snapshot.controlPlaneTopology = infra.status?.controlPlaneTopology || '';
  }
  if (nodesData?.items) {
    snapshot.nodes.count = nodesData.items.length;
    const versions = new Set<string>();
    for (const n of nodesData.items) versions.add(n.status?.nodeInfo?.kubeletVersion || '');
    snapshot.nodes.versions = [...versions].filter(Boolean).sort();
  }
  if (coData?.items) {
    snapshot.clusterOperators = coData.items.map((co: any) => ({
      name: co.metadata.name,
      version: co.status?.versions?.find((v: any) => v.name === 'operator')?.version || '',
      available: co.status?.conditions?.find((c: any) => c.type === 'Available')?.status === 'True',
      degraded: co.status?.conditions?.find((c: any) => c.type === 'Degraded')?.status === 'True',
    }));
  }
  if (crdData?.items) snapshot.crds = crdData.items.map((c: any) => c.metadata.name).sort();
  if (scData?.items) snapshot.storageClasses = scData.items.map((s: any) => s.metadata.name).sort();
  if (nsData?.items) snapshot.namespaceCount = nsData.items.length;

  if (crbData?.items || rbData?.items) {
    const clusterAdminSubjects: string[] = [];
    for (const crb of crbData?.items || []) {
      if (crb.roleRef?.name !== 'cluster-admin') continue;
      for (const s of crb.subjects || []) {
        clusterAdminSubjects.push(`${s.kind}/${s.name}`);
      }
    }
    snapshot.rbac = {
      clusterAdminSubjects: clusterAdminSubjects.sort(),
      clusterRoleBindingCount: crbData?.items?.length || 0,
      roleBindingCount: rbData?.items?.length || 0,
    };
  }

  snapshot.config = {
    identityProviders: (oauthData?.spec?.identityProviders || []).map((idp: any) => `${idp.name} (${idp.type})`),
    // Unset fields mean the platform default, but only when the read worked.
    tlsProfile: apiServerData?.spec?.tlsSecurityProfile?.type || 'Intermediate',
    proxyEnabled: !!(proxyData?.spec?.httpProxy || proxyData?.spec?.httpsProxy),
    encryptionType: apiServerData?.spec?.encryption?.type || 'identity',
    schedulerProfile: schedulerData?.spec?.profile || DEFAULT_SCHEDULER_PROFILE,
    ingressDomain: ingressData?.spec?.domain || '',
  };
  if (unavailable.size > 0) snapshot.unavailable = [...unavailable].sort();

  return snapshot;
}

/** Which sources each diff field is built from. */
const FIELD_SOURCES: Record<string, SnapshotSource[]> = {
  'Cluster Version': ['clusterVersion'],
  'Platform': ['infrastructure'],
  'Control Plane Topology': ['infrastructure'],
  'Node Count': ['nodes'],
  'Kubelet Versions': ['nodes'],
  'Namespace Count': ['namespaces'],
  'CRD Count': ['crds'],
  'CRDs Added': ['crds'],
  'CRDs Removed': ['crds'],
  'Storage Classes': ['storageClasses'],
  'ClusterRoleBindings': ['clusterRoleBindings'],
  'RoleBindings': ['roleBindings'],
  'Cluster-Admin Added': ['clusterRoleBindings'],
  'Cluster-Admin Removed': ['clusterRoleBindings'],
  'Identity Providers': ['oauth'],
  'TLS Profile': ['apiServer'],
  'Proxy': ['proxy'],
  'Encryption': ['apiServer'],
  'Scheduler Profile': ['scheduler'],
  'Ingress Domain': ['ingress'],
};

function sourcesFor(field: string): SnapshotSource[] {
  if (field.startsWith('Operator: ')) return ['clusterOperators'];
  return FIELD_SOURCES[field] ?? [];
}

export function compareSnapshots(left: ClusterSnapshot, right: ClusterSnapshot): DiffRow[] {
  const rows = compareSnapshotFields(left, right);
  const lu = new Set(left.unavailable ?? []);
  const ru = new Set(right.unavailable ?? []);
  if (lu.size === 0 && ru.size === 0) return rows;
  const out: DiffRow[] = [];
  for (const row of rows) {
    const srcs = sourcesFor(row.field);
    const lBad = srcs.some((x) => lu.has(x));
    const rBad = srcs.some((x) => ru.has(x));
    if (!lBad && !rBad) { out.push(row); continue; }
    // Set-difference rows (added/removed) mean nothing when a side is unread.
    if (/ (Added|Removed)$/.test(row.field) || row.field.startsWith('Operator: ')) continue;
    out.push({ ...row, left: lBad ? 'unavailable' : row.left, right: rBad ? 'unavailable' : row.right, changed: false, unavailable: true });
  }
  return out;
}

function compareSnapshotFields(left: ClusterSnapshot, right: ClusterSnapshot): DiffRow[] {
  const rows: DiffRow[] = [];
  rows.push({ field: 'Cluster Version', category: 'Cluster', left: left.clusterVersion, right: right.clusterVersion, changed: left.clusterVersion !== right.clusterVersion });
  rows.push({ field: 'Platform', category: 'Cluster', left: left.platform, right: right.platform, changed: left.platform !== right.platform });
  rows.push({ field: 'Control Plane Topology', category: 'Cluster', left: left.controlPlaneTopology || '—', right: right.controlPlaneTopology || '—', changed: (left.controlPlaneTopology || '') !== (right.controlPlaneTopology || '') });
  rows.push({ field: 'Node Count', category: 'Nodes', left: String(left.nodes.count), right: String(right.nodes.count), changed: left.nodes.count !== right.nodes.count });
  rows.push({ field: 'Kubelet Versions', category: 'Nodes', left: left.nodes.versions.join(', '), right: right.nodes.versions.join(', '), changed: left.nodes.versions.join(',') !== right.nodes.versions.join(',') });
  rows.push({ field: 'Namespace Count', category: 'Cluster', left: String(left.namespaceCount), right: String(right.namespaceCount), changed: left.namespaceCount !== right.namespaceCount });
  rows.push({ field: 'CRD Count', category: 'APIs', left: String(left.crds.length), right: String(right.crds.length), changed: left.crds.length !== right.crds.length });
  rows.push({ field: 'Storage Classes', category: 'Storage', left: left.storageClasses.join(', '), right: right.storageClasses.join(', '), changed: left.storageClasses.join(',') !== right.storageClasses.join(',') });

  const leftCrds = new Set(left.crds);
  const rightCrds = new Set(right.crds);
  const addedCrds = right.crds.filter(c => !leftCrds.has(c));
  const removedCrds = left.crds.filter(c => !rightCrds.has(c));
  if (addedCrds.length > 0) rows.push({ field: 'CRDs Added', category: 'APIs', left: '', right: addedCrds.join(', '), changed: true });
  if (removedCrds.length > 0) rows.push({ field: 'CRDs Removed', category: 'APIs', left: removedCrds.join(', '), right: '', changed: true });

  const leftOps = new Map(left.clusterOperators.map(o => [o.name, o]));
  const rightOps = new Map(right.clusterOperators.map(o => [o.name, o]));
  for (const [name, rOp] of rightOps) {
    const lOp = leftOps.get(name);
    if (!lOp) {
      rows.push({ field: `Operator: ${name}`, category: 'Operators', left: '(not present)', right: `v${rOp.version}`, changed: true });
    } else if (lOp.version !== rOp.version) {
      rows.push({ field: `Operator: ${name}`, category: 'Operators', left: `v${lOp.version}`, right: `v${rOp.version}`, changed: true });
    }
  }

  if (left.rbac && right.rbac) {
    rows.push({ field: 'ClusterRoleBindings', category: 'RBAC', left: String(left.rbac.clusterRoleBindingCount), right: String(right.rbac.clusterRoleBindingCount), changed: left.rbac.clusterRoleBindingCount !== right.rbac.clusterRoleBindingCount });
    rows.push({ field: 'RoleBindings', category: 'RBAC', left: String(left.rbac.roleBindingCount), right: String(right.rbac.roleBindingCount), changed: left.rbac.roleBindingCount !== right.rbac.roleBindingCount });

    const leftAdmins = new Set(left.rbac.clusterAdminSubjects);
    const rightAdmins = new Set(right.rbac.clusterAdminSubjects);
    const addedAdmins = right.rbac.clusterAdminSubjects.filter(a => !leftAdmins.has(a));
    const removedAdmins = left.rbac.clusterAdminSubjects.filter(a => !rightAdmins.has(a));
    if (addedAdmins.length > 0) rows.push({ field: 'Cluster-Admin Added', category: 'RBAC', left: '', right: addedAdmins.join(', '), changed: true });
    if (removedAdmins.length > 0) rows.push({ field: 'Cluster-Admin Removed', category: 'RBAC', left: removedAdmins.join(', '), right: '', changed: true });
  }

  if (left.config && right.config) {
    const lc = left.config, rc = right.config;
    rows.push({ field: 'Identity Providers', category: 'Config', left: lc.identityProviders.join(', ') || 'None', right: rc.identityProviders.join(', ') || 'None', changed: lc.identityProviders.join(',') !== rc.identityProviders.join(',') });
    rows.push({ field: 'TLS Profile', category: 'Config', left: lc.tlsProfile, right: rc.tlsProfile, changed: lc.tlsProfile !== rc.tlsProfile });
    rows.push({ field: 'Proxy', category: 'Config', left: lc.proxyEnabled ? 'Enabled' : 'Disabled', right: rc.proxyEnabled ? 'Enabled' : 'Disabled', changed: lc.proxyEnabled !== rc.proxyEnabled });
    rows.push({ field: 'Encryption', category: 'Config', left: lc.encryptionType, right: rc.encryptionType, changed: lc.encryptionType !== rc.encryptionType });
    rows.push({ field: 'Scheduler Profile', category: 'Config', left: lc.schedulerProfile, right: rc.schedulerProfile, changed: lc.schedulerProfile !== rc.schedulerProfile });
    rows.push({ field: 'Ingress Domain', category: 'Config', left: lc.ingressDomain, right: rc.ingressDomain, changed: lc.ingressDomain !== rc.ingressDomain });
  }

  return rows;
}
