import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings, Server, Puzzle, Shield, Database, ArrowRight,
  CheckCircle, XCircle, RefreshCw, Download, Upload, GitCompare, Loader2, Minus,
  ArrowUpCircle, AlertTriangle, AlertCircle, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList, k8sGet, k8sPatch } from '../engine/query';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import type { K8sResource } from '../engine/renderers';
import type { ClusterVersion, ClusterOperator, Node, Namespace, Deployment, Condition } from '../engine/types';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useUIStore } from '../store/uiStore';
import { useClusterStore } from '../store/clusterStore';
import { K8S_BASE as BASE } from '../engine/gvr';
import ClusterConfig from '../components/ClusterConfig';
const TimelineViewLazy = React.lazy(() => import('./TimelineView'));
import ProductionReadiness from '../components/ProductionReadiness';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { Panel } from '../components/primitives/Panel';
import { parseCpu, parseMem, formatMem } from '../engine/formatting';
import { type ClusterSnapshot, type DiffRow, loadSnapshots, saveSnapshots, captureSnapshot, compareSnapshots } from '../engine/snapshot';
import { QuotasTab } from './admin/QuotasTab';
import { CertificatesTab } from './admin/CertificatesTab';

/** OpenShift Infrastructure resource (config.openshift.io/v1) */
interface Infrastructure extends K8sResource {
  status?: {
    platform?: string;
    platformStatus?: { type?: string };
    apiServerURL?: string;
    controlPlaneTopology?: string;
  };
}

/** OpenShift OAuth resource (config.openshift.io/v1) */
interface OAuthConfig extends K8sResource {
  spec?: {
    identityProviders?: Array<{ name: string; type: string }>;
  };
}

/** OpenShift operator resource (operator.openshift.io/v1) */
interface OperatorResource extends K8sResource {
  status?: {
    conditions?: Condition[];
    latestAvailableRevision?: number;
  };
}

/** OpenShift Ingress config (config.openshift.io/v1) */
interface IngressConfig extends K8sResource {
  spec?: {
    domain?: string;
    defaultCertificate?: { name: string };
  };
}

/** CRD resource */
interface CustomResourceDefinition extends K8sResource {
  spec?: {
    group?: string;
    [key: string]: unknown;
  };
}

/** PDB resource */
interface PodDisruptionBudget extends K8sResource {
  spec?: {
    selector?: { matchLabels?: Record<string, string> };
    [key: string]: unknown;
  };
}

/** Available update entry (extends typed ClusterVersion updates with risks) */
interface AvailableUpdate {
  version: string;
  image?: string;
  risks?: Array<{ name?: string; message?: string }>;
}

type Tab = 'overview' | 'readiness' | 'operators' | 'config' | 'updates' | 'snapshots' | 'quotas' | 'certificates' | 'timeline';

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
    queryFn: () => k8sGet<ClusterVersion>('/apis/config.openshift.io/v1/clusterversions/version').catch(() => null),
    staleTime: 60000,
  });

  // Infrastructure
  const { data: infra } = useQuery({
    queryKey: ['admin', 'infra'],
    queryFn: () => k8sGet<Infrastructure>('/apis/config.openshift.io/v1/infrastructures/cluster').catch(() => null),
    staleTime: 60000,
  });

  const { data: nodes = [] } = useK8sListWatch<K8sResource>({
    apiPath: '/api/v1/nodes',
  });

  const { data: operators = [] } = useK8sListWatch<K8sResource>({
    apiPath: '/apis/config.openshift.io/v1/clusteroperators',
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
    queryFn: () => k8sGet<OAuthConfig>('/apis/config.openshift.io/v1/oauths/cluster').catch(() => null),
    staleTime: 120000,
  });

  // Namespaces
  const { data: namespaces = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/namespaces'],
    queryFn: () => k8sList('/api/v1/namespaces'),
    staleTime: 60000,
  });

  // etcd operator status
  const { data: etcdOperator } = useQuery({
    queryKey: ['admin', 'etcd-operator'],
    queryFn: () => k8sGet<OperatorResource>('/apis/operator.openshift.io/v1/etcds/cluster').catch(() => null),
    staleTime: 60000,
  });

  // kube-apiserver operator status
  const { data: apiServerOperator } = useQuery({
    queryKey: ['admin', 'apiserver-operator'],
    queryFn: () => k8sGet<OperatorResource>('/apis/operator.openshift.io/v1/kubeapiservers/cluster').catch(() => null),
    staleTime: 60000,
  });

  // Ingress config (for cert expiry)
  const { data: ingressConfig } = useQuery({
    queryKey: ['admin', 'config', 'ingress'],
    queryFn: () => k8sGet<IngressConfig>('/apis/config.openshift.io/v1/ingresses/cluster').catch(() => null),
    staleTime: 120000,
  });

  // Router cert secret
  const { data: routerCert } = useQuery({
    queryKey: ['admin', 'router-cert'],
    queryFn: () => k8sGet<K8sResource>('/api/v1/namespaces/openshift-ingress/secrets/router-certs-default').catch(() => null),
    staleTime: 300000,
  });

  // PDBs for pre-upgrade check
  const { data: pdbs = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/policy/v1/poddisruptionbudgets'],
    queryFn: () => k8sList('/apis/policy/v1/poddisruptionbudgets').catch(() => []),
    staleTime: 60000,
  });

  // Deployments for PDB coverage check
  const { data: deployments = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/apps/v1/deployments'],
    queryFn: () => k8sList('/apis/apps/v1/deployments').catch(() => []),
    staleTime: 60000,
  });

  // etcd backup CRDs
  const { data: etcdBackupExists } = useQuery({
    queryKey: ['admin', 'etcd-backup'],
    queryFn: () => k8sList('/apis/config.openshift.io/v1/backups').then((items: K8sResource[]) => items.length > 0).catch(() => false),
    staleTime: 60000,
  });

  // Computed
  const cvVersion = clusterVersion?.status?.desired?.version || clusterVersion?.status?.history?.[0]?.version || '';
  const cvChannel = clusterVersion?.spec?.channel || '';
  const platform = infra?.status?.platform || infra?.status?.platformStatus?.type || '';
  const apiUrl = infra?.status?.apiServerURL || '';
  const controlPlaneTopology = useClusterStore((s) => s.controlPlaneTopology) || infra?.status?.controlPlaneTopology || '';
  const isHyperShift = useClusterStore((s) => s.isHyperShift);
  const availableUpdates = (clusterVersion?.status?.availableUpdates || []) as AvailableUpdate[];
  const isUpdating = (clusterVersion?.status?.conditions || []).some((c: Condition) => c.type === 'Progressing' && c.status === 'True');

  const opDegraded = operators.filter((o) => (o as unknown as ClusterOperator).status?.conditions?.find((c: Condition) => c.type === 'Degraded' && c.status === 'True')).length;
  const opProgressing = operators.filter((o) => (o as unknown as ClusterOperator).status?.conditions?.find((c: Condition) => c.type === 'Progressing' && c.status === 'True')).length;

  const nodeRoles = React.useMemo(() => {
    const roles = new Map<string, number>();
    for (const n of nodes) {
      const labels = n.metadata.labels || {};
      const nodeRoleKeys = Object.keys(labels).filter(k => k.startsWith('node-role.kubernetes.io/')).map(k => k.replace('node-role.kubernetes.io/', ''));
      // Merge master + control-plane into "control-plane"
      const normalized = new Set(nodeRoleKeys.map(r => r === 'master' ? 'control-plane' : r));
      for (const role of normalized) {
        roles.set(role, (roles.get(role) || 0) + 1);
      }
    }
    return [...roles.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  // Cluster capacity
  const clusterCapacity = React.useMemo(() => {
    let cpuAllocatable = 0, memAllocatable = 0, cpuCapacity = 0, memCapacity = 0, pods = 0;
    for (const n of nodes) {
      const node = n as unknown as Node;
      const alloc = node.status?.allocatable || {};
      const cap = node.status?.capacity || {};
      cpuAllocatable += parseCpu(alloc.cpu || '0');
      memAllocatable += parseMem(alloc.memory || '0');
      cpuCapacity += parseCpu(cap.cpu || '0');
      memCapacity += parseMem(cap.memory || '0');
      pods += parseInt(alloc.pods || '0', 10);
    }
    return { cpuAllocatable, memAllocatable, cpuCapacity, memCapacity, pods };
  }, [nodes]);

  // Namespace stats
  const nsStats = React.useMemo(() => {
    const all = namespaces;
    const system = all.filter(ns => {
      const name = ns.metadata?.name || '';
      return name.startsWith('openshift-') || name.startsWith('kube-') || name === 'default' || name === 'openshift';
    });
    return { total: all.length, user: all.length - system.length, system: system.length };
  }, [namespaces]);

  // Cluster age from install history
  const clusterAge = React.useMemo(() => {
    const history = clusterVersion?.status?.history || [];
    if (history.length === 0) return null;
    const oldest = history[history.length - 1];
    const installDate = oldest?.startedTime || oldest?.completionTime;
    if (!installDate) return null;
    const diff = Date.now() - new Date(installDate).getTime();
    const days = Math.floor(diff / 86400000);
    if (days > 365) return { label: `${Math.floor(days / 365)}y ${Math.floor((days % 365) / 30)}mo`, date: installDate };
    if (days > 30) return { label: `${Math.floor(days / 30)}mo ${days % 30}d`, date: installDate };
    return { label: `${days}d`, date: installDate };
  }, [clusterVersion]);

  // Operator health helpers — handles both ClusterOperator (Available/Degraded) and
  // operator.openshift.io resources (StaticPodsAvailable, *Degraded, *Progressing)
  const getOperatorStatus = (op: K8sResource | OperatorResource | null): string => {
    const conditions: Condition[] = (op as OperatorResource)?.status?.conditions || [];
    // Check for any degraded condition
    const hasDegraded = conditions.some((c) => c.type.endsWith('Degraded') && c.status === 'True');
    if (hasDegraded) return 'degraded';
    // Check for any progressing condition
    const hasProgressing = conditions.some((c) => c.type.endsWith('Progressing') && c.status === 'True');
    if (hasProgressing) return 'progressing';
    // Check for available
    const hasAvailable = conditions.some((c) => (c.type === 'Available' || c.type.endsWith('Available')) && c.status === 'True');
    if (hasAvailable) return 'healthy';
    return 'unknown';
  };

  // Certificate expiry from router secret
  const certExpiry = React.useMemo(() => {
    if (!routerCert?.data?.['tls.crt']) return null;
    try {
      const pem = atob(routerCert.data['tls.crt']);
      const match = pem.match(/Not After\s*:\s*(.+)/);
      if (match) {
        const expDate = new Date(match[1]);
        const daysLeft = Math.floor((expDate.getTime() - Date.now()) / 86400000);
        return { date: expDate, daysLeft };
      }
    } catch {}
    return null;
  }, [routerCert]);

  const crdGroupCount = React.useMemo(() => {
    const groups = new Set<string>();
    for (const crd of crds) groups.add((crd as unknown as CustomResourceDefinition).spec?.group || 'unknown');
    return groups.size;
  }, [crds]);

  const identityProviders = React.useMemo(() => {
    return oauthConfig?.spec?.identityProviders || [];
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
  const opDegradedCount = operators.filter((o) => (o as unknown as ClusterOperator).status?.conditions?.find((c: Condition) => c.type === 'Degraded' && c.status === 'True')).length;

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <Settings className="w-3.5 h-3.5" /> },
    { id: 'readiness', label: 'Readiness', icon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'operators', label: `Operators (${operators.length})${opDegradedCount > 0 ? ` · ${opDegradedCount} degraded` : ''}`, icon: <Puzzle className="w-3.5 h-3.5" /> },
    { id: 'config', label: 'Cluster Config', icon: <Database className="w-3.5 h-3.5" /> },
    { id: 'updates', label: `Updates${availableUpdates.length > 0 ? ` (${availableUpdates.length})` : ''}`, icon: <ArrowUpCircle className="w-3.5 h-3.5" /> },
    { id: 'snapshots', label: `Snapshots (${savedSnapshots.length})`, icon: <GitCompare className="w-3.5 h-3.5" /> },
    { id: 'quotas', label: `Quotas (${quotas.length})`, icon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'certificates', label: 'Certificates', icon: <Shield className="w-3.5 h-3.5" /> },
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
            {/* Row 1: Key info cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <InfoCard label="Cluster Version" value={cvVersion || '—'} sub={cvChannel} />
              <InfoCard label="Platform" value={platform || '—'} sub={(() => { try { return apiUrl ? new URL(apiUrl).hostname : ''; } catch { return ''; } })()} />
              <InfoCard label="Control Plane" value={isHyperShift ? 'Hosted (External)' : controlPlaneTopology ? `Self-managed (${controlPlaneTopology})` : '—'} sub={isHyperShift ? 'Managed externally' : ''} />
              <InfoCard label="Cluster Age" value={clusterAge?.label || '—'} sub={clusterAge?.date ? new Date(clusterAge.date).toLocaleDateString() : ''} />
              <button onClick={() => go('/compute', 'Compute')} className="text-left">
                <InfoCard label="Nodes" value={String(nodes.length)} sub={`${nodeRoles.map(([r, c]) => `${c} ${r}`).join(', ')} →`} />
              </button>
              <button onClick={() => setActiveTab('quotas')} className="text-left">
                <InfoCard label="Namespaces" value={String(nsStats.total)} sub={`${nsStats.user} user, ${nsStats.system} system →`} />
              </button>
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

            {/* Cluster Capacity */}
            <Panel title="Cluster Capacity" icon={<Server className="w-4 h-4 text-cyan-500" />}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-slate-400 mb-1">CPU (allocatable)</div>
                  <div className="text-lg font-bold text-slate-100">{clusterCapacity.cpuAllocatable.toFixed(0)} cores</div>
                  <div className="text-xs text-slate-500">{clusterCapacity.cpuCapacity.toFixed(0)} total capacity</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Memory (allocatable)</div>
                  <div className="text-lg font-bold text-slate-100">{formatMem(clusterCapacity.memAllocatable)}</div>
                  <div className="text-xs text-slate-500">{formatMem(clusterCapacity.memCapacity)} total capacity</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Max Pods</div>
                  <div className="text-lg font-bold text-slate-100">{clusterCapacity.pods.toLocaleString()}</div>
                  <div className="text-xs text-slate-500">across {nodes.length} nodes</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Per-Node Average</div>
                  <div className="text-lg font-bold text-slate-100">{nodes.length > 0 ? (clusterCapacity.cpuAllocatable / nodes.length).toFixed(1) : 0} CPU</div>
                  <div className="text-xs text-slate-500">{nodes.length > 0 ? formatMem(clusterCapacity.memAllocatable / nodes.length) : '—'} memory</div>
                </div>
              </div>
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Control Plane Status */}
              <Panel title="Control Plane" icon={<Shield className="w-4 h-4 text-green-500" />}>
                <div className="space-y-2.5">
                  {[
                    { name: 'API Server', op: apiServerOperator, detail: (() => {
                      const rev = apiServerOperator?.status?.latestAvailableRevision;
                      return rev ? `revision ${rev}` : '';
                    })() },
                    { name: 'etcd', op: etcdOperator, detail: (() => {
                      const msg = (etcdOperator?.status?.conditions || []).find((c: Condition) => c.type === 'EtcdMembersAvailable')?.message || '';
                      return msg || '';
                    })() },
                  ].map(({ name, op, detail }) => {
                    const status = op ? getOperatorStatus(op) : 'unknown';
                    return (
                      <div key={name} className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-2">
                          {status === 'healthy' ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> :
                           status === 'degraded' ? <XCircle className="w-3.5 h-3.5 text-red-500" /> :
                           status === 'progressing' ? <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" /> :
                           <AlertTriangle className="w-3.5 h-3.5 text-slate-500" />}
                          <span className="text-sm text-slate-200">{name}</span>
                          {detail && <span className="text-xs text-slate-500">{detail}</span>}
                        </div>
                        <span className={cn('text-xs px-1.5 py-0.5 rounded',
                          status === 'healthy' ? 'bg-green-900/50 text-green-300' :
                          status === 'degraded' ? 'bg-red-900/50 text-red-300' :
                          status === 'progressing' ? 'bg-blue-900/50 text-blue-300' :
                          'bg-slate-800 text-slate-400'
                        )}>{status === 'healthy' ? 'Available' : status === 'degraded' ? 'Degraded' : status === 'progressing' ? 'Updating' : 'Unknown'}</span>
                      </div>
                    );
                  })}
                  <div className="border-t border-slate-800 pt-2 mt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">ClusterOperators ({operators.length})</span>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" /> {operators.length - opDegraded - opProgressing}</span>
                        {opDegraded > 0 && <span className="flex items-center gap-1 text-xs text-red-400"><XCircle className="w-3 h-3" /> {opDegraded}</span>}
                        {opProgressing > 0 && <span className="flex items-center gap-1 text-xs text-yellow-400"><RefreshCw className="w-3 h-3" /> {opProgressing}</span>}
                      </div>
                    </div>
                  </div>
                </div>
                <button onClick={() => go('/r/config.openshift.io~v1~clusteroperators', 'ClusterOperators')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-3">View all operators <ArrowRight className="w-3 h-3" /></button>
              </Panel>

              {/* Nodes */}
              <Panel title={`Nodes (${nodes.length})`} icon={<Server className="w-4 h-4 text-blue-500" />}>
                <div className="space-y-2 mb-3">
                  {nodeRoles.map(([role, count]) => (
                    <div key={role} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{role}</span>
                      <span className="text-sm font-mono text-slate-400">{count}</span>
                    </div>
                  ))}
                  {(() => {
                    const readyNodes = nodes.filter((n) => {
                      const node = n as unknown as Node;
                      const conditions: Condition[] = node.status?.conditions || [];
                      return conditions.some((c) => c.type === 'Ready' && c.status === 'True');
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

              {/* Identity Providers */}
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

              {/* Certificate & Ingress */}
              <Panel title="Ingress & Certificates" icon={<Shield className="w-4 h-4 text-orange-500" />}>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-300">Apps Domain</span>
                    <span className="text-xs font-mono text-slate-400">{ingressConfig?.spec?.domain || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-300">Default Certificate</span>
                    <span className={cn('text-xs px-1.5 py-0.5 rounded',
                      ingressConfig?.spec?.defaultCertificate ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300'
                    )}>{ingressConfig?.spec?.defaultCertificate ? 'Custom' : 'Self-signed'}</span>
                  </div>
                  {certExpiry && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Router Cert Expires</span>
                      <span className={cn('text-xs px-1.5 py-0.5 rounded',
                        certExpiry.daysLeft < 30 ? 'bg-red-900/50 text-red-300' :
                        certExpiry.daysLeft < 90 ? 'bg-yellow-900/50 text-yellow-300' :
                        'bg-green-900/50 text-green-300'
                      )}>{certExpiry.daysLeft}d ({certExpiry.date.toLocaleDateString()})</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-300">Quotas / Limit Ranges</span>
                    <span className="text-xs text-slate-400">{quotas.length} quotas, {limitRanges.length} limits</span>
                  </div>
                </div>
                <button onClick={() => setActiveTab('config')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-3">
                  Cluster config <ArrowRight className="w-3 h-3" />
                </button>
              </Panel>
            </div>
          </>
        )}

        {/* ===== READINESS ===== */}
        {activeTab === 'readiness' && <ProductionReadiness />}

        {/* ===== OPERATORS ===== */}
        {activeTab === 'operators' && (() => {
          const operatorList = operators.map((co) => {
            const op = co as unknown as ClusterOperator;
            const conditions: Condition[] = op.status?.conditions || [];
            const available = conditions.find((c) => c.type === 'Available')?.status === 'True';
            const degraded = conditions.find((c) => c.type === 'Degraded')?.status === 'True';
            const progressing = conditions.find((c) => c.type === 'Progressing')?.status === 'True';
            const version = op.status?.versions?.find((v) => v.name === 'operator')?.version || '';
            const message = degraded ? conditions.find((c) => c.type === 'Degraded')?.message || '' : progressing ? conditions.find((c) => c.type === 'Progressing')?.message || '' : '';
            return { name: co.metadata.name, available, degraded, progressing, version, message };
          }).sort((a, b) => {
            if (a.degraded && !b.degraded) return -1;
            if (!a.degraded && b.degraded) return 1;
            if (a.progressing && !b.progressing) return -1;
            return a.name.localeCompare(b.name);
          });
          const degradedOps = operatorList.filter((o) => o.degraded);
          const progressingOps = operatorList.filter((o) => o.progressing);
          const availableOps = operatorList.filter((o) => o.available && !o.degraded);

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
                  {operatorList.map((op) => (
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
              const conditions: Condition[] = clusterVersion?.status?.conditions || [];
              const progressing = conditions.find((c) => c.type === 'Progressing');
              const available = conditions.find((c) => c.type === 'Available');
              const failing = conditions.find((c) => c.type === 'Failing');
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
                    const readyNodes = nodes.filter((n) => {
                      const node = n as unknown as Node;
                      const conds: Condition[] = node.status?.conditions || [];
                      return conds.some((c) => c.type === 'Ready' && c.status === 'True');
                    });
                    const allNodesReady = readyNodes.length === nodes.length;
                    const degradedOps = operators.filter((o) => ((o as unknown as ClusterOperator).status?.conditions || []).some((c: Condition) => c.type === 'Degraded' && c.status === 'True'));
                    const allOpsHealthy = degradedOps.length === 0;
                    const channelStable = cvChannel?.includes('stable') || cvChannel?.includes('eus');

                    // Real PDB check: user deployments with >1 replica that have PDBs
                    const userDeploys = deployments.filter((d) => {
                      const dep = d as unknown as Deployment;
                      const ns = dep.metadata?.namespace || '';
                      return !ns.startsWith('openshift-') && !ns.startsWith('kube-') && (dep.spec?.replicas ?? 0) > 1;
                    });
                    const pdbSelectors = (pdbs as unknown as PodDisruptionBudget[]).map((p) => p.spec?.selector?.matchLabels || {});
                    const deploysWithPDB = userDeploys.filter((d) => {
                      const dep = d as unknown as Deployment;
                      const podLabels = dep.spec?.template?.metadata?.labels || {};
                      return pdbSelectors.some((sel) => Object.entries(sel).every(([k, v]) => podLabels[k] === v));
                    });
                    const pdbCoverage = userDeploys.length === 0 || deploysWithPDB.length >= userDeploys.length * 0.5;

                    const checks = [
                      { label: 'All nodes ready', pass: allNodesReady, detail: allNodesReady ? `${nodes.length}/${nodes.length} ready` : `${readyNodes.length}/${nodes.length} ready — fix unready nodes first` },
                      { label: 'No degraded operators', pass: allOpsHealthy, detail: allOpsHealthy ? `${operators.length} operators healthy` : `${degradedOps.length} degraded: ${degradedOps.slice(0, 3).map((o) => o.metadata.name).join(', ')}` },
                      { label: 'Stable update channel', pass: channelStable, detail: channelStable ? `Channel: ${cvChannel}` : `Channel "${cvChannel}" — consider switching to stable for production` },
                      { label: 'Etcd backup', pass: isHyperShift || !!etcdBackupExists, detail: isHyperShift ? 'Managed by hosting provider' : etcdBackupExists ? 'Backup schedule configured' : 'No automated backup configured — take a manual backup: ssh to control plane → /usr/local/bin/cluster-backup.sh /home/core/backup' },
                      { label: 'PodDisruptionBudgets', pass: pdbCoverage, detail: userDeploys.length === 0 ? 'No multi-replica user deployments' : `${deploysWithPDB.length}/${userDeploys.length} multi-replica deployments have PDBs` },
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
                  {availableUpdates.map((u, i: number) => {
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
                  {operators.map((op) => {
                    const co = op as unknown as ClusterOperator;
                    const conds: Condition[] = co.status?.conditions || [];
                    const progressing = conds.find((c) => c.type === 'Progressing');
                    const available = conds.find((c) => c.type === 'Available');
                    const degraded = conds.find((c) => c.type === 'Degraded');
                    const isProgressing = progressing?.status === 'True';
                    const isDegraded = degraded?.status === 'True';
                    const isAvailable = available?.status === 'True';
                    const version = co.status?.versions?.find((v) => v.name === 'operator')?.version || '';
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
                {(clusterVersion?.status?.history || []).slice(0, 10).map((h, i: number) => {
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
        {activeTab === 'quotas' && <QuotasTab quotas={quotas} limitRanges={limitRanges} go={go} />}

        {activeTab === 'certificates' && <CertificatesTab go={go} />}

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

function InfoCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-lg font-bold text-slate-100 truncate">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

