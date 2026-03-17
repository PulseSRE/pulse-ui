import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HeartPulse, AlertCircle, XCircle, CheckCircle, Server, Box, Package,
  HardDrive, ShieldAlert, Heart, ArrowRight, Puzzle, Shield, Clock,
  Activity, Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sGet } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { getPodStatus, getNodeStatus, getDeploymentStatus } from '../engine/renderers/statusUtils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { resourceDetailUrl } from '../engine/gvr';
import { queryInstant } from '../components/metrics/prometheus';
import { useK8sListWatch } from '../hooks/useK8sListWatch';

function filterByNamespace<T extends { metadata: { namespace?: string } }>(items: T[], ns: string): T[] {
  if (ns === '*') return items;
  return items.filter((i) => i.metadata.namespace === ns);
}

export default function PulseView() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);

  // Core resource queries — real-time via WebSocket watches
  const { data: nodes = [] } = useK8sListWatch({ apiPath: '/api/v1/nodes' });
  const { data: pods = [], isLoading: podsLoading } = useK8sListWatch({ apiPath: '/api/v1/pods' });
  const { data: deployments = [] } = useK8sListWatch({ apiPath: '/apis/apps/v1/deployments' });
  const { data: pvcs = [] } = useK8sListWatch({ apiPath: '/api/v1/persistentvolumeclaims' });
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

  // Pending PVCs
  const pendingPVCs = React.useMemo(() => pvcs.filter((pvc) => (pvc.status as any)?.phase === 'Pending'), [pvcs]);

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

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Nodes" value={`${healthyNodes}/${nodes.length}`} icon={<Server className="w-4 h-4" />} issues={unreadyNodes.length + pressureNodes.length} onClick={() => go('/r/v1~nodes', 'Nodes')} />
          <StatCard label="Pods" value={`${healthyPods}/${filteredPods.length}`} icon={<Box className="w-4 h-4" />} issues={failingPods.length} onClick={() => go('/r/v1~pods', 'Pods')} />
          <StatCard label="Deployments" value={`${healthyDeploys}/${filteredDeployments.length}`} icon={<Package className="w-4 h-4" />} issues={unhealthyDeploys.length} onClick={() => go('/r/apps~v1~deployments', 'Deployments')} />
          <StatCard label="Operators" value={`${operators.length - degradedOperators.length}/${operators.length}`} icon={<Puzzle className="w-4 h-4" />} issues={degradedOperators.length} onClick={() => go('/operators', 'Operators')} />
          <StatCard label="CPU" value={cpuPercent !== null ? `${Math.round(cpuPercent)}%` : '—'} icon={<Cpu className="w-4 h-4" />} issues={cpuPercent !== null && cpuPercent > 80 ? 1 : 0} />
          <StatCard label="Memory" value={memPercent !== null ? `${Math.round(memPercent)}%` : '—'} icon={<Activity className="w-4 h-4" />} issues={memPercent !== null && memPercent > 80 ? 1 : 0} />
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

        {/* Degraded Operators */}
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

        {/* Failing Pods */}
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

        {/* Unhealthy Deployments */}
        {unhealthyDeploys.length > 0 && (
          <IssueSection title={`Unhealthy Deployments (${unhealthyDeploys.length})`} icon={<AlertCircle className="w-4 h-4 text-yellow-500" />} severity="warning">
            {unhealthyDeploys.slice(0, 5).map((deploy) => {
              const status = getDeploymentStatus(deploy);
              return (
                <IssueRow key={deploy.metadata.uid} name={deploy.metadata.name} namespace={deploy.metadata.namespace} status={`${status.ready}/${status.desired} ready`} onClick={() => go(resourceDetailUrl(deploy), deploy.metadata.name)} />
              );
            })}
          </IssueSection>
        )}

        {/* Unready Nodes */}
        {unreadyNodes.length > 0 && (
          <IssueSection title={`Unready Nodes (${unreadyNodes.length})`} icon={<XCircle className="w-4 h-4 text-red-500" />} severity="critical">
            {unreadyNodes.map((node) => (
              <IssueRow key={node.metadata.uid} name={node.metadata.name} status="NotReady" onClick={() => go(`/r/v1~nodes/_/${node.metadata.name}`, node.metadata.name)} />
            ))}
          </IssueSection>
        )}

        {/* Nodes with Pressure */}
        {pressureNodes.length > 0 && (
          <IssueSection title={`Nodes Under Pressure (${pressureNodes.length})`} icon={<AlertCircle className="w-4 h-4 text-yellow-500" />} severity="warning">
            {pressureNodes.map((node) => {
              const s = getNodeStatus(node);
              const pressures = [s.pressure.disk && 'Disk', s.pressure.memory && 'Memory', s.pressure.pid && 'PID'].filter(Boolean).join(', ');
              return (
                <IssueRow key={node.metadata.uid} name={node.metadata.name} status={`${pressures} Pressure`} onClick={() => go(`/r/v1~nodes/_/${node.metadata.name}`, node.metadata.name)} />
              );
            })}
          </IssueSection>
        )}

        {/* Pending PVCs */}
        {pendingPVCs.length > 0 && (
          <IssueSection title={`Pending PVCs (${pendingPVCs.length})`} icon={<HardDrive className="w-4 h-4 text-yellow-500" />} severity="warning">
            {pendingPVCs.slice(0, 5).map((pvc) => (
              <IssueRow key={pvc.metadata.uid} name={pvc.metadata.name} namespace={pvc.metadata.namespace} status="Pending" detail="No volume bound" onClick={() => go(resourceDetailUrl(pvc), pvc.metadata.name)} />
            ))}
          </IssueSection>
        )}

        {/* All healthy */}
        {totalIssues === 0 && !isLoading && (
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-8 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-slate-100 mb-1">Everything looks good</h2>
            <p className="text-sm text-slate-400 mb-4">No active issues detected across {nodes.length} nodes, {filteredPods.length} pods, and {filteredDeployments.length} deployments.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => go('/troubleshoot', 'Troubleshoot')} className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors">Run Diagnostics</button>
              <button onClick={() => go('/timeline', 'Timeline')} className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors">View Timeline</button>
            </div>
          </div>
        )}

        {/* Quick links */}
        <div className="flex items-center justify-center gap-4 text-xs text-slate-500 pt-2">
          <button onClick={() => go('/troubleshoot', 'Troubleshoot')} className="hover:text-slate-300 transition-colors">Troubleshoot</button>
          <span>·</span>
          <button onClick={() => go('/alerts', 'Alerts')} className="hover:text-slate-300 transition-colors">Alerts</button>
          <span>·</span>
          <button onClick={() => go('/timeline', 'Timeline')} className="hover:text-slate-300 transition-colors">Timeline</button>
          <span>·</span>
          <button onClick={() => go('/admin', 'Administration')} className="hover:text-slate-300 transition-colors">Admin</button>
        </div>
      </div>
    </div>
  );
}

// --- Components ---

function StatCard({ label, value, icon, issues, onClick, extra }: {
  label: string; value: string; icon: React.ReactNode; issues: number; onClick: () => void; extra?: React.ReactNode;
}) {
  return (
    <div onClick={onClick} className={cn('bg-slate-900 rounded-lg border p-3 cursor-pointer hover:border-slate-600 transition-colors', issues > 0 ? 'border-yellow-800' : 'border-slate-800')}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-xs">{label}</span></div>
        {issues > 0 ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{issues}</span> : <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
      </div>
      {value && <div className="text-xl font-bold text-slate-100">{value}</div>}
      {extra}
    </div>
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

function IssueRow({ name, namespace, status, detail, onClick }: {
  name: string; namespace?: string; status: string; detail?: string; onClick: () => void;
}) {
  return (
    <div onClick={onClick} className="flex items-center justify-between p-2 rounded hover:bg-slate-800/50 cursor-pointer transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-sm text-slate-200 font-medium truncate">{name}</div>
          {namespace && <div className="text-xs text-slate-500">{namespace}</div>}
          {detail && <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{detail}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-xs px-2 py-0.5 bg-red-900/50 text-red-300 rounded">{status}</span>
        <ArrowRight className="w-3 h-3 text-slate-500" />
      </div>
    </div>
  );
}
