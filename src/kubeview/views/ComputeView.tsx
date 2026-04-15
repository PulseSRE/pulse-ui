import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Server } from 'lucide-react';
import { HealthAuditPanel } from '../components/audit/HealthAuditPanel';
import type { AuditCheck } from '../components/audit/types';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import { safeQuery } from '../engine/safeQuery';
import { queryInstant } from '../components/metrics/prometheus';
import { MetricCard } from '../components/metrics/Sparkline';
import { CHART_COLORS } from '../engine/colors';
import { NodeHexMap } from './compute/NodeHexMap';
import { MetricGrid } from '../components/primitives/MetricGrid';
import type { K8sResource } from '../engine/renderers';
import type { Node, Pod, Machine, NodePool, Condition } from '../engine/types';
import { getNodeStatus } from '../engine/renderers/statusUtils';
import { parseResourceValue, formatBytes, formatCpu } from '../engine/formatting';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { useClusterStore } from '../store/clusterStore';
import { Card } from '../components/primitives/Card';
import { Badge } from '../components/primitives/Badge';
import { CapacityTab } from './compute/CapacityTab';
import { StatCard } from './compute/StatCard';
import { ClusterTypeSummary } from './compute/ClusterTypeSummary';
import { NodeAlerts } from './compute/NodeAlerts';
import { MachineManagement } from './compute/MachineManagement';
import { MachineConfigSection } from './compute/MachineConfigSection';
import type { NodeDetail, PrometheusResult } from './compute/types';

export default function ComputeView() {
  const go = useNavigateTab();
  const urlTab = new URLSearchParams(window.location.search).get('tab');
  const [computeTab, setComputeTabState] = React.useState<'overview' | 'capacity'>(urlTab === 'capacity' ? 'capacity' : 'overview');
  const setComputeTab = (tab: 'overview' | 'capacity') => {
    setComputeTabState(tab);
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  };
  const isHyperShift = useClusterStore((s) => s.isHyperShift);
  const platform = useClusterStore((s) => s.platform);
  const clusterVersion = useClusterStore((s) => s.clusterVersion);

  const { data: nodes = [] } = useK8sListWatch({ apiPath: '/api/v1/nodes' });
  const { data: pods = [] } = useK8sListWatch({ apiPath: '/api/v1/pods' });

  const { data: machines = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/machine.openshift.io/v1beta1/machines'],
    queryFn: async () => (await safeQuery(() => k8sList('/apis/machine.openshift.io/v1beta1/machines'))) ?? [],
    staleTime: 60000,
    enabled: !isHyperShift,
  });

  const { data: machineSets = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/machine.openshift.io/v1beta1/machinesets'],
    queryFn: async () => (await safeQuery(() => k8sList('/apis/machine.openshift.io/v1beta1/machinesets'))) ?? [],
    staleTime: 60000,
    enabled: !isHyperShift,
  });

  const { data: healthChecks = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/machine.openshift.io/v1beta1/machinehealthchecks'],
    queryFn: async () => (await safeQuery(() => k8sList('/apis/machine.openshift.io/v1beta1/machinehealthchecks'))) ?? [],
    staleTime: 60000,
    enabled: !isHyperShift,
  });

  const { data: machineAutoscalers = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/autoscaling.openshift.io/v1beta1/machineautoscalers'],
    queryFn: async () => (await safeQuery(() => k8sList('/apis/autoscaling.openshift.io/v1beta1/machineautoscalers'))) ?? [],
    staleTime: 60000,
    enabled: !isHyperShift,
  });

  const { data: clusterAutoscaler = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/autoscaling.openshift.io/v1/clusterautoscalers'],
    queryFn: async () => (await safeQuery(() => k8sList('/apis/autoscaling.openshift.io/v1/clusterautoscalers'))) ?? [],
    staleTime: 60000,
    enabled: !isHyperShift,
  });

  // NodePools (HyperShift only)
  const { data: nodePools = [] } = useQuery<K8sResource[]>({
    queryKey: ['compute', 'nodepools'],
    queryFn: async () => (await safeQuery(() => k8sList('/apis/hypershift.openshift.io/v1beta1/nodepools'))) ?? [],
    staleTime: 60000,
    enabled: isHyperShift,
  });

  // Per-node CPU usage from Prometheus (joined via kube_node_info for reliable node name matching)
  const { data: nodeCpuMetrics = [] } = useQuery({
    queryKey: ['compute', 'node-cpu'],
    queryFn: async () => {
      const result = await safeQuery(() => queryInstant('sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) by (instance) * on(instance) group_left(node) kube_node_info'));
      if (result !== null) return result;
      return (await safeQuery(() => queryInstant('sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) by (instance)'))) ?? [];
    },
    refetchInterval: 30000,
  });

  // Per-node memory usage from Prometheus (joined via kube_node_info for reliable node name matching)
  const { data: nodeMemMetrics = [] } = useQuery({
    queryKey: ['compute', 'node-mem'],
    queryFn: async () => {
      const result = await safeQuery(() => queryInstant('(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 * on(instance) group_left(node) kube_node_info'));
      if (result !== null) return result;
      return (await safeQuery(() => queryInstant('(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100'))) ?? [];
    },
    refetchInterval: 30000,
  });

  // MachineConfig resources
  const { data: machineConfigPools = [] } = useQuery<K8sResource[]>({
    queryKey: ['compute', 'machineconfigpools'],
    queryFn: async () => (await safeQuery(() => k8sList('/apis/machineconfiguration.openshift.io/v1/machineconfigpools'))) ?? [],
    staleTime: 60000,
  });

  // Cluster totals
  const { data: clusterCpu } = useQuery({
    queryKey: ['compute', 'cluster-cpu'],
    queryFn: async () => (await safeQuery(() => queryInstant('sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) / sum(machine_cpu_cores) * 100'))) ?? [],
    refetchInterval: 30000,
  });
  const { data: clusterMem } = useQuery({
    queryKey: ['compute', 'cluster-mem'],
    queryFn: async () => (await safeQuery(() => queryInstant('(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100'))) ?? [],
    refetchInterval: 30000,
  });

  const cpuPercent = clusterCpu?.[0]?.value ?? null;
  const memPercent = clusterMem?.[0]?.value ?? null;
  const readyCount = nodes.filter((n) => getNodeStatus(n).ready).length;
  const unreadyNodes = nodes.filter((n) => !getNodeStatus(n).ready);
  const pressureNodes = nodes.filter((n) => { const s = getNodeStatus(n); return s.ready && (s.pressure.disk || s.pressure.memory || s.pressure.pid); });

  // Pods per node (count)
  const podsByNode = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const pod of pods as unknown as Pod[]) {
      const nodeName = pod.spec?.nodeName;
      if (nodeName) map.set(nodeName, (map.get(nodeName) || 0) + 1);
    }
    return map;
  }, [pods]);

  // Pod details per node (for hex map clickable dots)
  const podDetailsByNode = React.useMemo(() => {
    const map: Record<string, Array<{ name: string; namespace: string; status: string; restarts: number }>> = {};
    for (const pod of pods as unknown as Pod[]) {
      const nodeName = pod.spec?.nodeName;
      if (!nodeName) continue;
      if (!map[nodeName]) map[nodeName] = [];
      const cs = pod.status?.containerStatuses?.[0];
      const waitReason = cs?.state?.waiting?.reason;
      map[nodeName].push({
        name: pod.metadata.name,
        namespace: pod.metadata.namespace || '',
        status: waitReason || pod.status?.phase || 'Unknown',
        restarts: cs?.restartCount || 0,
      });
    }
    return map;
  }, [pods]);

  // Cluster capacity totals
  const clusterCapacity = React.useMemo(() => {
    let cpuCores = 0, memBytes = 0, podCapacity = 0;
    for (const n of nodes as unknown as Node[]) {
      const cap = n.status?.capacity;
      cpuCores += parseResourceValue(cap?.cpu);
      memBytes += parseResourceValue(cap?.memory);
      podCapacity += parseResourceValue(cap?.pods);
    }
    return { cpuCores, memBytes, podCapacity, totalPods: pods.length };
  }, [nodes, pods]);

  // Node details with metrics
  const nodeDetails: NodeDetail[] = React.useMemo(() => {
    return (nodes as unknown as Node[]).map((node) => {
      const status = getNodeStatus(node as K8sResource);
      const nodeInfo = node.status?.nodeInfo || {};
      const capacity = node.status?.capacity || {};
      const allocatable = node.status?.allocatable || {};
      const labels = node.metadata.labels || {};
      const roles = Object.keys(labels).filter(k => k.startsWith('node-role.kubernetes.io/')).map(k => k.replace('node-role.kubernetes.io/', ''));
      if (roles.length === 0) roles.push('worker');
      const taints = node.spec?.taints || [];
      const unschedulable = node.spec?.unschedulable;
      const podCount = podsByNode.get(node.metadata.name) || 0;
      const podCap = parseResourceValue(allocatable.pods || capacity.pods);
      const cpuCap = parseResourceValue(capacity.cpu);
      const memCap = parseResourceValue(capacity.memory);

      // Match per-node metrics: prefer `node` label (from kube_node_info join), fall back to `instance` substring
      const nodeName = node.metadata.name;
      const findMetric = (metrics: PrometheusResult[]) =>
        metrics.find((m) => m.metric?.node === nodeName) ??
        metrics.find((m) => m.metric?.instance?.includes(nodeName));
      const memMetric = findMetric(nodeMemMetrics as PrometheusResult[]);
      const memUsagePct = memMetric?.value ?? null;
      const cpuMetric = findMetric(nodeCpuMetrics as PrometheusResult[]);
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
      const machineRef = (machines as Machine[]).find((m) => m.status?.nodeRef?.name === nodeName);
      const instanceType = (machineRef?.spec?.providerSpec?.value?.instanceType as string)
        || node.metadata.labels?.['node.kubernetes.io/instance-type']
        || '';

      return {
        node: node as K8sResource, status, nodeInfo, capacity, allocatable, roles, taints, unschedulable,
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
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Server className="w-6 h-6 text-blue-500" /> Compute
            <Badge variant={isHyperShift ? 'info' : 'outline'} size="sm">
              {isHyperShift ? 'Hosted' : 'Self-Managed'}
            </Badge>
            {platform && <span className="text-sm font-normal text-slate-500">{platform}</span>}
          </h1>
          <p className="text-sm text-slate-400 mt-1">Cluster capacity, node health, and resource utilization</p>
        </div>

        {/* Tabs */}
        <Card className="flex gap-1 p-1">
          {([['overview', 'Overview'], ['capacity', 'Capacity Planning']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={computeTab === id} aria-label={label} onClick={() => setComputeTab(id)}
              className={cn('px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', computeTab === id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              {label}
            </button>
          ))}
        </Card>

        {computeTab === 'capacity' && <CapacityTab />}

        {computeTab === 'overview' && <>
        {/* Cluster type summary */}
        <ClusterTypeSummary
          isHyperShift={isHyperShift}
          nodeDetails={nodeDetails}
          nodePools={nodePools}
          clusterVersion={clusterVersion}
          platform={platform}
        />

        {/* Key metrics — sparklines for trends, static for capacity */}
        <MetricGrid>
          <MetricCard
            title="CPU Utilization"
            query={isHyperShift
              ? "sum(rate(node_cpu_seconds_total{mode!='idle'}[5m])) / count(count by (cpu) (node_cpu_seconds_total)) * 100"
              : "sum(rate(node_cpu_seconds_total{mode!='idle'}[5m])) / sum(machine_cpu_cores) * 100"}
            unit="%"
            color={CHART_COLORS.blue}
            thresholds={{ warning: 70, critical: 90 }}
          />
          <MetricCard
            title="Memory Utilization"
            query="(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100"
            unit="%"
            color={CHART_COLORS.violet}
            thresholds={{ warning: 75, critical: 90 }}
          />
          <MetricCard
            title="Disk Usage"
            query="(1 - sum(node_filesystem_avail_bytes{fstype!~'tmpfs|overlay|squashfs'}) / sum(node_filesystem_size_bytes{fstype!~'tmpfs|overlay|squashfs'})) * 100"
            unit="%"
            color={CHART_COLORS.cyan}
            thresholds={{ warning: 80, critical: 95 }}
          />
          <MetricCard
            title="Pod Density"
            query={`sum(kubelet_running_pods) / ${nodes.length * (clusterCapacity.podCapacity / nodes.length || 250)} * 100 or vector(0)`}
            unit="%"
            color={CHART_COLORS.amber}
            thresholds={{ warning: 80, critical: 95 }}
          />
        </MetricGrid>

        {/* Capacity summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Nodes" value={`${readyCount}/${nodes.length}`} issues={unreadyNodes.length} onClick={() => go('/r/v1~nodes', 'Nodes')} />
          <StatCard label="Total CPU" value={formatCpu(clusterCapacity.cpuCores)} />
          <StatCard label="Total Memory" value={formatBytes(clusterCapacity.memBytes)} />
          <StatCard label="Pods" value={`${clusterCapacity.totalPods}/${clusterCapacity.podCapacity}`} />
        </div>

        {/* Alerts */}
        <NodeAlerts unreadyNodes={unreadyNodes} pressureNodes={pressureNodes} go={go} />

        {isHyperShift ? (
          <>
            {/* HyperShift: NodePools first (primary scaling), then hex map, then audit */}
            <MachineManagement
              isHyperShift={isHyperShift}
              machines={machines}
              machineSets={machineSets}
              healthChecks={healthChecks}
              machineAutoscalers={machineAutoscalers}
              clusterAutoscaler={clusterAutoscaler}
              nodePools={nodePools}
              go={go}
            />

            <NodeHexMap
              nodes={nodeDetails}
              podsByNode={podDetailsByNode}
              onNodeClick={(name) => go(`/r/v1~nodes/_/${name}`, name)}
              onPodClick={(ns, name) => go(`/r/v1~pods/${ns}/${name}`, name)}
              onViewAll={() => go('/r/v1~nodes', 'Nodes')}
              isHyperShift
            />

            <ComputeHealthAudit
              nodes={nodes}
              healthChecks={healthChecks}
              clusterAutoscaler={clusterAutoscaler}
              machineAutoscalers={machineAutoscalers}
              nodeDetails={nodeDetails}
              nodePools={nodePools}
              go={go}
            />

            {machineConfigPools.length > 0 && (
              <MachineConfigSection machineConfigPools={machineConfigPools} go={go} />
            )}
          </>
        ) : (
          <>
            {/* Regular: Audit → Hex map → Machine management → MachineConfig */}
            <ComputeHealthAudit
              nodes={nodes}
              healthChecks={healthChecks}
              clusterAutoscaler={clusterAutoscaler}
              machineAutoscalers={machineAutoscalers}
              nodeDetails={nodeDetails}
              nodePools={nodePools}
              go={go}
            />

            <NodeHexMap
              nodes={nodeDetails}
              podsByNode={podDetailsByNode}
              onNodeClick={(name) => go(`/r/v1~nodes/_/${name}`, name)}
              onPodClick={(ns, name) => go(`/r/v1~pods/${ns}/${name}`, name)}
              onViewAll={() => go('/r/v1~nodes', 'Nodes')}
            />

            <MachineManagement
              isHyperShift={isHyperShift}
              machines={machines}
              machineSets={machineSets}
              healthChecks={healthChecks}
              machineAutoscalers={machineAutoscalers}
              clusterAutoscaler={clusterAutoscaler}
              nodePools={nodePools}
              go={go}
            />

            <MachineConfigSection machineConfigPools={machineConfigPools} go={go} />
          </>
        )}
        </>}
      </div>
    </div>
  );
}

// ===== Compute Health Audit =====

/** Item in an audit check list — may be a full resource, a node detail, or a placeholder */
interface AuditItem {
  metadata?: { name?: string; namespace?: string; uid?: string };
  name?: string;
  _pressureTypes?: string;
  _kubeletVersion?: string;
  [key: string]: unknown;
}


function ComputeHealthAudit({
  nodes,
  healthChecks,
  clusterAutoscaler,
  machineAutoscalers,
  nodeDetails,
  nodePools,
  go,
}: {
  nodes: K8sResource[];
  healthChecks: K8sResource[];
  clusterAutoscaler: K8sResource[];
  machineAutoscalers: K8sResource[];
  nodeDetails: NodeDetail[];
  nodePools: K8sResource[];
  go: (path: string, title: string) => void;
}) {
  const isHyperShift = useClusterStore((s) => s.isHyperShift);
  const [expandedCheck, setExpandedCheck] = React.useState<string | null>(null);

  const checks: AuditCheck[] = React.useMemo(() => {
    const allChecks: AuditCheck[] = [];

    // 1. HA Control Plane (skip on HyperShift — CP is external)
    if (!isHyperShift) {
      const masterNodes = nodeDetails.filter(nd => nd.roles.includes('master') || nd.roles.includes('control-plane'));
      const hasHA = masterNodes.length >= 3;
      allChecks.push({
        id: 'ha-control-plane',
        title: 'HA Control Plane',
        description: 'Production clusters should have 3+ control plane nodes for high availability',
        why: 'etcd requires an odd-numbered quorum (3 or 5 nodes). With fewer than 3 masters, losing a single node causes cluster failure. 3 masters can tolerate 1 failure; 5 can tolerate 2.',
        passing: hasHA ? (masterNodes as unknown as AuditItem[]) : [],
        failing: hasHA ? [] : (masterNodes as unknown as AuditItem[]),
        yamlExample: `# Control plane nodes are provisioned during cluster installation.
# To scale control plane nodes post-install, you must:
# 1. Create new master Machines via MachineSet
# 2. Update etcd members
# 3. Update load balancer configuration
#
# For production clusters, always install with 3 or 5 control plane nodes.
# Single-node OpenShift is for dev/test only.`,
      });
    }

    // 2. Dedicated Worker Nodes
    const workerNodes = nodeDetails.filter(nd => nd.roles.includes('worker') && !nd.roles.includes('master') && !nd.roles.includes('control-plane'));
    const hasWorkers = isHyperShift ? workerNodes.length >= 1 : workerNodes.length >= 2;
    allChecks.push({
      id: 'dedicated-workers',
      title: isHyperShift ? 'Worker Nodes' : 'Dedicated Worker Nodes',
      description: isHyperShift ? 'Worker nodes for workload scheduling (all nodes are workers on hosted clusters)' : 'Production workloads should run on 2+ dedicated worker nodes (not on masters)',
      why: isHyperShift ? 'On HyperShift clusters, all visible nodes are workers. The control plane runs externally in a management cluster.' : 'Running application pods on control plane nodes creates resource contention with etcd and apiserver. Control plane stability is critical — separating workloads protects cluster availability.',
      passing: hasWorkers ? (workerNodes as unknown as AuditItem[]) : [],
      failing: hasWorkers ? [] : (workerNodes as unknown as AuditItem[]),
      yamlExample: `# Worker nodes are created via MachineSets.
# View existing MachineSets and scale them up:
#   oc get machinesets -n openshift-machine-api
#   oc scale machineset <name> --replicas=3
#
# Or create new worker MachineSets based on existing ones.
# For HA, spread workers across multiple availability zones.`,
    });

    // 3. MachineHealthChecks (skip on HyperShift — managed externally via NodePool)
    if (!isHyperShift) {
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
    }

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
      }) as unknown as AuditItem[],
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
    const kubeletVersions = new Map<string, K8sResource[]>();
    nodeDetails.forEach(nd => {
      const info = nd.nodeInfo as Record<string, string | undefined>;
      const version = info.kubeletVersion || 'unknown';
      if (!kubeletVersions.has(version)) kubeletVersions.set(version, []);
      kubeletVersions.get(version)!.push(nd.node);
    });
    const consistentVersion = kubeletVersions.size === 1;
    const mismatchedNodes: AuditCheck['failing'] = consistentVersion ? [] : Array.from(kubeletVersions.entries())
      .filter(([, versionNodes]) => versionNodes.length < nodeDetails.length)
      .flatMap(([version, versionNodes]) => versionNodes.map(n => ({ ...n, _kubeletVersion: version })));

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

    // 6. Cluster Autoscaling (skip on HyperShift — scaling is via NodePool)
    if (!isHyperShift) {
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
    }

    // 7. NodePool Health (HyperShift only)
    if (isHyperShift && nodePools.length > 0) {
      const nps = nodePools as unknown as NodePool[];
      const unhealthyPools = nps.filter(np => {
        const desired = np.spec?.replicas ?? 0;
        const ready = np.status?.replicas ?? 0;
        const conditions = np.status?.conditions || [];
        return (desired > 0 && ready < desired) || conditions.some((c: Condition) => c.type === 'Ready' && c.status !== 'True');
      });
      const healthyPools = nps.filter(np => !unhealthyPools.includes(np));
      allChecks.push({
        id: 'nodepool-health',
        title: 'NodePool Health',
        description: 'All NodePools should have desired replicas ready and no degraded conditions',
        why: 'NodePools manage worker node lifecycle on HyperShift clusters. Unhealthy NodePools mean nodes are not being provisioned or replaced correctly.',
        passing: healthyPools.map(np => ({ metadata: np.metadata, node: np as unknown as K8sResource, status: { ready: true } })) as AuditItem[],
        failing: unhealthyPools.map(np => ({ metadata: np.metadata, node: np as unknown as K8sResource, status: { ready: false } })) as AuditItem[],
        yamlExample: `apiVersion: hypershift.openshift.io/v1beta1
kind: NodePool
metadata:
  name: my-nodepool
spec:
  replicas: 3
  autoScaling:
    min: 2
    max: 10
  management:
    autoRepair: true
    upgradeType: Replace`,
      });
    }

    return allChecks;
  }, [nodes, healthChecks, clusterAutoscaler, machineAutoscalers, nodeDetails, nodePools, isHyperShift]);

  if (nodes.length === 0) return null;

  return (
    <HealthAuditPanel
      title="Compute Health Audit"
      checks={checks}
      onNavigateItem={(check, item) => {
        const name = item.metadata?.name || '';
        const isNode = check.id === 'ha-control-plane' || check.id === 'dedicated-workers' || check.id === 'node-pressure' || check.id === 'kubelet-version';
        if (isNode) go(`/r/v1~nodes/_/${name}`, name);
        else if (check.id === 'machine-health-checks') go('/create/machine.openshift.io~v1beta1~machinehealthchecks', 'Create MachineHealthCheck');
        else if (check.id === 'cluster-autoscaling') go('/create/autoscaling.openshift.io~v1~clusterautoscalers', 'Create ClusterAutoscaler');
      }}
      navigateLabel={(check) =>
        check.id === 'machine-health-checks' || check.id === 'cluster-autoscaling' ? 'Create' : 'View'
      }
      renderItemBadges={(check, item) => (
        <>
          {item._pressureTypes && <span className="text-xs px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded">{item._pressureTypes as string}</span>}
          {item._kubeletVersion && <span className="text-xs px-1.5 py-0.5 bg-yellow-900/50 text-yellow-300 rounded font-mono">{item._kubeletVersion as string}</span>}
        </>
      )}
    />
  );
}
