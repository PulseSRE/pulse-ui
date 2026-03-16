import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CheckCircle,
  XCircle,
  AlertCircle,
  Activity,
  TrendingUp,
  Server,
  Box,
  HardDrive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { getDeploymentStatus, getPodStatus, getNodeStatus } from '../engine/renderers/statusUtils';
import { queryInstant } from '../components/metrics/prometheus';

export default function DashboardView() {
  const navigate = useNavigate();

  const { data: deployments = [], isLoading: deploymentsLoading } = useQuery<K8sResource[]>({
    queryKey: ['dashboard', 'deployments'],
    queryFn: () => k8sList<K8sResource>('/apis/apps/v1/deployments'),
    refetchInterval: 30000,
  });

  const { data: pods = [], isLoading: podsLoading } = useQuery<K8sResource[]>({
    queryKey: ['dashboard', 'pods'],
    queryFn: () => k8sList<K8sResource>('/api/v1/pods'),
    refetchInterval: 30000,
  });

  const { data: nodes = [] } = useQuery<K8sResource[]>({
    queryKey: ['dashboard', 'nodes'],
    queryFn: () => k8sList<K8sResource>('/api/v1/nodes'),
    refetchInterval: 30000,
  });

  const { data: events = [] } = useQuery<K8sResource[]>({
    queryKey: ['dashboard', 'events'],
    queryFn: () => k8sList<K8sResource>('/api/v1/events?limit=100'),
    refetchInterval: 30000,
  });

  // Prometheus metrics
  const { data: cpuMetrics } = useQuery({
    queryKey: ['dashboard', 'cpu'],
    queryFn: () => queryInstant('sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) / sum(machine_cpu_cores) * 100').catch(() => []),
    refetchInterval: 30000,
  });

  const { data: memMetrics } = useQuery({
    queryKey: ['dashboard', 'memory'],
    queryFn: () => queryInstant('(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100').catch(() => []),
    refetchInterval: 30000,
  });

  // Pod status summary
  const podStatusSummary = React.useMemo(() => {
    const summary = { running: 0, pending: 0, failed: 0, succeeded: 0, other: 0 };
    for (const pod of pods) {
      const status = getPodStatus(pod);
      const phase = status.phase.toLowerCase();
      if (phase === 'running') summary.running++;
      else if (phase === 'pending') summary.pending++;
      else if (phase === 'failed') summary.failed++;
      else if (phase === 'succeeded') summary.succeeded++;
      else summary.other++;
    }
    return summary;
  }, [pods]);

  // Node summary
  const nodeSummary = React.useMemo(() => {
    let ready = 0;
    for (const node of nodes) {
      const status = getNodeStatus(node);
      if (status.ready) ready++;
    }
    return { total: nodes.length, ready };
  }, [nodes]);

  // Unhealthy deployments
  const unhealthyDeploys = React.useMemo(() => {
    return deployments.filter((d) => {
      const status = getDeploymentStatus(d);
      return !status.available;
    });
  }, [deployments]);

  // Top namespaces by pod count
  const namespacePodCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const pod of pods) {
      const ns = pod.metadata.namespace || 'unknown';
      counts.set(ns, (counts.get(ns) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [pods]);

  // Recent warnings
  const recentWarnings = React.useMemo(() => {
    return events
      .filter((e) => (e as any).type === 'Warning')
      .sort((a, b) => {
        const aTime = (a as any).lastTimestamp || (a as any).firstTimestamp || '';
        const bTime = (b as any).lastTimestamp || (b as any).firstTimestamp || '';
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      })
      .slice(0, 8);
  }, [events]);

  const cpuPercent = cpuMetrics?.[0]?.value ?? null;
  const memPercent = memMetrics?.[0]?.value ?? null;
  const isLoading = deploymentsLoading || podsLoading;

  return (
    <div className="h-full overflow-auto bg-slate-950">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-blue-500" />
            Cluster Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">Real-time overview of cluster health and resources</p>
        </div>

        {/* Top row: Key metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Nodes"
            value={`${nodeSummary.ready}/${nodeSummary.total}`}
            subtitle={nodeSummary.ready === nodeSummary.total ? 'All ready' : `${nodeSummary.total - nodeSummary.ready} not ready`}
            icon={<Server className="w-5 h-5" />}
            status={nodeSummary.ready === nodeSummary.total ? 'healthy' : 'warning'}
            onClick={() => navigate('/r/v1~nodes')}
          />
          <MetricCard
            label="Pods"
            value={`${podStatusSummary.running}/${pods.length}`}
            subtitle={podStatusSummary.failed > 0 ? `${podStatusSummary.failed} failed` : podStatusSummary.pending > 0 ? `${podStatusSummary.pending} pending` : 'All running'}
            icon={<Box className="w-5 h-5" />}
            status={podStatusSummary.failed > 0 ? 'error' : podStatusSummary.pending > 0 ? 'warning' : 'healthy'}
            onClick={() => navigate('/r/v1~pods')}
          />
          <MetricCard
            label="CPU Usage"
            value={cpuPercent !== null ? `${Math.round(cpuPercent)}%` : '—'}
            subtitle="Cluster average"
            icon={<Activity className="w-5 h-5" />}
            status={cpuPercent !== null && cpuPercent > 80 ? 'warning' : 'healthy'}
          />
          <MetricCard
            label="Memory"
            value={memPercent !== null ? `${Math.round(memPercent)}%` : '—'}
            subtitle="Cluster average"
            icon={<HardDrive className="w-5 h-5" />}
            status={memPercent !== null && memPercent > 80 ? 'warning' : 'healthy'}
          />
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Deployments + Pod breakdown */}
          <div className="lg:col-span-2 space-y-6">
            {/* Unhealthy Deployments */}
            {unhealthyDeploys.length > 0 && (
              <Panel title={`Unhealthy Deployments (${unhealthyDeploys.length})`} icon={<XCircle className="w-4 h-4 text-red-500" />}>
                <div className="space-y-2">
                  {unhealthyDeploys.slice(0, 5).map((deployment) => {
                    const status = getDeploymentStatus(deployment);
                    const ns = deployment.metadata.namespace;
                    return (
                      <div
                        key={deployment.metadata.uid}
                        onClick={() => navigate(`/r/apps~v1~deployments/${ns}/${deployment.metadata.name}`)}
                        className="flex items-center justify-between p-2 rounded hover:bg-slate-800/50 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm text-slate-200 font-medium truncate">{deployment.metadata.name}</div>
                            <div className="text-xs text-slate-500">{ns}</div>
                          </div>
                        </div>
                        <span className="text-sm font-mono text-red-400">{status.ready}/{status.desired}</span>
                      </div>
                    );
                  })}
                </div>
              </Panel>
            )}

            {/* Pod Status Breakdown */}
            <Panel title="Pod Status" icon={<TrendingUp className="w-4 h-4 text-blue-500" />}>
              {isLoading ? (
                <div className="text-center py-8 text-slate-500 text-sm">Loading...</div>
              ) : (
                <div className="space-y-3">
                  <StatusBar label="Running" count={podStatusSummary.running} total={pods.length} color="green" />
                  <StatusBar label="Pending" count={podStatusSummary.pending} total={pods.length} color="yellow" />
                  <StatusBar label="Failed" count={podStatusSummary.failed} total={pods.length} color="red" />
                  <StatusBar label="Succeeded" count={podStatusSummary.succeeded} total={pods.length} color="blue" />
                  <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-sm text-slate-400">Total Pods</span>
                    <span className="text-xl font-bold text-slate-100">{pods.length}</span>
                  </div>
                </div>
              )}
            </Panel>

            {/* Top Namespaces by Pod Count */}
            <Panel title="Pods by Namespace" icon={<Box className="w-4 h-4 text-purple-500" />}>
              <div className="space-y-2">
                {namespacePodCounts.map(([ns, count]) => (
                  <div
                    key={ns}
                    onClick={() => navigate(`/r/v1~pods`)}
                    className="flex items-center justify-between p-2 rounded hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <span className="text-sm text-slate-300">{ns}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 rounded-full"
                          style={{ width: `${(count / pods.length) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm text-slate-400 font-mono w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* Right column: Warnings + Deployments */}
          <div className="space-y-6">
            {/* Recent Warnings */}
            <Panel title={`Recent Warnings (${recentWarnings.length})`} icon={<AlertCircle className="w-4 h-4 text-yellow-500" />}>
              {recentWarnings.length === 0 ? (
                <div className="text-center py-6">
                  <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">No warnings</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-auto">
                  {recentWarnings.map((event, idx) => {
                    const e = event as any;
                    return (
                      <div key={idx} className="p-2 rounded bg-slate-800/50 border border-slate-700">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs text-slate-500">{e.involvedObject?.kind} {e.involvedObject?.name}</div>
                            <div className="text-sm text-slate-200 font-medium">{e.reason}</div>
                            <div className="text-xs text-slate-400 line-clamp-2">{e.message}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => navigate('/timeline')}
                    className="w-full text-center text-xs text-blue-400 hover:text-blue-300 pt-2"
                  >
                    View all events →
                  </button>
                </div>
              )}
            </Panel>

            {/* Deployments Overview */}
            <Panel title={`Deployments (${deployments.length})`} icon={<Activity className="w-4 h-4 text-blue-500" />}>
              <div className="space-y-1 max-h-64 overflow-auto">
                {deployments.slice(0, 15).map((deployment) => {
                  const status = getDeploymentStatus(deployment);
                  const ns = deployment.metadata.namespace;
                  return (
                    <div
                      key={deployment.metadata.uid}
                      onClick={() => navigate(`/r/apps~v1~deployments/${ns}/${deployment.metadata.name}`)}
                      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {status.available ? (
                          <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                        )}
                        <span className="text-sm text-slate-300 truncate">{deployment.metadata.name}</span>
                      </div>
                      <span className={cn('text-xs font-mono', status.available ? 'text-green-400' : 'text-red-400')}>
                        {status.ready}/{status.desired}
                      </span>
                    </div>
                  );
                })}
                {deployments.length > 15 && (
                  <button
                    onClick={() => navigate('/r/apps~v1~deployments')}
                    className="w-full text-center text-xs text-blue-400 hover:text-blue-300 pt-2"
                  >
                    View all {deployments.length} deployments →
                  </button>
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, subtitle, icon, status, onClick }: {
  label: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  status: 'healthy' | 'warning' | 'error';
  onClick?: () => void;
}) {
  const statusColor = { healthy: 'bg-green-500', warning: 'bg-yellow-500', error: 'bg-red-500' }[status];
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-slate-900 rounded-lg border border-slate-800 p-4',
        onClick && 'cursor-pointer hover:border-slate-600 transition-colors'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-slate-400">
          {icon}
          <span className="text-sm">{label}</span>
        </div>
        <div className={cn('w-2 h-2 rounded-full', statusColor)} />
      </div>
      <div className="text-2xl font-bold text-slate-100">{value}</div>
      <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">{icon}{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function StatusBar({ label, count, total, color }: { label: string; count: number; total: number; color: 'green' | 'yellow' | 'red' | 'blue' }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const bg = { green: 'bg-green-500', yellow: 'bg-yellow-500', red: 'bg-red-500', blue: 'bg-blue-500' }[color];
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-slate-300">{label}</span>
        <span className="text-sm text-slate-400 font-mono">{count}</span>
      </div>
      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
        <div className={cn('h-full transition-all duration-300 rounded-full', bg)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
