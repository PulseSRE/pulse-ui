import { getClusterBase } from '../engine/clusterConnection';
import { useFleetStore } from '../store/fleetStore';
import { metricsAvailableFor } from '../components/metrics/prometheus';

/** Resolve during render so async callbacks retain the displayed cluster's target. */
export function useClusterBase(): string {
  const clusterId = useFleetStore(state => state.activeClusterId);
  return getClusterBase(clusterId);
}

/**
 * The cluster this screen is showing. Put it in every query key that reads
 * cluster data and pass it to the k8s helper, so a cached object from one
 * cluster is never shown — or written back — while another is active.
 */
export function useActiveClusterId(): string {
  return useFleetStore(state => state.activeClusterId);
}

/** Whether Prometheus/Alertmanager data can be shown for the active cluster. */
export function useMetricsAvailable(): boolean {
  return metricsAvailableFor(useActiveClusterId());
}
