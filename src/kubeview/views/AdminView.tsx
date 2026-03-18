import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings, Server, Puzzle, FileCode, Shield, Database, ArrowRight,
  CheckCircle, XCircle, RefreshCw, Download, Upload, GitCompare, Loader2, Minus,
  ArrowUpCircle, AlertTriangle, AlertCircle, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList, k8sGet, k8sPatch } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useUIStore } from '../store/uiStore';
import { K8S_BASE as BASE } from '../engine/gvr';
import ClusterConfig from '../components/ClusterConfig';
const TimelineViewLazy = React.lazy(() => import('./TimelineView'));
import ProductionReadiness from '../components/ProductionReadiness';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { Panel } from '../components/primitives/Panel';

type Tab = 'overview' | 'readiness' | 'operators' | 'config' | 'updates' | 'snapshots' | 'quotas' | 'timeline';

// --- Snapshot types & logic (merged from ConfigCompareView) ---

interface ClusterSnapshot {
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
  // RBAC state
  rbac?: {
    clusterAdminSubjects: string[];
    clusterRoleBindingCount: number;
    roleBindingCount: number;
  };
  // Cluster config state
  config?: {
    identityProviders: string[];
    tlsProfile: string;
    proxyEnabled: boolean;
    encryptionType: string;
    schedulerProfile: string;
    ingressDomain: string;
  };
}

interface DiffRow {
  field: string;
  category: string;
  left: string;
  right: string;
  changed: boolean;
}

const SNAPSHOTS_KEY = 'shiftops-snapshots';

function loadSnapshots(): ClusterSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
  } catch { return []; }
}

const MAX_SNAPSHOTS = 10;

function saveSnapshots(snapshots: ClusterSnapshot[]) {
  // Keep only the most recent snapshots to avoid filling localStorage
  const trimmed = snapshots.slice(-MAX_SNAPSHOTS);
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage quota exceeded — remove oldest and retry
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

async function captureSnapshot(label: string): Promise<ClusterSnapshot> {
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

  // RBAC state
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

  // Cluster config state
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

function compareSnapshots(left: ClusterSnapshot, right: ClusterSnapshot): DiffRow[] {
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

  // RBAC comparison
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

  // Config comparison
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

// --- Main component ---

export default function AdminView() {
  const searchParams = new URLSearchParams(window.location.search);
  const initialTab = (searchParams.get('tab') as Tab) || 'overview';
  const [activeTab, setActiveTabState] = React.useState<Tab>(initialTab);
  const setActiveTab = (tab: Tab) => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  };
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  // Cluster version
  const { data: clusterVersion } = useQuery({
    queryKey: ['admin', 'clusterversion'],
    queryFn: () => k8sGet<any>('/apis/config.openshift.io/v1/clusterversions/version').catch(() => null),
    staleTime: 60000,
  });

  // Infrastructure
  const { data: infra } = useQuery({
    queryKey: ['admin', 'infra'],
    queryFn: () => k8sGet<any>('/apis/config.openshift.io/v1/infrastructures/cluster').catch(() => null),
    staleTime: 60000,
  });

  const { data: nodes = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/nodes'],
    queryFn: () => k8sList('/api/v1/nodes'),
    refetchInterval: 30000,
  });

  const { data: operators = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/config.openshift.io/v1/clusteroperators'],
    queryFn: () => k8sList('/apis/config.openshift.io/v1/clusteroperators').catch(() => []),
    refetchInterval: 30000,
  });

  const { data: crds = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/apiextensions.k8s.io/v1/customresourcedefinitions'],
    queryFn: () => k8sList('/apis/apiextensions.k8s.io/v1/customresourcedefinitions'),
    staleTime: 60000,
  });

  const { data: quotas = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/resourcequotas'],
    queryFn: () => k8sList('/api/v1/resourcequotas'),
    staleTime: 60000,
  });

  const { data: limitRanges = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/limitranges'],
    queryFn: () => k8sList('/api/v1/limitranges'),
    staleTime: 60000,
  });

  const { data: oauthConfig } = useQuery({
    queryKey: ['admin', 'oauth'],
    queryFn: () => k8sGet<any>('/apis/config.openshift.io/v1/oauths/cluster').catch(() => null),
    staleTime: 120000,
  });

  // Computed
  const cvVersion = clusterVersion?.status?.desired?.version || clusterVersion?.status?.history?.[0]?.version || '';
  const cvChannel = clusterVersion?.spec?.channel || '';
  const platform = infra?.status?.platform || infra?.status?.platformStatus?.type || '';
  const apiUrl = infra?.status?.apiServerURL || '';
  const availableUpdates = clusterVersion?.status?.availableUpdates || [];
  const isUpdating = (clusterVersion?.status?.conditions || []).some((c: any) => c.type === 'Progressing' && c.status === 'True');

  const opDegraded = operators.filter((o: any) => o.status?.conditions?.find((c: any) => c.type === 'Degraded' && c.status === 'True')).length;
  const opProgressing = operators.filter((o: any) => o.status?.conditions?.find((c: any) => c.type === 'Progressing' && c.status === 'True')).length;

  const nodeRoles = React.useMemo(() => {
    const roles = new Map<string, number>();
    for (const n of nodes) {
      const labels = n.metadata.labels || {};
      for (const [k] of Object.entries(labels)) {
        if (k.startsWith('node-role.kubernetes.io/')) {
          roles.set(k.replace('node-role.kubernetes.io/', ''), (roles.get(k.replace('node-role.kubernetes.io/', '')) || 0) + 1);
        }
      }
    }
    return [...roles.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  const crdGroupCount = React.useMemo(() => {
    const groups = new Set<string>();
    for (const crd of crds) groups.add((crd.spec as any)?.group || 'unknown');
    return groups.size;
  }, [crds]);

  const identityProviders = React.useMemo(() => {
    return (oauthConfig?.spec?.identityProviders || []) as Array<{ name: string; type: string }>;
  }, [oauthConfig]);

  const go = useNavigateTab();

  // --- Confirm Dialog state ---
  const [confirmDialog, setConfirmDialog] = React.useState<{
    title: string; description: string; confirmLabel: string;
    variant: 'danger' | 'warning'; onConfirm: () => void;
  } | null>(null);

  // --- Updates ---
  const [updating, setUpdating] = React.useState(false);
  const [channelEdit, setChannelEdit] = React.useState('');
  const [showChannelEdit, setShowChannelEdit] = React.useState(false);

  const handleStartUpdate = (version: string) => {
    setConfirmDialog({
      title: `Start cluster update to ${version}?`,
      description: `This will rolling-restart all nodes in the cluster. The update process cannot be easily reversed. Make sure you have a recent etcd backup before proceeding.`,
      confirmLabel: 'Start Update',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmDialog(null);
        setUpdating(true);
        try {
          await k8sPatch('/apis/config.openshift.io/v1/clusterversions/version', {
            spec: { desiredUpdate: { version } },
          }, 'application/merge-patch+json');
          addToast({ type: 'success', title: 'Cluster update started', detail: `Updating to ${version}` });
          queryClient.invalidateQueries({ queryKey: ['admin', 'clusterversion'] });
        } catch (err) {
          addToast({ type: 'error', title: 'Update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
        }
        setUpdating(false);
      },
    });
  };

  const handleChangeChannel = async () => {
    if (!channelEdit) return;
    try {
      await k8sPatch('/apis/config.openshift.io/v1/clusterversions/version', {
        spec: { channel: channelEdit },
      }, 'application/merge-patch+json');
      addToast({ type: 'success', title: 'Channel updated', detail: channelEdit });
      setShowChannelEdit(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'clusterversion'] });
    } catch (err) {
      addToast({ type: 'error', title: 'Channel update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
  };

  // --- Snapshots ---
  const [savedSnapshots, setSavedSnapshots] = React.useState<ClusterSnapshot[]>(loadSnapshots);
  const [capturing, setCapturing] = React.useState(false);
  const [compareLeft, setCompareLeft] = React.useState<string>('');
  const [compareRight, setCompareRight] = React.useState<string>('');
  const [diff, setDiff] = React.useState<DiffRow[] | null>(null);
  const [showOnlyChanges, setShowOnlyChanges] = React.useState(true);

  const handleCapture = async () => {
    setCapturing(true);
    try {
      const label = `Snapshot ${savedSnapshots.length + 1}`;
      const snap = await captureSnapshot(label);
      const updated = [snap, ...savedSnapshots].slice(0, 20); // keep max 20
      setSavedSnapshots(updated);
      saveSnapshots(updated);
      addToast({ type: 'success', title: 'Snapshot captured', detail: `v${snap.clusterVersion} · ${snap.nodes.count} nodes · ${snap.crds.length} CRDs` });
    } catch (err) {
      addToast({ type: 'error', title: 'Capture failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setCapturing(false);
  };

  const handleDeleteSnapshot = (id: string) => {
    const snap = savedSnapshots.find(s => s.id === id);
    if (!snap) return;
    setConfirmDialog({
      title: `Delete snapshot "${snap.label}"?`,
      description: 'This snapshot will be permanently removed. This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => {
        setConfirmDialog(null);
        const updated = savedSnapshots.filter(s => s.id !== id);
        setSavedSnapshots(updated);
        saveSnapshots(updated);
        if (compareLeft === id) { setCompareLeft(''); setDiff(null); }
        if (compareRight === id) { setCompareRight(''); setDiff(null); }
        addToast({ type: 'success', title: 'Snapshot deleted', detail: snap.label });
      },
    });
  };

  const handleExportSnapshot = (snap: ClusterSnapshot) => {
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cluster-snapshot-${snap.timestamp.slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: 'Snapshot exported', detail: snap.label });
  };

  const handleImportSnapshot = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text());
        if (!raw.timestamp || !raw.nodes || !Array.isArray(raw.clusterOperators) || !Array.isArray(raw.crds)) {
          addToast({ type: 'error', title: 'Invalid snapshot format', detail: 'Missing required fields (timestamp, nodes, clusterOperators, crds)' });
          return;
        }
        const snap: ClusterSnapshot = {
          id: raw.id || `snap-${Date.now()}`,
          label: raw.label || file.name.replace('.json', ''),
          timestamp: raw.timestamp,
          clusterVersion: raw.clusterVersion || '',
          platform: raw.platform || '',
          nodes: { count: raw.nodes?.count || 0, versions: raw.nodes?.versions || [] },
          clusterOperators: raw.clusterOperators,
          crds: raw.crds,
          storageClasses: raw.storageClasses || [],
          namespaceCount: raw.namespaceCount || 0,
        };
        const updated = [snap, ...savedSnapshots].slice(0, 20);
        setSavedSnapshots(updated);
        saveSnapshots(updated);
        addToast({ type: 'success', title: 'Snapshot imported', detail: snap.label });
      } catch {
        addToast({ type: 'error', title: 'Invalid snapshot file', detail: 'Could not parse JSON' });
      }
    };
    input.click();
  };

  React.useEffect(() => {
    if (compareLeft && compareRight) {
      const l = savedSnapshots.find(s => s.id === compareLeft);
      const r = savedSnapshots.find(s => s.id === compareRight);
      if (l && r) setDiff(compareSnapshots(l, r));
    } else {
      setDiff(null);
    }
  }, [compareLeft, compareRight, savedSnapshots]);

  const changedCount = diff?.filter(r => r.changed).length ?? 0;
  const displayRows = diff && showOnlyChanges ? diff.filter(r => r.changed) : diff;

  // Operator stats
  const opDegradedCount = operators.filter((o: any) => o.status?.conditions?.find((c: any) => c.type === 'Degraded' && c.status === 'True')).length;

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <Settings className="w-3.5 h-3.5" /> },
    { id: 'readiness', label: 'Readiness', icon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'operators', label: `Operators (${operators.length})${opDegradedCount > 0 ? ` · ${opDegradedCount} degraded` : ''}`, icon: <Puzzle className="w-3.5 h-3.5" /> },
    { id: 'config', label: 'Cluster Config', icon: <Database className="w-3.5 h-3.5" /> },
    { id: 'updates', label: `Updates${availableUpdates.length > 0 ? ` (${availableUpdates.length})` : ''}`, icon: <ArrowUpCircle className="w-3.5 h-3.5" /> },
    { id: 'snapshots', label: `Snapshots (${savedSnapshots.length})`, icon: <GitCompare className="w-3.5 h-3.5" /> },
    { id: 'quotas', label: `Quotas (${quotas.length})`, icon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'timeline', label: 'Timeline', icon: <Clock className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Settings className="w-6 h-6 text-slate-400" />
            Administration
          </h1>
          <p className="text-sm text-slate-400 mt-1">Cluster configuration, updates, and snapshots</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap', activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* ===== OVERVIEW ===== */}
        {activeTab === 'overview' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <InfoCard label="Cluster Version" value={cvVersion || '—'} sub={cvChannel} />
              <InfoCard label="Platform" value={platform || '—'} sub={(() => { try { return apiUrl ? new URL(apiUrl).hostname : ''; } catch { return ''; } })()} />
              <InfoCard label="Nodes" value={String(nodes.length)} sub={nodeRoles.map(([r, c]) => `${c} ${r}`).join(', ')} />
              <button onClick={() => go('/crds', 'Custom Resources')} className="text-left">
                <InfoCard label="CRDs" value={String(crds.length)} sub={`${crdGroupCount} API groups →`} />
              </button>
            </div>

            {/* Update banner */}
            {availableUpdates.length > 0 && (
              <div className="bg-blue-950/30 border border-blue-800 rounded-lg px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ArrowUpCircle className="w-5 h-5 text-blue-400" />
                  <div>
                    <span className="text-sm font-medium text-blue-300">Cluster update available</span>
                    <span className="text-xs text-blue-400 ml-2">{availableUpdates[0]?.version}</span>
                  </div>
                </div>
                <button onClick={() => setActiveTab('updates')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                  View updates <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Panel title={`Operators (${operators.length})`} icon={<Puzzle className="w-4 h-4 text-violet-500" />}>
                <div className="flex items-center gap-4 mb-3">
                  <span className="flex items-center gap-1.5 text-sm"><CheckCircle className="w-3.5 h-3.5 text-green-500" /> {operators.length - opDegraded - opProgressing} healthy</span>
                  {opDegraded > 0 && <span className="flex items-center gap-1.5 text-sm text-red-400"><XCircle className="w-3.5 h-3.5" /> {opDegraded} degraded</span>}
                  {opProgressing > 0 && <span className="flex items-center gap-1.5 text-sm text-yellow-400"><RefreshCw className="w-3.5 h-3.5" /> {opProgressing} progressing</span>}
                </div>
                <button onClick={() => go('/r/config.openshift.io~v1~clusteroperators', 'ClusterOperators')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">View all operators <ArrowRight className="w-3 h-3" /></button>
              </Panel>

              <Panel title={`Nodes (${nodes.length})`} icon={<Server className="w-4 h-4 text-blue-500" />}>
                <div className="space-y-2 mb-3">
                  {nodeRoles.map(([role, count]) => (
                    <div key={role} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{role}</span>
                      <span className="text-sm font-mono text-slate-400">{count}</span>
                    </div>
                  ))}
                  {(() => {
                    const readyNodes = nodes.filter((n: any) => {
                      const conditions = (n.status?.conditions || []) as any[];
                      return conditions.some((c: any) => c.type === 'Ready' && c.status === 'True');
                    });
                    const unready = nodes.length - readyNodes.length;
                    return (
                      <div className="flex items-center gap-3 pt-1 border-t border-slate-800">
                        <span className="flex items-center gap-1.5 text-sm text-green-400"><CheckCircle className="w-3.5 h-3.5" /> {readyNodes.length} ready</span>
                        {unready > 0 && <span className="flex items-center gap-1.5 text-sm text-red-400"><XCircle className="w-3.5 h-3.5" /> {unready} not ready</span>}
                      </div>
                    );
                  })()}
                </div>
                <button onClick={() => go('/compute', 'Compute')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">Compute overview <ArrowRight className="w-3 h-3" /></button>
              </Panel>

              <Panel title="Identity Providers" icon={<Shield className="w-4 h-4 text-teal-500" />}>
                {identityProviders.length === 0 ? (
                  <div className="text-sm text-slate-500 py-2">No identity providers configured</div>
                ) : (
                  <div className="space-y-1">
                    {identityProviders.map((idp, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50">
                        <span className="text-sm text-slate-200">{idp.name}</span>
                        <span className="text-xs px-2 py-0.5 bg-slate-800 text-slate-400 rounded">{idp.type}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => setActiveTab('config')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-3">
                  Manage providers <ArrowRight className="w-3 h-3" />
                </button>
              </Panel>

              <Panel title="Quick Navigation" icon={<Database className="w-4 h-4 text-slate-400" />}>
                <div className="space-y-1.5">
                  {[
                    { icon: <Shield className="w-3.5 h-3.5" />, label: 'Access Control', desc: 'RBAC audit', path: '/access-control' },
                    { icon: <Server className="w-3.5 h-3.5" />, label: 'User Management', desc: 'Users, impersonation', path: '/users' },
                    { icon: <FileCode className="w-3.5 h-3.5" />, label: `${crds.length} CRDs`, desc: 'Custom resources & instances', path: '/crds' },
                    { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: 'Alerts', desc: 'Firing alerts, silences', path: '/alerts' },
                    { icon: <GitCompare className="w-3.5 h-3.5" />, label: 'Config Snapshots', desc: 'Capture & compare', onClick: () => setActiveTab('snapshots') },
                    { icon: <Puzzle className="w-3.5 h-3.5" />, label: 'Software', desc: 'Install & manage', path: '/create/v1~pods' },
                  ].map((item) => (
                    <button key={item.label} onClick={item.onClick || (() => go(item.path!, item.label))}
                      className="w-full text-left flex items-center gap-2.5 py-1.5 px-2 rounded hover:bg-slate-800/50 transition-colors">
                      {item.icon}
                      <div className="flex-1">
                        <span className="text-sm text-slate-300">{item.label}</span>
                        <span className="text-xs text-slate-600 ml-2">{item.desc}</span>
                      </div>
                      <ArrowRight className="w-3 h-3 text-slate-600" />
                    </button>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        )}

        {/* ===== READINESS ===== */}
        {activeTab === 'readiness' && <ProductionReadiness />}

        {/* ===== OPERATORS ===== */}
        {activeTab === 'operators' && (() => {
          const operatorList = operators.map((co: any) => {
            const conditions = co.status?.conditions || [];
            const available = conditions.find((c: any) => c.type === 'Available')?.status === 'True';
            const degraded = conditions.find((c: any) => c.type === 'Degraded')?.status === 'True';
            const progressing = conditions.find((c: any) => c.type === 'Progressing')?.status === 'True';
            const version = co.status?.versions?.find((v: any) => v.name === 'operator')?.version || '';
            const message = degraded ? conditions.find((c: any) => c.type === 'Degraded')?.message || '' : progressing ? conditions.find((c: any) => c.type === 'Progressing')?.message || '' : '';
            return { name: co.metadata.name, available, degraded, progressing, version, message };
          }).sort((a: any, b: any) => {
            if (a.degraded && !b.degraded) return -1;
            if (!a.degraded && b.degraded) return 1;
            if (a.progressing && !b.progressing) return -1;
            return a.name.localeCompare(b.name);
          });
          const degradedOps = operatorList.filter((o: any) => o.degraded);
          const progressingOps = operatorList.filter((o: any) => o.progressing);
          const availableOps = operatorList.filter((o: any) => o.available && !o.degraded);

          return (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
                  <div className="flex items-center gap-2 text-green-400 mb-1"><CheckCircle className="w-4 h-4" /><span className="text-xs">Available</span></div>
                  <div className="text-xl font-bold text-slate-100">{availableOps.length}</div>
                </div>
                <div className={cn('bg-slate-900 rounded-lg border p-3', degradedOps.length > 0 ? 'border-red-800' : 'border-slate-800')}>
                  <div className="flex items-center gap-2 text-red-400 mb-1"><XCircle className="w-4 h-4" /><span className="text-xs">Degraded</span></div>
                  <div className="text-xl font-bold text-slate-100">{degradedOps.length}</div>
                </div>
                <div className={cn('bg-slate-900 rounded-lg border p-3', progressingOps.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
                  <div className="flex items-center gap-2 text-yellow-400 mb-1"><RefreshCw className="w-4 h-4" /><span className="text-xs">Progressing</span></div>
                  <div className="text-xl font-bold text-slate-100">{progressingOps.length}</div>
                </div>
              </div>
              <div className="bg-slate-900 rounded-lg border border-slate-800">
                <div className="divide-y divide-slate-800">
                  {operatorList.map((op: any) => (
                    <div key={op.name} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 cursor-pointer transition-colors" onClick={() => go(`/r/config.openshift.io~v1~clusteroperators/_/${op.name}`, op.name)}>
                      {op.degraded ? <XCircle className="w-4 h-4 text-red-500 shrink-0" /> :
                       op.progressing ? <RefreshCw className="w-4 h-4 text-yellow-500 shrink-0 animate-spin" /> :
                       op.available ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0" /> :
                       <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-200">{op.name}</span>
                          {op.version && <span className="text-xs text-slate-500 font-mono">{op.version}</span>}
                        </div>
                        {op.message && <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{op.message}</div>}
                      </div>
                      <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ===== CLUSTER CONFIG ===== */}
        {activeTab === 'config' && <ClusterConfig />}

        {/* ===== UPDATES ===== */}
        {activeTab === 'updates' && (
          <div className="space-y-6">
            {/* ClusterVersion conditions */}
            {(() => {
              const conditions = (clusterVersion?.status?.conditions || []) as any[];
              const progressing = conditions.find((c: any) => c.type === 'Progressing');
              const available = conditions.find((c: any) => c.type === 'Available');
              const failing = conditions.find((c: any) => c.type === 'Failing');
              const isProgressing = progressing?.status === 'True';
              const isFailing = failing?.status === 'True';
              return (
                <>
                  {isFailing && (
                    <div className="flex items-start gap-3 px-4 py-3 bg-red-950/30 border border-red-900 rounded-lg">
                      <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-sm font-medium text-red-300">Update Failing</div>
                        <div className="text-xs text-slate-400 mt-0.5">{failing?.message}</div>
                      </div>
                    </div>
                  )}
                  {isProgressing && !isFailing && (
                    <div className="flex items-start gap-3 px-4 py-3 bg-blue-950/30 border border-blue-800 rounded-lg">
                      <RefreshCw className="w-5 h-5 text-blue-400 animate-spin shrink-0 mt-0.5" />
                      <div>
                        <div className="text-sm font-medium text-blue-300">Update in Progress</div>
                        <div className="text-xs text-slate-400 mt-0.5">{progressing?.message}</div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Current version + channel */}
            <Panel title="Current Version" icon={<Settings className="w-4 h-4 text-slate-400" />}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Version</span>
                  <span className="text-sm font-mono text-slate-200">{cvVersion || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Channel</span>
                  {showChannelEdit ? (
                    <div className="flex items-center gap-2">
                      <input type="text" value={channelEdit} onChange={(e) => setChannelEdit(e.target.value)} placeholder="e.g. stable-4.17" className="px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 w-48" autoFocus />
                      <button onClick={handleChangeChannel} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500">Save</button>
                      <button onClick={() => setShowChannelEdit(false)} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-slate-200">{cvChannel || '—'}</span>
                      <button onClick={() => { setChannelEdit(cvChannel); setShowChannelEdit(true); }} className="text-xs text-blue-400 hover:text-blue-300">Change</button>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Cluster ID</span>
                  <span className="text-xs font-mono text-slate-500">{clusterVersion?.spec?.clusterID || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Platform</span>
                  <span className="text-xs font-mono text-slate-500">{platform || '—'}</span>
                </div>
              </div>
            </Panel>

            {/* Pre-update checklist */}
            {availableUpdates.length > 0 && (
              <Panel title="Pre-Update Checklist" icon={<Shield className="w-4 h-4 text-amber-500" />}>
                <div className="space-y-2">
                  {(() => {
                    const readyNodes = nodes.filter((n: any) => {
                      const conds = (n.status?.conditions || []) as any[];
                      return conds.some((c: any) => c.type === 'Ready' && c.status === 'True');
                    });
                    const allNodesReady = readyNodes.length === nodes.length;
                    const degradedOps = operators.filter((o: any) => (o.status?.conditions || []).some((c: any) => c.type === 'Degraded' && c.status === 'True'));
                    const allOpsHealthy = degradedOps.length === 0;
                    const hasPDBs = limitRanges.length > 0 || quotas.length > 0; // proxy check
                    const channelStable = cvChannel?.includes('stable') || cvChannel?.includes('eus');

                    const checks = [
                      { label: 'All nodes ready', pass: allNodesReady, detail: allNodesReady ? `${nodes.length}/${nodes.length} ready` : `${readyNodes.length}/${nodes.length} ready — fix unready nodes first` },
                      { label: 'No degraded operators', pass: allOpsHealthy, detail: allOpsHealthy ? `${operators.length} operators healthy` : `${degradedOps.length} degraded: ${degradedOps.slice(0, 3).map((o: any) => o.metadata.name).join(', ')}` },
                      { label: 'Stable update channel', pass: channelStable, detail: channelStable ? `Channel: ${cvChannel}` : `Channel "${cvChannel}" — consider switching to stable for production` },
                      { label: 'Etcd backup recommended', pass: false, detail: 'Take an etcd backup before upgrading: ssh to control plane → /usr/local/bin/cluster-backup.sh /home/core/backup' },
                      { label: 'PodDisruptionBudgets in place', pass: true, detail: 'Verify critical workloads have PDBs to prevent downtime during node restarts' },
                    ];

                    return checks.map((check, i) => (
                      <div key={i} className="flex items-start gap-2 py-1.5 px-2">
                        {check.pass ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
                        <div>
                          <span className="text-sm text-slate-200">{check.label}</span>
                          <div className="text-xs text-slate-500 mt-0.5">{check.detail}</div>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </Panel>
            )}

            {/* Available updates */}
            <Panel title={`Available Updates (${availableUpdates.length})`} icon={<ArrowUpCircle className="w-4 h-4 text-blue-500" />}>
              {availableUpdates.length === 0 ? (
                <div className="text-center py-6">
                  <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">Cluster is up to date</p>
                  <p className="text-xs text-slate-500 mt-1">Channel: {cvChannel}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {availableUpdates.map((u: any, i: number) => {
                    const versionParts = u.version?.split('.') || [];
                    const currentParts = cvVersion?.split('.') || [];
                    const minorSkip = versionParts[1] && currentParts[1] ? parseInt(versionParts[1]) - parseInt(currentParts[1]) : 0;
                    return (
                      <div key={i} className="flex items-center justify-between p-3 rounded bg-slate-800/50 border border-slate-700">
                        <div>
                          <span className="text-sm font-medium text-slate-200">{u.version}</span>
                          {i === 0 && <span className="ml-2 text-xs px-1.5 py-0.5 bg-blue-900 text-blue-300 rounded">Recommended</span>}
                          {minorSkip > 1 && <span className="ml-2 text-xs px-1.5 py-0.5 bg-amber-900 text-amber-300 rounded">Skips {minorSkip - 1} minor</span>}
                          {u.risks && u.risks.length > 0 && <span className="ml-2 text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{u.risks.length} known risk{u.risks.length > 1 ? 's' : ''}</span>}
                        </div>
                        <button
                          onClick={() => handleStartUpdate(u.version)}
                          disabled={updating || isUpdating}
                          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {updating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpCircle className="w-3 h-3" />}
                          Update
                        </button>
                      </div>
                    );
                  })}
                  <div className="text-xs text-slate-500 pt-2">
                    <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-yellow-500" /> Estimated duration: ~{Math.max(30, nodes.length * 10)} minutes ({nodes.length} nodes × ~10min each)</span>
                  </div>
                </div>
              )}
            </Panel>

            {/* Operator update status (during upgrade) */}
            {isUpdating && (
              <Panel title="Operator Update Progress" icon={<Puzzle className="w-4 h-4 text-violet-500" />}>
                <div className="space-y-1 max-h-64 overflow-auto">
                  {(operators as any[]).map((op) => {
                    const conds = op.status?.conditions || [];
                    const progressing = conds.find((c: any) => c.type === 'Progressing');
                    const available = conds.find((c: any) => c.type === 'Available');
                    const degraded = conds.find((c: any) => c.type === 'Degraded');
                    const isProgressing = progressing?.status === 'True';
                    const isDegraded = degraded?.status === 'True';
                    const isAvailable = available?.status === 'True';
                    const version = op.status?.versions?.find((v: any) => v.name === 'operator')?.version || '';
                    return (
                      <div key={op.metadata.uid} className="flex items-center justify-between py-1.5 px-2 hover:bg-slate-800/30 rounded">
                        <div className="flex items-center gap-2">
                          {isDegraded ? <XCircle className="w-3.5 h-3.5 text-red-500" /> :
                           isProgressing ? <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" /> :
                           <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                          <span className="text-sm text-slate-200">{op.metadata.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {version && <span className="text-xs font-mono text-slate-500">{version}</span>}
                          <span className={cn('text-xs px-1.5 py-0.5 rounded',
                            isDegraded ? 'bg-red-900/50 text-red-300' :
                            isProgressing ? 'bg-blue-900/50 text-blue-300' :
                            'bg-green-900/50 text-green-300'
                          )}>
                            {isDegraded ? 'Degraded' : isProgressing ? 'Updating' : 'Ready'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Panel>
            )}

            {/* Update history */}
            <Panel title="Update History" icon={<RefreshCw className="w-4 h-4 text-blue-500" />}>
              <div className="space-y-1 max-h-64 overflow-auto">
                {(clusterVersion?.status?.history || []).slice(0, 10).map((h: any, i: number) => {
                  const startTime = h.startedTime ? new Date(h.startedTime) : null;
                  const endTime = h.completionTime ? new Date(h.completionTime) : null;
                  const duration = startTime && endTime ? Math.round((endTime.getTime() - startTime.getTime()) / 60000) : null;
                  return (
                    <div key={i} className="flex items-center justify-between py-2 px-2 hover:bg-slate-800/30 rounded">
                      <div className="flex items-center gap-2">
                        {h.state === 'Completed' ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> :
                         h.state === 'Partial' ? <RefreshCw className="w-3.5 h-3.5 text-yellow-500 animate-spin" /> :
                         <XCircle className="w-3.5 h-3.5 text-red-500" />}
                        <span className="text-sm text-slate-200 font-mono">{h.version}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        {duration && <span>{duration}min</span>}
                        <span className={cn(h.state === 'Completed' ? 'text-green-400' : h.state === 'Partial' ? 'text-yellow-400' : 'text-red-400')}>{h.state}</span>
                        {endTime && <span>{endTime.toLocaleDateString()}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>
        )}

        {/* ===== SNAPSHOTS ===== */}
        {activeTab === 'snapshots' && (
          <div className="space-y-6">
            {/* Actions */}
            <div className="flex items-center gap-3">
              <button onClick={handleCapture} disabled={capturing} className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50">
                {capturing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Capture Snapshot
              </button>
              <button onClick={handleImportSnapshot} className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded">
                <Upload className="w-3.5 h-3.5" /> Import
              </button>
            </div>

            {/* Saved snapshots */}
            {savedSnapshots.length === 0 ? (
              <div className="bg-slate-900 rounded-lg border border-slate-800 p-12 text-center">
                <GitCompare className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-300 mb-2">No Snapshots Yet</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  Capture a snapshot to record your cluster's current state. Take another after maintenance to see what changed.
                </p>
              </div>
            ) : (
              <Panel title={`Saved Snapshots (${savedSnapshots.length})`} icon={<Database className="w-4 h-4 text-slate-400" />}>
                <div className="space-y-2">
                  {savedSnapshots.map((snap) => (
                    <div key={snap.id} className="flex items-center gap-3 p-2 rounded hover:bg-slate-800/50">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-200 font-medium">{snap.label}</div>
                        <div className="text-xs text-slate-500">{new Date(snap.timestamp).toLocaleString()} · v{snap.clusterVersion} · {snap.nodes.count} nodes · {snap.crds.length} CRDs</div>
                      </div>
                      <select value={compareLeft === snap.id ? 'left' : compareRight === snap.id ? 'right' : ''} onChange={(e) => {
                        if (e.target.value === 'left') { setCompareLeft(snap.id); if (compareRight === snap.id) setCompareRight(''); }
                        else if (e.target.value === 'right') { setCompareRight(snap.id); if (compareLeft === snap.id) setCompareLeft(''); }
                        else { if (compareLeft === snap.id) setCompareLeft(''); if (compareRight === snap.id) setCompareRight(''); }
                      }} className="px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-300">
                        <option value="">—</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                      <button onClick={() => handleExportSnapshot(snap)} className="p-1 text-slate-500 hover:text-slate-300" title="Export"><Download className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDeleteSnapshot(snap.id)} className="p-1 text-slate-500 hover:text-red-400" title="Delete"><XCircle className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {/* Diff table */}
            {diff && (
              <div className="bg-slate-900 rounded-lg border border-slate-800">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-100">Comparison — {changedCount} change{changedCount !== 1 ? 's' : ''}</h2>
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={showOnlyChanges} onChange={(e) => setShowOnlyChanges(e.target.checked)} className="rounded" />
                    Show only changes
                  </label>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium w-10"></th>
                        <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Field</th>
                        <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Left</th>
                        <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Right</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {(displayRows || []).map((row, idx) => (
                        <tr key={idx} className={row.changed ? 'bg-yellow-950/20' : ''}>
                          <td className="px-4 py-2">
                            {row.changed ? (
                              row.left && !row.right ? <Minus className="w-3.5 h-3.5 text-red-400" /> :
                              !row.left && row.right ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> :
                              <GitCompare className="w-3.5 h-3.5 text-yellow-400" />
                            ) : <CheckCircle className="w-3.5 h-3.5 text-slate-600" />}
                          </td>
                          <td className="px-4 py-2 text-slate-300 font-medium"><span className="text-xs text-slate-500 mr-2">{row.category}</span>{row.field}</td>
                          <td className={cn('px-4 py-2 font-mono text-xs', row.changed ? 'text-red-300' : 'text-slate-400')}>{row.left || '—'}</td>
                          <td className={cn('px-4 py-2 font-mono text-xs', row.changed ? 'text-green-300' : 'text-slate-400')}>{row.right || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== QUOTAS ===== */}
        {activeTab === 'quotas' && <QuotasTab quotas={quotas as any[]} limitRanges={limitRanges as any[]} go={go} />}

        {activeTab === 'timeline' && (
          <React.Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-blue-400 animate-spin" /></div>}>
            <TimelineViewLazy />
          </React.Suspense>
        )}
      </div>
      {confirmDialog && (
        <ConfirmDialog
          open={true}
          onClose={() => setConfirmDialog(null)}
          onConfirm={confirmDialog.onConfirm}
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          variant={confirmDialog.variant}
        />
      )}
    </div>
  );
}

function parseResourceValue(val: string): number {
  if (!val) return 0;
  const num = parseFloat(val);
  if (val.endsWith('Ki')) return num * 1024;
  if (val.endsWith('Mi')) return num * 1024 * 1024;
  if (val.endsWith('Gi')) return num * 1024 * 1024 * 1024;
  if (val.endsWith('Ti')) return num * 1024 * 1024 * 1024 * 1024;
  if (val.endsWith('m')) return num / 1000;
  if (val.endsWith('k')) return num * 1000;
  if (val.endsWith('M')) return num * 1000000;
  if (val.endsWith('G')) return num * 1000000000;
  return num;
}

function formatResourceValue(val: string, resource: string): string {
  if (!val) return '—';
  if (resource.includes('memory') || resource.includes('storage') || resource.includes('ephemeral')) {
    const bytes = parseResourceValue(val);
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Gi`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} Mi`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} Ki`;
    return val;
  }
  return val;
}

function QuotasTab({ quotas, limitRanges, go }: { quotas: any[]; limitRanges: any[]; go: (path: string, title: string) => void }) {
  const { data: namespaces = [] } = useQuery<any[]>({
    queryKey: ['k8s', 'list', '/api/v1/namespaces'],
    queryFn: () => k8sList('/api/v1/namespaces'),
    staleTime: 60000,
  });

  const userNamespaces = React.useMemo(() =>
    namespaces.filter((ns: any) => {
      const name = ns.metadata?.name || '';
      return !name.startsWith('openshift-') && !name.startsWith('kube-') && name !== 'default' && name !== 'openshift';
    }),
  [namespaces]);

  const quotaNamespaces = new Set(quotas.map((q: any) => q.metadata?.namespace));
  const lrNamespaces = new Set(limitRanges.map((lr: any) => lr.metadata?.namespace));
  const unprotectedNs = userNamespaces.filter((ns: any) => !quotaNamespaces.has(ns.metadata?.name) && !lrNamespaces.has(ns.metadata?.name));

  // Aggregate usage across all quotas
  const totalResources = React.useMemo(() => {
    const agg: Record<string, { hard: number; used: number; display: string }> = {};
    for (const q of quotas) {
      const hard = q.spec?.hard || {};
      const used = q.status?.used || {};
      for (const [key, hardVal] of Object.entries(hard)) {
        if (!agg[key]) agg[key] = { hard: 0, used: 0, display: key };
        agg[key].hard += parseResourceValue(hardVal as string);
        agg[key].used += parseResourceValue((used[key] || '0') as string);
      }
    }
    return agg;
  }, [quotas]);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1">Resource Quotas</div>
          <div className="text-xl font-bold text-slate-100">{quotas.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">{quotaNamespaces.size} namespace{quotaNamespaces.size !== 1 ? 's' : ''}</div>
        </div>
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1">Limit Ranges</div>
          <div className="text-xl font-bold text-slate-100">{limitRanges.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">{lrNamespaces.size} namespace{lrNamespaces.size !== 1 ? 's' : ''}</div>
        </div>
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1">User Namespaces</div>
          <div className="text-xl font-bold text-slate-100">{userNamespaces.length}</div>
        </div>
        <div className={cn('bg-slate-900 rounded-lg border p-3', unprotectedNs.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Unprotected</span>
            {unprotectedNs.length > 0 && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />}
          </div>
          <div className={cn('text-xl font-bold', unprotectedNs.length > 0 ? 'text-yellow-400' : 'text-green-400')}>{unprotectedNs.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">no quota or limit range</div>
        </div>
      </div>

      {/* Cluster-wide resource usage */}
      {Object.keys(totalResources).length > 0 && (
        <Panel title="Cluster Quota Usage" icon={<Database className="w-4 h-4 text-blue-400" />}>
          <div className="space-y-3">
            {Object.entries(totalResources).sort(([a], [b]) => a.localeCompare(b)).map(([key, { hard, used }]) => {
              const pct = hard > 0 ? Math.min(100, (used / hard) * 100) : 0;
              const isMemory = key.includes('memory') || key.includes('storage') || key.includes('ephemeral');
              const formatVal = (v: number) => {
                if (isMemory) {
                  if (v >= 1024 * 1024 * 1024) return `${(v / (1024 * 1024 * 1024)).toFixed(1)}Gi`;
                  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(0)}Mi`;
                  return `${v}`;
                }
                if (v >= 1000) return `${(v / 1000).toFixed(1)}`;
                if (v < 1 && v > 0) return `${(v * 1000).toFixed(0)}m`;
                return `${v}`;
              };
              const barColor = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-blue-500';
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-slate-300">{key}</span>
                    <span className="text-xs text-slate-400 font-mono">{formatVal(used)} / {formatVal(hard)} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Per-namespace quota details */}
      <Panel title={`Resource Quotas (${quotas.length})`} icon={<Shield className="w-4 h-4 text-orange-500" />}>
        {quotas.length === 0 ? (
          <div className="text-center py-6">
            <div className="text-sm text-slate-500 mb-2">No resource quotas configured</div>
            <p className="text-xs text-slate-600 max-w-md mx-auto">Resource quotas limit total CPU, memory, and object counts per namespace. Without quotas, a single namespace can consume all cluster resources.</p>
            <button onClick={() => go('/create/v1~resourcequotas', 'Create ResourceQuota')} className="mt-3 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">Create ResourceQuota</button>
          </div>
        ) : (
          <div className="space-y-4">
            {quotas.map((q: any) => {
              const hard = q.spec?.hard || {};
              const used = q.status?.used || {};
              const resources = Object.keys(hard);
              return (
                <div key={q.metadata?.uid} className="border border-slate-800 rounded-lg overflow-hidden">
                  <button onClick={() => go(`/r/v1~resourcequotas/${q.metadata.namespace}/${q.metadata.name}`, q.metadata.name)}
                    className="w-full px-4 py-2.5 flex items-center justify-between bg-slate-800/30 hover:bg-slate-800/60 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{q.metadata.name}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{q.metadata.namespace}</span>
                    </div>
                    <span className="text-xs text-slate-500">{resources.length} resource{resources.length !== 1 ? 's' : ''}</span>
                  </button>
                  <div className="px-4 py-2 space-y-2">
                    {resources.map((key) => {
                      const hardVal = parseResourceValue(hard[key]);
                      const usedVal = parseResourceValue(used[key] || '0');
                      const pct = hardVal > 0 ? Math.min(100, (usedVal / hardVal) * 100) : 0;
                      const barColor = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500';
                      return (
                        <div key={key}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs text-slate-400">{key}</span>
                            <span className="text-xs font-mono text-slate-300">
                              {formatResourceValue(used[key] || '0', key)} / {formatResourceValue(hard[key], key)}
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Limit Ranges */}
      <Panel title={`Limit Ranges (${limitRanges.length})`} icon={<Shield className="w-4 h-4 text-yellow-500" />}>
        {limitRanges.length === 0 ? (
          <div className="text-center py-6">
            <div className="text-sm text-slate-500 mb-2">No limit ranges configured</div>
            <p className="text-xs text-slate-600 max-w-md mx-auto">LimitRanges set default and max CPU/memory for containers that don't specify their own. Without them, containers can request unlimited resources.</p>
            <button onClick={() => go('/create/v1~limitranges', 'Create LimitRange')} className="mt-3 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">Create LimitRange</button>
          </div>
        ) : (
          <div className="space-y-4">
            {limitRanges.map((lr: any) => {
              const limits = (lr.spec?.limits || []) as any[];
              return (
                <div key={lr.metadata?.uid} className="border border-slate-800 rounded-lg overflow-hidden">
                  <button onClick={() => go(`/r/v1~limitranges/${lr.metadata.namespace}/${lr.metadata.name}`, lr.metadata.name)}
                    className="w-full px-4 py-2.5 flex items-center justify-between bg-slate-800/30 hover:bg-slate-800/60 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{lr.metadata.name}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{lr.metadata.namespace}</span>
                    </div>
                    <span className="text-xs text-slate-500">{limits.length} limit{limits.length !== 1 ? 's' : ''}</span>
                  </button>
                  <div className="px-4 py-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-800">
                          <th className="py-1.5 text-left font-normal">Type</th>
                          <th className="py-1.5 text-left font-normal">Resource</th>
                          <th className="py-1.5 text-right font-normal">Default</th>
                          <th className="py-1.5 text-right font-normal">Default Request</th>
                          <th className="py-1.5 text-right font-normal">Max</th>
                          <th className="py-1.5 text-right font-normal">Min</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {limits.flatMap((limit: any) => {
                          const resources = new Set([
                            ...Object.keys(limit.default || {}),
                            ...Object.keys(limit.defaultRequest || {}),
                            ...Object.keys(limit.max || {}),
                            ...Object.keys(limit.min || {}),
                          ]);
                          return [...resources].map((res) => (
                            <tr key={`${limit.type}-${res}`} className="text-slate-300">
                              <td className="py-1.5 text-slate-400">{limit.type}</td>
                              <td className="py-1.5">{res}</td>
                              <td className="py-1.5 text-right font-mono">{limit.default?.[res] || '—'}</td>
                              <td className="py-1.5 text-right font-mono">{limit.defaultRequest?.[res] || '—'}</td>
                              <td className="py-1.5 text-right font-mono">{limit.max?.[res] || '—'}</td>
                              <td className="py-1.5 text-right font-mono">{limit.min?.[res] || '—'}</td>
                            </tr>
                          ));
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Unprotected namespaces */}
      {unprotectedNs.length > 0 && (
        <Panel title={`Unprotected Namespaces (${unprotectedNs.length})`} icon={<AlertTriangle className="w-4 h-4 text-yellow-500" />}>
          <p className="text-xs text-slate-500 mb-3">These user namespaces have no ResourceQuota or LimitRange. Workloads can consume unlimited resources.</p>
          <div className="flex flex-wrap gap-2">
            {unprotectedNs.map((ns: any) => (
              <button key={ns.metadata?.name} onClick={() => go(`/r/v1~namespaces/_/${ns.metadata?.name}`, ns.metadata?.name)}
                className="text-xs px-2.5 py-1.5 bg-yellow-950/30 border border-yellow-900/50 text-yellow-300 rounded hover:bg-yellow-900/40 transition-colors">
                {ns.metadata?.name}
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function InfoCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-lg font-bold text-slate-100 truncate">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

