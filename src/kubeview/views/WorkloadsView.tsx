import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Package, Box, Clock, RefreshCw, AlertCircle, CheckCircle, XCircle,
  FileText, ArrowRight, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { getDeploymentStatus, getPodStatus } from '../engine/renderers/statusUtils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';


export default function WorkloadsView() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  const { data: deployments = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/apps/v1/deployments', nsFilter],
    queryFn: () => k8sList('/apis/apps/v1/deployments', nsFilter),
    refetchInterval: 30000,
  });
  const { data: statefulsets = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/apps/v1/statefulsets', nsFilter],
    queryFn: () => k8sList('/apis/apps/v1/statefulsets', nsFilter),
    refetchInterval: 30000,
  });
  const { data: daemonsets = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/apps/v1/daemonsets', nsFilter],
    queryFn: () => k8sList('/apis/apps/v1/daemonsets', nsFilter),
    refetchInterval: 30000,
  });
  const { data: pods = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/pods', nsFilter],
    queryFn: () => k8sList('/api/v1/pods', nsFilter),
    refetchInterval: 30000,
  });
  const { data: jobs = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/batch/v1/jobs', nsFilter],
    queryFn: () => k8sList('/apis/batch/v1/jobs', nsFilter),
    refetchInterval: 30000,
  });
  const { data: cronjobs = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/batch/v1/cronjobs', nsFilter],
    queryFn: () => k8sList('/apis/batch/v1/cronjobs', nsFilter),
    refetchInterval: 30000,
  });

  // Data is already namespace-scoped from API when nsFilter is set
  const fd = deployments as any[];
  const fss = statefulsets as any[];
  const fds = daemonsets as any[];
  const fp = pods as any[];
  const fj = jobs as any[];
  const fc = cronjobs as any[];

  const unhealthyDeploys = fd.filter((d) => !getDeploymentStatus(d).available);
  const crashingPods = fp.filter((p) => {
    const s = getPodStatus(p);
    return s.reason === 'CrashLoopBackOff' || s.reason === 'ImagePullBackOff' || s.phase === 'Failed';
  });

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><Package className="w-6 h-6 text-blue-500" /> Workloads</h1>
          <p className="text-sm text-slate-400 mt-1">Deployments, StatefulSets, DaemonSets, Jobs, and Pods</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Deployments" value={fd.length} issues={unhealthyDeploys.length} onClick={() => go('/r/apps~v1~deployments', 'Deployments')} />
          <StatCard label="StatefulSets" value={fss.length} onClick={() => go('/r/apps~v1~statefulsets', 'StatefulSets')} />
          <StatCard label="DaemonSets" value={fds.length} onClick={() => go('/r/apps~v1~daemonsets', 'DaemonSets')} />
          <StatCard label="Pods" value={fp.length} issues={crashingPods.length} onClick={() => go('/r/v1~pods', 'Pods')} />
          <StatCard label="Jobs" value={fj.length} onClick={() => go('/r/batch~v1~jobs', 'Jobs')} />
          <StatCard label="CronJobs" value={fc.length} onClick={() => go('/r/batch~v1~cronjobs', 'CronJobs')} />
        </div>

        {/* Unhealthy workloads */}
        {unhealthyDeploys.length > 0 && (
          <div className="bg-red-950/30 rounded-lg border border-red-900 p-4">
            <h2 className="text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2"><XCircle className="w-4 h-4 text-red-500" /> Unhealthy Deployments ({unhealthyDeploys.length})</h2>
            <div className="space-y-1">
              {unhealthyDeploys.slice(0, 10).map((d: any) => {
                const s = getDeploymentStatus(d);
                return (
                  <button key={d.metadata.uid} onClick={() => go(`/r/apps~v1~deployments/${d.metadata.namespace}/${d.metadata.name}`, d.metadata.name)}
                    className="w-full flex items-center justify-between p-2 rounded hover:bg-slate-800/50 text-left">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                      <span className="text-sm text-slate-200 truncate">{d.metadata.name}</span>
                      <span className="text-xs text-slate-500">{d.metadata.namespace}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-red-400">{s.ready}/{s.desired}</span>
                      <ArrowRight className="w-3 h-3 text-slate-600" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent deployments */}
        <div className="bg-slate-900 rounded-lg border border-slate-800">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Deployments</h2>
            <button onClick={() => go('/r/apps~v1~deployments', 'Deployments')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></button>
          </div>
          <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
            {fd.slice(0, 20).map((d: any) => {
              const s = getDeploymentStatus(d);
              return (
                <button key={d.metadata.uid} onClick={() => go(`/r/apps~v1~deployments/${d.metadata.namespace}/${d.metadata.name}`, d.metadata.name)}
                  className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-800/50 text-left">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn('w-2 h-2 rounded-full shrink-0', s.available ? 'bg-green-500' : 'bg-red-500')} />
                    <span className="text-sm text-slate-200 truncate">{d.metadata.name}</span>
                    <span className="text-xs text-slate-500">{d.metadata.namespace}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn('text-xs font-mono', s.available ? 'text-green-400' : 'text-red-400')}>{s.ready}/{s.desired}</span>
                    <button onClick={(e) => { e.stopPropagation(); go(`/logs/${d.metadata.namespace}/${d.metadata.name}?selector=${encodeURIComponent(`app=${d.metadata.name}`)}&kind=Deployment`, `${d.metadata.name} (Logs)`); }}
                      className="text-xs text-slate-500 hover:text-blue-400" title="View Logs"><FileText className="w-3.5 h-3.5" /></button>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Pod status breakdown */}
        {crashingPods.length > 0 && (
          <div className="bg-yellow-950/30 rounded-lg border border-yellow-900 p-4">
            <h2 className="text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-yellow-500" /> Problem Pods ({crashingPods.length})</h2>
            <div className="space-y-1">
              {crashingPods.slice(0, 8).map((p: any) => {
                const s = getPodStatus(p);
                return (
                  <button key={p.metadata.uid} onClick={() => go(`/r/v1~pods/${p.metadata.namespace}/${p.metadata.name}`, p.metadata.name)}
                    className="w-full flex items-center justify-between p-2 rounded hover:bg-slate-800/50 text-left">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
                      <span className="text-sm text-slate-200 truncate">{p.metadata.name}</span>
                      <span className="text-xs text-slate-500">{p.metadata.namespace}</span>
                    </div>
                    <span className="text-xs px-2 py-0.5 bg-red-900/50 text-red-300 rounded">{s.reason || s.phase}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, issues, onClick }: { label: string; value: number; issues?: number; onClick: () => void }) {
  return (
    <div onClick={onClick} className={cn('bg-slate-900 rounded-lg border p-3 cursor-pointer hover:border-slate-600 transition-colors', issues ? 'border-yellow-800' : 'border-slate-800')}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-400">{label}</span>
        {issues ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{issues}</span> : <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
      </div>
      <div className="text-xl font-bold text-slate-100">{value}</div>
    </div>
  );
}
