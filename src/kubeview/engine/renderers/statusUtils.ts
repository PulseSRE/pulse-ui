import type { K8sResource } from './index';
import type { Pod, Node, Deployment } from '../types';

// Detect the "status" of any K8s resource generically
export function detectResourceStatus(resource: K8sResource): {
  status: 'healthy' | 'warning' | 'error' | 'pending' | 'unknown' | 'terminating';
  reason: string;
} {
  // Check for deletion timestamp first
  if (resource.metadata.deletionTimestamp) {
    return { status: 'terminating', reason: 'Resource is being deleted' };
  }

  // Type-specific detection
  const kind = resource.kind.toLowerCase();

  if (kind === 'pod') {
    const podStatus = getPodStatus(resource);
    if (podStatus.phase === 'Running' && podStatus.ready) {
      return { status: 'healthy', reason: 'Running' };
    }
    if (podStatus.phase === 'Succeeded') {
      return { status: 'healthy', reason: 'Completed' };
    }
    if (podStatus.phase === 'Pending') {
      return { status: 'pending', reason: podStatus.reason ?? 'Pending' };
    }
    if (podStatus.phase === 'Failed' || podStatus.reason) {
      return { status: 'error', reason: podStatus.reason ?? 'Failed' };
    }
    if (!podStatus.ready) {
      return { status: 'warning', reason: 'Not Ready' };
    }
  }

  if (kind === 'deployment' || kind === 'statefulset' || kind === 'daemonset') {
    const depStatus = getDeploymentStatus(resource);
    if (depStatus.ready === depStatus.desired && depStatus.available) {
      return { status: 'healthy', reason: 'Available' };
    }
    if (depStatus.progressing) {
      return { status: 'pending', reason: 'Progressing' };
    }
    if (depStatus.ready === 0) {
      return { status: 'error', reason: 'No replicas ready' };
    }
    return { status: 'warning', reason: 'Partially ready' };
  }

  if (kind === 'node') {
    const nodeStatus = getNodeStatus(resource);
    if (nodeStatus.ready) {
      if (nodeStatus.pressure.disk || nodeStatus.pressure.memory || nodeStatus.pressure.pid) {
        return { status: 'warning', reason: 'Resource pressure' };
      }
      return { status: 'healthy', reason: 'Ready' };
    }
    return { status: 'error', reason: 'Not Ready' };
  }

  // Generic condition-based detection
  const status = resource.status as Record<string, unknown> | undefined;
  const conditions = (status?.conditions ?? []) as Array<Record<string, unknown>>;

  const readyCondition = conditions.find((c) => c.type === 'Ready');
  if (readyCondition) {
    const condStatus = String(readyCondition.status ?? '');
    if (condStatus === 'True') {
      return { status: 'healthy', reason: 'Ready' };
    }
    if (condStatus === 'False') {
      return { status: 'error', reason: String(readyCondition.reason ?? 'Not Ready') };
    }
    if (condStatus === 'Unknown') {
      return { status: 'unknown', reason: 'Status unknown' };
    }
  }

  // Fallback to checking phase
  const phase = status?.phase;
  if (phase) {
    const phaseStr = String(phase).toLowerCase();
    if (phaseStr === 'active' || phaseStr === 'running' || phaseStr === 'bound') {
      return { status: 'healthy', reason: String(phase) };
    }
    if (phaseStr === 'pending') {
      return { status: 'pending', reason: String(phase) };
    }
    if (phaseStr === 'failed' || phaseStr === 'error') {
      return { status: 'error', reason: String(phase) };
    }
  }

  return { status: 'unknown', reason: 'Unknown' };
}

// Pod status detection
export function getPodStatus(pod: K8sResource): {
  phase: string;
  reason?: string;
  ready: boolean;
  restartCount: number;
  containerStatuses: Array<{
    name: string;
    ready: boolean;
    state: 'running' | 'waiting' | 'terminated';
    reason?: string;
    restartCount: number;
  }>;
} {
  const p = pod as Pod;
  const phase = p.status?.phase ?? 'Unknown';
  const reason = p.status?.reason;

  const allStatuses = [
    ...(p.status?.containerStatuses ?? []),
    ...(p.status?.initContainerStatuses ?? []),
  ];

  const parsedStatuses = allStatuses.map((cs) => {
    const name = cs.name;
    const ready = cs.ready;
    const restartCount = cs.restartCount;

    let state: 'running' | 'waiting' | 'terminated' = 'waiting';
    let stateReason: string | undefined;

    if (cs.state) {
      if (cs.state.running) {
        state = 'running';
      } else if (cs.state.waiting) {
        state = 'waiting';
        stateReason = cs.state.waiting.reason ?? '';
      } else if (cs.state.terminated) {
        state = 'terminated';
        stateReason = cs.state.terminated.reason ?? '';
      }
    }

    return { name, ready, state, reason: stateReason, restartCount };
  });

  const ready = parsedStatuses.length > 0 && parsedStatuses.every((s) => s.ready);
  const totalRestarts = parsedStatuses.reduce((sum, s) => sum + s.restartCount, 0);

  // Check for specific failure reasons
  const failedContainer = parsedStatuses.find(
    (s) => s.state === 'waiting' && s.reason && s.reason !== 'ContainerCreating'
  );

  return {
    phase,
    reason: failedContainer?.reason ?? reason,
    ready,
    restartCount: totalRestarts,
    containerStatuses: parsedStatuses,
  };
}

// Deployment status detection
export function getDeploymentStatus(deployment: K8sResource): {
  ready: number;
  desired: number;
  available: boolean;
  progressing: boolean;
} {
  const d = deployment as Deployment;

  const desired = d.spec?.replicas ?? 0;
  const ready = d.status?.readyReplicas ?? d.status?.availableReplicas ?? 0;
  const available = ready === desired && desired > 0;

  const conditions = d.status?.conditions ?? [];
  const progressingCondition = conditions.find((c) => c.type === 'Progressing');
  const progressing = progressingCondition?.status === 'True';

  return { ready, desired, available, progressing };
}

// Node status detection
export function getNodeStatus(node: K8sResource): {
  ready: boolean;
  conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
  roles: string[];
  pressure: { disk: boolean; memory: boolean; pid: boolean };
} {
  const n = node as Node;
  const labels = n.metadata.labels ?? {};

  const conditions = (n.status?.conditions ?? []).map((c) => ({
    type: c.type,
    status: c.status,
    reason: c.reason,
    message: c.message,
  }));

  const readyCondition = conditions.find((c) => c.type === 'Ready');
  const ready = readyCondition ? readyCondition.status === 'True' : false;

  // Extract roles from labels
  const roles: string[] = [];
  for (const key of Object.keys(labels)) {
    if (key.startsWith('node-role.kubernetes.io/')) {
      roles.push(key.replace('node-role.kubernetes.io/', ''));
    }
  }

  // Check for pressure conditions
  const diskPressure = conditions.find((c) => c.type === 'DiskPressure')?.status === 'True';
  const memoryPressure = conditions.find((c) => c.type === 'MemoryPressure')?.status === 'True';
  const pidPressure = conditions.find((c) => c.type === 'PIDPressure')?.status === 'True';

  return {
    ready,
    conditions,
    roles,
    pressure: {
      disk: diskPressure ?? false,
      memory: memoryPressure ?? false,
      pid: pidPressure ?? false,
    },
  };
}

// Status color mapping
export function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'healthy' || s === 'running' || s === 'ready' || s === 'active' || s === 'succeeded') {
    return 'text-green-600';
  }
  if (s === 'warning' || s === 'pending' || s === 'progressing') {
    return 'text-amber-600';
  }
  if (s === 'error' || s === 'failed' || s === 'crashloopbackoff') {
    return 'text-red-600';
  }
  if (s === 'terminating') {
    return 'text-orange-600';
  }
  return 'text-gray-600';
}

// Status icon mapping (lucide icon names)
export function statusIcon(status: string): string {
  const s = status.toLowerCase();
  if (s === 'healthy' || s === 'running' || s === 'ready' || s === 'active' || s === 'succeeded') {
    return 'check-circle';
  }
  if (s === 'warning' || s === 'pending' || s === 'progressing') {
    return 'alert-circle';
  }
  if (s === 'error' || s === 'failed' || s === 'crashloopbackoff') {
    return 'x-circle';
  }
  if (s === 'terminating') {
    return 'loader';
  }
  return 'help-circle';
}
