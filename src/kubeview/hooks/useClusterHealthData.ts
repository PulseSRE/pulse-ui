/**
 * Shared hook for cluster health data — used by Pulse, Troubleshoot.
 * Uses useK8sListWatch for real-time WebSocket updates.
 */

import type { K8sResource } from '../engine/renderers';
import { useK8sListWatch } from './useK8sListWatch';

export function useClusterHealthData() {
  const nodes = useK8sListWatch({ apiPath: '/api/v1/nodes' });
  const pods = useK8sListWatch({ apiPath: '/api/v1/pods' });
  const deployments = useK8sListWatch({ apiPath: '/apis/apps/v1/deployments' });
  const events = useK8sListWatch({ apiPath: '/api/v1/events' });
  const pvcs = useK8sListWatch({ apiPath: '/api/v1/persistentvolumeclaims' });

  return {
    nodes: (nodes.data ?? []) as K8sResource[],
    pods: (pods.data ?? []) as K8sResource[],
    deployments: (deployments.data ?? []) as K8sResource[],
    events: (events.data ?? []) as K8sResource[],
    pvcs: (pvcs.data ?? []) as K8sResource[],
    isLoading: nodes.isLoading || pods.isLoading,
  };
}
