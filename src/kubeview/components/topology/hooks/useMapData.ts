import { useMemo, useRef, useEffect, useState } from 'react';
import type { K8sResource } from '../../../engine/renderers';
import type { ClusterConnection } from '../../../engine/clusterConnection';
import type { HealthScoreResult } from '../../../engine/healthScore';
import type { MapCluster, MapNode, MapPod, MapZone, MapEvent, ZoneUtilization, PodMovement } from '../types';
import { resolveRegionCoords } from '../regionCoords';

function gradeFromScore(score: number): HealthScoreResult['grade'] {
  if (score >= 90) return 'healthy';
  if (score >= 70) return 'warning';
  if (score >= 50) return 'degraded';
  return 'critical';
}

function statusToScore(status: ClusterConnection['status']): number {
  switch (status) {
    case 'connected': return 95;
    case 'auth-expired': return 40;
    case 'unreachable': return 10;
    default: return 50;
  }
}

/**
 * Detect cloud provider from node providerID or labels.
 * providerID format: "aws:///us-east-1a/i-abc123" or "azure:///..." or "gce:///..."
 */
function detectProvider(node: K8sResource): string {
  if (!node.metadata) return 'Unknown';
  const spec = node.spec as Record<string, unknown> | undefined;
  const providerID = (spec?.providerID as string) || '';
  if (providerID.startsWith('aws:')) return 'AWS';
  if (providerID.startsWith('azure:')) return 'Azure';
  if (providerID.startsWith('gce:')) return 'GCP';
  if (providerID.startsWith('ibmcloud:')) return 'IBM Cloud';
  if (providerID.startsWith('vsphere:')) return 'vSphere';
  if (providerID.startsWith('openstack:')) return 'OpenStack';
  if (providerID.startsWith('baremetalhost:')) return 'Bare Metal';
  if (providerID) return providerID.split(':')[0];
  return 'Unknown';
}

function getNodeRegion(node: K8sResource): string | null {
  const labels = node.metadata?.labels || {};
  return labels['topology.kubernetes.io/region']
    || labels['failure-domain.beta.kubernetes.io/region']
    || null;
}

function getNodeZone(node: K8sResource): string | null {
  const labels = node.metadata?.labels || {};
  return labels['topology.kubernetes.io/zone']
    || labels['failure-domain.beta.kubernetes.io/zone']
    || null;
}

type K8sCondition = { type: string; status: string };

function getConditions(resource: K8sResource): K8sCondition[] {
  const status = resource.status as Record<string, unknown> | undefined;
  return (status?.conditions as K8sCondition[]) || [];
}

function nodeHealthScore(node: K8sResource): number {
  const conditions = getConditions(node);
  const ready = conditions.find(c => c.type === 'Ready');
  if (!ready || ready.status !== 'True') return 20;
  let score = 100;
  for (const c of conditions) {
    if (c.type === 'DiskPressure' && c.status === 'True') score -= 25;
    if (c.type === 'MemoryPressure' && c.status === 'True') score -= 25;
    if (c.type === 'PIDPressure' && c.status === 'True') score -= 15;
  }
  return Math.max(0, score);
}

const DEFAULT_POSITIONS: Array<{ latitude: number; longitude: number }> = [
  { latitude: 39.0, longitude: -77.5 },
  { latitude: 46.2, longitude: -123.8 },
  { latitude: 50.1, longitude: 8.7 },
  { latitude: 35.7, longitude: 139.7 },
  { latitude: -33.9, longitude: 151.2 },
  { latitude: -23.6, longitude: -46.6 },
  { latitude: 1.3, longitude: 103.8 },
  { latitude: 53.3, longitude: -6.3 },
];

/**
 * Build MapCluster array from ClusterConnections.
 * Auto-detects the local cluster's region from node labels.
 */
export function useMapClusters(clusters: ClusterConnection[], k8sNodes: K8sResource[]): MapCluster[] {
  return useMemo(() => {
    const result: MapCluster[] = [];
    let defaultIdx = 0;

    for (const c of clusters) {
      const loc = c.location
        ? { latitude: c.location.latitude, longitude: c.location.longitude, region: c.location.region, displayName: c.location.displayName || c.location.region }
        : (() => {
            const resolved = resolveRegionCoords(c.id) || resolveRegionCoords(c.name) || resolveRegionCoords(c.environment || '');
            if (resolved) return { latitude: resolved.latitude, longitude: resolved.longitude, region: c.id, displayName: resolved.displayName };

            if (c.connectionType === 'local') {
              const detectedRegion = getNodeRegion(k8sNodes[0] || {} as K8sResource);
              if (detectedRegion) {
                const fromNodes = resolveRegionCoords(detectedRegion);
                if (fromNodes) return { latitude: fromNodes.latitude, longitude: fromNodes.longitude, region: detectedRegion, displayName: fromNodes.displayName };
              }
            }

            const pos = DEFAULT_POSITIONS[defaultIdx % DEFAULT_POSITIONS.length];
            defaultIdx++;
            return { latitude: pos.latitude, longitude: pos.longitude, region: 'unknown', displayName: c.name };
          })();

      const score = statusToScore(c.status);
      result.push({
        id: c.id,
        name: c.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        region: loc.region,
        displayName: loc.displayName,
        status: c.status,
        healthScore: score,
        healthGrade: gradeFromScore(score),
        nodeCount: c.metadata?.nodeCount || k8sNodes.length,
        environment: c.environment,
        version: c.metadata?.version,
      });
    }
    return result;
  }, [clusters, k8sNodes]);
}

/**
 * Group nodes by availability zone and build MapZone array.
 * Each zone becomes a pin on the map showing the datacenter.
 */
export function useMapZones(k8sNodes: K8sResource[], pods: K8sResource[]): MapZone[] {
  return useMemo(() => {
    const zoneMap = new Map<string, {
      region: string;
      zone: string;
      provider: string;
      nodes: K8sResource[];
    }>();

    for (const node of k8sNodes) {
      const region = getNodeRegion(node) || 'unknown';
      const zone = getNodeZone(node) || region;
      const provider = detectProvider(node);
      const key = `${region}/${zone}`;

      if (!zoneMap.has(key)) {
        zoneMap.set(key, { region, zone, provider, nodes: [] });
      }
      zoneMap.get(key)!.nodes.push(node);
    }

    const result: MapZone[] = [];
    let defaultIdx = 0;

    for (const [key, group] of zoneMap) {
      // Resolve coordinates from region
      const resolved = resolveRegionCoords(group.region) || resolveRegionCoords(group.zone);
      let latitude: number, longitude: number, displayName: string;

      if (resolved) {
        latitude = resolved.latitude;
        longitude = resolved.longitude;
        displayName = resolved.displayName;
        // Offset zones within the same region slightly so pins don't overlap
        const zoneIdx = group.zone.replace(group.region, '');
        if (zoneIdx) {
          const offset = (zoneIdx.charCodeAt(0) - 96) * 0.8; // a=0.8, b=1.6, c=2.4
          latitude += (offset % 2 === 0 ? offset : -offset) * 0.3;
          longitude += offset * 0.5;
        }
      } else {
        const pos = DEFAULT_POSITIONS[defaultIdx % DEFAULT_POSITIONS.length];
        defaultIdx++;
        latitude = pos.latitude;
        longitude = pos.longitude;
        displayName = group.zone;
      }

      const nodeNames = group.nodes.map(n => n.metadata?.name || '');
      const scores = group.nodes.map(n => nodeHealthScore(n));
      const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      const podCount = pods.filter(p => {
        const nodeName = ((p.spec as Record<string, unknown>)?.nodeName as string) || '';
        return nodeNames.includes(nodeName);
      }).length;

      result.push({
        id: key,
        region: group.region,
        zone: group.zone,
        latitude,
        longitude,
        displayName,
        provider: group.provider,
        nodeCount: group.nodes.length,
        nodeNames,
        healthScore: avgScore,
        healthGrade: gradeFromScore(avgScore),
        podCount,
      });
    }

    return result;
  }, [k8sNodes, pods]);
}

export function useMapNodes(k8sNodes: K8sResource[], pods: K8sResource[]): MapNode[] {
  return useMemo(() => {
    return k8sNodes.map(node => {
      const name = node.metadata?.name || '';
      const labels = node.metadata?.labels || {};
      const conditions = getConditions(node);
      const ready = conditions.find(c => c.type === 'Ready');
      const isReady = ready?.status === 'True';
      const score = nodeHealthScore(node);

      const podCount = pods.filter(p => (p.spec as Record<string, unknown>)?.nodeName === name).length;
      const pressureConditions = conditions
        .filter(c => c.type !== 'Ready' && c.status === 'True')
        .map(c => c.type);

      return {
        id: name,
        name,
        healthScore: score,
        healthGrade: gradeFromScore(score),
        podCount,
        status: isReady ? 'Ready' : 'NotReady',
        conditions: pressureConditions,
        region: getNodeRegion(node) || undefined,
        zone: getNodeZone(node) || undefined,
        instanceType: labels['node.kubernetes.io/instance-type'] || labels['beta.kubernetes.io/instance-type'] || undefined,
        provider: detectProvider(node),
      } satisfies MapNode;
    });
  }, [k8sNodes, pods]);
}

export function useMapPods(pods: K8sResource[]): MapPod[] {
  return useMemo(() => {
    return pods.map(p => {
      const spec = p.spec as Record<string, unknown>;
      const status = p.status as Record<string, unknown> | undefined;
      const containerStatuses = (status?.containerStatuses as Array<{ restartCount?: number }>) || [];
      const restarts = containerStatuses.reduce((sum, cs) => sum + (cs.restartCount || 0), 0);

      return {
        name: p.metadata.name,
        namespace: p.metadata.namespace || '',
        phase: (status?.phase as string) || 'Unknown',
        nodeName: (spec?.nodeName as string) || '',
        restarts,
      } satisfies MapPod;
    });
  }, [pods]);
}

/**
 * Extract live events from K8s Event resources.
 * Shows deploys, scales, restarts, evictions as recent activity.
 */
export function useMapEvents(events: K8sResource[], k8sNodes: K8sResource[]): MapEvent[] {
  return useMemo(() => {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const result: MapEvent[] = [];

    for (const e of events) {
      const reason = ((e as Record<string, unknown>).reason as string) || '';
      const message = ((e as Record<string, unknown>).message as string) || '';
      const involvedObj = (e as Record<string, unknown>).involvedObject as Record<string, unknown> | undefined;
      const kind = (involvedObj?.kind as string) || '';
      const name = (involvedObj?.name as string) || '';
      const lastTs = ((e as Record<string, unknown>).lastTimestamp as string) || (e.metadata?.creationTimestamp as string) || '';
      const timestamp = lastTs ? new Date(lastTs).getTime() : 0;

      if (timestamp < oneHourAgo) continue;

      let type: MapEvent['type'] = 'alert';
      if (reason === 'ScalingReplicaSet' || reason === 'SuccessfulCreate') type = 'deploy';
      else if (reason === 'ScaledUp' || reason === 'ScaledDown') type = 'scale';
      else if (reason === 'BackOff' || reason === 'Killing' || reason === 'Restarting') type = 'restart';
      else if (reason === 'Evicted' || reason === 'Preempting') type = 'eviction';
      else if (reason === 'Scheduled' || reason === 'SuccessfullyAssigned') type = 'scheduled';

      let nodeName: string | undefined;
      if (kind === 'Node') nodeName = name;
      else if (kind === 'Pod') {
        const match = message.match(/to\s+(\S+)/);
        if (match) {
          const candidate = match[1];
          if (k8sNodes.some(n => n.metadata?.name === candidate)) nodeName = candidate;
        }
      }

      const nodeRes = nodeName ? k8sNodes.find(n => n.metadata?.name === nodeName) : undefined;
      const zone = nodeRes ? getNodeZone(nodeRes) || undefined : undefined;

      result.push({
        id: e.metadata?.uid || `${name}-${timestamp}`,
        type,
        message: `${reason}: ${message}`.slice(0, 120),
        nodeName,
        zone,
        timestamp,
      });
    }

    return result.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  }, [events, k8sNodes]);
}

/**
 * Compute resource utilization per zone from pod resource requests.
 * Uses pod requests as a proxy since actual metrics need Prometheus.
 */
export function useZoneUtilization(k8sNodes: K8sResource[], pods: K8sResource[], zones: MapZone[]): ZoneUtilization[] {
  return useMemo(() => {
    return zones.map(zone => {
      // Get allocatable resources for nodes in this zone
      let totalCpuMillis = 0;
      let totalMemBytes = 0;
      let usedCpuMillis = 0;
      let usedMemBytes = 0;

      for (const nodeName of zone.nodeNames) {
        const node = k8sNodes.find(n => n.metadata?.name === nodeName);
        if (!node) continue;
        const status = node.status as Record<string, unknown> | undefined;
        const allocatable = status?.allocatable as Record<string, string> | undefined;
        if (allocatable) {
          totalCpuMillis += parseCpu(allocatable.cpu || '0');
          totalMemBytes += parseMem(allocatable.memory || '0');
        }

        // Sum pod requests on this node
        const nodePods = pods.filter(p => (p.spec as Record<string, unknown>)?.nodeName === nodeName);
        for (const pod of nodePods) {
          const containers = ((pod.spec as Record<string, unknown>)?.containers as Array<Record<string, unknown>>) || [];
          for (const c of containers) {
            const requests = c.resources as Record<string, unknown> | undefined;
            const req = requests?.requests as Record<string, string> | undefined;
            if (req) {
              usedCpuMillis += parseCpu(req.cpu || '0');
              usedMemBytes += parseMem(req.memory || '0');
            }
          }
        }
      }

      return {
        zoneId: zone.id,
        cpuPercent: totalCpuMillis > 0 ? Math.round((usedCpuMillis / totalCpuMillis) * 100) : 0,
        memoryPercent: totalMemBytes > 0 ? Math.round((usedMemBytes / totalMemBytes) * 100) : 0,
      } satisfies ZoneUtilization;
    });
  }, [k8sNodes, pods, zones]);
}

function parseCpu(val: string): number {
  if (val.endsWith('m')) return parseInt(val, 10);
  if (val.endsWith('n')) return parseInt(val, 10) / 1000000;
  return parseFloat(val) * 1000;
}

function parseMem(val: string): number {
  const num = parseInt(val, 10);
  if (val.endsWith('Ki')) return num * 1024;
  if (val.endsWith('Mi')) return num * 1024 * 1024;
  if (val.endsWith('Gi')) return num * 1024 * 1024 * 1024;
  return num;
}

/**
 * Track pod phase changes in real-time.
 * Compares current pods to previous snapshot and emits movement events.
 */
export function usePodMovements(pods: K8sResource[]): PodMovement[] {
  const prevPods = useRef<Map<string, string>>(new Map());
  const [movements, setMovements] = useState<PodMovement[]>([]);

  useEffect(() => {
    const now = Date.now();
    const newMovements: PodMovement[] = [];
    const currentPods = new Map<string, string>();

    for (const p of pods) {
      const name = p.metadata?.name || '';
      const ns = p.metadata?.namespace || '';
      const status = p.status as Record<string, unknown> | undefined;
      const phase = (status?.phase as string) || 'Unknown';
      const nodeName = ((p.spec as Record<string, unknown>)?.nodeName as string) || '';
      const key = `${ns}/${name}`;
      currentPods.set(key, phase);

      const prevPhase = prevPods.current.get(key);
      if (prevPhase && prevPhase !== phase) {
        newMovements.push({ podName: name, namespace: ns, fromPhase: prevPhase, toPhase: phase, nodeName, timestamp: now });
      } else if (!prevPhase && phase === 'Pending') {
        newMovements.push({ podName: name, namespace: ns, fromPhase: '', toPhase: 'Pending', nodeName, timestamp: now });
      }
    }

    // Detect deletions
    for (const [key, prevPhase] of prevPods.current) {
      if (!currentPods.has(key)) {
        const [ns, name] = key.split('/');
        newMovements.push({ podName: name, namespace: ns, fromPhase: prevPhase, toPhase: 'Deleted', nodeName: '', timestamp: now });
      }
    }

    prevPods.current = currentPods;

    if (newMovements.length > 0) {
      setMovements(prev => [...newMovements, ...prev].slice(0, 30));
    }

    // Expire old movements after 30 seconds
    const timer = setTimeout(() => {
      setMovements(prev => prev.filter(m => now - m.timestamp < 30000));
    }, 30000);
    return () => clearTimeout(timer);
  }, [pods]);

  return movements;
}
