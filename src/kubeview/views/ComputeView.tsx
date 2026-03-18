import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Server, Cpu, HardDrive, CheckCircle, XCircle, AlertCircle,
  ArrowRight, Ban, Box, Terminal, FileText, Activity, Info, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import { queryInstant } from '../components/metrics/prometheus';
import { MetricCard } from '../components/metrics/Sparkline';
import type { K8sResource } from '../engine/renderers';
import { getNodeStatus } from '../engine/renderers/statusUtils';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';

function parseQuantity(q: string | undefined): number {
  if (!q) return 0;
  const match = q.match(/^(\d+\.?\d*)\s*([A-Za-z]*)/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2];
  if (unit === 'Ki') return val * 1024;
  if (unit === 'Mi') return val * 1024 * 1024;
  if (unit === 'Gi') return val * 1024 * 1024 * 1024;
  if (unit === 'Ti') return val * 1024 * 1024 * 1024 * 1024;
  if (unit === 'm') return val / 1000;
  if (unit === 'k') return val * 1000;
  return val;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} Ti`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} Gi`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} Mi`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} Ki`;
  return `${bytes}`;
}

function formatCpu(cores: number): string {
  if (cores >= 1) return `${cores.toFixed(1)} cores`;
  return `${Math.round(cores * 1000)}m`;
}

export default function ComputeView() {
  const go = useNavigateTab();

  const { data: nodes = [] } = useK8sListWatch({ apiPath: '/api/v1/nodes' });
  const { data: pods = [] } = useK8sListWatch({ apiPath: '/api/v1/pods' });

  const { data: machines = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/machine.openshift.io/v1beta1/machines'],
    queryFn: () => k8sList('/apis/machine.openshift.io/v1beta1/machines').catch(() => []),
    staleTime: 60000,
  });

  const { data: machineSets = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/machine.openshift.io/v1beta1/machinesets'],
    queryFn: () => k8sList('/apis/machine.openshift.io/v1beta1/machinesets').catch(() => []),
    staleTime: 60000,
  });

  const { data: healthChecks = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/machine.openshift.io/v1beta1/machinehealthchecks'],
    queryFn: () => k8sList('/apis/machine.openshift.io/v1beta1/machinehealthchecks').catch(() => []),
    staleTime: 60000,
  });

  const { data: machineAutoscalers = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/autoscaling.openshift.io/v1beta1/machineautoscalers'],
    queryFn: () => k8sList('/apis/autoscaling.openshift.io/v1beta1/machineautoscalers').catch(() => []),
    staleTime: 60000,
  });

  const { data: clusterAutoscaler = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/autoscaling.openshift.io/v1/clusterautoscalers'],
    queryFn: () => k8sList('/apis/autoscaling.openshift.io/v1/clusterautoscalers').catch(() => []),
    staleTime: 60000,
  });

  // Per-node CPU usage from Prometheus
  const { data: nodeCpuMetrics = [] } = useQuery({
    queryKey: ['compute', 'node-cpu'],
    queryFn: () => queryInstant('sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) by (instance)').catch(() => []),
    refetchInterval: 30000,
  });

  // Per-node memory usage from Prometheus
  const { data: nodeMemMetrics = [] } = useQuery({
    queryKey: ['compute', 'node-mem'],
    queryFn: () => queryInstant('(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100').catch(() => []),
    refetchInterval: 30000,
  });

  // MachineConfig resources
  const { data: machineConfigPools = [] } = useQuery<K8sResource[]>({
    queryKey: ['compute', 'machineconfigpools'],
    queryFn: () => k8sList('/apis/machineconfiguration.openshift.io/v1/machineconfigpools').catch(() => []),
    staleTime: 60000,
  });

  // Cluster totals
  const { data: clusterCpu } = useQuery({
    queryKey: ['compute', 'cluster-cpu'],
    queryFn: () => queryInstant('sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) / sum(machine_cpu_cores) * 100').catch(() => []),
    refetchInterval: 30000,
  });
  const { data: clusterMem } = useQuery({
    queryKey: ['compute', 'cluster-mem'],
    queryFn: () => queryInstant('(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100').catch(() => []),
    refetchInterval: 30000,
  });

  const cpuPercent = clusterCpu?.[0]?.value ?? null;
  const memPercent = clusterMem?.[0]?.value ?? null;
  const readyCount = nodes.filter((n) => getNodeStatus(n).ready).length;
  const unreadyNodes = nodes.filter((n) => !getNodeStatus(n).ready);
  const pressureNodes = nodes.filter((n) => { const s = getNodeStatus(n); return s.ready && (s.pressure.disk || s.pressure.memory || s.pressure.pid); });

  // Pods per node
  const podsByNode = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const pod of pods as any[]) {
      const nodeName = pod.spec?.nodeName;
      if (nodeName) map.set(nodeName, (map.get(nodeName) || 0) + 1);
    }
    return map;
  }, [pods]);

  // Cluster capacity totals
  const clusterCapacity = React.useMemo(() => {
    let cpuCores = 0, memBytes = 0, podCapacity = 0;
    for (const n of nodes) {
      const cap = (n.status as any)?.capacity || {};
      cpuCores += parseQuantity(cap.cpu);
      memBytes += parseQuantity(cap.memory);
      podCapacity += parseQuantity(cap.pods);
    }
    return { cpuCores, memBytes, podCapacity, totalPods: pods.length };
  }, [nodes, pods]);

  // Node details with metrics
  const nodeDetails = React.useMemo(() => {
    return nodes.map((node) => {
      const status = getNodeStatus(node);
      const nodeInfo = (node.status as any)?.nodeInfo || {};
      const capacity = (node.status as any)?.capacity || {};
      const allocatable = (node.status as any)?.allocatable || {};
      const labels = node.metadata.labels || {};
      const roles = Object.keys(labels).filter(k => k.startsWith('node-role.kubernetes.io/')).map(k => k.replace('node-role.kubernetes.io/', ''));
      if (roles.length === 0) roles.push('worker');
      const taints = ((node.spec as any)?.taints || []) as any[];
      const unschedulable = (node.spec as any)?.unschedulable;
      const podCount = podsByNode.get(node.metadata.name) || 0;
      const podCap = parseQuantity(allocatable.pods || capacity.pods);
      const cpuCap = parseQuantity(capacity.cpu);
      const memCap = parseQuantity(capacity.memory);

      // Try to find per-node metrics (match by instance name containing node name)
      const nodeName = node.metadata.name;
      const memMetric = nodeMemMetrics.find((m: any) => m.metric?.instance?.includes(nodeName));
      const memUsagePct = memMetric?.value ?? null;
      const cpuMetric = nodeCpuMetrics.find((m: any) => m.metric?.instance?.includes(nodeName));
      const cpuUsageCores = cpuMetric?.value ?? null;
      const cpuUsagePct = cpuCap > 0 && cpuUsageCores !== null ? (cpuUsageCores / cpuCap) * 100 : null;

      // Age
      const created = node.metadata.creationTimestamp ? new Date(node.metadata.creationTimestamp) : null;
      const ageMs = created ? Date.now() - created.getTime() : 0;
      const ageDays = Math.floor(ageMs / 86400000);
      const age = ageDays > 0 ? `${ageDays}d` : `${Math.floor(ageMs / 3600000)}h`;

      // Pressure indicators
      const pressures: string[] = [];
      if (status.pressure?.disk) pressures.push('Disk');
      if (status.pressure?.memory) pressures.push('Memory');
      if (status.pressure?.pid) pressures.push('PID');

      // Machine ref
      const machineRef = machines.find((m: any) => m.status?.nodeRef?.name === nodeName);
      const instanceType = (machineRef as any)?.spec?.providerSpec?.value?.instanceType || '';

      return {
        node, status, nodeInfo, capacity, allocatable, roles, taints, unschedulable,
        podCount, podCap, cpuCap, memCap, memUsagePct, cpuUsagePct, age, pressures,
        instanceType, name: nodeName,
      };
    }).sort((a, b) => {
      // Sort: unready first, then by pod count descending
      if (!a.status.ready && b.status.ready) return -1;
      if (a.status.ready && !b.status.ready) return 1;
      return b.podCount - a.podCount;
    });
  }, [nodes, podsByNode, nodeMemMetrics]);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><Server className="w-6 h-6 text-blue-500" /> Compute</h1>
          <p className="text-sm text-slate-400 mt-1">Cluster capacity, node health, and resource utilization</p>
        </div>

        {/* Metrics sparklines */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            title="Cluster CPU"
            query="sum(rate(node_cpu_seconds_total{mode!='idle'}[5m])) / sum(machine_cpu_cores) * 100"
            unit="%"
            color="#3b82f6"
            thresholds={{ warning: 70, critical: 90 }}
          />
          <MetricCard
            title="Cluster Memory"
            query="(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100"
            unit="%"
            color="#8b5cf6"
            thresholds={{ warning: 75, critical: 90 }}
          />
          <MetricCard
            title="Node Load (1m)"
            query="avg(node_load1)"
            unit=""
            color="#f59e0b"
          />
          <MetricCard
            title="Filesystem Usage"
            query="(1 - sum(node_filesystem_avail_bytes{fstype!~'tmpfs|overlay|squashfs'}) / sum(node_filesystem_size_bytes{fstype!~'tmpfs|overlay|squashfs'})) * 100"
            unit="%"
            color="#06b6d4"
            thresholds={{ warning: 80, critical: 95 }}
          />
        </div>

        {/* Cluster overview cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Nodes" value={`${readyCount}/${nodes.length}`} issues={unreadyNodes.length + pressureNodes.length} onClick={() => go('/r/v1~nodes', 'Nodes')} />
          <StatCard label="CPU Usage" value={cpuPercent !== null ? `${Math.round(cpuPercent)}%` : '—'} bar={cpuPercent} barColor={cpuPercent && cpuPercent > 80 ? 'red' : cpuPercent && cpuPercent > 60 ? 'yellow' : 'green'} />
          <StatCard label="Memory" value={memPercent !== null ? `${Math.round(memPercent)}%` : '—'} bar={memPercent} barColor={memPercent && memPercent > 80 ? 'red' : memPercent && memPercent > 60 ? 'yellow' : 'green'} />
          <StatCard label="Total CPU" value={formatCpu(clusterCapacity.cpuCores)} subtitle={`${nodes.length} nodes`} />
          <StatCard label="Total Memory" value={formatBytes(clusterCapacity.memBytes)} subtitle={`${nodes.length} nodes`} />
          <StatCard label="Pods" value={`${clusterCapacity.totalPods}/${clusterCapacity.podCapacity}`} bar={clusterCapacity.podCapacity > 0 ? (clusterCapacity.totalPods / clusterCapacity.podCapacity) * 100 : null} barColor="blue" />
        </div>

        {/* Compute Health Audit */}
        <ComputeHealthAudit
          nodes={nodes as any[]}
          healthChecks={healthChecks as any[]}
          clusterAutoscaler={clusterAutoscaler as any[]}
          machineAutoscalers={machineAutoscalers as any[]}
          nodeDetails={nodeDetails}
          go={go}
        />

        {/* Alerts */}
        {(unreadyNodes.length > 0 || pressureNodes.length > 0) && (
          <div className="space-y-2">
            {unreadyNodes.map((n) => (
              <button key={n.metadata.uid} onClick={() => go(`/r/v1~nodes/_/${n.metadata.name}`, n.metadata.name)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-red-950/30 border border-red-900 rounded-lg hover:bg-red-950/50 text-left">
                <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                <div className="flex-1"><span className="text-sm font-medium text-slate-200">{n.metadata.name}</span><span className="text-xs text-red-400 ml-2">NotReady</span></div>
                <ArrowRight className="w-4 h-4 text-slate-600" />
              </button>
            ))}
            {pressureNodes.map((n) => {
              const s = getNodeStatus(n);
              const pressures = [s.pressure.disk && 'Disk', s.pressure.memory && 'Memory', s.pressure.pid && 'PID'].filter(Boolean).join(', ');
              return (
                <button key={n.metadata.uid} onClick={() => go(`/r/v1~nodes/_/${n.metadata.name}`, n.metadata.name)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-yellow-950/30 border border-yellow-900 rounded-lg hover:bg-yellow-950/50 text-left">
                  <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0" />
                  <div className="flex-1"><span className="text-sm font-medium text-slate-200">{n.metadata.name}</span><span className="text-xs text-yellow-400 ml-2">{pressures} Pressure</span></div>
                  <ArrowRight className="w-4 h-4 text-slate-600" />
                </button>
              );
            })}
          </div>
        )}

        {/* Node table */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Nodes ({nodes.length})</h2>
            <button onClick={() => go('/r/v1~nodes', 'Nodes')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Node</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Roles</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">CPU</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Memory</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Pods</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Instance</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Version</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Age</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {nodeDetails.map((nd) => {
                  const podPct = nd.podCap > 0 ? (nd.podCount / nd.podCap) * 100 : 0;
                  const memPct = nd.memUsagePct;
                  const cpuPct = nd.cpuUsagePct;
                  return (
                    <tr key={nd.node.metadata.uid} onClick={() => go(`/r/v1~nodes/_/${nd.name}`, nd.name)}
                      className="hover:bg-slate-800/70 cursor-pointer transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {nd.status.ready ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                          <span className="text-slate-200 truncate max-w-[200px]" title={nd.name}>{nd.name}</span>
                          {nd.unschedulable && <Ban className="w-3 h-3 text-yellow-500" title="Cordoned" />}
                        </div>
                        {nd.taints.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {nd.taints.map((t: any, i: number) => (
                              <span key={i} className={cn('text-xs px-1 py-0.5 rounded font-mono',
                                t.effect === 'NoSchedule' ? 'bg-yellow-900/30 text-yellow-400' :
                                t.effect === 'NoExecute' ? 'bg-red-900/30 text-red-400' :
                                'bg-slate-800 text-slate-500'
                              )} title={`${t.key}=${t.value || ''}:${t.effect}`}>
                                {t.key.split('/').pop()}:{t.effect}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={cn('text-xs px-1.5 py-0.5 rounded', nd.status.ready ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300')}>
                            {nd.status.ready ? 'Ready' : 'NotReady'}
                          </span>
                          {nd.pressures.length > 0 && nd.pressures.map((p: string) => (
                            <span key={p} className="text-xs px-1 py-0.5 bg-red-900/50 text-red-300 rounded">{p}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">{nd.roles.map((r: string) => <span key={r} className={cn('text-xs px-1.5 py-0.5 rounded', r === 'master' || r === 'control-plane' ? 'bg-purple-900/50 text-purple-300' : r === 'infra' ? 'bg-orange-900/50 text-orange-300' : 'bg-blue-900/50 text-blue-300')}>{r}</span>)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {cpuPct !== null ? (
                            <>
                              <UsageBar pct={cpuPct} color={cpuPct > 80 ? 'red' : cpuPct > 60 ? 'yellow' : 'green'} />
                              <span className="text-xs text-slate-400 font-mono w-10">{Math.round(cpuPct)}%</span>
                            </>
                          ) : (
                            <span className="text-xs text-slate-500">{formatCpu(nd.cpuCap)}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {memPct !== null ? (
                            <>
                              <UsageBar pct={memPct} color={memPct > 80 ? 'red' : memPct > 60 ? 'yellow' : 'green'} />
                              <span className="text-xs text-slate-400 font-mono w-10">{Math.round(memPct)}%</span>
                            </>
                          ) : (
                            <span className="text-xs text-slate-500">{formatBytes(nd.memCap)}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <UsageBar pct={podPct} color={podPct > 80 ? 'red' : podPct > 60 ? 'yellow' : 'blue'} />
                          <span className="text-xs text-slate-400 font-mono w-12">{nd.podCount}/{nd.podCap}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {nd.instanceType ? (
                          <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono">{nd.instanceType}</span>
                        ) : (
                          <span className="text-xs text-slate-600">{nd.nodeInfo.architecture}</span>
                        )}
                      </td>
                      <td className="px-4 py-3"><span className="text-xs text-slate-500 font-mono">{nd.nodeInfo.kubeletVersion}</span></td>
                      <td className="px-4 py-3"><span className="text-xs text-slate-500">{nd.age}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); go(`/node-logs/${nd.name}`, `${nd.name} (Logs)`); }} className="p-1 text-slate-500 hover:text-blue-400 transition-colors" title="Node Logs"><FileText className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Machine Management */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* MachineSets */}
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">MachineSets ({machineSets.length})</h2>
              <button onClick={() => go('/r/machine.openshift.io~v1beta1~machinesets', 'MachineSets')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
            </div>
            <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
              {machineSets.length === 0 ? <div className="px-4 py-6 text-center text-sm text-slate-500">No MachineSets</div> : machineSets.map((ms: any) => {
                const desired = ms.spec?.replicas ?? 0;
                const ready = ms.status?.readyReplicas ?? 0;
                // Find autoscaler for this machineset
                const autoscaler = machineAutoscalers.find((a: any) => a.spec?.scaleTargetRef?.name === ms.metadata.name);
                return (
                  <button key={ms.metadata.uid} onClick={() => go(`/r/machine.openshift.io~v1beta1~machinesets/${ms.metadata.namespace}/${ms.metadata.name}`, ms.metadata.name)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/50 text-left">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn('w-2 h-2 rounded-full shrink-0', ready === desired ? 'bg-green-500' : 'bg-yellow-500')} />
                      <span className="text-sm text-slate-200 truncate">{ms.metadata.name}</span>
                      {autoscaler && <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded shrink-0">autoscaled {autoscaler.spec?.minReplicas}-{autoscaler.spec?.maxReplicas}</span>}
                    </div>
                    <span className={cn('text-xs font-mono shrink-0', ready === desired ? 'text-green-400' : 'text-yellow-400')}>{ready}/{desired}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Machines */}
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Machines ({machines.length})</h2>
              <button onClick={() => go('/r/machine.openshift.io~v1beta1~machines', 'Machines')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
            </div>
            <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
              {machines.length === 0 ? <div className="px-4 py-6 text-center text-sm text-slate-500">No Machines</div> : machines.map((m: any) => {
                const phase = m.status?.phase || 'Unknown';
                const instanceType = m.spec?.providerSpec?.value?.instanceType || '';
                const nodeRef = m.status?.nodeRef?.name || '';
                return (
                  <button key={m.metadata.uid} onClick={() => go(`/r/machine.openshift.io~v1beta1~machines/${m.metadata.namespace}/${m.metadata.name}`, m.metadata.name)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/50 text-left">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn('w-2 h-2 rounded-full shrink-0', phase === 'Running' ? 'bg-green-500' : phase === 'Provisioning' ? 'bg-yellow-500' : 'bg-red-500')} />
                      <div className="min-w-0">
                        <span className="text-sm text-slate-200 truncate block">{m.metadata.name}</span>
                        {nodeRef && <span className="text-xs text-slate-500 truncate block">{nodeRef}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {instanceType && <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono">{instanceType}</span>}
                      <span className={cn('text-xs px-1.5 py-0.5 rounded',
                        phase === 'Running' ? 'bg-green-900/50 text-green-300' :
                        phase === 'Provisioning' ? 'bg-yellow-900/50 text-yellow-300' :
                        'bg-red-900/50 text-red-300'
                      )}>{phase}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* MachineHealthChecks */}
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Machine Health Checks ({healthChecks.length})</h2>
              <button onClick={() => go('/r/machine.openshift.io~v1beta1~machinehealthchecks', 'HealthChecks')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
            </div>
            <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
              {healthChecks.length === 0 ? <div className="px-4 py-6 text-center text-sm text-slate-500">No health checks configured</div> : healthChecks.map((hc: any) => {
                const maxUnhealthy = hc.spec?.maxUnhealthy || '100%';
                const conditions = (hc.spec?.unhealthyConditions || []) as Array<{ type: string; status: string; timeout: string }>;
                const currentHealthy = hc.status?.currentHealthy ?? 0;
                const expectedMachines = hc.status?.expectedMachines ?? 0;
                return (
                  <button key={hc.metadata.uid} onClick={() => go(`/r/machine.openshift.io~v1beta1~machinehealthchecks/${hc.metadata.namespace}/${hc.metadata.name}`, hc.metadata.name)}
                    className="w-full px-4 py-3 hover:bg-slate-800/50 text-left">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-slate-200">{hc.metadata.name}</span>
                      <span className={cn('text-xs font-mono', currentHealthy === expectedMachines ? 'text-green-400' : 'text-yellow-400')}>
                        {currentHealthy}/{expectedMachines} healthy
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>Max unhealthy: {maxUnhealthy}</span>
                      {conditions.map((c, i) => <span key={i}>{c.type}≠{c.status} → {c.timeout}</span>)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Autoscaling */}
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Autoscaling</h2>
              {clusterAutoscaler.length > 0 && <span className="text-xs px-1.5 py-0.5 bg-green-900/50 text-green-300 rounded">Enabled</span>}
            </div>
            <div className="p-4 space-y-3">
              {clusterAutoscaler.length === 0 && machineAutoscalers.length === 0 ? (
                <div className="py-3 space-y-4">
                  <div className="text-sm text-slate-400">Autoscaling is not configured</div>

                  <div className="space-y-3 text-xs text-slate-500">
                    <div className="flex gap-3">
                      <span className="text-blue-400 font-bold shrink-0">Step 1</span>
                      <div>
                        <div className="text-slate-300 font-medium">Create a ClusterAutoscaler</div>
                        <div>Sets cluster-wide limits: max total nodes, max cores, max memory. Only one per cluster.</div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <span className="text-blue-400 font-bold shrink-0">Step 2</span>
                      <div>
                        <div className="text-slate-300 font-medium">Create MachineAutoscalers (one per MachineSet)</div>
                        <div>Sets min/max replicas per MachineSet. The autoscaler adds nodes when pods are pending due to insufficient resources, and removes them when utilization is low.</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button onClick={() => go('/create/autoscaling.openshift.io~v1~clusterautoscalers', 'Create ClusterAutoscaler')} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 flex items-center gap-1">
                      Create ClusterAutoscaler <ArrowRight className="w-3 h-3" />
                    </button>
                    <button onClick={() => go('/create/autoscaling.openshift.io~v1beta1~machineautoscalers', 'Create MachineAutoscaler')} className="px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700 flex items-center gap-1">
                      Create MachineAutoscaler <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {clusterAutoscaler.map((ca: any) => (
                    <div key={ca.metadata.uid} className="p-3 bg-slate-800/50 rounded border border-slate-700">
                      <div className="text-sm text-slate-200 mb-2">Cluster Autoscaler</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="text-slate-500">Min nodes:</span> <span className="text-slate-300">{ca.spec?.resourceLimits?.minNodesTotal ?? '—'}</span></div>
                        <div><span className="text-slate-500">Max nodes:</span> <span className="text-slate-300">{ca.spec?.resourceLimits?.maxNodesTotal ?? '—'}</span></div>
                        <div><span className="text-slate-500">Scale down:</span> <span className="text-slate-300">{ca.spec?.scaleDown?.enabled ? 'enabled' : 'disabled'}</span></div>
                        <div><span className="text-slate-500">Delay:</span> <span className="text-slate-300">{ca.spec?.scaleDown?.delayAfterAdd ?? '—'}</span></div>
                      </div>
                    </div>
                  ))}
                  {machineAutoscalers.length > 0 && (
                    <div>
                      <div className="text-xs text-slate-500 mb-2">Machine Autoscalers ({machineAutoscalers.length})</div>
                      {machineAutoscalers.map((ma: any) => (
                        <div key={ma.metadata.uid} className="flex items-center justify-between py-1.5">
                          <span className="text-sm text-slate-300">{ma.spec?.scaleTargetRef?.name || ma.metadata.name}</span>
                          <span className="text-xs text-slate-400 font-mono">{ma.spec?.minReplicas}–{ma.spec?.maxReplicas} replicas</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* MachineConfig Management */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* MachineConfigPools */}
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">MachineConfigPools ({machineConfigPools.length})</h2>
              <button onClick={() => go('/r/machineconfiguration.openshift.io~v1~machineconfigpools', 'MachineConfigPools')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
            </div>
            <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
              {machineConfigPools.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">No MachineConfigPools found</div>
              ) : (machineConfigPools as any[]).map((mcp) => {
                const conditions = mcp.status?.conditions || [];
                const updated = conditions.find((c: any) => c.type === 'Updated');
                const updating = conditions.find((c: any) => c.type === 'Updating');
                const degraded = conditions.find((c: any) => c.type === 'Degraded');
                const isUpdated = updated?.status === 'True';
                const isUpdating = updating?.status === 'True';
                const isDegraded = degraded?.status === 'True';
                const machineCount = mcp.status?.machineCount ?? 0;
                const readyCount = mcp.status?.readyMachineCount ?? 0;
                const updatedCount = mcp.status?.updatedMachineCount ?? 0;
                const currentConfig = mcp.status?.configuration?.name || '';

                return (
                  <button key={mcp.metadata.uid} onClick={() => go(`/r/machineconfiguration.openshift.io~v1~machineconfigpools/_/${mcp.metadata.name}`, mcp.metadata.name)}
                    className="w-full px-4 py-3 hover:bg-slate-800/50 text-left transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-200">{mcp.metadata.name}</span>
                        {isDegraded && <span className="text-xs px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded">Degraded</span>}
                        {isUpdating && <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded">Updating</span>}
                        {isUpdated && !isUpdating && <span className="text-xs px-1.5 py-0.5 bg-green-900/50 text-green-300 rounded">Updated</span>}
                      </div>
                      <span className={cn('text-xs font-mono', readyCount === machineCount ? 'text-green-400' : 'text-yellow-400')}>
                        {readyCount}/{machineCount} ready
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>{updatedCount}/{machineCount} updated</span>
                      {currentConfig && <span className="font-mono truncate max-w-[200px]">Config: {currentConfig}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* MachineConfigs quick access */}
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Machine Configuration</h2>
              <button onClick={() => go('/r/machineconfiguration.openshift.io~v1~machineconfigs', 'MachineConfigs')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
            </div>
            <div className="p-4 space-y-2">
              <p className="text-xs text-slate-400">MachineConfigs define OS-level configuration for nodes — systemd units, kernel parameters, files, and more. Changes trigger rolling reboots via MachineConfigPools.</p>
              <div className="space-y-1.5 pt-2">
                {[
                  { label: 'MachineConfigs', path: '/r/machineconfiguration.openshift.io~v1~machineconfigs', desc: 'OS-level node configuration (files, systemd, kernel args)' },
                  { label: 'MachineConfigPools', path: '/r/machineconfiguration.openshift.io~v1~machineconfigpools', desc: 'Groups of nodes that share the same MachineConfig' },
                  { label: 'KubeletConfigs', path: '/r/machineconfiguration.openshift.io~v1~kubeletconfigs', desc: 'Kubelet parameters (maxPods, eviction thresholds)' },
                  { label: 'ContainerRuntimeConfigs', path: '/r/machineconfiguration.openshift.io~v1~containerruntimeconfigs', desc: 'CRI-O runtime settings (pids limit, log size)' },
                ].map((item) => (
                  <button key={item.label} onClick={() => go(item.path, item.label)}
                    className="flex items-center justify-between w-full py-2 px-3 rounded hover:bg-slate-800/50 text-left transition-colors">
                    <div>
                      <div className="text-sm text-slate-200">{item.label}</div>
                      <div className="text-xs text-slate-500">{item.desc}</div>
                    </div>
                    <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
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

function StatCard({ label, value, subtitle, issues, bar, barColor, onClick }: {
  label: string; value: string; subtitle?: string; issues?: number; bar?: number | null; barColor?: 'green' | 'yellow' | 'red' | 'blue'; onClick?: () => void;
}) {
  return (
    <div onClick={onClick} className={cn('bg-slate-900 rounded-lg border p-3', onClick && 'cursor-pointer hover:border-slate-600', issues ? 'border-yellow-800' : 'border-slate-800')}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-400">{label}</span>
        {issues ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{issues}</span> : null}
      </div>
      <div className="text-xl font-bold text-slate-100">{value}</div>
      {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
      {bar !== null && bar !== undefined && <UsageBar pct={bar} color={barColor || 'blue'} className="mt-2" />}
    </div>
  );
}

function UsageBar({ pct, color, className }: { pct: number; color: 'green' | 'yellow' | 'red' | 'blue'; className?: string }) {
  const bg = { green: 'bg-green-500', yellow: 'bg-yellow-500', red: 'bg-red-500', blue: 'bg-blue-500' }[color];
  return (
    <div className={cn('w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden', className)}>
      <div className={cn('h-full rounded-full transition-all', bg)} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

// ===== Compute Health Audit =====

interface AuditCheck {
  id: string;
  title: string;
  description: string;
  why: string;
  passing: any[];
  failing: any[];
  yamlExample: string;
}

function ComputeHealthAudit({
  nodes,
  healthChecks,
  clusterAutoscaler,
  machineAutoscalers,
  nodeDetails,
  go,
}: {
  nodes: any[];
  healthChecks: any[];
  clusterAutoscaler: any[];
  machineAutoscalers: any[];
  nodeDetails: Array<{ node: any; status: any; roles: string[]; nodeInfo: any; name: string }>;
  go: (path: string, title: string) => void;
}) {
  const [expandedCheck, setExpandedCheck] = React.useState<string | null>(null);

  const checks: AuditCheck[] = React.useMemo(() => {
    const allChecks: AuditCheck[] = [];

    // 1. HA Control Plane
    const masterNodes = nodeDetails.filter(nd => nd.roles.includes('master') || nd.roles.includes('control-plane'));
    const hasHA = masterNodes.length >= 3;
    allChecks.push({
      id: 'ha-control-plane',
      title: 'HA Control Plane',
      description: 'Production clusters should have 3+ control plane nodes for high availability',
      why: 'etcd requires an odd-numbered quorum (3 or 5 nodes). With fewer than 3 masters, losing a single node causes cluster failure. 3 masters can tolerate 1 failure; 5 can tolerate 2.',
      passing: hasHA ? masterNodes : [],
      failing: hasHA ? [] : masterNodes,
      yamlExample: `# Control plane nodes are provisioned during cluster installation.
# To scale control plane nodes post-install, you must:
# 1. Create new master Machines via MachineSet
# 2. Update etcd members
# 3. Update load balancer configuration
#
# For production clusters, always install with 3 or 5 control plane nodes.
# Single-node OpenShift is for dev/test only.`,
    });

    // 2. Dedicated Worker Nodes
    const workerNodes = nodeDetails.filter(nd => nd.roles.includes('worker') && !nd.roles.includes('master') && !nd.roles.includes('control-plane'));
    const hasWorkers = workerNodes.length >= 2;
    allChecks.push({
      id: 'dedicated-workers',
      title: 'Dedicated Worker Nodes',
      description: 'Production workloads should run on 2+ dedicated worker nodes (not on masters)',
      why: 'Running application pods on control plane nodes creates resource contention with etcd and apiserver. Control plane stability is critical — separating workloads protects cluster availability.',
      passing: hasWorkers ? workerNodes : [],
      failing: hasWorkers ? [] : workerNodes,
      yamlExample: `# Worker nodes are created via MachineSets.
# View existing MachineSets and scale them up:
#   oc get machinesets -n openshift-machine-api
#   oc scale machineset <name> --replicas=3
#
# Or create new worker MachineSets based on existing ones.
# For HA, spread workers across multiple availability zones.`,
    });

    // 3. MachineHealthChecks
    const hasMHC = healthChecks.length > 0;
    allChecks.push({
      id: 'machine-health-checks',
      title: 'MachineHealthChecks',
      description: 'Automatically replace unhealthy nodes when they fail health checks',
      why: 'Without MachineHealthChecks, failed nodes remain in the cluster in NotReady state. Pods are rescheduled but the node is never recovered. MHCs detect and replace failed nodes automatically, restoring capacity.',
      passing: hasMHC ? healthChecks : [],
      failing: hasMHC ? [] : [{ metadata: { name: 'No MachineHealthChecks configured' } }],
      yamlExample: `apiVersion: machine.openshift.io/v1beta1
kind: MachineHealthCheck
metadata:
  name: worker-health-check
  namespace: openshift-machine-api
spec:
  selector:
    matchLabels:
      machine.openshift.io/cluster-api-machine-role: worker
  unhealthyConditions:
  - type: "Ready"
    status: "False"
    timeout: "300s"
  - type: "Ready"
    status: "Unknown"
    timeout: "300s"
  maxUnhealthy: "40%"`,
    });

    // 4. Node Pressure
    const pressureNodes = nodeDetails.filter(nd => {
      const s = nd.status;
      return s.ready && (s.pressure?.disk || s.pressure?.memory || s.pressure?.pid);
    });
    allChecks.push({
      id: 'node-pressure',
      title: 'Node Pressure',
      description: 'Nodes should not be under disk, memory, or PID pressure',
      why: 'Pressure conditions indicate resource exhaustion. DiskPressure causes pod evictions and kubelet failures. MemoryPressure triggers OOM kills. PIDPressure prevents new processes from starting.',
      passing: nodeDetails.filter(nd => {
        const s = nd.status;
        return s.ready && !s.pressure?.disk && !s.pressure?.memory && !s.pressure?.pid;
      }),
      failing: pressureNodes.map(nd => {
        const pressures: string[] = [];
        if (nd.status.pressure?.disk) pressures.push('Disk');
        if (nd.status.pressure?.memory) pressures.push('Memory');
        if (nd.status.pressure?.pid) pressures.push('PID');
        return {
          ...nd.node,
          _pressureTypes: pressures.join(', '),
        };
      }),
      yamlExample: `# Node pressure is resolved by freeing resources:
#
# DiskPressure:
#   - Delete old container images: oc adm prune images
#   - Increase root volume size on the cloud provider
#   - Configure image garbage collection thresholds
#
# MemoryPressure:
#   - Scale down workloads or move to larger instance types
#   - Set pod memory limits to prevent leaks
#
# PIDPressure:
#   - Increase kernel.pid_max via MachineConfig
#   - Check for runaway processes creating forks`,
    });

    // 5. Kubelet Version Consistency
    const kubeletVersions = new Map<string, any[]>();
    nodeDetails.forEach(nd => {
      const version = nd.nodeInfo.kubeletVersion || 'unknown';
      if (!kubeletVersions.has(version)) kubeletVersions.set(version, []);
      kubeletVersions.get(version)!.push(nd.node);
    });
    const consistentVersion = kubeletVersions.size === 1;
    const mismatchedNodes = consistentVersion ? [] : Array.from(kubeletVersions.entries())
      .filter(([version, nodes]) => nodes.length < nodeDetails.length)
      .flatMap(([version, nodes]) => nodes.map(n => ({ ...n, _kubeletVersion: version })));

    allChecks.push({
      id: 'kubelet-version',
      title: 'Kubelet Version Consistency',
      description: 'All nodes should run the same kubelet version',
      why: 'Version skew between nodes can cause unpredictable behavior, API incompatibilities, and upgrade issues. Kubernetes supports n-1 minor version skew, but consistency is best practice.',
      passing: consistentVersion ? nodeDetails.map(nd => nd.node) : [],
      failing: mismatchedNodes,
      yamlExample: `# Kubelet version is updated via cluster upgrades:
#   oc adm upgrade
#
# If nodes are out of sync:
# 1. Check for stuck Machine updates in openshift-machine-api
# 2. Cordon and drain outdated nodes:
#    oc adm cordon <node>
#    oc adm drain <node> --ignore-daemonsets --delete-emptydir-data
# 3. Delete the Machine to trigger replacement:
#    oc delete machine <machine-name> -n openshift-machine-api
#
# Avoid manual kubelet updates — always use cluster upgrade process.`,
    });

    // 6. Cluster Autoscaling
    const hasAutoscaling = clusterAutoscaler.length > 0 && machineAutoscalers.length > 0;
    const autoscalingResources = [...clusterAutoscaler, ...machineAutoscalers];
    allChecks.push({
      id: 'cluster-autoscaling',
      title: 'Cluster Autoscaling',
      description: 'Enable ClusterAutoscaler + MachineAutoscaler for automatic node scaling',
      why: 'Without autoscaling, pending pods wait indefinitely when capacity is exhausted. Manual scaling is slow and error-prone. Autoscaling adds nodes on demand and removes them when idle, optimizing cost and availability.',
      passing: hasAutoscaling ? autoscalingResources : [],
      failing: hasAutoscaling ? [] : [{ metadata: { name: 'Autoscaling not configured' } }],
      yamlExample: `# Step 1: Create ClusterAutoscaler (one per cluster)
apiVersion: autoscaling.openshift.io/v1
kind: ClusterAutoscaler
metadata:
  name: default
spec:
  resourceLimits:
    maxNodesTotal: 24
  scaleDown:
    enabled: true
    delayAfterAdd: 10m

# Step 2: Create MachineAutoscaler (one per MachineSet)
apiVersion: autoscaling.openshift.io/v1beta1
kind: MachineAutoscaler
metadata:
  name: worker-us-east-1a
  namespace: openshift-machine-api
spec:
  minReplicas: 1
  maxReplicas: 6
  scaleTargetRef:
    apiVersion: machine.openshift.io/v1beta1
    kind: MachineSet
    name: my-cluster-worker-us-east-1a`,
    });

    return allChecks;
  }, [nodes, healthChecks, clusterAutoscaler, machineAutoscalers, nodeDetails]);

  if (nodes.length === 0) return null;

  const totalPassing = checks.reduce((s, c) => s + (c.failing.length === 0 ? 1 : 0), 0);
  const score = Math.round((totalPassing / checks.length) * 100);

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" /> Compute Health Audit
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
                      {pass ? `${check.passing.length} pass` : `${check.failing.length} ${check.failing.length === 1 ? 'issue' : 'issues'}`}
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

                  {/* Failing items */}
                  {check.failing.length > 0 && (
                    <div>
                      <div className="text-xs text-amber-400 font-medium mb-1.5">
                        {check.id === 'ha-control-plane' ? `Only ${check.failing.length} control plane node${check.failing.length > 1 ? 's' : ''}` :
                         check.id === 'dedicated-workers' ? `Only ${check.failing.length} worker node${check.failing.length > 1 ? 's' : ''}` :
                         check.id === 'machine-health-checks' || check.id === 'cluster-autoscaling' ? 'Not configured' :
                         `Issues (${check.failing.length})`}
                      </div>
                      <div className="space-y-1 max-h-32 overflow-auto">
                        {check.failing.slice(0, 10).map((item: any, idx: number) => {
                          const name = item.metadata?.name || `item-${idx}`;
                          const ns = item.metadata?.namespace;
                          const isNode = check.id === 'ha-control-plane' || check.id === 'dedicated-workers' || check.id === 'node-pressure' || check.id === 'kubelet-version';
                          const pressureType = item._pressureTypes;
                          const kubeletVersion = item._kubeletVersion;

                          return (
                            <button
                              key={item.metadata?.uid || idx}
                              onClick={() => {
                                if (isNode) {
                                  go(`/r/v1~nodes/_/${name}`, name);
                                } else if (check.id === 'machine-health-checks') {
                                  go('/create/machine.openshift.io~v1beta1~machinehealthchecks', 'Create MachineHealthCheck');
                                } else if (check.id === 'cluster-autoscaling') {
                                  go('/create/autoscaling.openshift.io~v1~clusterautoscalers', 'Create ClusterAutoscaler');
                                }
                              }}
                              className="flex items-center justify-between w-full py-1 px-2 rounded hover:bg-slate-800/50 text-left transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                <span className="text-xs text-slate-300">{name}</span>
                                {ns && <span className="text-xs text-slate-600">{ns}</span>}
                                {pressureType && <span className="text-xs px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded">{pressureType}</span>}
                                {kubeletVersion && <span className="text-xs px-1.5 py-0.5 bg-yellow-900/50 text-yellow-300 rounded font-mono">{kubeletVersion}</span>}
                              </div>
                              <span className="text-xs text-blue-400">
                                {check.id === 'machine-health-checks' || check.id === 'cluster-autoscaling' ? 'Create →' : 'View →'}
                              </span>
                            </button>
                          );
                        })}
                        {check.failing.length > 10 && <div className="text-xs text-slate-600 px-2">+{check.failing.length - 10} more</div>}
                      </div>
                    </div>
                  )}

                  {/* Passing items */}
                  {check.passing.length > 0 && (
                    <div>
                      <div className="text-xs text-green-400 font-medium mb-1">
                        {check.id === 'ha-control-plane' ? `Control plane nodes (${check.passing.length})` :
                         check.id === 'dedicated-workers' ? `Worker nodes (${check.passing.length})` :
                         check.id === 'machine-health-checks' ? `Configured (${check.passing.length})` :
                         check.id === 'cluster-autoscaling' ? 'Enabled' :
                         `Passing (${check.passing.length})`}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {check.passing.slice(0, 8).map((item: any, idx: number) => {
                          const name = item.metadata?.name || item.name || `item-${idx}`;
                          return (
                            <span key={item.metadata?.uid || idx} className="text-xs px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded">{name}</span>
                          );
                        })}
                        {check.passing.length > 8 && <span className="text-xs text-slate-600">+{check.passing.length - 8} more</span>}
                      </div>
                    </div>
                  )}

                  {/* YAML example */}
                  <div>
                    <div className="text-xs text-slate-500 font-medium mb-1">
                      {check.id === 'machine-health-checks' || check.id === 'cluster-autoscaling' ? 'Configuration example:' : 'How to address:'}
                    </div>
                    <pre className="text-[11px] text-emerald-400 font-mono bg-slate-950 p-3 rounded overflow-x-auto whitespace-pre-wrap">{check.yamlExample}</pre>
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
