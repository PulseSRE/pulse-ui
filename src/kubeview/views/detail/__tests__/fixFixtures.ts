/** Pods and owners for the guided-fix tests, one scenario per fix kind. */
const MiB = 1024 * 1024;

export function deployment(container: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: 'apps/v1', kind: 'Deployment',
    metadata: { name: 'api', namespace: 'payments', uid: 'd1', resourceVersion: '777', generation: 14, annotations: { 'deployment.kubernetes.io/revision': '14' } },
    spec: {
      replicas: 3, selector: { matchLabels: { app: 'api' } },
      strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: '25%' } },
      template: { metadata: { labels: { app: 'api' } }, spec: { containers: [{ name: 'api', image: 'quay.io/acme/api:1.8.2', ...container }] } },
    },
    status: { replicas: 3, updatedReplicas: 3, availableReplicas: 2, observedGeneration: 14 },
    ...extra,
  };
}

export function pod(status: Record<string, unknown>, spec: Record<string, unknown> = {}) {
  return {
    apiVersion: 'v1', kind: 'Pod',
    metadata: { name: 'api-7f9c4d-x2k8q', namespace: 'payments', ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'api-7f9c4d', controller: true }] },
    spec: { serviceAccountName: 'api-sa', containers: [{ name: 'api', image: 'quay.io/acme/api:1.8.2' }], ...spec },
    status: { phase: 'Running', containerStatuses: [{ name: 'api', ready: false, restartCount: 6, ...status }] },
  };
}

export const oomPod = () => pod({
  state: { waiting: { reason: 'CrashLoopBackOff' } },
  lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, startedAt: '2026-11-02T14:20:26Z', finishedAt: '2026-11-02T14:21:07Z' } },
});
export const oomOwner = () => deployment({ resources: { limits: { memory: '256Mi', cpu: '500m' }, requests: { memory: '128Mi', cpu: '250m' } } });
export const oomUsage = { state: 'ok' as const, memory: { api: 410 * MiB }, cpu: { api: 0.1 } };

export const livenessPod = () => pod({
  state: { waiting: { reason: 'CrashLoopBackOff' } },
  lastState: { terminated: { reason: 'Error', exitCode: 137, startedAt: '2026-11-02T14:20:00Z', finishedAt: '2026-11-02T14:20:35Z' } },
});
export const livenessOwner = () => deployment({ livenessProbe: { httpGet: { path: '/healthz', port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10, failureThreshold: 3 } });

export const cpuPod = () => pod({ state: { running: { startedAt: '2026-11-02T14:00:00Z' } }, restartCount: 0, ready: false });
export const cpuOwner = () => deployment({ resources: { limits: { cpu: '500m', memory: '1Gi' } } });
export const cpuUsage = { state: 'ok' as const, memory: { api: 300 * MiB }, cpu: { api: 0.49 } };

export const pullPod = () => pod({ restartCount: 0, state: { waiting: { reason: 'ImagePullBackOff', message: 'Back-off pulling image: unauthorized: authentication required' } } });

export const rollbackPod = () => pod({ state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'Error', exitCode: 1, startedAt: '2026-11-02T14:00:00Z', finishedAt: '2026-11-02T14:10:00Z' } } });
export const rollbackOwner = () => deployment({ image: 'quay.io/acme/api:1.9.0' });
export const replicaSets = () => [
  { apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: { name: 'api-old', namespace: 'payments', creationTimestamp: '2026-11-01T10:00:00Z', annotations: { 'deployment.kubernetes.io/revision': '13' }, ownerReferences: [{ kind: 'Deployment', name: 'api', uid: 'd1' }] }, spec: { replicas: 0, template: { metadata: { labels: { app: 'api', 'pod-template-hash': 'old' } }, spec: { containers: [{ name: 'api', image: 'quay.io/acme/api:1.8.2' }] } } }, status: {} },
  { apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: { name: 'api-7f9c4d', namespace: 'payments', creationTimestamp: '2026-11-02T14:01:00Z', annotations: { 'deployment.kubernetes.io/revision': '14' }, ownerReferences: [{ kind: 'Deployment', name: 'api', uid: 'd1' }] }, spec: { replicas: 3, template: { metadata: { labels: { app: 'api' } }, spec: { containers: [{ name: 'api', image: 'quay.io/acme/api:1.9.0' }] } } }, status: {} },
];
