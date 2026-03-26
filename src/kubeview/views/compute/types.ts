import type { K8sResource } from '../../engine/renderers';
import type { Node } from '../../engine/types';
import type { getNodeStatus } from '../../engine/renderers/statusUtils';

/** Prometheus instant-query result entry */
export type PrometheusResult = { metric: Record<string, string>; value: number };

/** MachineAutoscaler shape (not in typed interfaces yet) */
export interface MachineAutoscalerResource extends K8sResource {
  spec?: { scaleTargetRef?: { apiVersion?: string; kind?: string; name?: string }; minReplicas?: number; maxReplicas?: number };
}

/** ClusterAutoscaler shape (not in typed interfaces yet) */
export interface ClusterAutoscalerResource extends K8sResource {
  spec?: { resourceLimits?: { maxNodesTotal?: number; minNodesTotal?: number }; scaleDown?: { enabled?: boolean; delayAfterAdd?: string } };
}

/** MachineHealthCheck shape (not in typed interfaces yet) */
export interface MachineHealthCheckResource extends K8sResource {
  spec?: { maxUnhealthy?: string; unhealthyConditions?: Array<{ type: string; status: string; timeout: string }>; selector?: Record<string, unknown> };
  status?: { currentHealthy?: number; expectedMachines?: number };
}

/** MachineConfigPool shape (not in typed interfaces yet) */
export interface MachineConfigPoolResource extends K8sResource {
  status?: { conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>; machineCount?: number; readyMachineCount?: number; updatedMachineCount?: number; configuration?: { name?: string } };
}

/** Per-node detail computed for the table & audit checks */
export interface NodeDetail {
  node: K8sResource;
  status: ReturnType<typeof getNodeStatus>;
  nodeInfo: Partial<NonNullable<NonNullable<Node['status']>['nodeInfo']>>;
  capacity: Partial<NonNullable<NonNullable<Node['status']>['capacity']>>;
  allocatable: Partial<NonNullable<NonNullable<Node['status']>['capacity']>>;
  roles: string[];
  taints: NonNullable<NonNullable<Node['spec']>['taints']>;
  unschedulable: boolean | undefined;
  podCount: number;
  podCap: number;
  cpuCap: number;
  memCap: number;
  memUsagePct: number | null;
  cpuUsagePct: number | null;
  age: string;
  pressures: string[];
  instanceType: string;
  name: string;
}
