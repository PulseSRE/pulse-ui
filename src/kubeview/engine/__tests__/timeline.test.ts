import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  alertsToTimeline,
  eventsToTimeline,
  rolloutsToTimeline,
  configChangesToTimeline,
  correlateEntries,
  filterByTimeRange,
} from '../timeline';
import type { Event, ReplicaSet, Deployment, ClusterVersion, ClusterOperator } from '../types';

// ── Alert fixtures ──

function makeAlertGroups() {
  return [
    {
      name: 'kubernetes-resources',
      rules: [
        {
          name: 'KubePodCrashLooping',
          query: 'rate(kube_pod_container_status_restarts_total[15m]) > 0',
          state: 'firing',
          alerts: [
            {
              labels: {
                severity: 'critical',
                namespace: 'production',
                pod: 'api-server-7b9f4d6c8-x2k4n',
              },
              annotations: {
                description: 'Pod production/api-server-7b9f4d6c8-x2k4n is crash looping.',
              },
              state: 'firing' as const,
              activeAt: '2026-03-24T10:00:00Z',
            },
            {
              labels: {
                severity: 'critical',
                namespace: 'staging',
                pod: 'worker-5f8c9d7b2-m3j8p',
              },
              annotations: {
                message: 'Pod staging/worker-5f8c9d7b2-m3j8p restarting too frequently.',
              },
              state: 'pending' as const,
              activeAt: '2026-03-24T10:05:00Z',
            },
            {
              labels: { severity: 'warning', namespace: 'default' },
              annotations: {},
              state: 'inactive' as const,
            },
          ],
          labels: { severity: 'critical' },
          annotations: { description: 'Pod is crash looping.' },
        },
        {
          name: 'KubeDeploymentReplicasMismatch',
          query: 'kube_deployment_spec_replicas != kube_deployment_status_ready_replicas',
          state: 'firing',
          alerts: [
            {
              labels: {
                severity: 'warning',
                namespace: 'production',
                deployment: 'frontend',
              },
              annotations: {
                description: 'Deployment production/frontend has 2/3 replicas ready.',
              },
              state: 'firing' as const,
              activeAt: '2026-03-24T09:30:00Z',
            },
          ],
          labels: {},
          annotations: { description: 'Deployment replicas mismatch.' },
        },
      ],
    },
    {
      name: 'node-alerts',
      rules: [
        {
          name: 'NodeNotReady',
          query: 'kube_node_status_condition{condition="Ready",status="true"} == 0',
          state: 'firing',
          alerts: [
            {
              labels: {
                severity: 'critical',
                node: 'worker-03.example.com',
              },
              annotations: {
                description: 'Node worker-03.example.com is not ready.',
              },
              state: 'firing' as const,
              activeAt: '2026-03-24T08:15:00Z',
            },
          ],
          labels: { severity: 'critical' },
          annotations: {},
        },
        {
          name: 'NodeDiskPressure',
          query: 'kube_node_status_condition{condition="DiskPressure",status="true"} == 1',
          state: 'firing',
          alerts: [
            {
              labels: {
                node: 'worker-01.example.com',
              },
              annotations: {},
              state: 'firing' as const,
              activeAt: '2026-03-24T11:00:00Z',
            },
          ],
          labels: {},
          annotations: {},
        },
      ],
    },
  ];
}

// ── Event fixtures ──

function makeEvents(): Event[] {
  return [
    {
      apiVersion: 'v1',
      kind: 'Event',
      metadata: {
        name: 'api-server-7b9f4d6c8-x2k4n.17a3f2e1',
        namespace: 'production',
        uid: 'evt-uid-001',
        creationTimestamp: '2026-03-24T10:00:05Z',
      },
      involvedObject: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'api-server-7b9f4d6c8-x2k4n',
        namespace: 'production',
      },
      reason: 'BackOff',
      message: 'Back-off restarting failed container',
      type: 'Warning',
      count: 5,
      firstTimestamp: '2026-03-24T09:50:00Z',
      lastTimestamp: '2026-03-24T10:00:05Z',
    },
    {
      apiVersion: 'v1',
      kind: 'Event',
      metadata: {
        name: 'frontend-deploy.17a3f300',
        namespace: 'production',
        uid: 'evt-uid-002',
        creationTimestamp: '2026-03-24T09:30:00Z',
      },
      involvedObject: {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        name: 'frontend',
        namespace: 'production',
      },
      reason: 'ScalingReplicaSet',
      message: 'Scaled up replica set frontend-6c9d4f8b7 to 3',
      type: 'Normal',
      firstTimestamp: '2026-03-24T09:30:00Z',
      lastTimestamp: '2026-03-24T09:30:00Z',
    },
    {
      apiVersion: 'v1',
      kind: 'Event',
      metadata: {
        name: 'worker-pod.failed-mount',
        namespace: 'staging',
        uid: 'evt-uid-003',
        creationTimestamp: '2026-03-24T10:10:00Z',
      },
      involvedObject: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'worker-5f8c9d7b2-m3j8p',
        namespace: 'staging',
      },
      reason: 'FailedMount',
      message: 'Unable to attach or mount volumes: timed out waiting for the condition',
      type: 'Warning',
      firstTimestamp: '2026-03-24T10:10:00Z',
      lastTimestamp: '2026-03-24T10:10:00Z',
    },
    {
      apiVersion: 'v1',
      kind: 'Event',
      metadata: {
        name: 'node-kubelet.17a3f444',
        namespace: '',
        uid: 'evt-uid-004',
        creationTimestamp: '2026-03-24T08:15:10Z',
      },
      involvedObject: {
        apiVersion: 'v1',
        kind: 'Node',
        name: 'worker-03.example.com',
      },
      reason: 'KilledContainer',
      message: 'Container runtime killed container due to OOM',
      type: 'Warning',
      firstTimestamp: '2026-03-24T08:15:10Z',
      lastTimestamp: '2026-03-24T08:15:10Z',
    },
  ];
}

// ── ReplicaSet + Deployment fixtures ──

function makeDeployments(): Deployment[] {
  return [
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: 'frontend',
        namespace: 'production',
        uid: 'deploy-uid-001',
        creationTimestamp: '2026-03-20T12:00:00Z',
      },
      spec: {
        replicas: 3,
        selector: { matchLabels: { app: 'frontend' } },
        template: {
          metadata: { labels: { app: 'frontend' } },
          spec: {
            containers: [{ name: 'nginx', image: 'registry.example.com/frontend:v2.1.0' }],
          },
        },
      },
      status: {
        replicas: 3,
        readyReplicas: 3,
        availableReplicas: 3,
      },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: 'api-server',
        namespace: 'production',
        uid: 'deploy-uid-002',
        creationTimestamp: '2026-03-18T08:00:00Z',
      },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: 'api-server' } },
        template: {
          metadata: { labels: { app: 'api-server' } },
          spec: {
            containers: [{ name: 'api', image: 'registry.example.com/api:v3.0.1' }],
          },
        },
      },
      status: {
        replicas: 2,
        readyReplicas: 1,
        availableReplicas: 1,
        unavailableReplicas: 1,
      },
    },
  ];
}

function makeReplicaSets(): ReplicaSet[] {
  return [
    {
      apiVersion: 'apps/v1',
      kind: 'ReplicaSet',
      metadata: {
        name: 'frontend-6c9d4f8b7',
        namespace: 'production',
        uid: 'rs-uid-001',
        creationTimestamp: '2026-03-24T09:30:00Z',
        annotations: { 'deployment.kubernetes.io/revision': '3' },
        ownerReferences: [
          { apiVersion: 'apps/v1', kind: 'Deployment', name: 'frontend', uid: 'deploy-uid-001', controller: true },
        ],
      },
      spec: {
        replicas: 3,
        selector: { matchLabels: { app: 'frontend', 'pod-template-hash': '6c9d4f8b7' } },
        template: {
          metadata: { labels: { app: 'frontend', 'pod-template-hash': '6c9d4f8b7' } },
          spec: {
            containers: [{ name: 'nginx', image: 'registry.example.com/frontend:v2.1.0' }],
          },
        },
      },
      status: {
        replicas: 3,
        readyReplicas: 3,
        availableReplicas: 3,
      },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'ReplicaSet',
      metadata: {
        name: 'frontend-5a8b3c7d2',
        namespace: 'production',
        uid: 'rs-uid-002',
        creationTimestamp: '2026-03-22T14:00:00Z',
        annotations: { 'deployment.kubernetes.io/revision': '2' },
        ownerReferences: [
          { apiVersion: 'apps/v1', kind: 'Deployment', name: 'frontend', uid: 'deploy-uid-001', controller: true },
        ],
      },
      spec: {
        replicas: 0,
        selector: { matchLabels: { app: 'frontend', 'pod-template-hash': '5a8b3c7d2' } },
        template: {
          metadata: { labels: { app: 'frontend', 'pod-template-hash': '5a8b3c7d2' } },
          spec: {
            containers: [{ name: 'nginx', image: 'registry.example.com/frontend:v2.0.0' }],
          },
        },
      },
      status: {
        replicas: 0,
        readyReplicas: 0,
        availableReplicas: 0,
      },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'ReplicaSet',
      metadata: {
        name: 'api-server-8d7e6f5c4',
        namespace: 'production',
        uid: 'rs-uid-003',
        creationTimestamp: '2026-03-24T10:00:00Z',
        annotations: { 'deployment.kubernetes.io/revision': '5' },
        ownerReferences: [
          { apiVersion: 'apps/v1', kind: 'Deployment', name: 'api-server', uid: 'deploy-uid-002', controller: true },
        ],
      },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: 'api-server', 'pod-template-hash': '8d7e6f5c4' } },
        template: {
          metadata: { labels: { app: 'api-server', 'pod-template-hash': '8d7e6f5c4' } },
          spec: {
            containers: [{ name: 'api', image: 'registry.example.com/api:v3.0.1' }],
          },
        },
      },
      status: {
        replicas: 2,
        readyReplicas: 0,
        availableReplicas: 0,
      },
    },
    // Orphan ReplicaSet — no owner reference, should be filtered out
    {
      apiVersion: 'apps/v1',
      kind: 'ReplicaSet',
      metadata: {
        name: 'orphan-rs-9x8y7z6',
        namespace: 'default',
        uid: 'rs-uid-004',
        creationTimestamp: '2026-03-23T12:00:00Z',
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: 'orphan' } },
        template: {
          metadata: { labels: { app: 'orphan' } },
          spec: {
            containers: [{ name: 'orphan', image: 'busybox:latest' }],
          },
        },
      },
      status: { replicas: 1, readyReplicas: 1 },
    },
  ];
}

// ── ClusterVersion + ClusterOperator fixtures ──

function makeClusterVersion(): ClusterVersion {
  return {
    apiVersion: 'config.openshift.io/v1',
    kind: 'ClusterVersion',
    metadata: {
      name: 'version',
      uid: 'cv-uid-001',
      creationTimestamp: '2025-06-01T00:00:00Z',
    },
    status: {
      desired: { version: '4.16.5', image: 'quay.io/openshift-release-dev/ocp-release:4.16.5-x86_64' },
      history: [
        {
          state: 'Completed',
          version: '4.16.5',
          startedTime: '2026-03-23T02:00:00Z',
          completionTime: '2026-03-23T03:15:00Z',
          image: 'quay.io/openshift-release-dev/ocp-release:4.16.5-x86_64',
        },
        {
          state: 'Completed',
          version: '4.16.4',
          startedTime: '2026-03-10T01:00:00Z',
          completionTime: '2026-03-10T02:30:00Z',
          image: 'quay.io/openshift-release-dev/ocp-release:4.16.4-x86_64',
        },
        {
          state: 'Partial',
          version: '4.16.3',
          startedTime: '2026-02-28T01:00:00Z',
        },
      ],
    },
  };
}

function makeClusterOperators(): ClusterOperator[] {
  return [
    {
      apiVersion: 'config.openshift.io/v1',
      kind: 'ClusterOperator',
      metadata: {
        name: 'kube-apiserver',
        uid: 'co-uid-001',
        creationTimestamp: '2025-06-01T00:00:00Z',
      },
      status: {
        conditions: [
          {
            type: 'Available',
            status: 'True',
            lastTransitionTime: '2026-03-23T03:20:00Z',
            reason: 'AsExpected',
            message: 'All replicas available',
          },
          {
            type: 'Degraded',
            status: 'True',
            lastTransitionTime: '2026-03-24T06:00:00Z',
            reason: 'NodeControllerDegraded',
            message: 'Node worker-03.example.com is not ready',
          },
          {
            type: 'Progressing',
            status: 'False',
            lastTransitionTime: '2026-03-23T03:20:00Z',
            reason: 'AsExpected',
          },
        ],
      },
    },
    {
      apiVersion: 'config.openshift.io/v1',
      kind: 'ClusterOperator',
      metadata: {
        name: 'ingress',
        uid: 'co-uid-002',
        creationTimestamp: '2025-06-01T00:00:00Z',
      },
      status: {
        conditions: [
          {
            type: 'Available',
            status: 'True',
            lastTransitionTime: '2026-03-20T12:00:00Z',
          },
          {
            type: 'Progressing',
            status: 'True',
            lastTransitionTime: '2026-03-24T09:00:00Z',
            reason: 'IngressControllerProgressing',
            message: 'Updating router deployment',
          },
          {
            type: 'Degraded',
            status: 'False',
            lastTransitionTime: '2026-03-20T12:00:00Z',
          },
        ],
      },
    },
    {
      apiVersion: 'config.openshift.io/v1',
      kind: 'ClusterOperator',
      metadata: {
        name: 'monitoring',
        uid: 'co-uid-003',
        creationTimestamp: '2025-06-01T00:00:00Z',
      },
      status: {
        conditions: [
          {
            type: 'Degraded',
            status: 'True',
            // Missing lastTransitionTime — should be excluded
            reason: 'PrometheusDown',
            message: 'Prometheus is not responding',
          },
        ],
      },
    },
  ];
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

describe('timeline engine', () => {
  describe('alertsToTimeline', () => {
    it('maps firing and pending alerts to TimelineEntry[], skipping inactive', () => {
      const entries = alertsToTimeline(makeAlertGroups());
      // 2 firing + 1 pending from first rule, 1 from second rule, 1 from NodeNotReady, 1 from NodeDiskPressure = 5
      // inactive one is excluded
      expect(entries).toHaveLength(5);
      expect(entries.every(e => e.category === 'alert')).toBe(true);
    });

    it('maps severity from alert labels', () => {
      const entries = alertsToTimeline(makeAlertGroups());
      const crashLoop = entries.find(e => e.title === 'KubePodCrashLooping' && e.namespace === 'production');
      expect(crashLoop?.severity).toBe('critical');

      const replicaMismatch = entries.find(e => e.title === 'KubeDeploymentReplicasMismatch');
      expect(replicaMismatch?.severity).toBe('warning');
    });

    it('falls back to rule-level severity when alert label is missing', () => {
      const entries = alertsToTimeline(makeAlertGroups());
      // NodeDiskPressure alert has no severity label, rule also has no severity label => defaults to warning
      const diskPressure = entries.find(e => e.title === 'NodeDiskPressure');
      expect(diskPressure?.severity).toBe('warning');
    });

    it('extracts pod resource reference from labels', () => {
      const entries = alertsToTimeline(makeAlertGroups());
      const crashLoop = entries.find(e => e.title === 'KubePodCrashLooping' && e.namespace === 'production');
      expect(crashLoop?.resource).toEqual({
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'api-server-7b9f4d6c8-x2k4n',
        namespace: 'production',
      });
    });

    it('extracts deployment resource reference from labels', () => {
      const entries = alertsToTimeline(makeAlertGroups());
      const replicaMismatch = entries.find(e => e.title === 'KubeDeploymentReplicasMismatch');
      expect(replicaMismatch?.resource).toEqual({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        name: 'frontend',
        namespace: 'production',
      });
    });

    it('extracts node resource reference with apiVersion v1', () => {
      const entries = alertsToTimeline(makeAlertGroups());
      const nodeAlert = entries.find(e => e.title === 'NodeNotReady');
      expect(nodeAlert?.resource).toEqual({
        apiVersion: 'v1',
        kind: 'Node',
        name: 'worker-03.example.com',
        namespace: undefined,
      });
    });

    it('uses alert annotation description for detail, falling back to message', () => {
      const entries = alertsToTimeline(makeAlertGroups());
      const crashProd = entries.find(e => e.title === 'KubePodCrashLooping' && e.namespace === 'production');
      expect(crashProd?.detail).toBe('Pod production/api-server-7b9f4d6c8-x2k4n is crash looping.');

      const crashStaging = entries.find(e => e.title === 'KubePodCrashLooping' && e.namespace === 'staging');
      expect(crashStaging?.detail).toBe('Pod staging/worker-5f8c9d7b2-m3j8p restarting too frequently.');
    });

    it('builds correlation keys from resource kind/name/namespace', () => {
      const entries = alertsToTimeline(makeAlertGroups());
      const crashProd = entries.find(e => e.title === 'KubePodCrashLooping' && e.namespace === 'production');
      expect(crashProd?.correlationKey).toBe('Pod/api-server-7b9f4d6c8-x2k4n/production');

      const replicaMismatch = entries.find(e => e.title === 'KubeDeploymentReplicasMismatch');
      expect(replicaMismatch?.correlationKey).toBe('Deployment/frontend/production');
    });

    it('builds correlation key without namespace for cluster-scoped alerts', () => {
      const entries = alertsToTimeline(makeAlertGroups());
      const nodeAlert = entries.find(e => e.title === 'NodeNotReady');
      // No namespace label => ns is undefined => falls to else branch: Alert/ruleName
      expect(nodeAlert?.correlationKey).toBe('Alert/NodeNotReady');
    });

    it('uses timestamp from activeAt', () => {
      const entries = alertsToTimeline(makeAlertGroups());
      const crashProd = entries.find(e => e.title === 'KubePodCrashLooping' && e.namespace === 'production');
      expect(crashProd?.timestamp).toBe('2026-03-24T10:00:00Z');
    });

    it('sets source type to prometheus', () => {
      const entries = alertsToTimeline(makeAlertGroups());
      expect(entries.every(e => e.source.type === 'prometheus')).toBe(true);
    });

    it('returns empty array for empty input', () => {
      expect(alertsToTimeline([])).toEqual([]);
    });
  });

  describe('eventsToTimeline', () => {
    it('maps K8s events to TimelineEntry[]', () => {
      const entries = eventsToTimeline(makeEvents());
      expect(entries).toHaveLength(4);
      expect(entries.every(e => e.category === 'event')).toBe(true);
    });

    it('uses lastTimestamp as primary timestamp', () => {
      const entries = eventsToTimeline(makeEvents());
      const backoff = entries.find(e => e.title === 'BackOff');
      expect(backoff?.timestamp).toBe('2026-03-24T10:00:05Z');
    });

    it('maps Warning type to warning severity', () => {
      const entries = eventsToTimeline(makeEvents());
      const backoff = entries.find(e => e.title === 'BackOff');
      expect(backoff?.severity).toBe('warning');
    });

    it('maps Normal type to normal severity', () => {
      const entries = eventsToTimeline(makeEvents());
      const scaling = entries.find(e => e.title === 'ScalingReplicaSet');
      expect(scaling?.severity).toBe('normal');
    });

    it('marks Failed/Error/Kill reasons as warning severity', () => {
      const entries = eventsToTimeline(makeEvents());
      const failedMount = entries.find(e => e.title === 'FailedMount');
      expect(failedMount?.severity).toBe('warning');

      const killed = entries.find(e => e.title === 'KilledContainer');
      expect(killed?.severity).toBe('warning');
    });

    it('extracts involvedObject as resource reference', () => {
      const entries = eventsToTimeline(makeEvents());
      const backoff = entries.find(e => e.title === 'BackOff');
      expect(backoff?.resource).toEqual({
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'api-server-7b9f4d6c8-x2k4n',
        namespace: 'production',
      });
    });

    it('builds correlation key from involvedObject kind/name/namespace', () => {
      const entries = eventsToTimeline(makeEvents());
      const backoff = entries.find(e => e.title === 'BackOff');
      expect(backoff?.correlationKey).toBe('Pod/api-server-7b9f4d6c8-x2k4n/production');

      const nodeEvt = entries.find(e => e.title === 'KilledContainer');
      expect(nodeEvt?.correlationKey).toBe('Node/worker-03.example.com/_');
    });

    it('sets source type to k8s-event', () => {
      const entries = eventsToTimeline(makeEvents());
      expect(entries.every(e => e.source.type === 'k8s-event')).toBe(true);
    });

    it('uses event message as detail', () => {
      const entries = eventsToTimeline(makeEvents());
      const failedMount = entries.find(e => e.title === 'FailedMount');
      expect(failedMount?.detail).toBe('Unable to attach or mount volumes: timed out waiting for the condition');
    });

    it('filters out events with no timestamp at all', () => {
      const noTimestamp: Event = {
        apiVersion: 'v1',
        kind: 'Event',
        metadata: { name: 'ghost-event' },
        involvedObject: { apiVersion: 'v1', kind: 'Pod', name: 'ghost' },
      };
      const entries = eventsToTimeline([noTimestamp]);
      expect(entries).toHaveLength(0);
    });

    it('falls back to firstTimestamp when lastTimestamp is absent', () => {
      const event: Event = {
        apiVersion: 'v1',
        kind: 'Event',
        metadata: { name: 'first-only', uid: 'evt-first-only' },
        involvedObject: { apiVersion: 'v1', kind: 'Pod', name: 'test-pod', namespace: 'default' },
        reason: 'Pulled',
        message: 'Successfully pulled image',
        type: 'Normal',
        firstTimestamp: '2026-03-24T07:00:00Z',
      };
      const entries = eventsToTimeline([event]);
      expect(entries[0].timestamp).toBe('2026-03-24T07:00:00Z');
    });

    it('returns empty array for empty input', () => {
      expect(eventsToTimeline([])).toEqual([]);
    });
  });

  describe('rolloutsToTimeline', () => {
    it('maps owned ReplicaSets to TimelineEntry[], filtering orphans', () => {
      const entries = rolloutsToTimeline(makeReplicaSets(), makeDeployments());
      // 3 owned ReplicaSets, 1 orphan excluded
      expect(entries).toHaveLength(3);
      expect(entries.every(e => e.category === 'rollout')).toBe(true);
    });

    it('extracts revision from ReplicaSet annotations', () => {
      const entries = rolloutsToTimeline(makeReplicaSets(), makeDeployments());
      const rev3 = entries.find(e => e.id === 'rollout-rs-uid-001');
      expect(rev3?.title).toBe('frontend revision 3');

      const rev2 = entries.find(e => e.id === 'rollout-rs-uid-002');
      expect(rev2?.title).toBe('frontend revision 2');
    });

    it('extracts short image name in detail', () => {
      const entries = rolloutsToTimeline(makeReplicaSets(), makeDeployments());
      const rev3 = entries.find(e => e.id === 'rollout-rs-uid-001');
      expect(rev3?.detail).toContain('frontend:v2.1.0');
      expect(rev3?.detail).toContain('3/3 ready');
    });

    it('sets severity to warning when replicas > 0 but readyReplicas is 0', () => {
      const entries = rolloutsToTimeline(makeReplicaSets(), makeDeployments());
      const apiRs = entries.find(e => e.id === 'rollout-rs-uid-003');
      expect(apiRs?.severity).toBe('warning');
    });

    it('sets severity to info when replicas are scaled to 0 (old revision)', () => {
      const entries = rolloutsToTimeline(makeReplicaSets(), makeDeployments());
      const rev2 = entries.find(e => e.id === 'rollout-rs-uid-002');
      // replicas=0, readyReplicas=0 => not (replicas > 0 && readyReplicas === 0) => info
      expect(rev2?.severity).toBe('info');
    });

    it('sets resource reference to owning Deployment', () => {
      const entries = rolloutsToTimeline(makeReplicaSets(), makeDeployments());
      const rev3 = entries.find(e => e.id === 'rollout-rs-uid-001');
      expect(rev3?.resource).toEqual({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        name: 'frontend',
        namespace: 'production',
      });
    });

    it('builds correlation key from Deployment name and namespace', () => {
      const entries = rolloutsToTimeline(makeReplicaSets(), makeDeployments());
      const rev3 = entries.find(e => e.id === 'rollout-rs-uid-001');
      expect(rev3?.correlationKey).toBe('Deployment/frontend/production');
    });

    it('sets source type to replicaset', () => {
      const entries = rolloutsToTimeline(makeReplicaSets(), makeDeployments());
      expect(entries.every(e => e.source.type === 'replicaset')).toBe(true);
    });

    it('uses ReplicaSet creationTimestamp as timestamp', () => {
      const entries = rolloutsToTimeline(makeReplicaSets(), makeDeployments());
      const rev3 = entries.find(e => e.id === 'rollout-rs-uid-001');
      expect(rev3?.timestamp).toBe('2026-03-24T09:30:00Z');
    });

    it('returns empty array when no ReplicaSets have Deployment owners', () => {
      const orphan = makeReplicaSets().filter(rs => !rs.metadata.ownerReferences);
      const entries = rolloutsToTimeline(orphan, makeDeployments());
      expect(entries).toEqual([]);
    });
  });

  describe('configChangesToTimeline', () => {
    it('maps ClusterVersion history entries to timeline entries', () => {
      const entries = configChangesToTimeline(makeClusterVersion(), []);
      expect(entries).toHaveLength(3);
      expect(entries.every(e => e.category === 'config')).toBe(true);
    });

    it('sets severity based on ClusterVersion update state', () => {
      const entries = configChangesToTimeline(makeClusterVersion(), []);
      const completed = entries.find(e => e.title.includes('4.16.5'));
      expect(completed?.severity).toBe('info');

      const partial = entries.find(e => e.title.includes('4.16.3'));
      expect(partial?.severity).toBe('warning');
    });

    it('includes completionTime as endTimestamp for completed updates', () => {
      const entries = configChangesToTimeline(makeClusterVersion(), []);
      const completed = entries.find(e => e.title.includes('4.16.5'));
      expect(completed?.endTimestamp).toBe('2026-03-23T03:15:00Z');
    });

    it('only includes Degraded and Progressing conditions with status=True', () => {
      const entries = configChangesToTimeline(null, makeClusterOperators());
      // kube-apiserver: Degraded=True (included), Available=True (excluded), Progressing=False (excluded)
      // ingress: Progressing=True (included), Available=True (excluded), Degraded=False (excluded)
      // monitoring: Degraded=True but missing lastTransitionTime (excluded)
      expect(entries).toHaveLength(2);
    });

    it('sets severity to critical for Degraded conditions', () => {
      const entries = configChangesToTimeline(null, makeClusterOperators());
      const degraded = entries.find(e => e.title.includes('kube-apiserver: Degraded'));
      expect(degraded?.severity).toBe('critical');
    });

    it('sets severity to info for Progressing conditions', () => {
      const entries = configChangesToTimeline(null, makeClusterOperators());
      const progressing = entries.find(e => e.title.includes('ingress: Progressing'));
      expect(progressing?.severity).toBe('info');
    });

    it('uses condition message as detail', () => {
      const entries = configChangesToTimeline(null, makeClusterOperators());
      const degraded = entries.find(e => e.title.includes('kube-apiserver: Degraded'));
      expect(degraded?.detail).toBe('Node worker-03.example.com is not ready');
    });

    it('builds correlation key from ClusterOperator name', () => {
      const entries = configChangesToTimeline(null, makeClusterOperators());
      const degraded = entries.find(e => e.title.includes('kube-apiserver: Degraded'));
      expect(degraded?.correlationKey).toBe('ClusterOperator/kube-apiserver');
    });

    it('uses cluster/version correlation key for ClusterVersion entries', () => {
      const entries = configChangesToTimeline(makeClusterVersion(), []);
      expect(entries.every(e => e.correlationKey === 'cluster/version')).toBe(true);
    });

    it('handles null clusterVersion gracefully', () => {
      const entries = configChangesToTimeline(null, makeClusterOperators());
      expect(entries.length).toBeGreaterThan(0);
    });

    it('skips conditions without lastTransitionTime', () => {
      const entries = configChangesToTimeline(null, makeClusterOperators());
      const monitoring = entries.filter(e => e.title.includes('monitoring'));
      expect(monitoring).toHaveLength(0);
    });

    it('returns empty array for null clusterVersion and no operators', () => {
      expect(configChangesToTimeline(null, [])).toEqual([]);
    });
  });

  describe('correlateEntries', () => {
    it('groups entries sharing the same correlationKey', () => {
      const alertEntries = alertsToTimeline(makeAlertGroups());
      const eventEntries = eventsToTimeline(makeEvents());
      const allEntries = [...alertEntries, ...eventEntries];
      const groups = correlateEntries(allEntries);

      // There should be at least one group since Pod/api-server-7b9f4d6c8-x2k4n/production
      // appears in both alerts and events
      const podGroup = groups.find(g => g.key === 'Pod/api-server-7b9f4d6c8-x2k4n/production');
      expect(podGroup).toBeDefined();
      expect(podGroup!.entries.length).toBeGreaterThanOrEqual(2);
    });

    it('only returns groups with 2 or more entries', () => {
      const entries = eventsToTimeline(makeEvents());
      const groups = correlateEntries(entries);
      // Each event has a unique involvedObject, so no groups of 2+
      expect(groups.every(g => g.entries.length >= 2)).toBe(true);
    });

    it('excludes entries without correlationKey', () => {
      const entries = [
        {
          id: 'no-key-1',
          timestamp: '2026-03-24T10:00:00Z',
          category: 'event' as const,
          severity: 'warning' as const,
          title: 'Orphan',
          detail: '',
          source: { type: 'k8s-event' as const },
        },
        {
          id: 'no-key-2',
          timestamp: '2026-03-24T10:01:00Z',
          category: 'event' as const,
          severity: 'warning' as const,
          title: 'Orphan 2',
          detail: '',
          source: { type: 'k8s-event' as const },
        },
      ];
      const groups = correlateEntries(entries);
      expect(groups).toHaveLength(0);
    });

    it('sorts groups by worst severity (critical first)', () => {
      const entries = [
        {
          id: 'a1', timestamp: '2026-03-24T10:00:00Z', category: 'alert' as const,
          severity: 'warning' as const, title: 'W1', detail: '',
          correlationKey: 'group-warn', source: { type: 'prometheus' as const },
        },
        {
          id: 'a2', timestamp: '2026-03-24T10:01:00Z', category: 'event' as const,
          severity: 'warning' as const, title: 'W2', detail: '',
          correlationKey: 'group-warn', source: { type: 'k8s-event' as const },
        },
        {
          id: 'b1', timestamp: '2026-03-24T10:00:00Z', category: 'alert' as const,
          severity: 'critical' as const, title: 'C1', detail: '',
          correlationKey: 'group-crit', source: { type: 'prometheus' as const },
        },
        {
          id: 'b2', timestamp: '2026-03-24T10:01:00Z', category: 'event' as const,
          severity: 'info' as const, title: 'C2', detail: '',
          correlationKey: 'group-crit', source: { type: 'k8s-event' as const },
        },
        {
          id: 'c1', timestamp: '2026-03-24T10:00:00Z', category: 'event' as const,
          severity: 'normal' as const, title: 'N1', detail: '',
          correlationKey: 'group-normal', source: { type: 'k8s-event' as const },
        },
        {
          id: 'c2', timestamp: '2026-03-24T10:05:00Z', category: 'event' as const,
          severity: 'normal' as const, title: 'N2', detail: '',
          correlationKey: 'group-normal', source: { type: 'k8s-event' as const },
        },
      ];
      const groups = correlateEntries(entries);
      expect(groups).toHaveLength(3);
      expect(groups[0].key).toBe('group-crit');
      expect(groups[0].severity).toBe('critical');
      expect(groups[1].key).toBe('group-warn');
      expect(groups[1].severity).toBe('warning');
      expect(groups[2].key).toBe('group-normal');
      expect(groups[2].severity).toBe('normal');
    });

    it('sorts entries within a group by timestamp ascending', () => {
      const entries = [
        {
          id: 'late', timestamp: '2026-03-24T12:00:00Z', category: 'event' as const,
          severity: 'warning' as const, title: 'Late', detail: '',
          correlationKey: 'same-group', source: { type: 'k8s-event' as const },
        },
        {
          id: 'early', timestamp: '2026-03-24T08:00:00Z', category: 'alert' as const,
          severity: 'critical' as const, title: 'Early', detail: '',
          correlationKey: 'same-group', source: { type: 'prometheus' as const },
        },
        {
          id: 'mid', timestamp: '2026-03-24T10:00:00Z', category: 'event' as const,
          severity: 'info' as const, title: 'Mid', detail: '',
          correlationKey: 'same-group', source: { type: 'k8s-event' as const },
        },
      ];
      const groups = correlateEntries(entries);
      expect(groups).toHaveLength(1);
      expect(groups[0].entries[0].id).toBe('early');
      expect(groups[0].entries[1].id).toBe('mid');
      expect(groups[0].entries[2].id).toBe('late');
    });

    it('sets timeRange from earliest to latest entry', () => {
      const entries = [
        {
          id: 'first', timestamp: '2026-03-24T08:00:00Z', category: 'event' as const,
          severity: 'info' as const, title: 'First', detail: '',
          correlationKey: 'time-range-group', source: { type: 'k8s-event' as const },
        },
        {
          id: 'last', timestamp: '2026-03-24T14:00:00Z', category: 'alert' as const,
          severity: 'warning' as const, title: 'Last', detail: '',
          correlationKey: 'time-range-group', source: { type: 'prometheus' as const },
        },
      ];
      const groups = correlateEntries(entries);
      expect(groups[0].timeRange).toEqual({
        start: '2026-03-24T08:00:00Z',
        end: '2026-03-24T14:00:00Z',
      });
    });

    it('uses worst severity across entries in a group', () => {
      const entries = [
        {
          id: 'info-one', timestamp: '2026-03-24T10:00:00Z', category: 'event' as const,
          severity: 'info' as const, title: 'Info', detail: '',
          correlationKey: 'mixed', source: { type: 'k8s-event' as const },
        },
        {
          id: 'crit-one', timestamp: '2026-03-24T10:05:00Z', category: 'alert' as const,
          severity: 'critical' as const, title: 'Critical', detail: '',
          correlationKey: 'mixed', source: { type: 'prometheus' as const },
        },
        {
          id: 'normal-one', timestamp: '2026-03-24T10:10:00Z', category: 'event' as const,
          severity: 'normal' as const, title: 'Normal', detail: '',
          correlationKey: 'mixed', source: { type: 'k8s-event' as const },
        },
      ];
      const groups = correlateEntries(entries);
      expect(groups[0].severity).toBe('critical');
    });
  });

  describe('filterByTimeRange', () => {
    const now = new Date('2026-03-24T12:00:00Z').getTime();

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-24T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('filters entries older than the cutoff', () => {
      const entries = eventsToTimeline(makeEvents());
      // cutoff = 1 hour = 3_600_000 ms
      // now is 2026-03-24T12:00:00Z, so cutoff is 11:00:00Z
      // Events at: 10:00:05Z (out), 09:30:00Z (out), 10:10:00Z (out), 08:15:10Z (out)
      const filtered = filterByTimeRange(entries, 3_600_000);
      expect(filtered).toHaveLength(0);
    });

    it('keeps entries within the cutoff window', () => {
      const entries = eventsToTimeline(makeEvents());
      // cutoff = 4 hours = 14_400_000 ms => cutoff at 08:00:00Z
      // 10:00:05Z (in), 09:30:00Z (in), 10:10:00Z (in), 08:15:10Z (in)
      const filtered = filterByTimeRange(entries, 14_400_000);
      expect(filtered).toHaveLength(4);
    });

    it('partially filters entries based on cutoff', () => {
      const entries = eventsToTimeline(makeEvents());
      // cutoff = 2.5 hours = 9_000_000 ms => cutoff at 09:30:00Z
      // 10:00:05Z (in), 09:30:00Z (in), 10:10:00Z (in), 08:15:10Z (out)
      const filtered = filterByTimeRange(entries, 9_000_000);
      expect(filtered).toHaveLength(3);
      expect(filtered.some(e => e.title === 'KilledContainer')).toBe(false);
    });

    it('returns empty array when all entries are older than cutoff', () => {
      const entries = eventsToTimeline(makeEvents());
      // 1 minute cutoff — all entries are hours old
      const filtered = filterByTimeRange(entries, 60_000);
      expect(filtered).toHaveLength(0);
    });

    it('returns all entries when cutoff is very large', () => {
      const entries = eventsToTimeline(makeEvents());
      // 30 days
      const filtered = filterByTimeRange(entries, 30 * 24 * 60 * 60 * 1000);
      expect(filtered).toHaveLength(4);
    });

    it('handles empty input', () => {
      expect(filterByTimeRange([], 3_600_000)).toEqual([]);
    });
  });
});
