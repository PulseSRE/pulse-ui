import React from 'react';
import {
  Package, Box, Clock, AlertCircle, CheckCircle, XCircle,
  FileText, ArrowRight, Plus, AlertTriangle, Info, RefreshCw,
  Activity, Layers, Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { K8sResource } from '../engine/renderers';
import { getDeploymentStatus, getPodStatus } from '../engine/renderers/statusUtils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { MetricCard } from '../components/metrics/Sparkline';
import { Panel } from '../components/primitives/Panel';
import { sanitizePromQL } from '../engine/query';

export default function WorkloadsView() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;
  const safeNs = nsFilter ? sanitizePromQL(nsFilter) : '';

  const { data: deployments = [] } = useK8sListWatch({ apiPath: '/apis/apps/v1/deployments', namespace: nsFilter });
  const { data: statefulsets = [] } = useK8sListWatch({ apiPath: '/apis/apps/v1/statefulsets', namespace: nsFilter });
  const { data: daemonsets = [] } = useK8sListWatch({ apiPath: '/apis/apps/v1/daemonsets', namespace: nsFilter });
  const { data: pods = [] } = useK8sListWatch({ apiPath: '/api/v1/pods', namespace: nsFilter });
  const { data: jobs = [] } = useK8sListWatch({ apiPath: '/apis/batch/v1/jobs', namespace: nsFilter });
  const { data: cronjobs = [] } = useK8sListWatch({ apiPath: '/apis/batch/v1/cronjobs', namespace: nsFilter });
  const { data: replicasets = [] } = useK8sListWatch({ apiPath: '/apis/apps/v1/replicasets', namespace: nsFilter });
  const { data: pdbs = [] } = useK8sListWatch({ apiPath: '/apis/policy/v1/poddisruptionbudgets', namespace: nsFilter });

  // Pod status breakdown
  const podStats = React.useMemo(() => {
    const s = { Running: 0, Pending: 0, Succeeded: 0, Failed: 0, CrashLoop: 0, ImagePull: 0, Unknown: 0 };
    for (const p of pods as any[]) {
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
    (deployments as any[]).filter(d => !getDeploymentStatus(d).available),
  [deployments]);

  const unhealthySS = React.useMemo(() =>
    (statefulsets as any[]).filter(s => {
      const ready = (s.status as any)?.readyReplicas ?? 0;
      const desired = (s.spec as any)?.replicas ?? 0;
      return desired > 0 && ready < desired;
    }),
  [statefulsets]);

  const failedJobs = React.useMemo(() =>
    (jobs as any[]).filter(j => {
      const conditions = j.status?.conditions || [];
      return conditions.some((c: any) => c.type === 'Failed' && c.status === 'True');
    }),
  [jobs]);

  const crashingPods = React.useMemo(() =>
    (pods as any[]).filter(p => {
      const s = getPodStatus(p);
      return s.reason === 'CrashLoopBackOff' || s.reason === 'ImagePullBackOff' || s.phase === 'Failed';
    }),
  [pods]);

  // Container restart count
  const highRestartPods = React.useMemo(() =>
    (pods as any[]).filter(p => {
      const restarts = (p.status?.containerStatuses || []).reduce((sum: number, c: any) => sum + (c.restartCount || 0), 0);
      return restarts >= 5;
    }).sort((a: any, b: any) => {
      const ra = (a.status?.containerStatuses || []).reduce((s: number, c: any) => s + (c.restartCount || 0), 0);
      const rb = (b.status?.containerStatuses || []).reduce((s: number, c: any) => s + (c.restartCount || 0), 0);
      return rb - ra;
    }),
  [pods]);

  // Old ReplicaSets (desired=0 but still present)
  const oldReplicaSets = React.useMemo(() =>
    (replicasets as any[]).filter(rs => (rs.spec?.replicas ?? 0) === 0 && (rs.status?.replicas ?? 0) === 0),
  [replicasets]);

  // Issues
  const issues: Array<{ msg: string; severity: 'warning' | 'critical' }> = [];
  if (podStats.CrashLoop > 0) issues.push({ msg: `${podStats.CrashLoop} pod${podStats.CrashLoop > 1 ? 's' : ''} in CrashLoopBackOff`, severity: 'critical' });
  if (podStats.ImagePull > 0) issues.push({ msg: `${podStats.ImagePull} pod${podStats.ImagePull > 1 ? 's' : ''} with image pull errors`, severity: 'critical' });
  if (unhealthyDeploys.length > 0) issues.push({ msg: `${unhealthyDeploys.length} deployment${unhealthyDeploys.length > 1 ? 's' : ''} not fully available`, severity: 'warning' });
  if (unhealthySS.length > 0) issues.push({ msg: `${unhealthySS.length} StatefulSet${unhealthySS.length > 1 ? 's' : ''} not ready`, severity: 'warning' });
  if (failedJobs.length > 0) issues.push({ msg: `${failedJobs.length} failed job${failedJobs.length > 1 ? 's' : ''}`, severity: 'warning' });

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Package className="w-6 h-6 text-blue-500" /> Workloads
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Deployments, StatefulSets, DaemonSets, Jobs, and Pods
              {nsFilter && <span className="text-blue-400 ml-1">in {nsFilter}</span>}
            </p>
          </div>
        </div>

        {/* Issues */}
        {issues.length > 0 && (
          <div className="space-y-2">
            {issues.map((issue, i) => (
              <div key={i} className={cn('flex items-center px-4 py-2.5 rounded-lg border',
                issue.severity === 'critical' ? 'bg-red-950/30 border-red-900' : 'bg-yellow-950/30 border-yellow-900')}>
                <div className="flex items-center gap-2">
                  {issue.severity === 'critical' ? <AlertCircle className="w-4 h-4 text-red-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
                  <span className="text-sm text-slate-200">{issue.msg}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <button onClick={() => go('/r/apps~v1~deployments', 'Deployments')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', unhealthyDeploys.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Deployments</span>
              {unhealthyDeploys.length > 0 ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{unhealthyDeploys.length}</span> : <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
            </div>
            <div className="text-xl font-bold text-slate-100">{deployments.length}</div>
          </button>
          <button onClick={() => go('/r/apps~v1~statefulsets', 'StatefulSets')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', unhealthySS.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">StatefulSets</span>
              {unhealthySS.length > 0 ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{unhealthySS.length}</span> : <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
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
              {crashingPods.length > 0 ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{crashingPods.length}</span> : <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
            </div>
            <div className="text-xl font-bold text-slate-100">{pods.length}</div>
          </button>
          <button onClick={() => go('/r/batch~v1~jobs', 'Jobs')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', failedJobs.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Jobs</span>
              {failedJobs.length > 0 && <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{failedJobs.length}</span>}
            </div>
            <div className="text-xl font-bold text-slate-100">{jobs.length}</div>
          </button>
          <button onClick={() => go('/r/batch~v1~cronjobs', 'CronJobs')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">CronJobs</div>
            <div className="text-xl font-bold text-slate-100">{cronjobs.length}</div>
          </button>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            title="Pod CPU Usage"
            query={nsFilter
              ? `sum(rate(container_cpu_usage_seconds_total{namespace="${safeNs}",container!=""}[5m])) / sum(kube_pod_container_resource_requests{namespace="${safeNs}",resource="cpu"}) * 100`
              : 'sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) / sum(kube_pod_container_resource_requests{resource="cpu"}) * 100'}
            unit="%"
            color="#3b82f6"
            thresholds={{ warning: 70, critical: 90 }}
          />
          <MetricCard
            title="Pod Memory Usage"
            query={nsFilter
              ? `sum(container_memory_working_set_bytes{namespace="${safeNs}",container!=""}) / sum(kube_pod_container_resource_requests{namespace="${safeNs}",resource="memory"}) * 100`
              : 'sum(container_memory_working_set_bytes{container!=""}) / sum(kube_pod_container_resource_requests{resource="memory"}) * 100'}
            unit="%"
            color="#8b5cf6"
            thresholds={{ warning: 75, critical: 90 }}
          />
          <MetricCard
            title="Container Restarts"
            query={nsFilter
              ? `sum(rate(kube_pod_container_status_restarts_total{namespace="${safeNs}"}[1h])) * 3600`
              : 'sum(rate(kube_pod_container_status_restarts_total[1h])) * 3600'}
            unit=" /hr"
            color="#f59e0b"
            thresholds={{ warning: 5, critical: 20 }}
          />
          <MetricCard
            title="Pod Start Rate"
            query={nsFilter
              ? `sum(rate(kube_pod_start_time{namespace="${safeNs}"}[1h])) * 3600`
              : 'sum(rate(kube_pod_start_time[1h])) * 3600'}
            unit=" /hr"
            color="#06b6d4"
          />
        </div>

        {/* Workload Health Audit */}
        <WorkloadHealthAudit deployments={deployments as any[]} pdbs={pdbs as any[]} go={go} />

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
                {unhealthyDeploys.slice(0, 10).map((d: any) => {
                  const s = getDeploymentStatus(d);
                  return (
                    <button key={d.metadata.uid} onClick={() => go(`/r/apps~v1~deployments/${d.metadata.namespace}/${d.metadata.name}`, d.metadata.name)}
                      className="w-full flex items-center justify-between p-2 rounded hover:bg-slate-800/50 text-left transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                        <span className="text-sm text-slate-200 truncate">{d.metadata.name}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{d.metadata.namespace}</span>
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
                {highRestartPods.slice(0, 8).map((p: any) => {
                  const restarts = (p.status?.containerStatuses || []).reduce((s: number, c: any) => s + (c.restartCount || 0), 0);
                  return (
                    <button key={p.metadata.uid} onClick={() => go(`/r/v1~pods/${p.metadata.namespace}/${p.metadata.name}`, p.metadata.name)}
                      className="w-full flex items-center justify-between p-2 rounded hover:bg-slate-800/50 text-left transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                        <span className="text-sm text-slate-200 truncate">{p.metadata.name}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{p.metadata.namespace}</span>
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
        <Panel title={`Deployments (${deployments.length})`} icon={<Package className="w-4 h-4 text-blue-400" />}>
          {deployments.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-500">No deployments{nsFilter ? ` in ${nsFilter}` : ''}</div>
          ) : (
            <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
              {(deployments as any[]).slice(0, 25).map((d) => {
                const s = getDeploymentStatus(d);
                return (
                  <button key={d.metadata.uid} onClick={() => go(`/r/apps~v1~deployments/${d.metadata.namespace}/${d.metadata.name}`, d.metadata.name)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-800/50 text-left transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn('w-2 h-2 rounded-full shrink-0', s.available ? 'bg-green-500' : 'bg-red-500')} />
                      <span className="text-sm text-slate-200 truncate">{d.metadata.name}</span>
                      <span className="text-xs text-slate-600">{d.metadata.namespace}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={cn('text-xs font-mono', s.available ? 'text-green-400' : 'text-red-400')}>{s.ready}/{s.desired}</span>
                      <span className="text-xs text-slate-600">{(d.spec as any)?.strategy?.type || 'RollingUpdate'}</span>
                      <button onClick={(e) => { e.stopPropagation(); go(`/logs/${d.metadata.namespace}/${d.metadata.name}?selector=${encodeURIComponent(`app=${d.metadata.name}`)}&kind=Deployment`, `${d.metadata.name} (Logs)`); }}
                        className="text-slate-500 hover:text-blue-400 transition-colors" title="View Logs"><FileText className="w-3.5 h-3.5" /></button>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {deployments.length > 25 && (
            <div className="px-3 py-2 border-t border-slate-800">
              <button onClick={() => go('/r/apps~v1~deployments', 'Deployments')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                View all {deployments.length} <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </Panel>

        {/* Failed Jobs */}
        {failedJobs.length > 0 && (
          <Panel title={`Failed Jobs (${failedJobs.length})`} icon={<XCircle className="w-4 h-4 text-red-500" />}>
            <div className="space-y-1">
              {(failedJobs as any[]).slice(0, 8).map((j) => (
                <button key={j.metadata.uid} onClick={() => go(`/r/batch~v1~jobs/${j.metadata.namespace}/${j.metadata.name}`, j.metadata.name)}
                  className="w-full flex items-center justify-between p-2 rounded hover:bg-slate-800/50 text-left transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                    <span className="text-sm text-slate-200 truncate">{j.metadata.name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{j.metadata.namespace}</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-slate-600" />
                </button>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Tip({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex gap-2">
      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
      <div>
        <span className="font-medium text-slate-200">{title}</span>
        <p className="text-slate-500">{desc}</p>
      </div>
    </div>
  );
}


// ===== Workload Health Audit =====

interface AuditCheck {
  id: string;
  title: string;
  description: string;
  why: string;
  passing: any[];
  failing: any[];
  yamlExample: string;
}

function WorkloadHealthAudit({ deployments, pdbs, go }: { deployments: any[]; pdbs: any[]; go: (path: string, title: string) => void }) {
  const [expandedCheck, setExpandedCheck] = React.useState<string | null>(null);

  // PDB label selectors for matching
  const pdbSelectors = React.useMemo(() =>
    pdbs.map((pdb: any) => ({
      name: pdb.metadata.name,
      ns: pdb.metadata.namespace,
      labels: pdb.spec?.selector?.matchLabels || {},
    })),
  [pdbs]);

  const hasPDB = (deploy: any) => {
    const deployLabels = deploy.spec?.selector?.matchLabels || {};
    const ns = deploy.metadata.namespace;
    return pdbSelectors.some(pdb =>
      pdb.ns === ns && Object.entries(pdb.labels).every(([k, v]) => deployLabels[k] === v)
    );
  };

  const checks: AuditCheck[] = React.useMemo(() => {
    const allChecks: AuditCheck[] = [];

    // Exclude platform-managed deployments (openshift-*, kube-*) — they're CVO-managed
    const userDeployments = deployments.filter((d: any) => {
      const ns = d.metadata?.namespace || '';
      return !ns.startsWith('openshift-') && !ns.startsWith('kube-') && ns !== 'openshift';
    });

    // 1. Resource requests/limits
    const noLimits = userDeployments.filter(d => {
      const containers = d.spec?.template?.spec?.containers || [];
      return containers.some((c: any) => !c.resources?.requests?.cpu || !c.resources?.limits?.memory);
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
    });

    // 2. Liveness probes
    const noLiveness = userDeployments.filter(d => {
      const containers = d.spec?.template?.spec?.containers || [];
      return containers.some((c: any) => !c.livenessProbe);
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
    });

    // 3. Readiness probes
    const noReadiness = userDeployments.filter(d => {
      const containers = d.spec?.template?.spec?.containers || [];
      return containers.some((c: any) => !c.readinessProbe);
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
    });

    return allChecks;
  }, [deployments, pdbSelectors]);

  if (deployments.length === 0) return null;

  const totalPassing = checks.reduce((s, c) => s + (c.failing.length === 0 ? 1 : 0), 0);
  const score = Math.round((totalPassing / checks.length) * 100);

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" /> Workload Health Audit
        </h2>
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-bold', score === 100 ? 'text-green-400' : score >= 60 ? 'text-amber-400' : 'text-red-400')}>{score}%</span>
          <span className="text-xs text-slate-500">{totalPassing}/{checks.length} passing</span>
        </div>
      </div>
      <div className="divide-y divide-slate-800">
        {checks.map((check) => {
          const pass = check.failing.length === 0;
          const expanded = expandedCheck === check.id;
          return (
            <div key={check.id}>
              <button
                onClick={() => setExpandedCheck(expanded ? null : check.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {pass ? <CheckCircle className="w-4 h-4 text-green-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                  <div>
                    <span className="text-sm text-slate-200">{check.title}</span>
                    <span className="text-xs text-slate-500 ml-2">
                      {pass ? `${check.passing.length} pass` : `${check.failing.length} of ${check.failing.length + check.passing.length} need attention`}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-600">{expanded ? '▾' : '▸'}</span>
              </button>

              {expanded && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-xs text-slate-400">{check.description}</p>

                  {/* Why it matters */}
                  <div className="bg-blue-950/20 border border-blue-900/50 rounded p-3">
                    <div className="text-xs font-medium text-blue-300 mb-1">Why it matters</div>
                    <p className="text-xs text-slate-400">{check.why}</p>
                  </div>

                  {/* Failing workloads */}
                  {check.failing.length > 0 && (
                    <div>
                      <div className="text-xs text-amber-400 font-medium mb-1.5">Missing ({check.failing.length})</div>
                      <div className="space-y-1 max-h-32 overflow-auto">
                        {check.failing.slice(0, 10).map((d: any) => (
                          <button key={d.metadata.uid} onClick={() => go(`/yaml/apps~v1~deployments/${d.metadata.namespace}/${d.metadata.name}`, `${d.metadata.name} (YAML)`)}
                            className="flex items-center justify-between w-full py-1 px-2 rounded hover:bg-slate-800/50 text-left transition-colors">
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                              <span className="text-xs text-slate-300">{d.metadata.name}</span>
                              <span className="text-xs text-slate-600">{d.metadata.namespace}</span>
                            </div>
                            <span className="text-xs text-blue-400">Edit YAML →</span>
                          </button>
                        ))}
                        {check.failing.length > 10 && <div className="text-xs text-slate-600 px-2">+{check.failing.length - 10} more</div>}
                      </div>
                    </div>
                  )}

                  {/* Passing workloads */}
                  {check.passing.length > 0 && (
                    <div>
                      <div className="text-xs text-green-400 font-medium mb-1">Passing ({check.passing.length})</div>
                      <div className="flex flex-wrap gap-1">
                        {check.passing.slice(0, 8).map((d: any) => (
                          <span key={d.metadata.uid} className="text-xs px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded">{d.metadata.name}</span>
                        ))}
                        {check.passing.length > 8 && <span className="text-xs text-slate-600">+{check.passing.length - 8} more</span>}
                      </div>
                    </div>
                  )}

                  {/* YAML example */}
                  <div>
                    <div className="text-xs text-slate-500 font-medium mb-1">How to fix — add to your Deployment YAML:</div>
                    <pre className="text-[11px] text-emerald-400 font-mono bg-slate-950 p-3 rounded overflow-x-auto">{check.yamlExample}</pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
