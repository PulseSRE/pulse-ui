import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerEnhancer,
  getEnhancer,
  getColumnsForResource,
  type ResourceEnhancer,
} from '../index';
import { registerBuiltinEnhancers } from '../register';

describe('OpenShiftView Enhancers', () => {
  beforeEach(() => {
    // Reset enhancers before each test
    // Note: In a real scenario, we'd need a way to clear the registry
    // For now, we'll just register built-in enhancers once
    registerBuiltinEnhancers();
  });

  describe('getEnhancer', () => {
    it('finds enhancer for pods', () => {
      const enhancer = getEnhancer('v1/pods');

      expect(enhancer).toBeDefined();
      expect(enhancer?.matches).toContain('v1/pods');
    });

    it('finds enhancer for deployments', () => {
      const enhancer = getEnhancer('apps/v1/deployments');

      expect(enhancer).toBeDefined();
      expect(enhancer?.matches).toContain('apps/v1/deployments');
    });

    it('finds enhancer for statefulsets using same enhancer as deployments', () => {
      const enhancer = getEnhancer('apps/v1/statefulsets');

      expect(enhancer).toBeDefined();
      expect(enhancer?.matches).toContain('apps/v1/statefulsets');
    });

    it('finds enhancer for nodes', () => {
      const enhancer = getEnhancer('v1/nodes');

      expect(enhancer).toBeDefined();
      expect(enhancer?.matches).toContain('v1/nodes');
    });

    it('finds enhancer for services', () => {
      const enhancer = getEnhancer('v1/services');

      expect(enhancer).toBeDefined();
      expect(enhancer?.matches).toContain('v1/services');
    });

    it('finds enhancer for secrets', () => {
      const enhancer = getEnhancer('v1/secrets');

      expect(enhancer).toBeDefined();
      expect(enhancer?.matches).toContain('v1/secrets');
    });

    it('returns undefined for unknown resource types', () => {
      const enhancer = getEnhancer('v1/configmaps');

      expect(enhancer).toBeUndefined();
    });
  });

  describe('getColumnsForResource', () => {
    it('returns enhanced columns for pods', () => {
      const columns = getColumnsForResource('v1/pods', true);

      // Should have default columns (name, namespace, age) + pod-specific columns
      expect(columns.length).toBeGreaterThan(3);

      const columnIds = columns.map((c) => c.id);
      expect(columnIds).toContain('name');
      expect(columnIds).toContain('namespace');
      expect(columnIds).toContain('age');
      expect(columnIds).toContain('status');
      expect(columnIds).toContain('ready');
      expect(columnIds).toContain('restarts');
    });

    it('returns enhanced columns for deployments', () => {
      const columns = getColumnsForResource('apps/v1/deployments', true);

      const columnIds = columns.map((c) => c.id);
      expect(columnIds).toContain('name');
      expect(columnIds).toContain('status');
      expect(columnIds).toContain('ready');
      expect(columnIds).toContain('image');
    });

    it('returns default columns for unknown resource types', () => {
      const columns = getColumnsForResource('v1/configmaps', true);

      // Should only have default columns
      expect(columns).toHaveLength(3);
      expect(columns[0].id).toBe('name');
      expect(columns[1].id).toBe('namespace');
      expect(columns[2].id).toBe('age');
    });

    it('omits namespace column for cluster-scoped resources', () => {
      const columns = getColumnsForResource('v1/nodes', false);

      const columnIds = columns.map((c) => c.id);
      expect(columnIds).not.toContain('namespace');
      expect(columnIds).toContain('name');
      expect(columnIds).toContain('age');
    });
  });

  describe('registerEnhancer', () => {
    it('allows registering custom enhancers', () => {
      const customEnhancer: ResourceEnhancer = {
        matches: ['v1/configmaps'],
        columns: [
          {
            id: 'keys',
            header: 'Keys',
            accessorFn: (resource) => {
              const data = resource.data as Record<string, unknown> | undefined;
              return data ? Object.keys(data).length : 0;
            },
            render: (value) => value,
            sortable: true,
            priority: 10,
          },
        ],
      };

      registerEnhancer(customEnhancer);

      const enhancer = getEnhancer('v1/configmaps');
      expect(enhancer).toBeDefined();
      expect(enhancer?.columns).toHaveLength(1);
      expect(enhancer?.columns[0].id).toBe('keys');
    });
  });
});
