/**
 * Rule-Based Auto-Diagnosis
 * Analyzes Kubernetes resources to identify issues and suggest fixes.
 */

import type { K8sResource } from './renderers/index';
import type { PersistentVolumeClaim } from './types';

export interface Diagnosis {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  suggestion?: string;
  logSnippet?: string;
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

  // PVC pending — show specific details about what's requested
  if (status.phase === 'Pending') {
    const spec = resource.spec as PersistentVolumeClaim['spec'];
    const storageClassName = spec?.storageClassName || '';
    const accessModes = (spec?.accessModes || []).join(', ') || 'not specified';
    const requestedStorage = spec?.resources?.requests?.storage || 'not specified';
    const volumeName = spec?.volumeName;

    let detail = `Requested: ${requestedStorage}, Access: ${accessModes}, Class: ${storageClassName || '(default)'}`;
    let suggestion = '';

    if (volumeName) {
      detail += `. Waiting for PV "${volumeName}"`;
      suggestion = `This PVC is waiting for a specific PV named "${volumeName}". Check: 1) Does the PV exist? Go to Storage page → PVs 2) Is it in "Available" status? 3) Do accessModes and capacity match?`;
    } else if (!storageClassName) {
      suggestion = 'No StorageClass specified and no default StorageClass is set. Fix: 1) Go to Storage page and check if a default StorageClass exists 2) Add storageClassName to the PVC spec via Edit YAML 3) Or set a default StorageClass in Admin → Cluster Config';
    } else {
      suggestion = `StorageClass "${storageClassName}" should auto-provision a volume. If stuck: 1) Check the Storage page — does this StorageClass exist? 2) Is the CSI driver running? 3) If binding mode is WaitForFirstConsumer, the PVC only binds when a Pod uses it 4) Check cloud provider quotas`;
    }

    diagnoses.push({
      severity: 'warning',
      title: 'PersistentVolumeClaim is pending',
      detail,
      suggestion,
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
        const phase = (resource.status as PodStatus | undefined)?.phase;
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

// --- Log-based error patterns ---

interface LogPattern {
  pattern: RegExp;
  title: string;
  suggestion: string;
}

const LOG_ERROR_PATTERNS: LogPattern[] = [
  { pattern: /permission denied/i, title: 'Permission denied', suggestion: 'The container is trying to access a path it does not have permission for. On OpenShift, containers run as a random non-root UID. Use an image that supports running as non-root (e.g. nginxinc/nginx-unprivileged), or add a SecurityContextConstraint (SCC) that allows the required access.' },
  { pattern: /bind.*address already in use/i, title: 'Port already in use', suggestion: 'Another process in the container is already listening on this port, or the port is privileged (<1024). Use a non-privileged port (e.g. 8080) or configure the container to run as root with an appropriate SCC.' },
  { pattern: /no such file or directory/i, title: 'File or directory not found', suggestion: 'The container is trying to access a file that does not exist. Check volume mounts, config maps, and the container image entrypoint.' },
  { pattern: /connection refused|ECONNREFUSED/i, title: 'Connection refused', suggestion: 'The application cannot connect to a required service. Check that dependent services (databases, APIs) are running and the connection URL/port is correct.' },
  { pattern: /exec format error/i, title: 'Wrong architecture', suggestion: 'The container image was built for a different CPU architecture (e.g. amd64 image on arm64 node). Use a multi-arch image or build for the correct platform.' },
  { pattern: /oom|out of memory|cannot allocate memory/i, title: 'Out of memory', suggestion: 'The process is running out of memory. Increase the container memory limit in the deployment spec, or optimize the application memory usage.' },
  { pattern: /certificate.*expired|x509.*certificate/i, title: 'TLS certificate error', suggestion: 'A TLS certificate is expired or invalid. Check the certificate dates, CA trust, and ensure the correct certificate is mounted.' },
  { pattern: /name.*resolution|could not resolve|ENOTFOUND|dns.*fail/i, title: 'DNS resolution failure', suggestion: 'The container cannot resolve a hostname. Check that the target service exists, DNS is working, and the service name is correct.' },
  { pattern: /read-only file system/i, title: 'Read-only filesystem', suggestion: 'The container is trying to write to a read-only filesystem. Add a writable volume mount (emptyDir) for the directory, or use an image that writes to /tmp.' },
  { pattern: /operation not permitted/i, title: 'Operation not permitted', suggestion: 'The container lacks the required Linux capability. On OpenShift, most capabilities are dropped by default. Use an SCC that grants the needed capability, or modify the application to not require it.' },
];

/**
 * Fetch pod logs and analyze for common error patterns.
 * Returns enriched diagnoses with log snippets and specific suggestions.
 */
export async function enrichDiagnosesWithLogs(
  resource: K8sResource,
  diagnoses: Diagnosis[],
  fetchFn: (url: string) => Promise<string> = defaultLogFetch,
): Promise<Diagnosis[]> {
  // Enrich PVC diagnoses with events
  if (resource.kind === 'PersistentVolumeClaim' && resource.metadata.namespace) {
    const hasPending = diagnoses.some(d => d.title.includes('pending'));
    if (hasPending) {
      try {
        const fieldSelector = encodeURIComponent(`involvedObject.name=${resource.metadata.name},involvedObject.kind=PersistentVolumeClaim`);
        const eventsText = await fetchFn(
          `/api/kubernetes/api/v1/namespaces/${resource.metadata.namespace}/events?fieldSelector=${fieldSelector}`
        );
        const events = JSON.parse(eventsText);
        const items = events.items || [];
        // Find the most recent warning event
        const warnings = items.filter((e: any) => e.type === 'Warning').sort((a: any, b: any) =>
          new Date(b.lastTimestamp || b.firstTimestamp || 0).getTime() - new Date(a.lastTimestamp || a.firstTimestamp || 0).getTime()
        );
        if (warnings.length > 0) {
          const msg = warnings[0].message || '';
          const reason = warnings[0].reason || '';
          return diagnoses.map(d => {
            if (!d.title.includes('pending')) return d;
            return {
              ...d,
              detail: d.detail + `. Event: ${reason}`,
              logSnippet: msg,
              suggestion: reason === 'ProvisioningFailed'
                ? `Provisioning failed: ${msg}. Check if the StorageClass provisioner is running and has capacity.`
                : reason === 'FailedBinding'
                  ? `No matching PV found. Check Storage → PVs for available volumes with matching accessModes and capacity.`
                  : msg.includes('storageclass')
                    ? `StorageClass issue: ${msg}. Go to Storage page to verify the StorageClass exists.`
                    : msg.includes('WaitForFirstConsumer')
                      ? 'This PVC uses WaitForFirstConsumer binding. It will bind automatically when a Pod that uses it is scheduled.'
                      : d.suggestion,
            };
          });
        }
      } catch {
        // Events fetch failed — return original diagnoses
      }
    }
    return diagnoses;
  }

  if (resource.kind !== 'Pod' || !resource.metadata.namespace) return diagnoses;

  // Enrich Pending pod diagnoses with scheduling events
  const hasPending = diagnoses.some(d => d.title.includes('Pending') || d.title.includes('scheduling') || d.title.includes('Unschedulable'));
  if (hasPending) {
    try {
      const fieldSelector = encodeURIComponent(`involvedObject.name=${resource.metadata.name},involvedObject.kind=Pod`);
      const eventsText = await fetchFn(
        `/api/kubernetes/api/v1/namespaces/${resource.metadata.namespace}/events?fieldSelector=${fieldSelector}`
      );
      const events = JSON.parse(eventsText);
      const warnings = (events.items || []).filter((e: any) => e.type === 'Warning').sort((a: any, b: any) =>
        new Date(b.lastTimestamp || b.firstTimestamp || 0).getTime() - new Date(a.lastTimestamp || a.firstTimestamp || 0).getTime()
      );
      if (warnings.length > 0) {
        const msg = warnings[0].message || '';
        const reason = warnings[0].reason || '';
        diagnoses = diagnoses.map(d => {
          if (!d.title.includes('Pending') && !d.title.includes('scheduling') && !d.title.includes('Unschedulable')) return d;
          return {
            ...d,
            detail: d.detail + `. Event: ${reason}`,
            logSnippet: msg,
            suggestion: reason === 'FailedScheduling'
              ? msg.includes('Insufficient cpu') ? 'Not enough CPU on any node. Scale up nodes or reduce resource requests.'
                : msg.includes('Insufficient memory') ? 'Not enough memory on any node. Scale up nodes or reduce resource requests.'
                : msg.includes('node(s) had untolerated taint') ? 'Pods cannot tolerate node taints. Add tolerations or remove taints.'
                : `Scheduling failed: ${msg}`
              : d.suggestion,
          };
        });
      }
    } catch {
      // Events fetch failed
    }
  }

  // Only fetch logs for pods with crashes or errors
  const hasCrash = diagnoses.some(d =>
    d.title.includes('CrashLoopBackOff') ||
    d.title.includes('OOM') ||
    d.title.includes('restarted') ||
    d.detail.includes('crashing')
  );
  if (!hasCrash) return diagnoses;

  try {
    // Try current logs first, then previous
    let logText = await fetchFn(
      `/api/kubernetes/api/v1/namespaces/${resource.metadata.namespace}/pods/${resource.metadata.name}/log?tailLines=50`
    );
    if (!logText.trim()) {
      logText = await fetchFn(
        `/api/kubernetes/api/v1/namespaces/${resource.metadata.namespace}/pods/${resource.metadata.name}/log?tailLines=50&previous=true`
      );
    }
    if (!logText.trim()) return diagnoses;

    // Extract error lines
    const lines = logText.split('\n');
    const errorLines = lines.filter(l => /error|fatal|panic|emerg|permission denied|failed|exception/i.test(l));
    const lastErrors = errorLines.slice(-5).join('\n');

    // Match against known patterns
    const enriched = diagnoses.map(d => {
      if (!d.title.includes('CrashLoopBackOff') && !d.title.includes('restarted')) return d;

      for (const pattern of LOG_ERROR_PATTERNS) {
        if (pattern.pattern.test(logText)) {
          return {
            ...d,
            title: `${d.title} — ${pattern.title}`,
            suggestion: pattern.suggestion,
            logSnippet: lastErrors || undefined,
          };
        }
      }

      // No pattern matched — still show the error lines
      if (lastErrors) {
        return {
          ...d,
          logSnippet: lastErrors,
          suggestion: d.suggestion + ' See log errors below.',
        };
      }
      return d;
    });

    return enriched;
  } catch {
    return diagnoses;
  }
}

async function defaultLogFetch(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) return '';
  return res.text();
}
