import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getKnownKinds, invalidateComponentRegistry } from '../componentRegistry';

describe('componentRegistry', () => {
  beforeEach(() => {
    invalidateComponentRegistry();
  });

  it('getKnownKinds returns all 27 built-in kinds', () => {
    const kinds = getKnownKinds();
    expect(kinds).toContain('data_table');
    expect(kinds).toContain('chart');
    expect(kinds).toContain('metric_card');
    expect(kinds).toContain('status_list');
    expect(kinds).toContain('resource_counts');
    expect(kinds).toContain('timeline');
    expect(kinds).toContain('topology');
    expect(kinds).toContain('action_button');
    expect(kinds).toContain('confidence_badge');
    expect(kinds).toContain('resolution_tracker');
    expect(kinds).toContain('blast_radius');
    expect(kinds).toContain('status_pipeline');
    expect(kinds).toContain('upgrade_graph');
    expect(kinds).toContain('rollout_history');
    expect(kinds.length).toBe(27);
  });

  it('invalidateComponentRegistry clears cache', () => {
    // Just verify it doesn't throw
    invalidateComponentRegistry();
  });
});
