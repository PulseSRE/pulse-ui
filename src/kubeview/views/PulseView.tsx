import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HeartPulse, AlertCircle, XCircle, CheckCircle, Server, Box, Package,
  HardDrive, ShieldAlert, Heart, ArrowRight, Puzzle, Shield, Clock,
  Activity, Cpu, Search, FileText, ChevronDown, ChevronRight, Loader2,
  Zap, GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sGet } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { getPodStatus, getNodeStatus, getDeploymentStatus } from '../engine/renderers/statusUtils';
import { kindToPlural } from '../engine/renderers/index';
import { diagnoseResource, type Diagnosis } from '../engine/diagnosis';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { resourceDetailUrl } from '../engine/gvr';
import { queryInstant } from '../components/metrics/prometheus';
import { MetricCard } from '../components/metrics/Sparkline';
import { useK8sListWatch } from '../hooks/useK8sListWatch';

function filterByNamespace<T extends { metadata: { namespace?: string } }>(items: T[], ns: string): T[] {
  if (ns === '*') return items;
  return items.filter((i) => i.metadata.namespace === ns);
}

type Tab = 'overview' | 'issues' | 'runbooks' | 'health';

interface DiagnosedResource {
  resource: K8sResource;
  diagnoses: Diagnosis[];
  maxSeverity: 'critical' | 'warning' | 'info';
}

export default function PulseView() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const urlTab = new URLSearchParams(window.location.search).get('tab') as Tab;
  const [activeTab, setActiveTabState] = useState<Tab>(urlTab || 'overview');
  const setActiveTab = (tab: Tab) => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedResource, setExpandedResource] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');

  // Core resource queries — real-time via WebSocket watches
  // Pass namespace to namespaced resources so the API call is server-side scoped (avoids fetching all cluster pods)
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;
  const { data: nodes = [] } = useK8sListWatch({ apiPath: '/api/v1/nodes' });
  const { data: pods = [], isLoading: podsLoading } = useK8sListWatch({ apiPath: '/api/v1/pods', namespace: nsFilter });
  const { data: deployments = [] } = useK8sListWatch({ apiPath: '/apis/apps/v1/deployments', namespace: nsFilter });
  const { data: pvcs = [] } = useK8sListWatch({ apiPath: '/api/v1/persistentvolumeclaims', namespace: nsFilter });
  const { data: operators = [] } = useK8sListWatch({ apiPath: '/apis/config.openshift.io/v1/clusteroperators' });

  // Cluster version
  const { data: clusterVersion } = useQuery({
    queryKey: ['pulse', 'clusterversion'],
    queryFn: () => k8sGet<any>('/apis/config.openshift.io/v1/clusterversions/version').catch(() => null),
    staleTime: 60000,
  });

  // Cluster metrics (CPU/Memory)
  const { data: cpuMetrics } = useQuery({
    queryKey: ['pulse', 'cpu'],
    queryFn: () => queryInstant('sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) / sum(machine_cpu_cores) * 100').catch(() => []),
    refetchInterval: 30000,
  });
  const { data: memMetrics } = useQuery({
    queryKey: ['pulse', 'memory'],
    queryFn: () => queryInstant('(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100').catch(() => []),
    refetchInterval: 30000,
  });
  const cpuPercent = cpuMetrics?.[0]?.value ?? null;
  const memPercent = memMetrics?.[0]?.value ?? null;

  // Namespace filter
  const filteredPods = React.useMemo(() => filterByNamespace(pods as any[], selectedNamespace), [pods, selectedNamespace]);
  const filteredDeployments = React.useMemo(() => filterByNamespace(deployments as any[], selectedNamespace), [deployments, selectedNamespace]);

  // === ISSUES ===

  // Failing pods (exclude installer/job pods)
  const failingPods = React.useMemo(() => {
    return filteredPods.filter((pod) => {
      const status = getPodStatus(pod);
      const name = pod.metadata.name;
      const owners = pod.metadata.ownerReferences || [];
      const ownedByJob = owners.some((o) => o.kind === 'Job');
      const isInstaller = name.startsWith('installer-') || name.startsWith('revision-pruner-');

      if (status.reason === 'CrashLoopBackOff' || status.reason === 'ImagePullBackOff' || status.reason === 'ErrImagePull') return true;
      if (status.phase === 'Failed' && !ownedByJob && !isInstaller) return true;
      return false;
    });
  }, [filteredPods]);

  // Unhealthy deployments
  const unhealthyDeploys = React.useMemo(() => {
    return filteredDeployments.filter((d) => !getDeploymentStatus(d).available);
  }, [filteredDeployments]);

  // Unready nodes
  const unreadyNodes = React.useMemo(() => nodes.filter((n) => !getNodeStatus(n).ready), [nodes]);

  // Nodes with pressure (but still Ready)
  const pressureNodes = React.useMemo(() => {
    return nodes.filter((n) => {
      const s = getNodeStatus(n);
      return s.ready && (s.pressure.disk || s.pressure.memory || s.pressure.pid);
    });
  }, [nodes]);

  // Pending PVCs (namespace-filtered)
  const filteredPVCs = React.useMemo(() => filterByNamespace(pvcs as any[], selectedNamespace), [pvcs, selectedNamespace]);
  const pendingPVCs = React.useMemo(() => filteredPVCs.filter((pvc) => (pvc.status as any)?.phase === 'Pending'), [filteredPVCs]);

  // Degraded operators
  const degradedOperators = React.useMemo(() => {
    return operators.filter((op: any) => {
      const conditions = op.status?.conditions || [];
      return conditions.some((c: any) => c.type === 'Degraded' && c.status === 'True');
    });
  }, [operators]);

  // Cluster update available
  const updateAvailable = React.useMemo(() => {
    if (!clusterVersion) return null;
    const conditions = clusterVersion.status?.conditions || [];
    const progressing = conditions.find((c: any) => c.type === 'Progressing');
    const available = clusterVersion.status?.availableUpdates;
    if (available && available.length > 0) return available[0].version;
    if (progressing?.status === 'True') return progressing.message;
    return null;
  }, [clusterVersion]);

  // Summary
  const healthyPods = filteredPods.filter((p) => { const s = getPodStatus(p); return s.phase === 'Running' && s.ready; }).length;
  const healthyDeploys = filteredDeployments.filter((d) => getDeploymentStatus(d).available).length;
  const healthyNodes = nodes.filter((n) => getNodeStatus(n).ready).length;
  const totalIssues = failingPods.length + unhealthyDeploys.length + unreadyNodes.length + pendingPVCs.length + degradedOperators.length + pressureNodes.length;
  const isLoading = podsLoading;

  // === DIAGNOSIS (for Issues tab) ===
  const diagnosedResources = useMemo<DiagnosedResource[]>(() => {
    const all = [...filteredPods, ...filteredDeployments, ...nodes, ...filteredPVCs];
    const results: DiagnosedResource[] = [];
    for (const resource of all) {
      const diagnoses = diagnoseResource(resource);
      if (diagnoses.length > 0) {
        const hasCritical = diagnoses.some((d) => d.severity === 'critical');
        const hasWarning = diagnoses.some((d) => d.severity === 'warning');
        results.push({ resource, diagnoses, maxSeverity: hasCritical ? 'critical' : hasWarning ? 'warning' : 'info' });
      }
    }
    return results.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.maxSeverity] - { critical: 0, warning: 1, info: 2 }[b.maxSeverity]));
  }, [filteredPods, filteredDeployments, nodes, filteredPVCs]);

  const filteredDiagnosedResources = useMemo(() => {
    let results = diagnosedResources;
    if (filter !== 'all') results = results.filter((r) => r.maxSeverity === filter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      results = results.filter((r) =>
        r.resource.metadata.name.toLowerCase().includes(q) ||
        r.resource.kind.toLowerCase().includes(q) ||
        r.resource.metadata.namespace?.toLowerCase().includes(q) ||
        r.diagnoses.some((d) => d.title.toLowerCase().includes(q))
      );
    }
    return results;
  }, [diagnosedResources, filter, searchQuery]);

  const criticalCount = diagnosedResources.filter((r) => r.maxSeverity === 'critical').length;
  const warningCount = diagnosedResources.filter((r) => r.maxSeverity === 'warning').length;

  // === NAMESPACE HEALTH (for Health tab) ===
  const namespaceHealth = useMemo(() => {
    const map = new Map<string, { total: number; healthy: number; critical: number; warning: number }>();
    for (const pod of pods) {
      const ns = pod.metadata.namespace || 'default';
      const name = pod.metadata.name;
      const owners = pod.metadata.ownerReferences || [];

      // Skip completed installer/job pods
      const isInstaller = name.startsWith('installer-') || name.startsWith('revision-pruner-');
      const ownedByJob = owners.some((o) => o.kind === 'Job');
      const status = getPodStatus(pod);
      if ((isInstaller || ownedByJob) && (status.phase === 'Failed' || status.phase === 'Succeeded')) continue;

      const entry = map.get(ns) || { total: 0, healthy: 0, critical: 0, warning: 0 };
      entry.total++;
      if (status.phase === 'Running' && status.ready) entry.healthy++;
      else if (status.phase === 'Succeeded') entry.healthy++;
      else if (status.reason === 'CrashLoopBackOff' || status.reason === 'ImagePullBackOff' || status.phase === 'Failed') entry.critical++;
      else if (status.phase === 'Pending') entry.warning++;
      else entry.healthy++;
      map.set(ns, entry);
    }
    return [...map.entries()]
      .map(([ns, h]) => ({ ns, ...h, score: h.total > 0 ? Math.round((h.healthy / h.total) * 100) : 100 }))
      .sort((a, b) => a.score - b.score);
  }, [pods]);

  // === RUNBOOKS ===
  const runbooks = [
    { id: 'crashloop', title: 'Pod CrashLoopBackOff', icon: '🔄', severity: 'critical' as const,
      count: filteredPods.filter((p) => getPodStatus(p).reason === 'CrashLoopBackOff').length,
      steps: ['Check pod logs for error messages', 'Verify image exists and is pullable', 'Check resource limits (OOM kills)', 'Review liveness probe configuration', 'Check for missing ConfigMaps/Secrets'] },
    { id: 'imagepull', title: 'Image Pull Failures', icon: '📦', severity: 'critical' as const,
      count: filteredPods.filter((p) => getPodStatus(p).reason === 'ImagePullBackOff' || getPodStatus(p).reason === 'ErrImagePull').length,
      steps: ['Verify image name and tag are correct', 'Check registry credentials (imagePullSecrets)', 'Verify network connectivity to registry', 'Check if image exists in the registry'] },
    { id: 'pending', title: 'Pods Stuck Pending', icon: '⏳', severity: 'warning' as const,
      count: filteredPods.filter((p) => getPodStatus(p).phase === 'Pending').length,
      steps: ['Check node resources (CPU/memory available)', 'Review node taints and pod tolerations', 'Check nodeSelector and affinity rules', 'Verify PVC is bound if volumes are used', 'Check resource quotas in the namespace'] },
    { id: 'deploy', title: 'Deployment Unavailable', icon: '🚫', severity: 'warning' as const,
      count: filteredDeployments.filter((d) => !getDeploymentStatus(d).available).length,
      steps: ['Check pod status in the deployment', 'Review deployment events', 'Verify image and pull policy', 'Check for resource quota limits', 'Review rollout history for recent changes'] },
    { id: 'node', title: 'Node Not Ready', icon: '🖥️', severity: 'critical' as const,
      count: nodes.filter((n) => !getNodeStatus(n).ready).length,
      steps: ['Check kubelet status on the node', 'Review node conditions (DiskPressure, MemoryPressure)', 'Check network connectivity to control plane', 'Review system logs (journalctl -u kubelet)', 'Check for certificate expiration'] },
    { id: 'pvc', title: 'PVC Stuck Pending', icon: '💾', severity: 'warning' as const,
      count: filteredPVCs.filter((p) => (p.status as any)?.phase === 'Pending').length,
      steps: ['Check if StorageClass exists and is valid', 'Verify storage provisioner is running', 'Check if PVs are available (for static provisioning)', 'Review storage class parameters', 'Check cloud provider quotas'] },
  ];

  const kindIcon: Record<string, React.ReactNode> = {
    Pod: <Box className="w-4 h-4" />, Deployment: <Package className="w-4 h-4" />,
    Node: <Server className="w-4 h-4" />, PersistentVolumeClaim: <HardDrive className="w-4 h-4" />,
  };

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <HeartPulse className="w-6 h-6 text-blue-500" />
              Cluster Pulse
            </h1>
            <p className="text-sm text-slate-400 mt-1">Active issues that need your attention</p>
          </div>
          {totalIssues === 0 && !isLoading ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-800 rounded-lg">
              <Heart className="w-5 h-5 text-green-400" />
              <span className="text-sm font-medium text-green-300">All systems healthy</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-900/30 border border-red-800 rounded-lg">
              <ShieldAlert className="w-5 h-5 text-red-400" />
              <span className="text-sm font-medium text-red-300">{totalIssues} issue{totalIssues !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Namespace stats */}
        {selectedNamespace !== '*' && (
          <div className="text-xs text-blue-400 font-medium flex items-center gap-1.5">
            <Box className="w-3 h-3" />
            Namespace: {selectedNamespace}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="Pods" value={`${healthyPods}/${filteredPods.length}`} icon={<Box className="w-4 h-4" />} issues={failingPods.length} onClick={() => go('/r/v1~pods', 'Pods')} />
          <StatCard label="Deployments" value={`${healthyDeploys}/${filteredDeployments.length}`} icon={<Package className="w-4 h-4" />} issues={unhealthyDeploys.length} onClick={() => go('/r/apps~v1~deployments', 'Deployments')} />
          <StatCard label="PVCs" value={`${filteredPVCs.length - pendingPVCs.length}/${filteredPVCs.length}`} icon={<HardDrive className="w-4 h-4" />} issues={pendingPVCs.length} onClick={() => go('/r/v1~persistentvolumeclaims', 'PVCs')} />
        </div>

        {/* Cluster stats */}
        <div className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
          <Server className="w-3 h-3" />
          Cluster-wide
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Nodes" value={`${healthyNodes}/${nodes.length}`} icon={<Server className="w-4 h-4" />} issues={unreadyNodes.length + pressureNodes.length} onClick={() => go('/r/v1~nodes', 'Nodes')} />
          <StatCard label="Operators" value={`${operators.length - degradedOperators.length}/${operators.length}`} icon={<Puzzle className="w-4 h-4" />} issues={degradedOperators.length} onClick={() => go('/admin', 'Administration')} />
          <StatCard label="CPU" value={cpuPercent !== null ? `${Math.round(cpuPercent)}%` : '—'} icon={<Cpu className="w-4 h-4" />} issues={cpuPercent !== null && cpuPercent > 80 ? 1 : 0} />
          <StatCard label="Memory" value={memPercent !== null ? `${Math.round(memPercent)}%` : '—'} icon={<Activity className="w-4 h-4" />} issues={memPercent !== null && memPercent > 80 ? 1 : 0} />
        </div>

        {/* Metrics charts */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            title="CPU Usage"
            query="sum(rate(node_cpu_seconds_total{mode!='idle'}[5m])) / sum(machine_cpu_cores) * 100"
            unit="%"
            color="#3b82f6"
            thresholds={{ warning: 70, critical: 90 }}
          />
          <MetricCard
            title="Memory Usage"
            query="(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100"
            unit="%"
            color="#8b5cf6"
            thresholds={{ warning: 75, critical: 90 }}
          />
          <MetricCard
            title="Network In"
            query="sum(rate(node_network_receive_bytes_total{device!~'lo|veth.*|br.*'}[5m])) / 1024 / 1024"
            unit=" MB/s"
            color="#06b6d4"
          />
          <MetricCard
            title="Disk I/O"
            query="sum(rate(node_disk_read_bytes_total[5m]) + rate(node_disk_written_bytes_total[5m])) / 1024 / 1024"
            unit=" MB/s"
            color="#f59e0b"
          />
        </div>

        {/* Cluster update available */}
        {updateAvailable && (
          <div className="bg-blue-950/30 border border-blue-800 rounded-lg px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-blue-400" />
              <div>
                <span className="text-sm font-medium text-blue-300">Cluster update available</span>
                <span className="text-xs text-blue-400 ml-2">{updateAvailable}</span>
              </div>
            </div>
            <button onClick={() => go('/admin', 'Administration')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              Administration <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1">
          {([
            { id: 'overview' as Tab, label: 'Overview', icon: <HeartPulse className="w-3.5 h-3.5" /> },
            { id: 'issues' as Tab, label: `Issues (${diagnosedResources.length})`, icon: <AlertCircle className="w-3.5 h-3.5" /> },
            { id: 'runbooks' as Tab, label: 'Runbooks', icon: <FileText className="w-3.5 h-3.5" /> },
            { id: 'health' as Tab, label: 'Namespace Health', icon: <Activity className="w-3.5 h-3.5" /> },
          ]).map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors', activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* === OVERVIEW TAB === */}
        {activeTab === 'overview' && (
          <>
            {/* === Namespace issues === */}
            {(failingPods.length > 0 || unhealthyDeploys.length > 0 || pendingPVCs.length > 0) && (
          <div className="space-y-3">
            {selectedNamespace !== '*' && <div className="text-xs text-blue-400 font-medium">Issues in {selectedNamespace}</div>}

            {failingPods.length > 0 && (
              <IssueSection title={`Failing Pods (${failingPods.length})`} icon={<XCircle className="w-4 h-4 text-red-500" />} severity="critical">
                {failingPods.slice(0, 5).map((pod) => {
                  const status = getPodStatus(pod);
                  return (
                    <IssueRow key={pod.metadata.uid} name={pod.metadata.name} namespace={pod.metadata.namespace} status={status.reason || status.phase} onClick={() => go(resourceDetailUrl(pod), pod.metadata.name)} />
                  );
                })}
                {failingPods.length > 5 && <button onClick={() => go('/r/v1~pods', 'Pods')} className="w-full text-center text-xs text-blue-400 hover:text-blue-300 pt-2">View all {failingPods.length} →</button>}
              </IssueSection>
            )}

            {unhealthyDeploys.length > 0 && (
              <IssueSection title={`Unhealthy Deployments (${unhealthyDeploys.length})`} icon={<AlertCircle className="w-4 h-4 text-yellow-500" />} severity="warning">
                {unhealthyDeploys.slice(0, 5).map((deploy) => {
                  const status = getDeploymentStatus(deploy);
                  return (
                    <IssueRow key={deploy.metadata.uid} name={deploy.metadata.name} namespace={deploy.metadata.namespace} status={`${status.ready}/${status.desired} ready`} severity="warning" onClick={() => go(resourceDetailUrl(deploy), deploy.metadata.name)} />
                  );
                })}
              </IssueSection>
            )}

            {pendingPVCs.length > 0 && (
              <IssueSection title={`Pending PVCs (${pendingPVCs.length})`} icon={<HardDrive className="w-4 h-4 text-yellow-500" />} severity="warning">
                {pendingPVCs.slice(0, 5).map((pvc) => (
                  <IssueRow key={pvc.metadata.uid} name={pvc.metadata.name} namespace={pvc.metadata.namespace} status="Pending" detail="No volume bound" severity="warning" onClick={() => go(resourceDetailUrl(pvc), pvc.metadata.name)} />
                ))}
              </IssueSection>
            )}
          </div>
            )}

            {/* === Cluster-wide issues === */}
        {(degradedOperators.length > 0 || unreadyNodes.length > 0 || pressureNodes.length > 0) && (
          <div className="space-y-3">
            <div className="text-xs text-slate-500 font-medium">Cluster-wide issues</div>

            {degradedOperators.length > 0 && (
              <IssueSection title={`Degraded Operators (${degradedOperators.length})`} icon={<Puzzle className="w-4 h-4 text-red-500" />} severity="critical">
                {degradedOperators.map((op: any) => {
                  const msg = (op.status?.conditions || []).find((c: any) => c.type === 'Degraded')?.message || '';
                  return (
                    <IssueRow key={op.metadata.uid} name={op.metadata.name} status="Degraded" detail={msg} onClick={() => go(`/r/config.openshift.io~v1~clusteroperators/_/${op.metadata.name}`, op.metadata.name)} />
                  );
                })}
              </IssueSection>
            )}

            {unreadyNodes.length > 0 && (
              <IssueSection title={`Unready Nodes (${unreadyNodes.length})`} icon={<XCircle className="w-4 h-4 text-red-500" />} severity="critical">
                {unreadyNodes.map((node) => (
                  <IssueRow key={node.metadata.uid} name={node.metadata.name} status="NotReady" onClick={() => go(`/r/v1~nodes/_/${node.metadata.name}`, node.metadata.name)} />
                ))}
              </IssueSection>
            )}

            {pressureNodes.length > 0 && (
              <IssueSection title={`Nodes Under Pressure (${pressureNodes.length})`} icon={<AlertCircle className="w-4 h-4 text-yellow-500" />} severity="warning">
                {pressureNodes.map((node) => {
                  const s = getNodeStatus(node);
                  const pressures = [s.pressure.disk && 'Disk', s.pressure.memory && 'Memory', s.pressure.pid && 'PID'].filter(Boolean).join(', ');
                  return (
                    <IssueRow key={node.metadata.uid} name={node.metadata.name} status={`${pressures} Pressure`} severity="warning" onClick={() => go(`/r/v1~nodes/_/${node.metadata.name}`, node.metadata.name)} />
                  );
                })}
              </IssueSection>
            )}
          </div>
            )}

            {/* All healthy */}
            {totalIssues === 0 && !isLoading && (
              <div className="bg-slate-900 rounded-lg border border-slate-800 p-8 text-center">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h2 className="text-lg font-semibold text-slate-100 mb-1">Everything looks good</h2>
                <p className="text-sm text-slate-400 mb-4">No active issues detected across {nodes.length} nodes, {filteredPods.length} pods, and {filteredDeployments.length} deployments.</p>
                <div className="flex items-center justify-center gap-3">
                  <button onClick={() => setActiveTab('issues')} className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors">Run Diagnostics</button>
                  <button onClick={() => go('/admin?tab=timeline', 'Admin')} className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors">View Timeline</button>
                </div>
              </div>
            )}

            {/* Quick links */}
            <div className="flex items-center justify-center gap-4 text-xs text-slate-500 pt-2">
              <button onClick={() => setActiveTab('issues')} className="hover:text-slate-300 transition-colors">Issues</button>
              <span>·</span>
              <button onClick={() => go('/alerts', 'Alerts')} className="hover:text-slate-300 transition-colors">Alerts</button>
              <span>·</span>
              <button onClick={() => go('/admin?tab=timeline', 'Admin')} className="hover:text-slate-300 transition-colors">Timeline</button>
              <span>·</span>
              <button onClick={() => go('/admin', 'Administration')} className="hover:text-slate-300 transition-colors">Admin</button>
            </div>
          </>
        )}

        {/* === ISSUES TAB === */}
        {activeTab === 'issues' && (
          <>
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by name, kind, namespace, or issue..." className="w-full pl-9 pr-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex bg-slate-900 rounded-lg border border-slate-700 text-xs">
                {(['all', 'critical', 'warning'] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={cn('px-3 py-2 capitalize transition-colors', filter === f ? (f === 'critical' ? 'bg-red-600 text-white rounded-lg' : f === 'warning' ? 'bg-yellow-600 text-white rounded-lg' : 'bg-blue-600 text-white rounded-lg') : 'text-slate-400 hover:text-slate-200')}>
                    {f} ({f === 'critical' ? criticalCount : f === 'warning' ? warningCount : diagnosedResources.length})
                  </button>
                ))}
              </div>
            </div>

            {isLoading && <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /><span className="ml-3 text-slate-400">Scanning resources...</span></div>}

            {!isLoading && filteredDiagnosedResources.length === 0 && (
              <div className="text-center py-12">
                <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
                <p className="text-slate-300 font-medium">{diagnosedResources.length === 0 ? 'No issues detected' : 'No matching issues'}</p>
                <p className="text-xs text-slate-500 mt-1">All scanned resources are healthy</p>
              </div>
            )}

            <div className="space-y-2">
              {filteredDiagnosedResources.map((item) => {
                const isExpanded = expandedResource === item.resource.metadata.uid;
                return (
                  <div key={item.resource.metadata.uid} className={cn('bg-slate-900 rounded-lg border transition-colors', item.maxSeverity === 'critical' ? 'border-red-900/50' : 'border-slate-800')}>
                    <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-800/50 transition-colors" onClick={() => setExpandedResource(isExpanded ? null : item.resource.metadata.uid || null)}>
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                      {item.maxSeverity === 'critical' ? <XCircle className="w-5 h-5 text-red-500" /> : <AlertCircle className="w-5 h-5 text-yellow-500" />}
                      <div className="flex items-center gap-2 text-slate-400">{kindIcon[item.resource.kind] || <Box className="w-4 h-4" />}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-200 truncate">{item.resource.metadata.name}</span>
                          <span className="text-xs text-slate-500">{item.resource.kind}</span>
                          {item.resource.metadata.namespace && <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{item.resource.metadata.namespace}</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">{item.diagnoses[0].title}{item.diagnoses.length > 1 && ` (+${item.diagnoses.length - 1} more)`}</div>
                      </div>
                      <span className={cn('text-xs px-2 py-0.5 rounded', item.maxSeverity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300')}>
                        {item.diagnoses.length} issue{item.diagnoses.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-slate-800 px-4 py-3 space-y-3">
                        {item.diagnoses.map((d, idx) => (
                          <div key={idx} className="flex items-start gap-3 py-2">
                            {d.severity === 'critical' ? <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />}
                            <div className="flex-1">
                              <div className="text-sm font-medium text-slate-200">{d.title}</div>
                              <div className="text-xs text-slate-400 mt-0.5">{d.detail}</div>
                              {d.suggestion && <div className="text-xs text-blue-400 mt-1">💡 {d.suggestion}</div>}
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                          <button onClick={() => go(resourceDetailUrl(item.resource), item.resource.metadata.name)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700">
                            <FileText className="w-3 h-3" /> Details
                          </button>
                          {item.resource.metadata.namespace && (
                            <button onClick={() => { const gvrUrl = resourceDetailUrl(item.resource).replace(/^\/r\//, '').split('/')[0]; go(`/deps/${gvrUrl}/${item.resource.metadata.namespace}/${item.resource.metadata.name}`, `${item.resource.metadata.name} (Deps)`); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700">
                              <GitBranch className="w-3 h-3" /> Dependencies
                            </button>
                          )}
                          {item.resource.kind === 'Pod' && item.resource.metadata.namespace && (
                            <button onClick={() => go(`/logs/${item.resource.metadata.namespace}/${item.resource.metadata.name}`, `${item.resource.metadata.name} (Logs)`)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500">
                              <FileText className="w-3 h-3" /> View Logs
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* === RUNBOOKS TAB === */}
        {activeTab === 'runbooks' && (
          <div className="space-y-4">
            {runbooks.map((rb) => {
              const affected = rb.id === 'crashloop' ? filteredPods.filter((p) => getPodStatus(p).reason === 'CrashLoopBackOff') :
                rb.id === 'imagepull' ? filteredPods.filter((p) => getPodStatus(p).reason === 'ImagePullBackOff' || getPodStatus(p).reason === 'ErrImagePull') :
                rb.id === 'pending' ? filteredPods.filter((p) => getPodStatus(p).phase === 'Pending') :
                rb.id === 'deploy' ? filteredDeployments.filter((d) => !getDeploymentStatus(d).available) :
                rb.id === 'node' ? nodes.filter((n) => !getNodeStatus(n).ready) :
                rb.id === 'pvc' ? filteredPVCs.filter((p) => (p.status as any)?.phase === 'Pending') : [];

              return (
                <div key={rb.id} className={cn('bg-slate-900 rounded-lg border', rb.count > 0 ? (rb.severity === 'critical' ? 'border-red-900/50' : 'border-yellow-900/50') : 'border-slate-800')}>
                  <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                      <span>{rb.icon}</span>
                      {rb.title}
                    </h3>
                    {rb.count > 0 ? (
                      <span className={cn('text-xs px-2 py-0.5 rounded font-medium', rb.severity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300')}>{rb.count} affected</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-green-900/50 text-green-300 rounded">✓ None</span>
                    )}
                  </div>

                  {/* Affected resources */}
                  {affected.length > 0 && (
                    <div className="px-4 py-2 border-b border-slate-800 bg-slate-950/50">
                      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1.5">Affected Resources</div>
                      <div className="space-y-1">
                        {affected.slice(0, 3).map((r) => (
                          <div key={r.metadata.uid} onClick={() => go(resourceDetailUrl(r), r.metadata.name)} className="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-800/50 cursor-pointer text-xs">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                              <span className="text-slate-200">{r.metadata.name}</span>
                              {r.metadata.namespace && <span className="text-slate-500">{r.metadata.namespace}</span>}
                            </div>
                            <ArrowRight className="w-3 h-3 text-slate-600" />
                          </div>
                        ))}
                        {affected.length > 3 && <div className="text-xs text-slate-500 px-2">+{affected.length - 3} more</div>}
                      </div>
                    </div>
                  )}

                  {/* Steps */}
                  <div className="p-4">
                    <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Investigation Steps</div>
                    <ol className="space-y-2">
                      {rb.steps.map((step, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-xs">
                          <span className={cn('w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5', rb.count === 0 ? 'bg-green-900/50 text-green-400' : 'bg-slate-800 text-slate-400')}>{rb.count === 0 ? '✓' : i + 1}</span>
                          <span className={cn('leading-relaxed', rb.count === 0 ? 'text-slate-500 line-through' : 'text-slate-300')}>{step}</span>
                        </li>
                      ))}
                    </ol>
                    {rb.count > 0 && affected.length > 0 && (
                      <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800">
                        <button onClick={() => go(resourceDetailUrl(affected[0]), affected[0].metadata.name)} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">
                          Investigate first resource →
                        </button>
                        {affected[0].kind === 'Pod' && affected[0].metadata.namespace && (
                          <button onClick={() => go(`/logs/${affected[0].metadata.namespace}/${affected[0].metadata.name}`, `${affected[0].metadata.name} (Logs)`)} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors">
                            View Logs
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* === NAMESPACE HEALTH TAB === */}
        {activeTab === 'health' && (
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100">Pod Health by Namespace</h2>
            </div>
            <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
              {namespaceHealth.map(({ ns, total, healthy, critical, warning, score }) => (
                <div
                  key={ns}
                  onClick={() => { useUIStore.getState().setSelectedNamespace(ns); go('/r/v1~pods', 'Pods'); }}
                  className="flex items-center gap-4 px-4 py-2.5 hover:bg-slate-800/50 transition-colors cursor-pointer"
                >
                  <div className="w-48 min-w-0">
                    <span className="text-sm text-blue-400 hover:text-blue-300 truncate block">{ns}</span>
                  </div>
                  <div className="flex-1">
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex">
                      {healthy > 0 && <div className="h-full bg-green-500" style={{ width: `${(healthy / total) * 100}%` }} />}
                      {warning > 0 && <div className="h-full bg-yellow-500" style={{ width: `${(warning / total) * 100}%` }} />}
                      {critical > 0 && <div className="h-full bg-red-500" style={{ width: `${(critical / total) * 100}%` }} />}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 w-40 justify-end">
                    <span className="text-green-400">{healthy}</span>
                    {warning > 0 && <span className="text-yellow-400">{warning} pending</span>}
                    {critical > 0 && <span className="text-red-400">{critical} failed</span>}
                    <span className={cn('font-mono font-semibold', score === 100 ? 'text-green-400' : score > 80 ? 'text-yellow-400' : 'text-red-400')}>{score}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Components ---

function StatCard({ label, value, icon, issues, onClick, extra }: {
  label: string; value: string; icon: React.ReactNode; issues: number; onClick: () => void; extra?: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className={cn('bg-slate-900 rounded-lg border p-3 cursor-pointer hover:border-slate-600 transition-colors text-left w-full', issues > 0 ? 'border-yellow-800' : 'border-slate-800')}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-xs">{label}</span></div>
        {issues > 0 ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{issues}</span> : <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
      </div>
      {value && <div className="text-xl font-bold text-slate-100">{value}</div>}
      {extra}
    </button>
  );
}

function IssueSection({ title, icon, severity, children }: {
  title: string; icon: React.ReactNode; severity: 'critical' | 'warning'; children: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-lg border', severity === 'critical' ? 'bg-red-950/30 border-red-900' : 'bg-yellow-950/30 border-yellow-900')}>
      <div className="px-4 py-3 border-b border-slate-800/50">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">{icon}{title}</h2>
      </div>
      <div className="p-3 space-y-1">{children}</div>
    </div>
  );
}

function IssueRow({ name, namespace, status, detail, onClick, severity = 'critical' }: {
  name: string; namespace?: string; status: string; detail?: string; onClick: () => void; severity?: 'critical' | 'warning';
}) {
  return (
    <button onClick={onClick} className="flex items-center justify-between p-2 rounded hover:bg-slate-800/50 cursor-pointer transition-colors w-full text-left">
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn('w-2 h-2 rounded-full flex-shrink-0', severity === 'critical' ? 'bg-red-500' : 'bg-amber-500')} />
        <div className="min-w-0">
          <div className="text-sm text-slate-200 font-medium truncate">{name}</div>
          {namespace && <div className="text-xs text-slate-500">{namespace}</div>}
          {detail && <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{detail}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={cn('text-xs px-2 py-0.5 rounded', severity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/50 text-amber-300')}>{status}</span>
        <ArrowRight className="w-3 h-3 text-slate-500" />
      </div>
    </button>
  );
}
