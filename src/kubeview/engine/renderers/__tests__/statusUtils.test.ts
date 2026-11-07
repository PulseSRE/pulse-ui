import { describe, it, expect } from 'vitest';
import {
  detectResourceStatus,
  getPodStatus,
  getDeploymentStatus,
  getNodeStatus,
  statusColor,
  statusIcon,
} from '../statusUtils';
import type { K8sResource } from '../index';

describe('Status Utils', () => {
  describe('getPodStatus', () => {
    it('detects running pod status', () => {
      const pod: K8sResource = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'test-pod' },
        status: {
          phase: 'Running',
          containerStatuses: [
            {
              name: 'container1',
              ready: true,
              restartCount: 0,
              state: { running: { startedAt: '2024-01-01T00:00:00Z' } },
            },
          ],
        },
      };

      const status = getPodStatus(pod);

      expect(status.phase).toBe('Running');
      expect(status.ready).toBe(true);
      expect(status.restartCount).toBe(0);
      expect(status.containerStatuses).toHaveLength(1);
      expect(status.containerStatuses[0].state).toBe('running');
    });

    it('detects CrashLoopBackOff status', () => {
      const pod: K8sResource = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'test-pod' },
        status: {
          phase: 'Running',
          containerStatuses: [
            {
              name: 'container1',
              ready: false,
              restartCount: 5,
              state: {
                waiting: { reason: 'CrashLoopBackOff', message: 'Container crashed' },
              },
            },
          ],
        },
      };

      const status = getPodStatus(pod);

      expect(status.phase).toBe('Running');
      expect(status.ready).toBe(false);
      expect(status.reason).toBe('CrashLoopBackOff');
      expect(status.restartCount).toBe(5);
    });

    it('handles init containers', () => {
      const pod: K8sResource = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'test-pod' },
        status: {
          phase: 'Pending',
          initContainerStatuses: [
            {
              name: 'init-container',
              ready: false,
              restartCount: 0,
              state: { waiting: { reason: 'ContainerCreating' } },
            },
          ],
          containerStatuses: [],
        },
      };

      const status = getPodStatus(pod);

      expect(status.containerStatuses).toHaveLength(1);
      expect(status.containerStatuses[0].name).toBe('init-container');
    });
  });

  describe('getDeploymentStatus', () => {
    it('detects available deployment', () => {
      const deployment: K8sResource = {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'test-deployment' },
        spec: { replicas: 3 },
        status: {
          readyReplicas: 3,
          conditions: [{ type: 'Progressing', status: 'True' }],
        },
      };

      const status = getDeploymentStatus(deployment);

      expect(status.ready).toBe(3);
      expect(status.desired).toBe(3);
      expect(status.available).toBe(true);
      expect(status.progressing).toBe(true);
    });

    it('detects partially ready deployment', () => {
      const deployment: K8sResource = {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'test-deployment' },
        spec: { replicas: 3 },
        status: {
          readyReplicas: 1,
          conditions: [{ type: 'Progressing', status: 'True' }],
        },
      };

      const status = getDeploymentStatus(deployment);

      expect(status.ready).toBe(1);
      expect(status.desired).toBe(3);
      expect(status.available).toBe(false);
    });
  });

  describe('getNodeStatus', () => {
    it('detects ready node', () => {
      const node: K8sResource = {
        apiVersion: 'v1',
        kind: 'Node',
        metadata: {
          name: 'test-node',
          labels: {
            'node-role.kubernetes.io/master': '',
            'node-role.kubernetes.io/control-plane': '',
          },
        },
        status: {
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'DiskPressure', status: 'False' },
            { type: 'MemoryPressure', status: 'False' },
            { type: 'PIDPressure', status: 'False' },
          ],
        },
      };

      const status = getNodeStatus(node);

      expect(status.ready).toBe(true);
      expect(status.roles).toContain('master');
      expect(status.roles).toContain('control-plane');
      expect(status.pressure.disk).toBe(false);
      expect(status.pressure.memory).toBe(false);
      expect(status.pressure.pid).toBe(false);
    });

    it('detects node with disk pressure', () => {
      const node: K8sResource = {
        apiVersion: 'v1',
        kind: 'Node',
        metadata: { name: 'test-node', labels: {} },
        status: {
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'DiskPressure', status: 'True', reason: 'LowDiskSpace' },
          ],
        },
      };

      const status = getNodeStatus(node);

      expect(status.ready).toBe(true);
      expect(status.pressure.disk).toBe(true);
    });
  });

  describe('detectResourceStatus', () => {
    it('detects terminating resource', () => {
      const resource: K8sResource = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: 'test-pod',
          deletionTimestamp: '2024-01-01T00:00:00Z',
        },
      };

      const status = detectResourceStatus(resource);

      expect(status.status).toBe('terminating');
    });

    it('detects healthy pod', () => {
      const pod: K8sResource = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'test-pod' },
        status: {
          phase: 'Running',
          containerStatuses: [
            {
              name: 'container1',
              ready: true,
              state: { running: {} },
            },
          ],
        },
      };

      const status = detectResourceStatus(pod);

      expect(status.status).toBe('healthy');
    });
  });

  describe('statusColor', () => {
    it('returns green for healthy status', () => {
      expect(statusColor('healthy')).toBe('text-green-600');
      expect(statusColor('Running')).toBe('text-green-600');
      expect(statusColor('Ready')).toBe('text-green-600');
    });

    it('returns amber for warning status', () => {
      expect(statusColor('warning')).toBe('text-amber-600');
      expect(statusColor('Pending')).toBe('text-amber-600');
    });

    it('returns red for error status', () => {
      expect(statusColor('error')).toBe('text-red-600');
      expect(statusColor('Failed')).toBe('text-red-600');
    });
  });

  describe('statusIcon', () => {
    it('returns appropriate icons for statuses', () => {
      expect(statusIcon('healthy')).toBe('check-circle');
      expect(statusIcon('warning')).toBe('alert-circle');
      expect(statusIcon('error')).toBe('x-circle');
      expect(statusIcon('terminating')).toBe('loader');
      expect(statusIcon('unknown')).toBe('help-circle');
    });
  });
});
