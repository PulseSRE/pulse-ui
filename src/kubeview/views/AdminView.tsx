import React, { Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Settings, Puzzle, Shield, Database, GitBranch,
  ArrowUpCircle, GitCompare, Gauge, Lock, Blocks, FileKey,
} from 'lucide-react';
import { useActiveClusterId } from '../hooks/useClusterBase';

const CRDsView = lazy(() => import('./CRDsView'));

import { cn } from '@/lib/utils';
import { k8sList, k8sGet } from '../engine/query';
import { fetchTlsSecrets, parseCertExpiry, certNotAfterFromSecretData, type TlsSecretLike } from '../engine/certExpiry';
import { safeQuery } from '../engine/safeQuery';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import type { K8sResource } from '../engine/renderers';
import type { ClusterVersion, ClusterOperator, Node, Deployment, Condition, Namespace, MachineConfigPool, Pod } from '../engine/types';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useClusterStore } from '../store/clusterStore';
import ClusterConfig from '../components/ClusterConfig';
import { parseCpu, parseMem, parseResourceValue } from '../engine/formatting';
import { QuotasTab } from './admin/QuotasTab';
import { CertificatesTab } from './admin/CertificatesTab';
import { CsrTab } from './admin/CsrTab';
import { OverviewTab } from './admin/OverviewTab';
import { OperatorsTab } from './admin/OperatorsTab';
import { UpdatesTab } from './admin/UpdatesTab';
import { SnapshotsTab } from './admin/SnapshotsTab';
import { loadSnapshots } from '../engine/snapshot';
import { GitOpsConfig } from '../components/GitOpsConfig';
import { SectionHeader } from '../components/primitives/SectionHeader';
import { promFetch, MetricsUnavailableError } from '../components/metrics/prometheus';

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

/** ResourceQuota resource */
interface ResourceQuota extends K8sResource {
  spec?: { hard?: Record<string, string>; [key: string]: unknown };
  status?: { hard?: Record<string, string>; used?: Record<string, string>; [key: string]: unknown };
}

/** LimitRange resource */
interface LimitRange extends K8sResource {
  spec?: {
    limits?: Array<{
      type: string;
      default?: Record<string, string>;
      defaultRequest?: Record<string, string>;
      max?: Record<string, string>;
      min?: Record<string, string>;
    }>;
    [key: string]: unknown;
  };
}

/** PDB resource */
interface PodDisruptionBudget extends K8sResource {
  spec?: {
    selector?: { matchLabels?: Record<string, string> };
    [key: string]: unknown;
  };
  status?: {
    disruptionsAllowed?: number;
    [key: string]: unknown;
  };
}

/** Available update entry */
interface AvailableUpdate {
  version: string;
  image?: string;
  risks?: Array<{ name?: string; message?: string }>;
}

type Tab = 'overview' | 'operators' | 'config' | 'updates' | 'snapshots' | 'quotas' | 'certificates' | 'csrs' | 'crds';

// --- Main component ---

const ADMIN_TABS: readonly Tab[] = ['overview', 'operators', 'config', 'updates', 'snapshots', 'quotas', 'certificates', 'csrs', 'crds'];

export default function AdminView() {
  // The tab follows `?tab=` through the router, so in-page links such as
  // go('/admin?tab=crds') switch tabs instead of only changing the URL.
  const clusterId = useActiveClusterId();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: Tab = tabParam && (ADMIN_TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : 'overview';
  const setActiveTab = React.useCallback((tab: Tab | string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
      return next;
    });
  }, [setSearchParams]);

  // --- Data fetching ---

  const { data: clusterVersion, isLoading: cvLoading, isError: cvError } = useQuery({
    queryKey: ['admin', 'clusterversion', clusterId],
    queryFn: () => safeQuery(() => k8sGet<ClusterVersion>('/apis/config.openshift.io/v1/clusterversions/version', clusterId)),
    staleTime: 60000,
  });

  const { data: infra } = useQuery({
    queryKey: ['admin', 'infra', clusterId],
    queryFn: () => safeQuery(() => k8sGet<Infrastructure>('/apis/config.openshift.io/v1/infrastructures/cluster', clusterId)),
    staleTime: 60000,
  });

  const { data: nodes = [], isLoading: nodesLoading, isError: nodesError } = useK8sListWatch<Node>({
    apiPath: '/api/v1/nodes',
  });

  const { data: operators = [], isLoading: opsLoading, isError: opsError } = useK8sListWatch<ClusterOperator>({
    apiPath: '/apis/config.openshift.io/v1/clusteroperators',
  });

  const { data: firingAlerts = [], error: firingAlertsError } = useQuery<Array<{ labels: Record<string, string>; annotations: Record<string, string>; state: string }>>({
    queryKey: ['admin', 'firing-alerts', clusterId],
    queryFn: async () => {
      const res = await promFetch('/api/v1/alerts', clusterId);
      // Throw, don't swallow. Returning [] here turned "Prometheus is not
      // reachable" into "no alerts are firing", and the Overview rendered a
      // green all-clear on the strength of a failed request.
      if (!res.ok) throw new Error(`Prometheus returned ${res.status} ${res.statusText}`);
      const json = await res.json();
      return (json.data?.alerts || []).filter((a: { state: string }) => a.state === 'firing');
    },
    refetchInterval: 30000,
  });

  const { data: recentEvents = [] } = useQuery<K8sResource[]>({
    queryKey: ['admin', 'recent-events', clusterId],
    queryFn: async () => (await safeQuery(() => k8sList('/api/v1/events?fieldSelector=type=Warning&limit=100', undefined, clusterId))) ?? [],
    refetchInterval: 30000,
  });

  const { data: expiringCerts = [] } = useQuery<Array<{ name: string; namespace: string; daysLeft: number }>>({
    queryKey: ['admin', 'expiring-certs', clusterId],
    queryFn: async () => {
      // Same parsing as the Certificates tab: the certificate's own notAfter,
      // then cert-manager/service-ca annotations. No guessed lifetimes.
      const secrets = (await safeQuery(() => fetchTlsSecrets<TlsSecretLike>(clusterId))) ?? [];
      const expiring: Array<{ name: string; namespace: string; daysLeft: number }> = [];
      for (const s of secrets) {
        const info = parseCertExpiry(s);
        if (info.daysUntilExpiry !== null && info.daysUntilExpiry <= 30) {
          expiring.push({ name: info.name, namespace: info.namespace, daysLeft: info.daysUntilExpiry });
        }
      }
      return expiring.sort((a, b) => a.daysLeft - b.daysLeft);
    },
    staleTime: 300000,
  });

  const { data: crds = [] } = useQuery<CustomResourceDefinition[]>({
    queryKey: ['k8s', 'list', '/apis/apiextensions.k8s.io/v1/customresourcedefinitions', undefined, clusterId],
    queryFn: () => k8sList<CustomResourceDefinition>('/apis/apiextensions.k8s.io/v1/customresourcedefinitions', undefined, clusterId),
    staleTime: 60000,
  });

  const { data: quotas = [] } = useQuery<ResourceQuota[]>({
    queryKey: ['k8s', 'list', '/api/v1/resourcequotas', undefined, clusterId],
    queryFn: () => k8sList<ResourceQuota>('/api/v1/resourcequotas', undefined, clusterId),
    staleTime: 60000,
  });

  const { data: limitRanges = [] } = useQuery<LimitRange[]>({
    queryKey: ['k8s', 'list', '/api/v1/limitranges', undefined, clusterId],
    queryFn: () => k8sList<LimitRange>('/api/v1/limitranges', undefined, clusterId),
    staleTime: 60000,
  });

  const { data: oauthConfig } = useQuery({
    queryKey: ['admin', 'oauth', clusterId],
    queryFn: () => safeQuery(() => k8sGet<OAuthConfig>('/apis/config.openshift.io/v1/oauths/cluster', clusterId)),
    staleTime: 120000,
  });

  const { data: namespaces = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/namespaces', undefined, clusterId],
    queryFn: () => k8sList('/api/v1/namespaces', undefined, clusterId),
    staleTime: 60000,
  });

  const { data: etcdOperator } = useQuery({
    queryKey: ['admin', 'etcd-operator', clusterId],
    queryFn: () => safeQuery(() => k8sGet<OperatorResource>('/apis/operator.openshift.io/v1/etcds/cluster', clusterId)),
    staleTime: 60000,
  });

  const { data: apiServerOperator } = useQuery({
    queryKey: ['admin', 'apiserver-operator', clusterId],
    queryFn: () => safeQuery(() => k8sGet<OperatorResource>('/apis/operator.openshift.io/v1/kubeapiservers/cluster', clusterId)),
    staleTime: 60000,
  });

  const { data: ingressConfig } = useQuery({
    queryKey: ['admin', 'config', 'ingress', clusterId],
    queryFn: () => safeQuery(() => k8sGet<IngressConfig>('/apis/config.openshift.io/v1/ingresses/cluster', clusterId)),
    staleTime: 120000,
  });

  const { data: routerCert } = useQuery({
    queryKey: ['admin', 'router-cert', clusterId],
    queryFn: () => safeQuery(() => k8sGet<K8sResource>('/api/v1/namespaces/openshift-ingress/secrets/router-certs-default', clusterId)),
    staleTime: 300000,
  });

  const { data: pdbs = [] } = useQuery<PodDisruptionBudget[]>({
    queryKey: ['k8s', 'list', '/apis/policy/v1/poddisruptionbudgets', undefined, clusterId],
    queryFn: async () => (await safeQuery(() => k8sList<PodDisruptionBudget>('/apis/policy/v1/poddisruptionbudgets', undefined, clusterId))) ?? [],
    staleTime: 60000,
  });

  const { data: deployments = [] } = useQuery<Deployment[]>({
    queryKey: ['k8s', 'list', '/apis/apps/v1/deployments', undefined, clusterId],
    queryFn: async () => (await safeQuery(() => k8sList<Deployment>('/apis/apps/v1/deployments', undefined, clusterId))) ?? [],
    staleTime: 60000,
  });

  // Same queryKey ComputeView uses for MachineConfigPools — real per-pool node
  // rollout progress (updatedMachineCount/machineCount, Degraded/Updating
  // conditions), shared cache when both views have fetched it.
  const { data: machineConfigPools = [] } = useQuery<MachineConfigPool[]>({
    queryKey: ['compute', 'machineconfigpools', clusterId],
    queryFn: async () => (await safeQuery(() => k8sList<MachineConfigPool>('/apis/machineconfiguration.openshift.io/v1/machineconfigpools', undefined, clusterId))) ?? [],
    staleTime: 60000,
  });

  // Pods are only needed to correlate PodDisruptionBudgets against nodes
  // that are actually draining right now — skip the cluster-wide fetch
  // entirely unless an update is actively progressing.
  const { data: pods = [] } = useK8sListWatch<Pod>({
    apiPath: '/api/v1/pods',
    enabled: (clusterVersion?.status?.conditions || []).some((c: Condition) => c.type === 'Progressing' && c.status === 'True'),
  });

  const { data: etcdBackupExists } = useQuery({
    queryKey: ['admin', 'etcd-backup', clusterId],
    // Backup is served at config.openshift.io/v1alpha1 (feature-gated by
    // AutomatedEtcdBackup), not v1 — v1 has never existed for this resource.
    queryFn: async () => { const items = await safeQuery(() => k8sList('/apis/config.openshift.io/v1alpha1/backups', undefined, clusterId)); return items ? items.length > 0 : false; },
    staleTime: 60000,
  });


  // --- Computed values ---

  const overviewLoading = cvLoading || nodesLoading || opsLoading;
  const overviewError = cvError || nodesError || opsError;

  const cvVersion = clusterVersion?.status?.desired?.version || clusterVersion?.status?.history?.[0]?.version || '';
  const cvChannel = clusterVersion?.spec?.channel || '';
  const platform = infra?.status?.platform || infra?.status?.platformStatus?.type || '';
  const apiUrl = infra?.status?.apiServerURL || '';
  const controlPlaneTopology = useClusterStore((s) => s.controlPlaneTopology) || infra?.status?.controlPlaneTopology || '';
  const isHyperShift = useClusterStore((s) => s.isHyperShift);
  const availableUpdates = (clusterVersion?.status?.availableUpdates || []) as AvailableUpdate[];
  const isUpdating = (clusterVersion?.status?.conditions || []).some((c: Condition) => c.type === 'Progressing' && c.status === 'True');

  const degradedOperators = React.useMemo(() =>
    operators.filter((o) => o.status?.conditions?.some((c: Condition) => c.type === 'Degraded' && c.status === 'True'))
      .map(o => {
        const degradedCond = o.status?.conditions?.find((c: Condition) => c.type === 'Degraded' && c.status === 'True');
        return { name: o.metadata.name, message: degradedCond?.message || degradedCond?.reason || '' };
      }),
  [operators]);
  const opDegraded = degradedOperators.length;
  const opProgressing = operators.filter((o) => o.status?.conditions?.find((c: Condition) => c.type === 'Progressing' && c.status === 'True')).length;
  // Counted per operator, so one that is both degraded and progressing is not subtracted twice.
  const opSteady = operators.filter((o) => !o.status?.conditions?.some((c: Condition) =>
    (c.type === 'Degraded' || c.type === 'Progressing') && c.status === 'True')).length;

  const alertCounts = React.useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0 };
    for (const a of firingAlerts) {
      const sev = a.labels?.severity || 'warning';
      if (sev === 'critical') counts.critical++;
      else if (sev === 'warning') counts.warning++;
      else counts.info++;
    }
    return counts;
  }, [firingAlerts]);

  const latestEvents = React.useMemo(() => {
    return [...recentEvents]
      .sort((a, b) => {
        const aTime = (a as any).lastTimestamp || (a as any).firstTimestamp || a.metadata.creationTimestamp || '';
        const bTime = (b as any).lastTimestamp || (b as any).firstTimestamp || b.metadata.creationTimestamp || '';
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      })
      .slice(0, 5);
  }, [recentEvents]);

  const nodeRoles = React.useMemo(() => {
    const roles = new Map<string, number>();
    for (const n of nodes) {
      const labels = n.metadata.labels || {};
      const nodeRoleKeys = Object.keys(labels).filter(k => k.startsWith('node-role.kubernetes.io/')).map(k => k.replace('node-role.kubernetes.io/', ''));
      const normalized = new Set(nodeRoleKeys.map(r => r === 'master' ? 'control-plane' : r));
      for (const role of normalized) {
        roles.set(role, (roles.get(role) || 0) + 1);
      }
    }
    return [...roles.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  const clusterCapacity = React.useMemo(() => {
    let cpuAllocatable = 0, memAllocatable = 0, cpuCapacity = 0, memCapacity = 0, pods = 0;
    for (const node of nodes) {
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

  const nsStats = React.useMemo(() => {
    const all = namespaces;
    const system = all.filter(ns => {
      const name = ns.metadata?.name || '';
      return name.startsWith('openshift-') || name.startsWith('kube-') || name === 'default' || name === 'openshift';
    });
    return { total: all.length, user: all.length - system.length, system: system.length };
  }, [namespaces]);

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

  const certExpiry = React.useMemo(() => {
    // tls.crt is a base64 PEM; it has no "Not After" text to match. Parse it.
    const expDate = certNotAfterFromSecretData(routerCert?.data?.['tls.crt']);
    if (!expDate) return null;
    const daysLeft = Math.floor((expDate.getTime() - Date.now()) / 86400000);
    return { date: expDate, daysLeft };
  }, [routerCert]);

  const crdGroupCount = React.useMemo(() => {
    const groups = new Set<string>();
    for (const crd of crds) groups.add(crd.spec?.group || 'unknown');
    return groups.size;
  }, [crds]);

  const identityProviders = React.useMemo(() => {
    return oauthConfig?.spec?.identityProviders || [];
  }, [oauthConfig]);

  const quotaHotSpots = React.useMemo(() => {
    const spots: Array<{ namespace: string; resource: string; pct: number }> = [];
    for (const q of quotas) {
      const spec = q.spec?.hard || {};
      const status = q.status?.used || {};
      for (const [key, hardVal] of Object.entries(spec)) {
        const hard = parseResourceValue(String(hardVal));
        const used = parseResourceValue(String(status[key] || '0'));
        if (hard > 0) {
          const pct = (used / hard) * 100;
          if (pct >= 80) {
            spots.push({ namespace: q.metadata.namespace || '', resource: key, pct: Math.round(pct) });
          }
        }
      }
    }
    return spots.sort((a, b) => b.pct - a.pct).slice(0, 5);
  }, [quotas]);

  const go = useNavigateTab();
  const savedSnapshots = loadSnapshots();

  // --- Tab definitions (8 tabs) ---

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode; activeIcon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <Settings className="w-3.5 h-3.5 text-slate-400" />, activeIcon: <Settings className="w-3.5 h-3.5" /> },
    { id: 'operators', label: `Operators (${operators.length})${opDegraded > 0 ? ` \u00b7 ${opDegraded} degraded` : ''}`, icon: <Puzzle className="w-3.5 h-3.5 text-purple-400" />, activeIcon: <Puzzle className="w-3.5 h-3.5" /> },
    { id: 'config', label: 'Cluster Config', icon: <Database className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <Database className="w-3.5 h-3.5" /> },
    { id: 'updates', label: `Updates${availableUpdates.length > 0 ? ` (${availableUpdates.length})` : ''}`, icon: <ArrowUpCircle className="w-3.5 h-3.5 text-green-400" />, activeIcon: <ArrowUpCircle className="w-3.5 h-3.5" /> },
    { id: 'snapshots', label: `Snapshots (${savedSnapshots.length})`, icon: <GitCompare className="w-3.5 h-3.5 text-blue-400" />, activeIcon: <GitCompare className="w-3.5 h-3.5" /> },
    { id: 'quotas', label: `Quotas (${quotas.length})`, icon: <Gauge className="w-3.5 h-3.5 text-amber-400" />, activeIcon: <Gauge className="w-3.5 h-3.5" /> },
    { id: 'certificates', label: 'Certificates', icon: <Lock className="w-3.5 h-3.5 text-red-400" />, activeIcon: <Lock className="w-3.5 h-3.5" /> },
    { id: 'csrs', label: 'Certificate requests', icon: <FileKey className="w-3.5 h-3.5 text-amber-400" />, activeIcon: <FileKey className="w-3.5 h-3.5" /> },
    { id: 'crds', label: `CRDs (${crds.length})`, icon: <Blocks className="w-3.5 h-3.5 text-indigo-400" />, activeIcon: <Blocks className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <SectionHeader
          icon={<Settings className="w-6 h-6 text-slate-400" />}
          title="Administration"
          subtitle="Cluster configuration, updates, and snapshots"
        />

        {/* Tabs */}
        <div
          className="flex gap-1 bg-slate-900 rounded-lg border border-slate-800 p-1 overflow-x-auto"
          role="tablist"
          aria-label="Administration tabs"
          onKeyDown={(e) => {
            const ids = tabs.map((t) => t.id);
            const idx = ids.indexOf(activeTab);
            if (e.key === 'ArrowRight') { e.preventDefault(); setActiveTab(ids[(idx + 1) % ids.length]); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveTab(ids[(idx - 1 + ids.length) % ids.length]); }
          }}
        >
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={activeTab === t.id} aria-controls={`admin-panel-${t.id}`} tabIndex={activeTab === t.id ? 0 : -1} onClick={() => setActiveTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500', activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              {activeTab === t.id ? t.activeIcon : t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* ===== OVERVIEW ===== */}
        {activeTab === 'overview' && (
          <>
          {/* Production Readiness summary */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Production Readiness</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Security, reliability, and observability gates for production clusters.
                </p>
              </div>
              <button
                onClick={() => go('/readiness', 'Production Readiness')}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap"
              >
                View Details →
              </button>
            </div>
          </div>

          <OverviewTab
            overviewLoading={overviewLoading}
            overviewError={overviewError}
            firingAlerts={firingAlerts}
            alertsUnavailable={!!firingAlertsError}
            alertsUnavailableReason={firingAlertsError instanceof MetricsUnavailableError ? 'Alert status is available for the local cluster only — Pulse cannot reach this cluster\'s Prometheus' : undefined}
            alertCounts={alertCounts}
            operators={operators}
            opDegraded={opDegraded}
            opProgressing={opProgressing}
            opSteady={opSteady}
            degradedOperators={degradedOperators}
            nodes={nodes}
            nodeRoles={nodeRoles}
            cvVersion={cvVersion}
            cvChannel={cvChannel}
            platform={platform}
            apiUrl={apiUrl}
            controlPlaneTopology={controlPlaneTopology}
            isHyperShift={isHyperShift}
            clusterAge={clusterAge}
            nsStats={nsStats}
            crds={crds}
            crdGroupCount={crdGroupCount}
            availableUpdates={availableUpdates}
            expiringCerts={expiringCerts}
            quotaHotSpots={quotaHotSpots}
            clusterCapacity={clusterCapacity}
            apiServerOperator={apiServerOperator}
            etcdOperator={etcdOperator}
            identityProviders={identityProviders}
            ingressConfig={ingressConfig}
            certExpiry={certExpiry}
            quotas={quotas}
            limitRanges={limitRanges}
            latestEvents={latestEvents}
            recentEvents={recentEvents}
            setActiveTab={setActiveTab}
            go={go}
          />
          </>
        )}

        {/* ===== OPERATORS ===== */}
        {activeTab === 'operators' && <OperatorsTab operators={operators} go={go} />}

        {/* ===== CLUSTER CONFIG ===== */}
        {activeTab === 'config' && <ClusterConfig />}

        {/* ===== UPDATES ===== */}
        {activeTab === 'updates' && (
          <UpdatesTab
            clusterVersion={clusterVersion}
            cvVersion={cvVersion}
            cvChannel={cvChannel}
            platform={platform}
            availableUpdates={availableUpdates}
            isUpdating={isUpdating}
            operators={operators}
            nodes={nodes}
            deployments={deployments}
            pdbs={pdbs}
            etcdBackupExists={etcdBackupExists}
            isHyperShift={isHyperShift}
            machineConfigPools={machineConfigPools}
            pods={pods}
            go={go}
          />
        )}

        {/* ===== SNAPSHOTS ===== */}
        {activeTab === 'snapshots' && <SnapshotsTab />}

        {/* ===== QUOTAS ===== */}
        {activeTab === 'quotas' && <QuotasTab quotas={quotas} limitRanges={limitRanges} go={go} />}

        {/* ===== CERTIFICATES ===== */}
        {activeTab === 'certificates' && <CertificatesTab go={go} />}

        {/* ===== CERTIFICATE SIGNING REQUESTS ===== */}
        {activeTab === 'csrs' && <CsrTab go={go} />}

        {/* ===== CRDs ===== */}
        {activeTab === 'crds' && <Suspense fallback={<div className="text-center py-8 text-slate-500 text-sm">Loading...</div>}><CRDsView /></Suspense>}

      </div>
    </div>
  );
}

