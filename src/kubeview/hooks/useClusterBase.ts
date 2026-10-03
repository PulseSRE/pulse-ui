import { getClusterBase } from '../engine/clusterConnection';
import { useFleetStore } from '../store/fleetStore';

/** Resolve during render so async callbacks retain the displayed cluster's target. */
export function useClusterBase(): string {
  const clusterId = useFleetStore(state => state.activeClusterId);
  return getClusterBase(clusterId);
}
