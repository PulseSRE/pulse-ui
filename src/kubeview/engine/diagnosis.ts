/**
 * Rule-Based Auto-Diagnosis
 * Analyzes Kubernetes resources to identify issues and suggest fixes.
 */

import type { K8sResource } from './renderers/index';

export interface Diagnosis {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  suggestion?: string;
  fix?: {
    label: string;
    patch: unknown;
    patchTarget: string;
    patchType?: string;
  };
}

export interface NeedsAttentionItem {
  resource: K8sResource;
  resourceType: string;  // GVR key
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  timestamp?: string;
}

interface PodStatus {
  phase?: string;
  conditions?: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  containerStatuses?: Array<{
    name: string;
    state?: {
      waiting?: {
        reason: string;
        message?: string;
      };
      running?: {
        startedAt: string;
      };
      terminated?: {
        reason: string;
        exitCode: number;
        message?: string;
      };
    };
    lastState?: {
      terminated?: {
        reason: string;
        exitCode: number;
        message?: string;
      };
    };
    restartCount: number;
  }>;
  initContainerStatuses?: Array<{
    name: string;
    state?: {
      waiting?: {
        reason: string;
        message?: string;
      };
      running?: {
        startedAt: string;
      };
      terminated?: {
        reason: string;
        exitCode: number;
        message?: string;
      };
    };
    lastState?: {
      terminated?: {
        reason: string;
        exitCode: number;
        message?: string;
      };
    };
    restartCount: number;
  }>;
}

interface DeploymentStatus {
  conditions?: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  replicas?: number;
  availableReplicas?: number;
  unavailableReplicas?: number;
}

interface PVCStatus {
  phase?: string;
  conditions?: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
}

interface NodeStatus {
  conditions?: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
}

/**
 * Diagnose a single resource
 */
export function diagnoseResource(resource: K8sResource): Diagnosis[] {
  const diagnoses: Diagnosis[] = [];

  switch (resource.kind) {
    case 'Pod':
      diagnoses.push(...diagnosePod(resource));
      break;
    case 'Deployment':
      diagnoses.push(...diagnoseDeployment(resource));
      break;
    case 'PersistentVolumeClaim':
      diagnoses.push(...diagnosePVC(resource));
      break;
    case 'Node':
      diagnoses.push(...diagnoseNode(resource));
      break;
    case 'Secret':
      diagnoses.push(...diagnoseCertificate(resource));
      break;
  }

  return diagnoses;
}

/**
 * Diagnose Pod issues
 */
function diagnosePod(resource: K8sResource): Diagnosis[] {
  const diagnoses: Diagnosis[] = [];
  const status = resource.status as PodStatus | undefined;
  const spec = resource.spec as { containers?: Array<{ resources?: { limits?: { memory?: string } } }> } | undefined;

  if (!status) return diagnoses;

  // Check container statuses
  const allContainerStatuses = [
    ...(status.containerStatuses || []),
    ...(status.initContainerStatuses || []),
  ];

  for (const containerStatus of allContainerStatuses) {
    const { state, lastState, name, restartCount } = containerStatus;

    // CrashLoopBackOff
    if (state?.waiting?.reason === 'CrashLoopBackOff') {
      diagnoses.push({
        severity: 'critical',
        title: `Container ${name} is in CrashLoopBackOff`,
        detail: state.waiting.message || 'Container is crashing repeatedly',
        suggestion: 'Check container logs for errors. Common causes: missing dependencies, configuration errors, or application bugs.',
      });
    }

    // ImagePullBackOff
    if (state?.waiting?.reason === 'ImagePullBackOff' || state?.waiting?.reason === 'ErrImagePull') {
      diagnoses.push({
        severity: 'critical',
        title: `Container ${name} cannot pull image`,
        detail: state.waiting.message || 'Failed to pull container image',
        suggestion: 'Check image name, registry credentials, and network connectivity. Ensure the image exists and you have access.',
      });
    }

    // OOMKilled
    if (lastState?.terminated?.reason === 'OOMKilled') {
      const currentMemoryLimit = spec?.containers?.find(c => (c as { name: string }).name === name)?.resources?.limits?.memory;

      diagnoses.push({
        severity: 'critical',
        title: `Container ${name} was killed due to OOM`,
        detail: `Container exceeded memory limit${currentMemoryLimit ? ` (${currentMemoryLimit})` : ''}`,
        suggestion: 'Increase memory limits or optimize memory usage in the application.',
        fix: currentMemoryLimit ? (() => {
          // Target the owning Deployment/StatefulSet, not the Pod (K8s rejects pod resource patches)
          const owner = (resource.metadata.ownerReferences || []).find(o => o.controller);
          if (!owner) return undefined;
          const ownerKind = owner.kind; // ReplicaSet, StatefulSet, etc.
          // For ReplicaSet, target the parent Deployment
          const isRS = ownerKind === 'ReplicaSet';
          const targetKind = isRS ? 'deployments' : `${ownerKind.toLowerCase()}s`;
          const targetName = isRS ? owner.name.replace(/-[a-f0-9]+$/, '') : owner.name;
          const group = isRS || ownerKind === 'Deployment' || ownerKind === 'StatefulSet' ? 'apps' : '';
          const basePath = group ? `/apis/${group}/v1` : '/api/v1';
          return {
            label: 'Increase memory limit',
            patch: {
              spec: {
                template: {
                  spec: {
                    containers: [{ name, resources: { limits: { memory: increaseMemory(currentMemoryLimit) } } }],
                  },
                },
              },
            },
            patchTarget: `${basePath}/namespaces/${resource.metadata.namespace}/${targetKind}/${targetName}`,
            patchType: 'application/strategic-merge-patch+json',
          };
        })() : undefined,
      });
    }

    // High restart count
    if (restartCount > 5) {
      diagnoses.push({
        severity: 'warning',
        title: `Container ${name} has restarted ${restartCount} times`,
        detail: 'Container is experiencing frequent restarts',
        suggestion: 'Investigate logs to identify the cause of restarts. Consider implementing health checks and liveness probes.',
      });
    }
  }

  // Pod pending
  if (status.phase === 'Pending') {
    const scheduledCondition = status.conditions?.find(c => c.type === 'PodScheduled');

    if (scheduledCondition?.status === 'False') {
      diagnoses.push({
        severity: 'critical',
        title: 'Pod cannot be scheduled',
        detail: scheduledCondition.message || 'No suitable node found',
        suggestion: 'Check node resources, taints/tolerations, node selectors, and affinity rules. Ensure cluster has enough capacity.',
      });
    }
  }

  return diagnoses;
}

/**
 * Diagnose Deployment issues
 */
function diagnoseDeployment(resource: K8sResource): Diagnosis[] {
  const diagnoses: Diagnosis[] = [];
  const status = resource.status as DeploymentStatus | undefined;

  if (!status) return diagnoses;

  // Check availability
  const availableCondition = status.conditions?.find(c => c.type === 'Available');

  if (availableCondition?.status === 'False') {
    diagnoses.push({
      severity: 'critical',
      title: 'Deployment is unavailable',
      detail: availableCondition.message || 'No replicas are available',
      suggestion: 'Check pod status and events. Common causes: image pull errors, insufficient resources, or application crashes.',
    });
  }

  // Check if replicas are unavailable
  if (status.unavailableReplicas && status.unavailableReplicas > 0) {
    diagnoses.push({
      severity: 'warning',
      title: `${status.unavailableReplicas} replica(s) unavailable`,
      detail: `${status.availableReplicas || 0} of ${status.replicas || 0} replicas are available`,
      suggestion: 'Check pod status for individual replica issues.',
    });
  }

  return diagnoses;
}

/**
 * Diagnose PVC issues
 */
function diagnosePVC(resource: K8sResource): Diagnosis[] {
  const diagnoses: Diagnosis[] = [];
  const status = resource.status as PVCStatus | undefined;

  if (!status) return diagnoses;

  // PVC pending
  if (status.phase === 'Pending') {
    diagnoses.push({
      severity: 'warning',
      title: 'PersistentVolumeClaim is pending',
      detail: 'Volume has not been bound',
      suggestion: 'Check if a suitable PersistentVolume exists or if the StorageClass can provision one. Verify storage class configuration and capacity.',
    });
  }

  return diagnoses;
}

/**
 * Diagnose Node issues
 */
function diagnoseNode(resource: K8sResource): Diagnosis[] {
  const diagnoses: Diagnosis[] = [];
  const status = resource.status as NodeStatus | undefined;

  if (!status || !status.conditions) return diagnoses;

  for (const condition of status.conditions) {
    // Node not ready
    if (condition.type === 'Ready' && condition.status !== 'True') {
      diagnoses.push({
        severity: 'critical',
        title: 'Node is not ready',
        detail: condition.message || 'Node is not accepting pods',
        suggestion: 'Check node status, kubelet logs, and system resources. Ensure the node can communicate with the control plane.',
      });
    }

    // Disk pressure
    if (condition.type === 'DiskPressure' && condition.status === 'True') {
      diagnoses.push({
        severity: 'critical',
        title: 'Node has disk pressure',
        detail: condition.message || 'Node is running out of disk space',
        suggestion: 'Free up disk space by removing unused images, logs, or evicting pods. Consider expanding disk capacity.',
      });
    }

    // Memory pressure
    if (condition.type === 'MemoryPressure' && condition.status === 'True') {
      diagnoses.push({
        severity: 'critical',
        title: 'Node has memory pressure',
        detail: condition.message || 'Node is running out of memory',
        suggestion: 'Evict pods, reduce memory usage, or add more memory to the node. Review pod resource limits.',
      });
    }

    // PID pressure
    if (condition.type === 'PIDPressure' && condition.status === 'True') {
      diagnoses.push({
        severity: 'warning',
        title: 'Node has PID pressure',
        detail: condition.message || 'Node is running out of process IDs',
        suggestion: 'Reduce the number of processes by evicting pods or increasing the PID limit.',
      });
    }
  }

  return diagnoses;
}

/**
 * Diagnose certificate expiration
 */
function diagnoseCertificate(resource: K8sResource): Diagnosis[] {
  const diagnoses: Diagnosis[] = [];

  // Check for cert-manager annotations
  const annotations = resource.metadata.annotations || {};
  const certExpiry = annotations['cert-manager.io/not-after'];

  if (certExpiry) {
    const expiryDate = new Date(certExpiry);
    const now = new Date();
    const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      diagnoses.push({
        severity: 'critical',
        title: 'Certificate has expired',
        detail: `Certificate expired on ${expiryDate.toLocaleDateString()}`,
        suggestion: 'Renew the certificate immediately to restore functionality.',
      });
    } else if (daysUntilExpiry < 7) {
      diagnoses.push({
        severity: 'critical',
        title: 'Certificate expiring soon',
        detail: `Certificate expires in ${daysUntilExpiry} day(s)`,
        suggestion: 'Renew the certificate to prevent service disruption.',
      });
    } else if (daysUntilExpiry < 30) {
      diagnoses.push({
        severity: 'warning',
        title: 'Certificate expiring soon',
        detail: `Certificate expires in ${daysUntilExpiry} day(s)`,
        suggestion: 'Plan to renew the certificate before it expires.',
      });
    }
  }

  return diagnoses;
}

/**
 * Find all resources that need attention
 */
export function findNeedsAttention(resources: K8sResource[]): NeedsAttentionItem[] {
  const items: NeedsAttentionItem[] = [];

  for (const resource of resources) {
    // Skip installer pods and job-owned pods (expected completions)
    if (resource.kind === 'Pod') {
      const name = resource.metadata.name;
      const owners = resource.metadata.ownerReferences || [];
      if (name.startsWith('installer-') || name.startsWith('revision-pruner-') || owners.some((o) => o.kind === 'Job')) {
        const phase = (resource.status as any)?.phase;
        if (phase === 'Failed' || phase === 'Succeeded') continue;
      }
    }

    const diagnoses = diagnoseResource(resource);

    for (const diagnosis of diagnoses) {
      if (diagnosis.severity === 'critical' || diagnosis.severity === 'warning') {
        items.push({
          resource,
          resourceType: `${resource.apiVersion}/${resource.kind}`,
          severity: diagnosis.severity,
          title: diagnosis.title,
          detail: diagnosis.detail,
          timestamp: resource.metadata.creationTimestamp,
        });
      }
    }
  }

  return items;
}

/**
 * Helper: Increase memory limit
 */
function increaseMemory(current: string): string {
  const match = current.match(/^(\d+)([A-Za-z]+)$/);
  if (!match) return current;

  const [, value, unit] = match;
  const numValue = parseInt(value, 10);

  // Increase by 50%
  const newValue = Math.ceil(numValue * 1.5);

  return `${newValue}${unit}`;
}

/**
 * Get diagnosis summary for a resource
 */
export function getDiagnosisSummary(resource: K8sResource): {
  critical: number;
  warning: number;
  info: number;
} {
  const diagnoses = diagnoseResource(resource);

  return {
    critical: diagnoses.filter(d => d.severity === 'critical').length,
    warning: diagnoses.filter(d => d.severity === 'warning').length,
    info: diagnoses.filter(d => d.severity === 'info').length,
  };
}

/**
 * Check if a resource needs attention
 */
export function needsAttention(resource: K8sResource): boolean {
  const summary = getDiagnosisSummary(resource);
  return summary.critical > 0 || summary.warning > 0;
}
