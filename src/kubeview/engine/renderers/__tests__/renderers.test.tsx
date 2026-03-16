import { describe, it, expect } from 'vitest';
import {
  getNestedValue,
  getDefaultColumns,
  renderAge,
  renderStatus,
  renderReplicas,
  type K8sResource,
} from '../index';

describe('OpenShiftView Renderers', () => {
  describe('getNestedValue', () => {
    it('retrieves nested values using dot notation', () => {
      const obj = {
        metadata: {
          name: 'test-pod',
          labels: {
            app: 'myapp',
          },
        },
      };

      expect(getNestedValue(obj, 'metadata.name')).toBe('test-pod');
      expect(getNestedValue(obj, 'metadata.labels.app')).toBe('myapp');
      expect(getNestedValue(obj, 'metadata.namespace')).toBeUndefined();
    });

    it('handles non-object inputs', () => {
      expect(getNestedValue(null, 'metadata.name')).toBeUndefined();
      expect(getNestedValue('string', 'metadata.name')).toBeUndefined();
    });
  });

  describe('getDefaultColumns', () => {
    it('returns name and age columns for non-namespaced resources', () => {
      const cols = getDefaultColumns(false);

      expect(cols).toHaveLength(2);
      expect(cols[0].id).toBe('name');
      expect(cols[1].id).toBe('age');
    });

    it('includes namespace column for namespaced resources', () => {
      const cols = getDefaultColumns(true);

      expect(cols).toHaveLength(3);
      expect(cols[0].id).toBe('name');
      expect(cols[1].id).toBe('namespace');
      expect(cols[2].id).toBe('age');
    });

    it('columns are sortable', () => {
      const cols = getDefaultColumns(true);

      expect(cols.every((c) => c.sortable)).toBe(true);
    });
  });

  describe('renderAge', () => {
    it('renders relative time for recent timestamps', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const result = renderAge(twoHoursAgo.toISOString());

      expect(result).toBeDefined();
    });

    it('handles missing timestamps', () => {
      const result = renderAge(undefined);

      expect(result).toBeDefined();
    });
  });

  describe('renderStatus', () => {
    it('renders status with color indicators', () => {
      const result = renderStatus('Running');

      expect(result).toBeDefined();
    });
  });

  describe('renderReplicas', () => {
    it('renders replica counts from deployment status', () => {
      const deployment: K8sResource = {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          name: 'test-deployment',
        },
        spec: {
          replicas: 3,
        },
        status: {
          readyReplicas: 3,
        },
      };

      const result = renderReplicas(null, deployment);

      expect(result).toBeDefined();
    });

    it('handles missing replica counts', () => {
      const deployment: K8sResource = {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          name: 'test-deployment',
        },
      };

      const result = renderReplicas(null, deployment);

      expect(result).toBeDefined();
    });
  });
});
