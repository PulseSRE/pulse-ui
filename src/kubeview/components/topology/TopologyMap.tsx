import React, { useCallback, useMemo } from 'react';
import type { K8sResource } from '../../engine/renderers';
import { useFleetStore } from '../../store/fleetStore';
import { useMapClusters, useMapZones, useMapNodes, useMapPods, useMapEvents, useZoneUtilization, usePodMovements } from './hooks/useMapData';
import { WorldMap } from './WorldMap';

interface TopologyMapProps {
  nodes: K8sResource[];
  pods: K8sResource[];
  operators: K8sResource[];
  events?: K8sResource[];
  go: (path: string, title: string) => void;
}

export default function TopologyMap({ nodes, pods, events = [], go }: TopologyMapProps) {
  const clusters = useFleetStore(s => s.clusters);
  const fleetMode = useFleetStore(s => s.fleetMode);
  const setActiveCluster = useFleetStore(s => s.setActiveCluster);

  const mapClusters = useMapClusters(clusters, nodes);
  const mapZones = useMapZones(nodes, pods);
  const mapNodes = useMapNodes(nodes, pods);
  const mapPods = useMapPods(pods);
  const mapEvents = useMapEvents(events, nodes);
  const zoneUtilization = useZoneUtilization(nodes, pods, mapZones);
  const podMovements = usePodMovements(pods);

  const navigateToNode = useCallback((nodeName: string) => {
    go(`/r/v1~nodes/_/${nodeName}`, nodeName);
  }, [go]);

  // Compute summary stats
  const stats = useMemo(() => {
    const totalNodes = mapNodes.length;
    const readyNodes = mapNodes.filter(n => n.status === 'Ready').length;
    const totalPods = mapPods.length;
    const runningPods = mapPods.filter(p => p.phase === 'Running').length;
    const failedPods = mapPods.filter(p => p.phase === 'Failed').length;
    const pendingPods = mapPods.filter(p => p.phase === 'Pending').length;
    const avgCpu = zoneUtilization.length > 0 ? Math.round(zoneUtilization.reduce((s, z) => s + z.cpuPercent, 0) / zoneUtilization.length) : 0;
    const avgMem = zoneUtilization.length > 0 ? Math.round(zoneUtilization.reduce((s, z) => s + z.memoryPercent, 0) / zoneUtilization.length) : 0;
    const zones = mapZones.length;
    const alerts = mapEvents.filter(e => e.type === 'alert' || e.type === 'restart').length;
    return { totalNodes, readyNodes, totalPods, runningPods, failedPods, pendingPods, avgCpu, avgMem, zones, alerts };
  }, [mapNodes, mapPods, zoneUtilization, mapZones, mapEvents]);

  if (mapClusters.length === 0 && mapZones.length === 0) return null;

  const isFleet = fleetMode === 'multi';

  return (
    <div role="img" aria-label={`Infrastructure command center showing ${stats.totalNodes} nodes across ${stats.zones} zones`}>
      <WorldMap
        clusters={isFleet ? mapClusters : []}
        zones={mapZones}
        nodes={mapNodes}
        pods={mapPods}
        events={mapEvents}
        zoneUtilization={zoneUtilization}
        podMovements={podMovements}
        stats={stats}
        onClusterClick={isFleet ? (cluster) => setActiveCluster(cluster.id) : undefined}
        onNavigateToNode={navigateToNode}
        onNavigate={go}
      />
    </div>
  );
}
