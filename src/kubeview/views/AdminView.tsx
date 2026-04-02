import React, { Suspense, lazy } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Settings, Puzzle, Shield, Database, GitBranch,
  ArrowUpCircle, GitCompare, Gauge, Lock, Blocks,
} from 'lucide-react';

const CRDsView = lazy(() => import('./CRDsView'));

import { cn } from '@/lib/utils';
import { k8sList, k8sGet } from '../engine/query';
import { fetchAgentEvalStatus } from '../engine/evalStatus';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import type { K8sResource } from '../engine/renderers';
import type { ClusterVersion, ClusterOperator, Node, Condition } from '../engine/types';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useClusterStore } from '../store/clusterStore';
import ClusterConfig from '../components/ClusterConfig';
import { parseCpu, parseMem, parseResourceValue } from '../engine/formatting';
import { QuotasTab } from './admin/QuotasTab';
import { CertificatesTab } from './admin/CertificatesTab';
import { OverviewTab } from './admin/OverviewTab';
import { OperatorsTab } from './admin/OperatorsTab';
import { UpdatesTab } from './admin/UpdatesTab';
import { SnapshotsTab } from './admin/SnapshotsTab';
import { loadSnapshots } from '../engine/snapshot';
import { GitOpsConfig } from '../components/GitOpsConfig';
import { SectionHeader } from '../components/primitives/SectionHeader';
import { getAllFlags, setFeatureFlag } from '../engine/featureFlags';
import type { FeatureFlag } from '../engine/featureFlags';

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

/** Available update entry */
interface AvailableUpdate {
  version: string;
  image?: string;
  risks?: Array<{ name?: string; message?: string }>;
}

type Tab = 'overview' | 'operators' | 'config' | 'updates' | 'snapshots' | 'quotas' | 'certificates' | 'crds';

// --- Main component ---

export default function AdminView() {
  const searchParams = new URLSearchParams(window.location.search);
  const initialTab = (searchParams.get('tab') as Tab) || 'overview';
  const [activeTab, setActiveTabState] = React.useState<Tab>(initialTab);
  const setActiveTab = (tab: Tab | string) => {
    setActiveTabState(tab as Tab);
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  };

  // --- Data fetching ---

  const { data: clusterVersion, isLoading: cvLoading, isError: cvError } = useQuery({
    queryKey: ['admin', 'clusterversion'],
    queryFn: () => k8sGet<ClusterVersion>('/apis/config.openshift.io/v1/clusterversions/version').catch(() => null),
    staleTime: 60000,
  });

  const { data: infra } = useQuery({
    queryKey: ['admin', 'infra'],
    queryFn: () => k8sGet<Infrastructure>('/apis/config.openshift.io/v1/infrastructures/cluster').catch(() => null),
    staleTime: 60000,
  });

  const { data: nodes = [], isLoading: nodesLoading, isError: nodesError } = useK8sListWatch<K8sResource>({
    apiPath: '/api/v1/nodes',
  });

  const { data: operators = [], isLoading: opsLoading, isError: opsError } = useK8sListWatch<K8sResource>({
    apiPath: '/apis/config.openshift.io/v1/clusteroperators',
  });

  const { data: firingAlerts = [] } = useQuery<Array<{ labels: Record<string, string>; annotations: Record<string, string>; state: string }>>({
    queryKey: ['admin', 'firing-alerts'],
    queryFn: async () => {
      const res = await fetch('/api/prometheus/api/v1/alerts');
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data?.alerts || []).filter((a: { state: string }) => a.state === 'firing');
    },
    refetchInterval: 30000,
  });

  const { data: recentEvents = [] } = useQuery<K8sResource[]>({
    queryKey: ['admin', 'recent-events'],
    queryFn: () => k8sList('/api/v1/events?fieldSelector=type=Warning&limit=100').catch(() => []),
    refetchInterval: 30000,
  });

  const { data: expiringCerts = [] } = useQuery<Array<{ name: string; namespace: string; daysLeft: number }>>({
    queryKey: ['admin', 'expiring-certs'],
    queryFn: async () => {
      const secrets = await k8sList('/api/v1/secrets?fieldSelector=type=kubernetes.io/tls').catch(() => []);
      const expiring: Array<{ name: string; namespace: string; daysLeft: number }> = [];
      for (const s of secrets as K8sResource[]) {
        const annotations = s.metadata.annotations || {};
        const expiryStr = annotations['cert-manager.io/certificate-expiry'] || '';
        const serviceCA = annotations['service.beta.openshift.io/originating-service-name'];
        const created = s.metadata.creationTimestamp;
        let daysLeft = Infinity;
        if (expiryStr) {
          daysLeft = Math.floor((new Date(expiryStr).getTime() - Date.now()) / 86400000);
        } else if (serviceCA && created) {
          daysLeft = Math.floor((new Date(created).getTime() + 26 * 30 * 86400000 - Date.now()) / 86400000);
        }
        if (daysLeft <= 30 && daysLeft > -999) {
          expiring.push({ name: s.metadata.name, namespace: s.metadata.namespace || '', daysLeft });
        }
      }
      return expiring.sort((a, b) => a.daysLeft - b.daysLeft);
    },
    staleTime: 300000,
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

  const { data: namespaces = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/namespaces'],
    queryFn: () => k8sList('/api/v1/namespaces'),
    staleTime: 60000,
  });

  const { data: etcdOperator } = useQuery({
    queryKey: ['admin', 'etcd-operator'],
    queryFn: () => k8sGet<OperatorResource>('/apis/operator.openshift.io/v1/etcds/cluster').catch(() => null),
    staleTime: 60000,
  });

  const { data: apiServerOperator } = useQuery({
    queryKey: ['admin', 'apiserver-operator'],
    queryFn: () => k8sGet<OperatorResource>('/apis/operator.openshift.io/v1/kubeapiservers/cluster').catch(() => null),
    staleTime: 60000,
  });

  const { data: ingressConfig } = useQuery({
    queryKey: ['admin', 'config', 'ingress'],
    queryFn: () => k8sGet<IngressConfig>('/apis/config.openshift.io/v1/ingresses/cluster').catch(() => null),
    staleTime: 120000,
  });

  const { data: routerCert } = useQuery({
    queryKey: ['admin', 'router-cert'],
    queryFn: () => k8sGet<K8sResource>('/api/v1/namespaces/openshift-ingress/secrets/router-certs-default').catch(() => null),
    staleTime: 300000,
  });

  const { data: pdbs = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/policy/v1/poddisruptionbudgets'],
    queryFn: () => k8sList('/apis/policy/v1/poddisruptionbudgets').catch(() => []),
    staleTime: 60000,
  });

  const { data: deployments = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/apps/v1/deployments'],
    queryFn: () => k8sList('/apis/apps/v1/deployments').catch(() => []),
    staleTime: 60000,
  });

  const { data: etcdBackupExists } = useQuery({
    queryKey: ['admin', 'etcd-backup'],
    queryFn: () => k8sList('/apis/config.openshift.io/v1/backups').then((items: K8sResource[]) => items.length > 0).catch(() => false),
    staleTime: 60000,
  });

  const { data: evalStatus, isLoading: evalLoading } = useQuery({
    queryKey: ['agent', 'eval-status'],
    queryFn: () => fetchAgentEvalStatus().catch(() => null),
    refetchInterval: 60000,
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
    operators.filter((o) => (o as unknown as ClusterOperator).status?.conditions?.some((c: Condition) => c.type === 'Degraded' && c.status === 'True'))
      .map(o => {
        const op = o as unknown as ClusterOperator;
        const degradedCond = op.status?.conditions?.find((c: Condition) => c.type === 'Degraded' && c.status === 'True');
        return { name: o.metadata.name, message: degradedCond?.message || degradedCond?.reason || '' };
      }),
  [operators]);
  const opDegraded = degradedOperators.length;
  const opProgressing = operators.filter((o) => (o as unknown as ClusterOperator).status?.conditions?.find((c: Condition) => c.type === 'Progressing' && c.status === 'True')).length;

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
    if (!routerCert?.data?.['tls.crt']) return null;
    try {
      const pem = atob(routerCert.data['tls.crt']);
      const match = pem.match(/Not After\s*:\s*(.+)/);
      if (match) {
        const expDate = new Date(match[1]);
        const daysLeft = Math.floor((expDate.getTime() - Date.now()) / 86400000);
        return { date: expDate, daysLeft };
      }
    } catch (err) { console.warn('Failed to parse certificate expiry:', err); }
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

  const quotaHotSpots = React.useMemo(() => {
    const spots: Array<{ namespace: string; resource: string; pct: number }> = [];
    for (const q of quotas as K8sResource[]) {
      const spec = (q as any).spec?.hard || {};
      const status = (q as any).status?.used || {};
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

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Agent Eval Score</h3>
              <p className="text-xs text-slate-500 mt-1">
                Eval score from static fixtures. Use &apos;pulse-eval replay&apos; for live agent testing.
              </p>
            </div>
            <span
              className={cn(
                'text-xs px-2.5 py-1 rounded border',
                evalLoading
                  ? 'bg-slate-800 text-slate-300 border-slate-700'
                  : evalStatus?.quality_gate_passed
                    ? 'bg-green-900/40 text-green-300 border-green-800/60'
                    : evalStatus
                      ? 'bg-amber-900/40 text-amber-300 border-amber-800/60'
                      : 'bg-slate-800 text-slate-300 border-slate-700',
              )}
            >
              {evalLoading ? 'Checking' : evalStatus ? (evalStatus.quality_gate_passed ? 'PASS' : 'FAIL') : 'Unavailable'}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
              <div className="text-slate-400">Release gate</div>
              <div className={cn(
                'mt-1 font-medium',
                evalStatus?.release
                  ? (evalStatus.release.gate_passed ? 'text-green-300' : 'text-amber-300')
                  : 'text-slate-300',
              )}>
                {evalStatus?.release ? (evalStatus.release.gate_passed ? 'PASS' : 'FAIL') : 'n/a'}
              </div>
            </div>
            <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
              <div className="text-slate-400">Outcomes gate</div>
              <div className={cn(
                'mt-1 font-medium',
                evalStatus?.outcomes
                  ? (evalStatus.outcomes.gate_passed ? 'text-green-300' : 'text-amber-300')
                  : 'text-slate-300',
              )}>
                {evalStatus?.outcomes ? (evalStatus.outcomes.gate_passed ? 'PASS' : 'FAIL') : 'n/a'}
              </div>
            </div>
            <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
              <div className="text-slate-400">Last eval run</div>
              <div className="mt-1 font-medium text-slate-300">
                {evalStatus?.generated_at_ms ? new Date(evalStatus.generated_at_ms).toLocaleString() : 'n/a'}
              </div>
            </div>
          </div>
        </div>

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
            <button key={t.id} role="tab" aria-selected={activeTab === t.id} aria-controls={`admin-panel-${t.id}`} tabIndex={activeTab === t.id ? 0 : -1} onClick={() => setActiveTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              {activeTab === t.id ? t.activeIcon : t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* ===== OVERVIEW ===== */}
        {activeTab === 'overview' && (
          <>
          <FeatureFlagsSection />

          {/* Production Readiness summary */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Production Readiness</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Security, reliability, and observability gates for production clusters.
                </p>
              </div>
              <a
                href="/readiness"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap"
              >
                View Details →
              </a>
            </div>
          </div>

          <OverviewTab
            overviewLoading={overviewLoading}
            overviewError={overviewError}
            firingAlerts={firingAlerts}
            alertCounts={alertCounts}
            operators={operators}
            opDegraded={opDegraded}
            opProgressing={opProgressing}
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
          />
        )}

        {/* ===== SNAPSHOTS ===== */}
        {activeTab === 'snapshots' && <SnapshotsTab />}

        {/* ===== QUOTAS ===== */}
        {activeTab === 'quotas' && <QuotasTab quotas={quotas} limitRanges={limitRanges} go={go} />}

        {/* ===== CERTIFICATES ===== */}
        {activeTab === 'certificates' && <CertificatesTab go={go} />}

        {/* ===== CRDs ===== */}
        {activeTab === 'crds' && <Suspense fallback={<div className="text-center py-8 text-slate-500 text-sm">Loading...</div>}><CRDsView /></Suspense>}

      </div>
    </div>
  );
}

const FLAG_LABELS: Record<FeatureFlag, { label: string; description: string }> = {
  incidentCenter: { label: 'Incident Center', description: 'Correlated incidents view at /incidents' },
  identityView: { label: 'Identity & Access', description: 'Unified identity management at /identity' },
  welcomeLaunchpad: { label: 'Welcome Launchpad', description: 'Enhanced welcome page with cluster state, onboarding CTA, and top issues' },
  onboarding: { label: 'Onboarding Wizard', description: 'Guided cluster readiness at /readiness' },
  reviewQueue: { label: 'Review Queue', description: 'AI-proposed infrastructure changes at /reviews' },
  enhancedPulse: { label: 'Enhanced Pulse', description: 'AI morning briefing and insights on Pulse page' },
  askPulse: { label: 'Ask Pulse', description: 'Natural language queries in Cmd+K search palette' },
};

function FeatureFlagsSection() {
  const [flags, setFlags] = React.useState(getAllFlags);

  const toggle = (flag: FeatureFlag) => {
    const next = !flags[flag];
    setFeatureFlag(flag, next);
    setFlags(getAllFlags());
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Settings className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-200">Feature Flags</h3>
        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-800/50">Preview</span>
      </div>
      <p className="text-xs text-slate-500">Toggle experimental features. Changes take effect on next navigation.</p>
      <div className="divide-y divide-slate-800/60">
        {(Object.keys(FLAG_LABELS) as FeatureFlag[]).map((flag) => (
          <div key={flag} className="flex items-center justify-between py-2.5">
            <div>
              <div className="text-sm text-slate-200">{FLAG_LABELS[flag].label}</div>
              <div className="text-xs text-slate-500">{FLAG_LABELS[flag].description}</div>
            </div>
            <button
              onClick={() => toggle(flag)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                flags[flag] ? 'bg-blue-600' : 'bg-slate-700',
              )}
              role="switch"
              aria-checked={flags[flag]}
              aria-label={`Toggle ${FLAG_LABELS[flag].label}`}
            >
              <span className={cn(
                'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                flags[flag] ? 'translate-x-4' : 'translate-x-0',
              )} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}