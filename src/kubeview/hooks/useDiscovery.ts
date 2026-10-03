import { useEffect } from 'react';
import { useFleetStore } from '../store/fleetStore';
import { useClusterStore } from '../store/clusterStore';

export function useDiscovery() {
  const { resourceRegistry, apiGroups, discoveryLoading, discoveryError, discoveryClusterId, runDiscovery } =
    useClusterStore();

  const clusterId = useFleetStore((s) => s.activeClusterId);
  useEffect(() => {
    if (discoveryClusterId !== clusterId || (!resourceRegistry && !discoveryLoading && !discoveryError)) {
      runDiscovery();
    }
  }, [resourceRegistry, discoveryLoading, discoveryError, discoveryClusterId, clusterId, runDiscovery]);

  return {
    resourceRegistry,
    apiGroups,
    isLoading: discoveryLoading,
    error: discoveryError,
    refresh: runDiscovery,
  };
}
