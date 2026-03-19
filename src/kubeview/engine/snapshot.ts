import { useUIStore } from '../store/uiStore';
import { K8S_BASE as BASE } from './gvr';

export interface ClusterSnapshot {
  id: string;
  label: string;
  timestamp: string;
  clusterVersion: string;
  platform: string;
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
}

export interface DiffRow {
  field: string;
  category: string;
  left: string;
  right: string;
  changed: boolean;
}

const SNAPSHOTS_KEY = 'shiftops-snapshots';
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
    try { localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(reduced)); } catch {}
  }
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const { impersonateUser, impersonateGroups } = useUIStore.getState();
    const headers: Record<string, string> = {};
    if (impersonateUser) {
      headers['Impersonate-User'] = impersonateUser;
      impersonateGroups.forEach((g, i) => { headers[`Impersonate-Group${i > 0 ? `-${i}` : ''}`] = g; });
    }
    const res = await fetch(`${BASE}${path}`, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function captureSnapshot(label: string): Promise<ClusterSnapshot> {
  const snapshot: ClusterSnapshot = {
    id: `snap-${Date.now()}`,
    label,
    timestamp: new Date().toISOString(),
    clusterVersion: '',
    platform: '',
    nodes: { count: 0, versions: [] },
    clusterOperators: [],
    crds: [],
    storageClasses: [],
    namespaceCount: 0,
  };

  const [cv, infra, nodesData, coData, crdData, scData, nsData, crbData, rbData, oauthData, apiServerData, ingressData, schedulerData, proxyData] = await Promise.all([
    fetchJson<any>('/apis/config.openshift.io/v1/clusterversions/version'),
    fetchJson<any>('/apis/config.openshift.io/v1/infrastructures/cluster'),
    fetchJson<any>('/api/v1/nodes'),
    fetchJson<any>('/apis/config.openshift.io/v1/clusteroperators'),
    fetchJson<any>('/apis/apiextensions.k8s.io/v1/customresourcedefinitions'),
    fetchJson<any>('/apis/storage.k8s.io/v1/storageclasses'),
    fetchJson<any>('/api/v1/namespaces'),
    fetchJson<any>('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings'),
    fetchJson<any>('/apis/rbac.authorization.k8s.io/v1/rolebindings'),
    fetchJson<any>('/apis/config.openshift.io/v1/oauths/cluster'),
    fetchJson<any>('/apis/config.openshift.io/v1/apiservers/cluster'),
    fetchJson<any>('/apis/config.openshift.io/v1/ingresses/cluster'),
    fetchJson<any>('/apis/config.openshift.io/v1/schedulers/cluster'),
    fetchJson<any>('/apis/config.openshift.io/v1/proxies/cluster'),
  ]);

  if (cv) snapshot.clusterVersion = cv.status?.desired?.version || cv.status?.history?.[0]?.version || '';
  if (infra) snapshot.platform = infra.status?.platform || infra.status?.platformStatus?.type || '';
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
      const name = crb.metadata?.name || '';
      if (name.startsWith('system:') || name.startsWith('openshift-')) continue;
      for (const s of crb.subjects || []) {
        if (s.name?.startsWith('system:')) continue;
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
    tlsProfile: apiServerData?.spec?.tlsSecurityProfile?.type || 'Intermediate',
    proxyEnabled: !!(proxyData?.spec?.httpProxy || proxyData?.spec?.httpsProxy),
    encryptionType: apiServerData?.spec?.encryption?.type || 'identity',
    schedulerProfile: schedulerData?.spec?.profile || 'HighNodeUtilization',
    ingressDomain: ingressData?.spec?.domain || '',
  };

  return snapshot;
}

export function compareSnapshots(left: ClusterSnapshot, right: ClusterSnapshot): DiffRow[] {
  const rows: DiffRow[] = [];
  rows.push({ field: 'Cluster Version', category: 'Cluster', left: left.clusterVersion, right: right.clusterVersion, changed: left.clusterVersion !== right.clusterVersion });
  rows.push({ field: 'Platform', category: 'Cluster', left: left.platform, right: right.platform, changed: left.platform !== right.platform });
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
