import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings, Server, Puzzle, FileCode, Shield, Database, ArrowRight,
  CheckCircle, XCircle, RefreshCw, Download, Upload, GitCompare, Loader2, Minus,
  ArrowUpCircle, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList, k8sGet, k8sPatch } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useUIStore } from '../store/uiStore';
import { K8S_BASE as BASE } from '../engine/gvr';

type Tab = 'overview' | 'quotas' | 'updates' | 'snapshots';

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
}

interface DiffRow {
  field: string;
  category: string;
  left: string;
  right: string;
  changed: boolean;
}

const SNAPSHOTS_KEY = 'openshiftview-snapshots';

function loadSnapshots(): ClusterSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
  } catch { return []; }
}

function saveSnapshots(snapshots: ClusterSnapshot[]) {
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`);
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

  const [cv, infra, nodesData, coData, crdData, scData, nsData] = await Promise.all([
    fetchJson<any>('/apis/config.openshift.io/v1/clusterversions/version'),
    fetchJson<any>('/apis/config.openshift.io/v1/infrastructures/cluster'),
    fetchJson<any>('/api/v1/nodes'),
    fetchJson<any>('/apis/config.openshift.io/v1/clusteroperators'),
    fetchJson<any>('/apis/apiextensions.k8s.io/v1/customresourcedefinitions'),
    fetchJson<any>('/apis/storage.k8s.io/v1/storageclasses'),
    fetchJson<any>('/api/v1/namespaces'),
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
  return rows;
}

// --- Main component ---

export default function AdminView() {
  const [activeTab, setActiveTab] = React.useState<Tab>('overview');
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

  // --- Updates ---
  const [updating, setUpdating] = React.useState(false);
  const [channelEdit, setChannelEdit] = React.useState('');
  const [showChannelEdit, setShowChannelEdit] = React.useState(false);

  const handleStartUpdate = async (version: string) => {
    if (!confirm(`Start cluster update to ${version}? This will rolling-restart all nodes.`)) return;
    setUpdating(true);
    try {
      await k8sPatch('/apis/config.openshift.io/v1/clusterversions/version', {
        spec: { desiredUpdate: { version } },
      });
      addToast({ type: 'success', title: 'Cluster update started', detail: `Updating to ${version}` });
      queryClient.invalidateQueries({ queryKey: ['admin', 'clusterversion'] });
    } catch (err) {
      addToast({ type: 'error', title: 'Update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setUpdating(false);
  };

  const handleChangeChannel = async () => {
    if (!channelEdit) return;
    try {
      await k8sPatch('/apis/config.openshift.io/v1/clusterversions/version', {
        spec: { channel: channelEdit },
      });
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
    const updated = savedSnapshots.filter(s => s.id !== id);
    setSavedSnapshots(updated);
    saveSnapshots(updated);
    if (compareLeft === id) { setCompareLeft(''); setDiff(null); }
    if (compareRight === id) { setCompareRight(''); setDiff(null); }
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
  };

  const handleImportSnapshot = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const snap = JSON.parse(await file.text()) as ClusterSnapshot;
        if (!snap.id) snap.id = `snap-${Date.now()}`;
        if (!snap.label) snap.label = file.name.replace('.json', '');
        const updated = [snap, ...savedSnapshots].slice(0, 20);
        setSavedSnapshots(updated);
        saveSnapshots(updated);
        addToast({ type: 'success', title: 'Snapshot imported', detail: snap.label });
      } catch {
        addToast({ type: 'error', title: 'Invalid snapshot file' });
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

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <Settings className="w-3.5 h-3.5" /> },
    { id: 'updates', label: `Updates${availableUpdates.length > 0 ? ` (${availableUpdates.length})` : ''}`, icon: <ArrowUpCircle className="w-3.5 h-3.5" /> },
    { id: 'snapshots', label: `Snapshots (${savedSnapshots.length})`, icon: <GitCompare className="w-3.5 h-3.5" /> },
    { id: 'quotas', label: `Quotas (${quotas.length})`, icon: <Shield className="w-3.5 h-3.5" /> },
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
              <InfoCard label="Platform" value={platform || '—'} sub={apiUrl ? new URL(apiUrl).hostname : ''} />
              <InfoCard label="Nodes" value={String(nodes.length)} sub={nodeRoles.map(([r, c]) => `${c} ${r}`).join(', ')} />
              <InfoCard label="CRDs" value={String(crds.length)} sub={`${crdGroupCount} API groups`} />
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
                <button onClick={() => go('/operators', 'Operators')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">View all operators <ArrowRight className="w-3 h-3" /></button>
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
              </Panel>

              <Panel title={`Nodes (${nodes.length})`} icon={<Server className="w-4 h-4 text-blue-500" />}>
                <div className="space-y-2 mb-3">
                  {nodeRoles.map(([role, count]) => (
                    <div key={role} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{role}</span>
                      <span className="text-sm font-mono text-slate-400">{count}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => go('/r/v1~nodes', 'Nodes')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">View all nodes <ArrowRight className="w-3 h-3" /></button>
              </Panel>

              <Panel title="Quick Links" icon={<Database className="w-4 h-4 text-slate-400" />}>
                <div className="space-y-2">
                  <button onClick={() => go('/r/apiextensions.k8s.io~v1~customresourcedefinitions', 'CRDs')} className="w-full text-left text-sm text-slate-300 hover:text-blue-400 flex items-center gap-2 py-1">
                    <FileCode className="w-3.5 h-3.5" /> Browse {crds.length} CRDs <ArrowRight className="w-3 h-3 ml-auto text-slate-600" />
                  </button>
                  <button onClick={() => go('/access-control', 'Access Control')} className="w-full text-left text-sm text-slate-300 hover:text-blue-400 flex items-center gap-2 py-1">
                    <Shield className="w-3.5 h-3.5" /> Access Control <ArrowRight className="w-3 h-3 ml-auto text-slate-600" />
                  </button>
                  <button onClick={() => setActiveTab('snapshots')} className="w-full text-left text-sm text-slate-300 hover:text-blue-400 flex items-center gap-2 py-1">
                    <GitCompare className="w-3.5 h-3.5" /> Config Snapshots <ArrowRight className="w-3 h-3 ml-auto text-slate-600" />
                  </button>
                </div>
              </Panel>
            </div>
          </>
        )}

        {/* ===== UPDATES ===== */}
        {activeTab === 'updates' && (
          <div className="space-y-6">
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
                  <span className="text-sm text-slate-400">API Server</span>
                  <span className="text-xs font-mono text-slate-500">{apiUrl || '—'}</span>
                </div>
                {isUpdating && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-yellow-950/30 border border-yellow-800 rounded">
                    <RefreshCw className="w-4 h-4 text-yellow-400 animate-spin" />
                    <span className="text-sm text-yellow-300">Cluster update in progress...</span>
                  </div>
                )}
              </div>
            </Panel>

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
                  {availableUpdates.map((u: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded bg-slate-800/50 border border-slate-700">
                      <div>
                        <span className="text-sm font-medium text-slate-200">{u.version}</span>
                        {i === 0 && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-blue-900 text-blue-300 rounded">Recommended</span>}
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
                  ))}
                  <div className="flex items-center gap-2 pt-2 text-xs text-slate-500">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
                    Updates will rolling-restart all nodes. Ensure workloads have disruption budgets.
                  </div>
                </div>
              )}
            </Panel>

            {/* Update history */}
            <Panel title="Update History" icon={<RefreshCw className="w-4 h-4 text-blue-500" />}>
              <div className="space-y-1 max-h-64 overflow-auto">
                {(clusterVersion?.status?.history || []).slice(0, 10).map((h: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-2">
                      {h.state === 'Completed' ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <RefreshCw className="w-3.5 h-3.5 text-yellow-500 animate-spin" />}
                      <span className="text-sm text-slate-200 font-mono">{h.version}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>{h.state}</span>
                      {h.completionTime && <span>{new Date(h.completionTime).toLocaleDateString()}</span>}
                    </div>
                  </div>
                ))}
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
        {activeTab === 'quotas' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel title={`Resource Quotas (${quotas.length})`} icon={<Shield className="w-4 h-4 text-orange-500" />}>
              {quotas.length === 0 ? <div className="text-sm text-slate-500 py-4 text-center">No resource quotas</div> : (
                <div className="space-y-1 max-h-80 overflow-auto">
                  {quotas.map((q) => {
                    const hard = (q.spec as any)?.hard || {};
                    return (
                      <div key={q.metadata.uid} className="py-2 px-2 rounded hover:bg-slate-800/50 cursor-pointer" onClick={() => go(`/r/v1~resourcequotas/${q.metadata.namespace}/${q.metadata.name}`, q.metadata.name)}>
                        <div className="flex items-center gap-2"><span className="text-sm text-slate-200">{q.metadata.name}</span><span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{q.metadata.namespace}</span></div>
                        <div className="text-xs text-slate-500 mt-0.5">{Object.keys(hard).join(', ')}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
            <Panel title={`Limit Ranges (${limitRanges.length})`} icon={<Shield className="w-4 h-4 text-yellow-500" />}>
              {limitRanges.length === 0 ? <div className="text-sm text-slate-500 py-4 text-center">No limit ranges</div> : (
                <div className="space-y-1 max-h-80 overflow-auto">
                  {limitRanges.map((lr) => {
                    const limits = ((lr.spec as any)?.limits || []) as Array<{ type: string }>;
                    return (
                      <div key={lr.metadata.uid} className="py-2 px-2 rounded hover:bg-slate-800/50 cursor-pointer" onClick={() => go(`/r/v1~limitranges/${lr.metadata.namespace}/${lr.metadata.name}`, lr.metadata.name)}>
                        <div className="flex items-center gap-2"><span className="text-sm text-slate-200">{lr.metadata.name}</span><span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{lr.metadata.namespace}</span></div>
                        <div className="text-xs text-slate-500 mt-0.5">{limits.map((l) => l.type).join(', ')}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        )}
      </div>
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

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800"><h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">{icon}{title}</h2></div>
      <div className="p-4">{children}</div>
    </div>
  );
}
