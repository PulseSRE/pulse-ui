import { describe, it, expect } from 'vitest';
import {
  diagnoseResource,
  enrichDiagnosesWithLogs,
  findNeedsAttention,
  getDiagnosisSummary,
  needsAttention,
} from '../diagnosis';

function makePod(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: 'test-pod', namespace: 'default', creationTimestamp: '2026-01-01T00:00:00Z' },
    ...overrides,
  };
}

function makeDeployment(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'test-deploy', namespace: 'default', creationTimestamp: '2026-01-01T00:00:00Z' },
    ...overrides,
  };
}

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: { name: 'test-node', creationTimestamp: '2026-01-01T00:00:00Z' },
    ...overrides,
  };
}

describe('diagnosis', () => {
  describe('diagnosePod', () => {
    it('detects CrashLoopBackOff', () => {
      const pod = makePod({
        status: {
          containerStatuses: [{
            name: 'app',
            restartCount: 10,
            state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off' } },
          }],
        },
      });

      const diagnoses = diagnoseResource(pod);
      expect(diagnoses.some((d) => d.title.includes('CrashLoopBackOff'))).toBe(true);
      expect(diagnoses.some((d) => d.severity === 'critical')).toBe(true);
    });

    it('detects ImagePullBackOff', () => {
      const pod = makePod({
        status: {
          containerStatuses: [{
            name: 'app',
            restartCount: 0,
            state: { waiting: { reason: 'ImagePullBackOff', message: 'not found' } },
          }],
        },
      });

      const diagnoses = diagnoseResource(pod);
      expect(diagnoses.some((d) => d.title.includes('cannot pull image'))).toBe(true);
    });

    it('detects ErrImagePull', () => {
      const pod = makePod({
        status: {
          containerStatuses: [{
            name: 'app',
            restartCount: 0,
            state: { waiting: { reason: 'ErrImagePull' } },
          }],
        },
      });

      const diagnoses = diagnoseResource(pod);
      expect(diagnoses.some((d) => d.title.includes('cannot pull image'))).toBe(true);
    });

    it('detects OOMKilled with fix suggestion', () => {
      const pod = makePod({
        metadata: {
          name: 'test-pod', namespace: 'default', creationTimestamp: '2026-01-01T00:00:00Z',
          ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'test-deploy-abc123', uid: '1', controller: true }],
        },
        spec: {
          containers: [{ name: 'app', resources: { limits: { memory: '256Mi' } } }],
        },
        status: {
          containerStatuses: [{
            name: 'app',
            restartCount: 3,
            state: { running: {} },
            lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } },
          }],
        },
      });

      const diagnoses = diagnoseResource(pod);
      const oom = diagnoses.find((d) => d.title.includes('OOM'));
      expect(oom).toBeDefined();
      expect(oom!.severity).toBe('critical');
      expect(oom!.fix).toBeDefined();
      expect(oom!.fix!.label).toBe('Increase memory limit');
    });

    it('detects high restart count', () => {
      const pod = makePod({
        status: {
          containerStatuses: [{
            name: 'app',
            restartCount: 10,
            state: { running: {} },
          }],
        },
      });

      const diagnoses = diagnoseResource(pod);
      expect(diagnoses.some((d) => d.title.includes('restarted 10 times'))).toBe(true);
      expect(diagnoses.some((d) => d.severity === 'warning')).toBe(true);
    });

    it('detects pending pod with scheduling failure', () => {
      const pod = makePod({
        status: {
          phase: 'Pending',
          conditions: [{
            type: 'PodScheduled',
            status: 'False',
            message: 'Insufficient cpu',
          }],
        },
      });

      const diagnoses = diagnoseResource(pod);
      expect(diagnoses.some((d) => d.title.includes('cannot be scheduled'))).toBe(true);
    });

    it('returns empty for healthy pod', () => {
      const pod = makePod({
        status: {
          phase: 'Running',
          containerStatuses: [{
            name: 'app',
            restartCount: 0,
            state: { running: { startedAt: '2026-01-01T00:00:00Z' } },
          }],
        },
      });

      const diagnoses = diagnoseResource(pod);
      expect(diagnoses).toHaveLength(0);
    });

    it('returns empty when status is missing', () => {
      const pod = makePod();
      expect(diagnoseResource(pod)).toHaveLength(0);
    });
  });

  describe('diagnoseDeployment', () => {
    it('detects unavailable deployment', () => {
      const deploy = makeDeployment({
        status: {
          conditions: [{ type: 'Available', status: 'False', message: 'No replicas' }],
        },
      });

      const diagnoses = diagnoseResource(deploy);
      expect(diagnoses.some((d) => d.title.includes('unavailable'))).toBe(true);
      expect(diagnoses.some((d) => d.severity === 'critical')).toBe(true);
    });

    it('detects unavailable replicas', () => {
      const deploy = makeDeployment({
        status: {
          replicas: 3,
          availableReplicas: 1,
          unavailableReplicas: 2,
        },
      });

      const diagnoses = diagnoseResource(deploy);
      expect(diagnoses.some((d) => d.title.includes('2 replica(s) unavailable'))).toBe(true);
    });

    it('returns empty for healthy deployment', () => {
      const deploy = makeDeployment({
        status: {
          replicas: 3,
          availableReplicas: 3,
          conditions: [{ type: 'Available', status: 'True' }],
        },
      });

      expect(diagnoseResource(deploy)).toHaveLength(0);
    });
  });

  describe('diagnoseNode', () => {
    it('detects node not ready', () => {
      const node = makeNode({
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'kubelet stopped' }],
        },
      });

      const diagnoses = diagnoseResource(node);
      expect(diagnoses.some((d) => d.title.includes('not ready'))).toBe(true);
      expect(diagnoses.some((d) => d.severity === 'critical')).toBe(true);
    });

    it('detects disk pressure', () => {
      const node = makeNode({
        status: {
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'DiskPressure', status: 'True', message: 'low disk' },
          ],
        },
      });

      const diagnoses = diagnoseResource(node);
      expect(diagnoses.some((d) => d.title.includes('disk pressure'))).toBe(true);
    });

    it('detects memory pressure', () => {
      const node = makeNode({
        status: {
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'MemoryPressure', status: 'True' },
          ],
        },
      });

      const diagnoses = diagnoseResource(node);
      expect(diagnoses.some((d) => d.title.includes('memory pressure'))).toBe(true);
    });

    it('detects PID pressure', () => {
      const node = makeNode({
        status: {
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'PIDPressure', status: 'True' },
          ],
        },
      });

      const diagnoses = diagnoseResource(node);
      expect(diagnoses.some((d) => d.title.includes('PID pressure'))).toBe(true);
      expect(diagnoses[0].severity).toBe('warning');
    });

    it('returns empty for healthy node', () => {
      const node = makeNode({
        status: {
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'DiskPressure', status: 'False' },
            { type: 'MemoryPressure', status: 'False' },
            { type: 'PIDPressure', status: 'False' },
          ],
        },
      });

      expect(diagnoseResource(node)).toHaveLength(0);
    });
  });

  describe('diagnosePVC', () => {
    it('detects pending PVC', () => {
      const pvc = {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'test-pvc', namespace: 'default', creationTimestamp: '2026-01-01T00:00:00Z' },
        status: { phase: 'Pending' },
      };

      const diagnoses = diagnoseResource(pvc);
      expect(diagnoses.some((d) => d.title.includes('pending'))).toBe(true);
    });
  });

  describe('findNeedsAttention', () => {
    it('collects critical and warning items', () => {
      const resources = [
        makePod({
          status: {
            containerStatuses: [{
              name: 'app',
              restartCount: 10,
              state: { waiting: { reason: 'CrashLoopBackOff' } },
            }],
          },
        }),
        makePod({ metadata: { name: 'healthy', namespace: 'default', creationTimestamp: '2026-01-01T00:00:00Z' }, status: { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0, state: { running: {} } }] } }),
      ];

      const items = findNeedsAttention(resources);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.severity === 'critical' || i.severity === 'warning')).toBe(true);
    });

    it('returns empty for healthy resources', () => {
      const resources = [
        makePod({ status: { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0, state: { running: {} } }] } }),
      ];

      expect(findNeedsAttention(resources)).toHaveLength(0);
    });
  });

  describe('getDiagnosisSummary', () => {
    it('counts by severity', () => {
      const pod = makePod({
        status: {
          containerStatuses: [{
            name: 'app',
            restartCount: 10,
            state: { waiting: { reason: 'CrashLoopBackOff' } },
          }],
        },
      });

      const summary = getDiagnosisSummary(pod);
      expect(summary.critical).toBeGreaterThan(0);
    });

    it('returns zeros for healthy resource', () => {
      const pod = makePod({ status: { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0, state: { running: {} } }] } });
      const summary = getDiagnosisSummary(pod);
      expect(summary.critical).toBe(0);
      expect(summary.warning).toBe(0);
      expect(summary.info).toBe(0);
    });
  });

  describe('needsAttention', () => {
    it('returns true for problematic resource', () => {
      const pod = makePod({
        status: {
          containerStatuses: [{
            name: 'app',
            restartCount: 10,
            state: { waiting: { reason: 'CrashLoopBackOff' } },
          }],
        },
      });

      expect(needsAttention(pod)).toBe(true);
    });

    it('returns false for healthy resource', () => {
      const pod = makePod({ status: { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0, state: { running: {} } }] } });
      expect(needsAttention(pod)).toBe(false);
    });
  });

  describe('enrichDiagnosesWithLogs', () => {
    const crashPod = makePod({
      status: {
        containerStatuses: [{
          name: 'nginx',
          restartCount: 5,
          state: { waiting: { reason: 'CrashLoopBackOff' } },
        }],
      },
    });

    it('detects permission denied from logs', async () => {
      const diagnoses = diagnoseResource(crashPod);
      const mockFetch = async () => 'nginx: [emerg] mkdir() "/var/cache/nginx/client_temp" failed (13: Permission denied)';
      const enriched = await enrichDiagnosesWithLogs(crashPod, diagnoses, mockFetch);
      const crash = enriched.find(d => d.title.includes('CrashLoopBackOff'));
      expect(crash?.title).toContain('Permission denied');
      expect(crash?.suggestion).toContain('non-root');
      expect(crash?.logSnippet).toContain('Permission denied');
    });

    it('detects connection refused from logs', async () => {
      const diagnoses = diagnoseResource(crashPod);
      const mockFetch = async () => 'Error: connect ECONNREFUSED 10.0.0.1:5432';
      const enriched = await enrichDiagnosesWithLogs(crashPod, diagnoses, mockFetch);
      const crash = enriched.find(d => d.title.includes('CrashLoopBackOff'));
      expect(crash?.title).toContain('Connection refused');
    });

    it('detects OOM from logs', async () => {
      const diagnoses = diagnoseResource(crashPod);
      const mockFetch = async () => 'FATAL: out of memory\nDetail: failed to allocate 1048576 bytes';
      const enriched = await enrichDiagnosesWithLogs(crashPod, diagnoses, mockFetch);
      const crash = enriched.find(d => d.title.includes('CrashLoopBackOff'));
      expect(crash?.title).toContain('Out of memory');
    });

    it('detects DNS failure from logs', async () => {
      const diagnoses = diagnoseResource(crashPod);
      const mockFetch = async () => 'Error: getaddrinfo ENOTFOUND postgres.default.svc.cluster.local';
      const enriched = await enrichDiagnosesWithLogs(crashPod, diagnoses, mockFetch);
      const crash = enriched.find(d => d.title.includes('CrashLoopBackOff'));
      expect(crash?.title).toContain('DNS resolution failure');
    });

    it('detects read-only filesystem from logs', async () => {
      const diagnoses = diagnoseResource(crashPod);
      const mockFetch = async () => 'Error: EROFS: read-only file system, open /data/cache.db';
      const enriched = await enrichDiagnosesWithLogs(crashPod, diagnoses, mockFetch);
      const crash = enriched.find(d => d.title.includes('CrashLoopBackOff'));
      expect(crash?.title).toContain('Read-only filesystem');
    });

    it('shows log snippet even when no pattern matches', async () => {
      const diagnoses = diagnoseResource(crashPod);
      const mockFetch = async () => 'some random error\nfatal: custom app crash';
      const enriched = await enrichDiagnosesWithLogs(crashPod, diagnoses, mockFetch);
      const crash = enriched.find(d => d.title.includes('CrashLoopBackOff'));
      expect(crash?.logSnippet).toContain('fatal: custom app crash');
    });

    it('does not enrich healthy pods', async () => {
      const healthyPod = makePod({ status: { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0, state: { running: {} } }] } });
      const diagnoses = diagnoseResource(healthyPod);
      const mockFetch = async () => 'should not be called';
      const enriched = await enrichDiagnosesWithLogs(healthyPod, diagnoses, mockFetch);
      expect(enriched).toEqual(diagnoses);
    });

    it('falls back to previous logs when current is empty', async () => {
      const diagnoses = diagnoseResource(crashPod);
      let callCount = 0;
      const mockFetch = async (url: string) => {
        callCount++;
        if (url.includes('previous=true')) return 'previous: permission denied on /var/run';
        return ''; // current logs empty
      };
      const enriched = await enrichDiagnosesWithLogs(crashPod, diagnoses, mockFetch);
      expect(callCount).toBe(2); // tried current, then previous
      const crash = enriched.find(d => d.title.includes('CrashLoopBackOff'));
      expect(crash?.title).toContain('Permission denied');
    });
  });
});
