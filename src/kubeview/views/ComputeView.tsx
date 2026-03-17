import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Server, Cpu, HardDrive, CheckCircle, XCircle, AlertCircle,
  ArrowRight, Ban, Box, Terminal, FileText, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import { queryInstant } from '../components/metrics/prometheus';
import type { K8sResource } from '../engine/renderers';
import { getNodeStatus } from '../engine/renderers/statusUtils';
import { useNavigateTab } from '../hooks/useNavigateTab';

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

  const { data: nodes = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/nodes'],
    queryFn: () => k8sList('/api/v1/nodes'),
    refetchInterval: 30000,
  });

  const { data: pods = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/pods'],
    queryFn: () => k8sList('/api/v1/pods'),
    refetchInterval: 30000,
  });

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

      return {
        node, status, nodeInfo, capacity, allocatable, roles, taints, unschedulable,
        podCount, podCap, cpuCap, memCap, memUsagePct, name: nodeName,
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

        {/* Cluster overview cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard label="Nodes" value={`${readyCount}/${nodes.length}`} issues={unreadyNodes.length + pressureNodes.length} onClick={() => go('/r/v1~nodes', 'Nodes')} />
          <MetricCard label="CPU Usage" value={cpuPercent !== null ? `${Math.round(cpuPercent)}%` : '—'} bar={cpuPercent} barColor={cpuPercent && cpuPercent > 80 ? 'red' : cpuPercent && cpuPercent > 60 ? 'yellow' : 'green'} />
          <MetricCard label="Memory" value={memPercent !== null ? `${Math.round(memPercent)}%` : '—'} bar={memPercent} barColor={memPercent && memPercent > 80 ? 'red' : memPercent && memPercent > 60 ? 'yellow' : 'green'} />
          <MetricCard label="Total CPU" value={formatCpu(clusterCapacity.cpuCores)} subtitle={`${nodes.length} nodes`} />
          <MetricCard label="Total Memory" value={formatBytes(clusterCapacity.memBytes)} subtitle={`${nodes.length} nodes`} />
          <MetricCard label="Pods" value={`${clusterCapacity.totalPods}/${clusterCapacity.podCapacity}`} bar={clusterCapacity.podCapacity > 0 ? (clusterCapacity.totalPods / clusterCapacity.podCapacity) * 100 : null} barColor="blue" />
        </div>

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
            <h2 className="text-sm font-semibold text-slate-100">All Nodes ({nodes.length})</h2>
            <div className="flex items-center gap-3">
              {machineSets.length > 0 && (
                <button onClick={() => go('/r/machine.openshift.io~v1beta1~machinesets', 'MachineSets')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                  {machineSets.length} MachineSets <ArrowRight className="w-3 h-3" />
                </button>
              )}
              <button onClick={() => go('/r/v1~nodes', 'Nodes')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">Table view <ArrowRight className="w-3 h-3" /></button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Node</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Roles</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Pods</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">CPU</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Memory</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Kubelet</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">OS</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {nodeDetails.map((nd) => {
                  const podPct = nd.podCap > 0 ? (nd.podCount / nd.podCap) * 100 : 0;
                  const memPct = nd.memUsagePct;
                  return (
                    <tr key={nd.node.metadata.uid} onClick={() => go(`/r/v1~nodes/_/${nd.name}`, nd.name)}
                      className="hover:bg-slate-800/50 cursor-pointer transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {nd.status.ready ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                          <span className="text-slate-200 truncate max-w-[200px]" title={nd.name}>{nd.name}</span>
                          {nd.unschedulable && <Ban className="w-3 h-3 text-yellow-500" title="Cordoned" />}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs px-1.5 py-0.5 rounded', nd.status.ready ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300')}>
                          {nd.status.ready ? 'Ready' : 'NotReady'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">{nd.roles.map(r => <span key={r} className="text-[10px] px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded">{r}</span>)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <UsageBar pct={podPct} color="blue" />
                          <span className="text-xs text-slate-400 font-mono w-12">{nd.podCount}/{nd.podCap}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><span className="text-xs text-slate-400">{formatCpu(nd.cpuCap)}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {memPct !== null ? <UsageBar pct={memPct} color={memPct > 80 ? 'red' : memPct > 60 ? 'yellow' : 'green'} /> : null}
                          <span className="text-xs text-slate-400">{formatBytes(nd.memCap)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><span className="text-xs text-slate-500 font-mono">{nd.nodeInfo.kubeletVersion}</span></td>
                      <td className="px-4 py-3"><span className="text-xs text-slate-500">{nd.nodeInfo.architecture}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); go(`/node-logs/${nd.name}`, `${nd.name} (Logs)`); }} className="p-1 text-slate-500 hover:text-blue-400" title="Node Logs"><FileText className="w-3.5 h-3.5" /></button>
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
                      {autoscaler && <span className="text-[10px] px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded shrink-0">autoscaled {autoscaler.spec?.minReplicas}-{autoscaler.spec?.maxReplicas}</span>}
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
                        {nodeRef && <span className="text-[10px] text-slate-500 truncate block">{nodeRef}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {instanceType && <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono">{instanceType}</span>}
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded',
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
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
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
              {clusterAutoscaler.length > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-green-900/50 text-green-300 rounded">Enabled</span>}
            </div>
            <div className="p-4 space-y-3">
              {clusterAutoscaler.length === 0 && machineAutoscalers.length === 0 ? (
                <div className="text-center py-4">
                  <div className="text-sm text-slate-500 mb-2">Autoscaling is not configured</div>
                  <div className="text-xs text-slate-600">Create a ClusterAutoscaler and MachineAutoscaler resources to enable automatic node scaling based on workload demand.</div>
                  <button onClick={() => go('/create/autoscaling.openshift.io~v1~clusterautoscalers', 'Create ClusterAutoscaler')} className="text-xs text-blue-400 hover:text-blue-300 mt-3 flex items-center gap-1 mx-auto">
                    Configure autoscaling <ArrowRight className="w-3 h-3" />
                  </button>
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
      </div>
    </div>
  );
}

function MetricCard({ label, value, subtitle, issues, bar, barColor, onClick }: {
  label: string; value: string; subtitle?: string; issues?: number; bar?: number | null; barColor?: 'green' | 'yellow' | 'red' | 'blue'; onClick?: () => void;
}) {
  return (
    <div onClick={onClick} className={cn('bg-slate-900 rounded-lg border p-3', onClick && 'cursor-pointer hover:border-slate-600', issues ? 'border-yellow-800' : 'border-slate-800')}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-400">{label}</span>
        {issues ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{issues}</span> : null}
      </div>
      <div className="text-xl font-bold text-slate-100">{value}</div>
      {subtitle && <div className="text-[10px] text-slate-500 mt-0.5">{subtitle}</div>}
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
