import React, { lazy, Suspense } from 'react';
import {
  Package, Box, Clock, AlertCircle, XCircle,
  FileText, ArrowRight, AlertTriangle, RefreshCw,
  Hammer, Database, Layers, CalendarClock, PlayCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { K8sResource } from '../engine/renderers';
import type { Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob, ReplicaSet } from '../engine/types';
import type { Condition, Container, ContainerStatus, LabelSelector, ObjectMeta } from '../engine/types';
import { getDeploymentStatus, getPodStatus } from '../engine/renderers/statusUtils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { MetricCard } from '../components/metrics/Sparkline';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { CHART_COLORS } from '../engine/colors';
import { Panel } from '../components/primitives/Panel';
import { sanitizePromQL } from '../engine/query';
import { SectionHeader } from '../components/primitives/SectionHeader';
import { Card } from '../components/primitives/Card';
import type { AuditCheck } from '../components/audit/types';
import { HealthAuditPanel } from '../components/audit/HealthAuditPanel';
import { WorkloadListPanel, type RowSummary } from './workloads/WorkloadListPanel';
import { timeAgo } from '../engine/dateUtils';

const BuildsView = lazy(() => import('./BuildsView'));

type Tab = 'overview' | 'builds';

/** Local PDB type — not yet in engine/types */
interface PodDisruptionBudget extends K8sResource {
  apiVersion: 'policy/v1';
  kind: 'PodDisruptionBudget';
  metadata: ObjectMeta & { name: string };
  spec?: {
    selector?: LabelSelector;
    minAvailable?: number | string;
    maxUnavailable?: number | string;
  };
  status?: {
    currentHealthy?: number;
    desiredHealthy?: number;
    disruptionsAllowed?: number;
    expectedPods?: number;
    conditions?: Condition[];
  };
}

export default function WorkloadsView() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;
  const safeNs = nsFilter ? sanitizePromQL(nsFilter) : '';

  const initialTab = (() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('tab') as Tab) || 'overview';
  })();
  const [activeTab, setActiveTab] = React.useState<Tab>(initialTab);
  const [deployFilter, setDeployFilter] = React.useState<string | null>(null);
  const [stsFilter, setStsFilter] = React.useState<string | null>(null);
  const [dsFilter, setDsFilter] = React.useState<string | null>(null);
  const [cronFilter, setCronFilter] = React.useState<string | null>(null);
  const [jobFilter, setJobFilter] = React.useState<string | null>(null);

  /** Show an in-page list with a filter applied, and bring it into view. */
  const showList = (id: string, apply: () => void) => {
    apply();
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  };

  const switchTab = (tab: Tab) => {
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
    setActiveTab(tab);
  };

  const { data: deployments = [], isLoading: deploysLoading } = useK8sListWatch<Deployment>({ apiPath: '/apis/apps/v1/deployments', namespace: nsFilter });
  const { data: statefulsets = [] } = useK8sListWatch<StatefulSet>({ apiPath: '/apis/apps/v1/statefulsets', namespace: nsFilter });
  const { data: daemonsets = [] } = useK8sListWatch<DaemonSet>({ apiPath: '/apis/apps/v1/daemonsets', namespace: nsFilter });
  const { data: pods = [], isLoading: podsLoading } = useK8sListWatch<Pod>({ apiPath: '/api/v1/pods', namespace: nsFilter });
  const { data: jobs = [] } = useK8sListWatch<Job>({ apiPath: '/apis/batch/v1/jobs', namespace: nsFilter });
  const { data: cronjobs = [] } = useK8sListWatch<CronJob>({ apiPath: '/apis/batch/v1/cronjobs', namespace: nsFilter });
  const { data: replicasets = [] } = useK8sListWatch<ReplicaSet>({ apiPath: '/apis/apps/v1/replicasets', namespace: nsFilter });
  const { data: pdbs = [] } = useK8sListWatch<PodDisruptionBudget>({ apiPath: '/apis/policy/v1/poddisruptionbudgets', namespace: nsFilter });

  // Pod status breakdown
  const podStats = React.useMemo(() => {
    const s = { Running: 0, Pending: 0, Succeeded: 0, Failed: 0, CrashLoop: 0, ImagePull: 0, Unknown: 0 };
    for (const p of pods) {
      const status = getPodStatus(p);
      if (status.reason === 'CrashLoopBackOff') s.CrashLoop++;
      else if (status.reason === 'ImagePullBackOff' || status.reason === 'ErrImagePull') s.ImagePull++;
      else if (status.phase === 'Running') s.Running++;
      else if (status.phase === 'Pending') s.Pending++;
      else if (status.phase === 'Succeeded') s.Succeeded++;
      else if (status.phase === 'Failed') s.Failed++;
      else s.Unknown++;
    }
    return s;
  }, [pods]);

  const unhealthyDeploys = React.useMemo(() =>
    deployments.filter(d => !getDeploymentStatus(d).available),
  [deployments]);

  const unhealthySS = React.useMemo(() =>
    statefulsets.filter(s => {
      const ready = s.status?.readyReplicas ?? 0;
      const desired = s.spec?.replicas ?? 0;
      return desired > 0 && ready < desired;
    }),
  [statefulsets]);

  const failedJobs = React.useMemo(() =>
    jobs.filter(j => {
      const conditions = j.status?.conditions || [];
      return conditions.some((c: Condition) => c.type === 'Failed' && c.status === 'True');
    }),
  [jobs]);

  const crashingPods = React.useMemo(() =>
    pods.filter(p => {
      const s = getPodStatus(p);
      return s.reason === 'CrashLoopBackOff' || s.reason === 'ImagePullBackOff' || s.phase === 'Failed';
    }),
  [pods]);

  // Container restart count
  const highRestartPods = React.useMemo(() =>
    pods.filter(p => {
      const restarts = (p.status?.containerStatuses || []).reduce((sum: number, c: ContainerStatus) => sum + (c.restartCount || 0), 0);
      return restarts >= 5;
    }).sort((a, b) => {
      const ra = (a.status?.containerStatuses || []).reduce((s: number, c: ContainerStatus) => s + (c.restartCount || 0), 0);
      const rb = (b.status?.containerStatuses || []).reduce((s: number, c: ContainerStatus) => s + (c.restartCount || 0), 0);
      return rb - ra;
    }),
  [pods]);

  // Old ReplicaSets (desired=0 but still present)
  const oldReplicaSets = React.useMemo(() =>
    replicasets.filter(rs => (rs.spec?.replicas ?? 0) === 0 && (rs.status?.replicas ?? 0) === 0),
  [replicasets]);

  const sortedDeploys = React.useMemo(() =>
    [...deployments].sort((a, b) => {
      const sa = getDeploymentStatus(a);
      const sb = getDeploymentStatus(b);
      if (sa.available !== sb.available) return sa.available ? 1 : -1;
      return (sb.desired - sb.ready) - (sa.desired - sa.ready);
    }),
  [deployments]);

  // Issues
  // Each banner opens the list it counts, already filtered.
  const issues: Array<{ msg: string; severity: 'warning' | 'critical'; open: () => void }> = [];
  if (podStats.CrashLoop > 0) issues.push({ msg: `${podStats.CrashLoop} pod${podStats.CrashLoop > 1 ? 's' : ''} in CrashLoopBackOff`, severity: 'critical', open: () => go('/r/v1~pods?q=CrashLoopBackOff', 'Pods (CrashLoopBackOff)') });
  if (podStats.ImagePull > 0) issues.push({ msg: `${podStats.ImagePull} pod${podStats.ImagePull > 1 ? 's' : ''} with image pull errors`, severity: 'critical', open: () => go('/r/v1~pods?q=ImagePull', 'Pods (image pull errors)') });
  if (unhealthyDeploys.length > 0) issues.push({ msg: `${unhealthyDeploys.length} deployment${unhealthyDeploys.length > 1 ? 's' : ''} not fully available`, severity: 'warning', open: () => showList('workloads-deployments', () => setDeployFilter('unhealthy')) });
  if (unhealthySS.length > 0) issues.push({ msg: `${unhealthySS.length} StatefulSet${unhealthySS.length > 1 ? 's' : ''} not ready`, severity: 'warning', open: () => showList('workloads-statefulsets', () => setStsFilter('unhealthy')) });
  if (failedJobs.length > 0) issues.push({ msg: `${failedJobs.length} failed job${failedJobs.length > 1 ? 's' : ''}`, severity: 'warning', open: () => showList('workloads-jobs', () => setJobFilter('failed')) });

  if (activeTab === 'builds') {
    return (
      <div className="h-full overflow-auto bg-slate-950 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <SectionHeader
            icon={<Package className="w-6 h-6 text-blue-500" />}
            title="Workloads"
            subtitle={<>Deployments, StatefulSets, DaemonSets, Jobs, Pods, and Builds{nsFilter && <span className="text-blue-400 ml-1">in {nsFilter}</span>}</>}
          />
          <Card className="flex gap-1 p-1">
            {([['overview', 'Workloads', <Package className="w-3.5 h-3.5" />], ['builds', 'Builds', <Hammer className="w-3.5 h-3.5" />]] as const).map(([id, label, icon]) => (
              <button key={id} role="tab" aria-selected={activeTab === id} aria-label={label as string} onClick={() => switchTab(id as Tab)}
                className={cn('px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500', activeTab === id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
                {icon}{label}
              </button>
            ))}
          </Card>
          <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>}>
            <BuildsView />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <SectionHeader
          icon={<Package className="w-6 h-6 text-blue-500" />}
          title="Workloads"
          subtitle={<>Deployments, StatefulSets, DaemonSets, Jobs, Pods, and Builds{nsFilter && <span className="text-blue-400 ml-1">in {nsFilter}</span>}</>}
        />

        {/* Tabs */}
        <Card className="flex gap-1 p-1">
          {([['overview', 'Workloads', <Package className="w-3.5 h-3.5" />], ['builds', 'Builds', <Hammer className="w-3.5 h-3.5" />]] as const).map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={activeTab === id} aria-label={label as string} onClick={() => switchTab(id as Tab)}
              className={cn('px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500', activeTab === id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              {icon}{label}
            </button>
          ))}
        </Card>

        {(deploysLoading || podsLoading) && deployments.length === 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="bg-slate-900 rounded-lg border border-slate-800 p-3 animate-pulse">
                <div className="h-3 bg-slate-800 rounded-sm w-2/3 mb-2" />
                <div className="h-5 bg-slate-800 rounded-sm w-1/3" />
              </div>
            ))}
          </div>
        )}

        {/* Issues */}
        {issues.length > 0 && (
          <div className="space-y-2">
            {issues.map((issue, i) => (
              <button key={i} onClick={issue.open} className={cn('w-full flex items-center justify-between px-4 py-2.5 rounded-lg border text-left transition-colors',
                issue.severity === 'critical' ? 'bg-red-950/30 border-red-900 hover:border-red-700' : 'bg-yellow-950/30 border-yellow-900 hover:border-yellow-700')}>
                <span className="flex items-center gap-2">
                  {issue.severity === 'critical' ? <AlertCircle className="w-4 h-4 text-red-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
                  <span className="text-sm text-slate-200">{issue.msg}</span>
                </span>
                <span className="text-xs text-blue-400 flex items-center gap-1">View <ArrowRight className="w-3 h-3" /></span>
              </button>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <button onClick={() => go('/r/apps~v1~deployments', 'Deployments')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', unhealthyDeploys.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Deployments</span>
              {unhealthyDeploys.length > 0 ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded-sm">{unhealthyDeploys.length}</span> : <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
            </div>
            <div className="text-xl font-bold text-slate-100">{deployments.length}</div>
          </button>
          <button onClick={() => go('/r/apps~v1~statefulsets', 'StatefulSets')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', unhealthySS.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">StatefulSets</span>
              {unhealthySS.length > 0 ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded-sm">{unhealthySS.length}</span> : <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
            </div>
            <div className="text-xl font-bold text-slate-100">{statefulsets.length}</div>
          </button>
          <button onClick={() => go('/r/apps~v1~daemonsets', 'DaemonSets')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">DaemonSets</div>
            <div className="text-xl font-bold text-slate-100">{daemonsets.length}</div>
          </button>
          <button onClick={() => go('/r/v1~pods', 'Pods')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', crashingPods.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Pods</span>
              {crashingPods.length > 0 ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded-sm">{crashingPods.length}</span> : <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
            </div>
            <div className="text-xl font-bold text-slate-100">{pods.length}</div>
          </button>
          <button onClick={() => go('/r/batch~v1~jobs', 'Jobs')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', failedJobs.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Jobs</span>
              {failedJobs.length > 0 && <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded-sm">{failedJobs.length}</span>}
            </div>
            <div className="text-xl font-bold text-slate-100">{jobs.length}</div>
          </button>
          <button onClick={() => go('/r/batch~v1~cronjobs', 'CronJobs')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">CronJobs</div>
            <div className="text-xl font-bold text-slate-100">{cronjobs.length}</div>
          </button>
        </div>

        {/* Metrics */}
        <MetricGrid>
          <MetricCard
            title="Pod CPU Usage"
            query={nsFilter
              ? `sum(rate(container_cpu_usage_seconds_total{namespace="${safeNs}",container!=""}[5m])) / sum(kube_pod_container_resource_requests{namespace="${safeNs}",resource="cpu"}) * 100`
              : 'sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) / sum(kube_pod_container_resource_requests{resource="cpu"}) * 100'}
            unit="%"
            color={CHART_COLORS.blue}
            thresholds={{ warning: 70, critical: 90 }}
          />
          <MetricCard
            title="Pod Memory Usage"
            query={nsFilter
              ? `sum(container_memory_working_set_bytes{namespace="${safeNs}",container!=""}) / sum(kube_pod_container_resource_requests{namespace="${safeNs}",resource="memory"}) * 100`
              : 'sum(container_memory_working_set_bytes{container!=""}) / sum(kube_pod_container_resource_requests{resource="memory"}) * 100'}
            unit="%"
            color={CHART_COLORS.violet}
            thresholds={{ warning: 75, critical: 90 }}
          />
          <MetricCard
            title="Container Restarts"
            query={nsFilter
              ? `sum(rate(kube_pod_container_status_restarts_total{namespace="${safeNs}"}[1h])) * 3600`
              : 'sum(rate(kube_pod_container_status_restarts_total[1h])) * 3600'}
            unit=" /hr"
            color={CHART_COLORS.amber}
            thresholds={{ warning: 5, critical: 20 }}
          />
          <MetricCard
            title="Pod Start Rate"
            query={nsFilter
              ? `sum(changes(kube_pod_start_time{namespace="${safeNs}"}[1h]))`
              : 'sum(changes(kube_pod_start_time[1h]))'}
            unit=" /hr"
            color={CHART_COLORS.cyan}
          />
          <MetricCard
            title="OOMKilled"
            query={nsFilter
              ? `count(kube_pod_container_status_last_terminated_reason{namespace="${safeNs}",reason="OOMKilled"}) or vector(0)`
              : 'count(kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}) or vector(0)'}
            unit=""
            color={CHART_COLORS.red}
            thresholds={{ warning: 1, critical: 5 }}
          />
          <MetricCard
            title="CrashLoopBackOff"
            query={nsFilter
              ? `count(kube_pod_container_status_waiting_reason{namespace="${safeNs}",reason="CrashLoopBackOff"}) or vector(0)`
              : 'count(kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"}) or vector(0)'}
            unit=""
            color={CHART_COLORS.red}
            thresholds={{ warning: 1, critical: 3 }}
          />
          <MetricCard
            title="Pending Pods"
            query={nsFilter
              ? `count(kube_pod_status_phase{namespace="${safeNs}",phase="Pending"}) or vector(0)`
              : 'count(kube_pod_status_phase{phase="Pending"}) or vector(0)'}
            unit=""
            color={CHART_COLORS.amber}
            thresholds={{ warning: 3, critical: 10 }}
          />
        </MetricGrid>

        {/* Workload Health Audit */}
        <WorkloadHealthAudit deployments={deployments} pdbs={pdbs} go={go} />

        {/* Pod Status Breakdown */}
        <Panel title="Pod Status" icon={<Box className="w-4 h-4 text-blue-400" />}>
          <div className="space-y-2">
            {Object.entries(podStats).filter(([, count]) => count > 0).map(([status, count]) => {
              const maxCount = Math.max(...Object.values(podStats).filter(v => v > 0), 1);
              const pct = (count / maxCount) * 100;
              const color = status === 'Running' ? 'bg-green-500' : status === 'Succeeded' ? 'bg-blue-500' : status === 'Pending' ? 'bg-amber-500' : 'bg-red-500';
              return (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('w-2.5 h-2.5 rounded-full', color)} />
                      <span className="text-sm text-slate-300">{status}</span>
                    </div>
                    <span className="text-sm font-mono text-slate-400">{count}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Unhealthy Deployments */}
          {unhealthyDeploys.length > 0 && (
            <Panel title={`Unhealthy Deployments (${unhealthyDeploys.length})`} icon={<XCircle className="w-4 h-4 text-red-500" />}>
              <div className="space-y-1">
                {unhealthyDeploys.slice(0, 10).map((d) => {
                  const s = getDeploymentStatus(d);
                  return (
                    <button key={d.metadata.uid} onClick={() => go(`/r/apps~v1~deployments/${d.metadata.namespace}/${d.metadata.name}`, d.metadata.name)}
                      className="w-full flex items-center justify-between p-2 rounded-sm hover:bg-slate-800/50 text-left transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                        <span className="text-sm text-slate-200 truncate">{d.metadata.name}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm">{d.metadata.namespace}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-red-400">{s.ready}/{s.desired}</span>
                        <ArrowRight className="w-3 h-3 text-slate-600" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          )}

          {/* High Restart Pods */}
          {highRestartPods.length > 0 && (
            <Panel title={`High Restart Pods (${highRestartPods.length})`} icon={<RefreshCw className="w-4 h-4 text-amber-500" />}>
              <div className="space-y-1">
                {highRestartPods.slice(0, 8).map((p) => {
                  const restarts = (p.status?.containerStatuses || []).reduce((s: number, c: ContainerStatus) => s + (c.restartCount || 0), 0);
                  return (
                    <button key={p.metadata.uid} onClick={() => go(`/r/v1~pods/${p.metadata.namespace}/${p.metadata.name}`, p.metadata.name)}
                      className="w-full flex items-center justify-between p-2 rounded-sm hover:bg-slate-800/50 text-left transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                        <span className="text-sm text-slate-200 truncate">{p.metadata.name}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm">{p.metadata.namespace}</span>
                      </div>
                      <span className="text-xs font-mono text-amber-400">{restarts} restarts</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-500">
                Pods with 5+ container restarts. High restarts may indicate OOM kills, failing health checks, or application crashes.
              </div>
            </Panel>
          )}
        </div>

        {/* Deployments list */}
        <WorkloadListPanel<Deployment>
          id="workloads-deployments"
          title="Deployments"
          icon={<Package className="w-4 h-4 text-blue-400" />}
          items={sortedDeploys}
          gvr="apps~v1~deployments"
          browseLabel="Browse all deployments"
          emptyText={`No deployments${nsFilter ? ` in ${nsFilter}` : ''}`}
          filters={[
            { key: 'unhealthy', label: 'Unhealthy', test: (d) => !getDeploymentStatus(d).available },
            { key: 'healthy', label: 'Healthy', test: (d) => getDeploymentStatus(d).available },
          ]}
          filter={deployFilter}
          onFilterChange={setDeployFilter}
          go={go}
          summarize={(d): RowSummary => {
            const s = getDeploymentStatus(d);
            return {
              tone: s.available ? 'ok' : 'bad',
              badges: d.spec?.paused ? ['paused'] : undefined,
              detail: <>
                <span className={cn('font-mono', s.available ? 'text-green-400' : 'text-red-400')}>{s.ready}/{s.desired}</span>
                <span className="text-slate-600">{d.spec?.strategy?.type || 'RollingUpdate'}</span>
              </>,
            };
          }}
          rowExtras={(d) => {
            // Pods are found by the Deployment's own selector, not `app=<name>`.
            const logSelector = Object.entries(d.spec?.selector?.matchLabels || {}).map(([k, v]) => `${k}=${v}`).join(',');
            return logSelector ? (
              <button onClick={() => go(`/logs/${d.metadata.namespace}/${d.metadata.name}?selector=${encodeURIComponent(logSelector)}&kind=Deployment`, `${d.metadata.name} (Logs)`)}
                className="px-2 py-2 text-slate-500 hover:text-blue-400 transition-colors" title="View Logs" aria-label={`View logs for ${d.metadata.name}`}>
                <FileText className="w-3.5 h-3.5" />
              </button>
            ) : null;
          }}
        />

        <WorkloadListPanel<StatefulSet>
          id="workloads-statefulsets"
          title="StatefulSets"
          icon={<Database className="w-4 h-4 text-violet-400" />}
          items={statefulsets}
          gvr="apps~v1~statefulsets"
          browseLabel="Browse all StatefulSets"
          emptyText={`No StatefulSets${nsFilter ? ` in ${nsFilter}` : ''}`}
          filters={[{ key: 'unhealthy', label: 'Not ready', test: (x) => unhealthySS.includes(x) }]}
          filter={stsFilter}
          onFilterChange={setStsFilter}
          go={go}
          summarize={(x): RowSummary => {
            const ready = x.status?.readyReplicas ?? 0;
            const desired = x.spec?.replicas ?? 0;
            return { tone: ready >= desired ? (desired === 0 ? 'idle' : 'ok') : 'warn', detail: <span className={cn('font-mono', ready >= desired ? 'text-green-400' : 'text-amber-400')}>{ready}/{desired}</span> };
          }}
        />

        <WorkloadListPanel<DaemonSet>
          id="workloads-daemonsets"
          title="DaemonSets"
          icon={<Layers className="w-4 h-4 text-cyan-400" />}
          items={daemonsets}
          gvr="apps~v1~daemonsets"
          browseLabel="Browse all DaemonSets"
          emptyText={`No DaemonSets${nsFilter ? ` in ${nsFilter}` : ''}`}
          filters={[{ key: 'unhealthy', label: 'Not ready', test: (x) => (x.status?.numberReady ?? 0) < (x.status?.desiredNumberScheduled ?? 0) }]}
          filter={dsFilter}
          onFilterChange={setDsFilter}
          go={go}
          summarize={(x): RowSummary => {
            const ready = x.status?.numberReady ?? 0;
            const desired = x.status?.desiredNumberScheduled ?? 0;
            return { tone: ready >= desired ? 'ok' : 'warn', detail: <span className={cn('font-mono', ready >= desired ? 'text-green-400' : 'text-amber-400')}>{ready}/{desired} nodes</span> };
          }}
        />

        <WorkloadListPanel<CronJob>
          id="workloads-cronjobs"
          title="CronJobs"
          icon={<CalendarClock className="w-4 h-4 text-amber-400" />}
          items={cronjobs}
          gvr="batch~v1~cronjobs"
          browseLabel="Browse all CronJobs"
          emptyText={`No CronJobs${nsFilter ? ` in ${nsFilter}` : ''}`}
          filters={[{ key: 'suspended', label: 'Suspended', test: (x) => !!x.spec?.suspend }]}
          filter={cronFilter}
          onFilterChange={setCronFilter}
          go={go}
          summarize={(x): RowSummary => ({
            tone: x.spec?.suspend ? 'idle' : 'ok',
            badges: x.spec?.suspend ? ['suspended'] : undefined,
            detail: <>
              <span className="font-mono text-slate-400">{x.spec?.schedule}</span>
              <span className="text-slate-500">{x.status?.lastScheduleTime ? `last ${timeAgo(x.status.lastScheduleTime)}` : 'never run'}</span>
            </>,
          })}
        />

        <WorkloadListPanel<Job>
          id="workloads-jobs"
          title="Jobs"
          icon={<PlayCircle className="w-4 h-4 text-emerald-400" />}
          items={jobs}
          gvr="batch~v1~jobs"
          browseLabel="Browse all Jobs"
          emptyText={`No Jobs${nsFilter ? ` in ${nsFilter}` : ''}`}
          filters={[
            { key: 'failed', label: 'Failed', test: (x) => failedJobs.includes(x) },
            { key: 'running', label: 'Running', test: (x) => (x.status?.active ?? 0) > 0 },
          ]}
          filter={jobFilter}
          onFilterChange={setJobFilter}
          go={go}
          summarize={(x): RowSummary => {
            const failed = failedJobs.includes(x);
            const running = (x.status?.active ?? 0) > 0;
            const completions = x.spec?.completions ?? 1;
            return {
              tone: failed ? 'bad' : running ? 'warn' : 'ok',
              detail: <>
                <span className={cn(failed ? 'text-red-400' : running ? 'text-amber-400' : 'text-green-400')}>{failed ? 'Failed' : running ? 'Running' : 'Complete'}</span>
                <span className="font-mono text-slate-400">{x.status?.succeeded ?? 0}/{completions}</span>
              </>,
            };
          }}
        />
      </div>
    </div>
  );
}

// ===== Workload Health Audit =====

function WorkloadHealthAudit({ deployments, pdbs, go }: { deployments: Deployment[]; pdbs: PodDisruptionBudget[]; go: (path: string, title: string) => void }) {
  // PDB label selectors for matching
  const pdbSelectors = React.useMemo(() =>
    pdbs.map((pdb) => ({
      name: pdb.metadata.name,
      ns: pdb.metadata.namespace,
      labels: pdb.spec?.selector?.matchLabels || {},
    })),
  [pdbs]);

  const hasPDB = (deploy: Deployment) => {
    const deployLabels = deploy.spec?.selector?.matchLabels || {};
    const ns = deploy.metadata.namespace;
    return pdbSelectors.some(pdb =>
      pdb.ns === ns && Object.entries(pdb.labels).every(([k, v]) => deployLabels[k] === v)
    );
  };

  const checks: AuditCheck[] = React.useMemo(() => {
    const allChecks: AuditCheck[] = [];

    // Exclude platform-managed deployments (openshift-*, kube-*) — they're CVO-managed
    const userDeployments = deployments.filter((d) => {
      const ns = d.metadata?.namespace || '';
      return !ns.startsWith('openshift-') && !ns.startsWith('kube-') && ns !== 'openshift';
    });

    // 1. Resource requests/limits
    const noLimits = userDeployments.filter(d => {
      const containers = d.spec?.template?.spec?.containers || [];
      return containers.some((c: Container) => !c.resources?.requests?.cpu || !c.resources?.limits?.memory);
    });
    allChecks.push({
      id: 'resource-limits',
      title: 'Resource Requests & Limits',
      description: 'Every container should have CPU/memory requests (for scheduling) and limits (for OOM protection)',
      why: 'Without requests, the scheduler cannot place pods optimally. Without limits, a single pod can consume all node resources and starve other workloads.',
      passing: userDeployments.filter(d => !noLimits.includes(d)),
      failing: noLimits,
      yamlExample: `spec:
  template:
    spec:
      containers:
      - name: my-app
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "500m"
            memory: "512Mi"`,
      fixLabel: 'How to fix — add to your Deployment YAML:',
    });

    // 2. Liveness probes
    const noLiveness = userDeployments.filter(d => {
      const containers = d.spec?.template?.spec?.containers || [];
      return containers.some((c: Container) => !c.livenessProbe);
    });
    allChecks.push({
      id: 'liveness-probe',
      title: 'Liveness Probes',
      description: 'Liveness probes detect when a container is stuck and automatically restart it',
      why: 'Without a liveness probe, a container that deadlocks or enters an infinite loop will never be restarted. Kubernetes only restarts containers that crash (exit non-zero).',
      passing: userDeployments.filter(d => !noLiveness.includes(d)),
      failing: noLiveness,
      yamlExample: `spec:
  template:
    spec:
      containers:
      - name: my-app
        livenessProbe:
          httpGet:
            path: /healthz
            port: 8080
          initialDelaySeconds: 15
          periodSeconds: 10
          failureThreshold: 3`,
      fixLabel: 'How to fix — add to your Deployment YAML:',
    });

    // 3. Readiness probes
    const noReadiness = userDeployments.filter(d => {
      const containers = d.spec?.template?.spec?.containers || [];
      return containers.some((c: Container) => !c.readinessProbe);
    });
    allChecks.push({
      id: 'readiness-probe',
      title: 'Readiness Probes',
      description: 'Readiness probes control when a pod receives traffic from Services',
      why: 'Without a readiness probe, pods receive traffic immediately on start — before the application is ready. This causes errors during deployments and restarts.',
      passing: userDeployments.filter(d => !noReadiness.includes(d)),
      failing: noReadiness,
      yamlExample: `spec:
  template:
    spec:
      containers:
      - name: my-app
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5`,
      fixLabel: 'How to fix — add to your Deployment YAML:',
    });

    // 4. PodDisruptionBudgets
    const multiReplicaDeploys = userDeployments.filter(d => (d.spec?.replicas ?? 0) > 1);
    const noPDB = multiReplicaDeploys.filter(d => !hasPDB(d));
    allChecks.push({
      id: 'pdb',
      title: 'PodDisruptionBudgets',
      description: 'PDBs prevent voluntary disruptions (node drains, upgrades) from taking down too many pods at once',
      why: 'During cluster upgrades or node maintenance, all pods on a node are evicted. Without a PDB, all replicas of a deployment could be evicted simultaneously, causing downtime.',
      passing: multiReplicaDeploys.filter(d => hasPDB(d)),
      failing: noPDB,
      yamlExample: `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-app-pdb
spec:
  minAvailable: 1    # or maxUnavailable: 1
  selector:
    matchLabels:
      app: my-app    # must match deployment selector`,
      fixLabel: 'How to fix — add to your Deployment YAML:',
    });

    // 5. Replicas > 1 for HA
    const singleReplica = userDeployments.filter(d => (d.spec?.replicas ?? 0) === 1);
    allChecks.push({
      id: 'replicas',
      title: 'Multiple Replicas',
      description: 'Production workloads should run 2+ replicas for high availability',
      why: 'A single replica means any pod restart, node failure, or upgrade causes downtime. With 2+ replicas, traffic is served even when one pod is unavailable.',
      passing: userDeployments.filter(d => (d.spec?.replicas ?? 0) > 1),
      failing: singleReplica,
      yamlExample: `spec:
  replicas: 2    # minimum for HA, 3+ recommended`,
      fixLabel: 'How to fix — add to your Deployment YAML:',
    });

    // 6. Rolling update strategy
    const recreateStrategy = userDeployments.filter(d => d.spec?.strategy?.type === 'Recreate');
    allChecks.push({
      id: 'strategy',
      title: 'Rolling Update Strategy',
      description: 'Avoid Recreate strategy in production — it causes downtime during updates',
      why: 'Recreate strategy terminates all old pods before creating new ones. During that gap, the application is completely unavailable.',
      passing: userDeployments.filter(d => !recreateStrategy.includes(d)),
      failing: recreateStrategy,
      yamlExample: `spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1`,
      fixLabel: 'How to fix — add to your Deployment YAML:',
    });

    return allChecks;
  }, [deployments, pdbSelectors]);

  if (deployments.length === 0) return null;

  return (
    <HealthAuditPanel
      checks={checks}
      title="Workload Health Audit"
      onNavigateItem={(_check, item) => {
        const d = item as Deployment;
        go(`/yaml/apps~v1~deployments/${d.metadata.namespace}/${d.metadata.name}`, `${d.metadata.name} (YAML)`);
      }}
      navigateLabel={() => 'Edit YAML'}
    />
  );
}
