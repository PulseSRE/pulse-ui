// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { describeToolAction, riskLevel } from '../MessageBubble';

describe('describeToolAction', () => {
  it('returns correct text for scale_deployment', () => {
    const result = describeToolAction('scale_deployment', {
      namespace: 'prod',
      name: 'api',
      replicas: 5,
    });
    expect(result).toBe('Scale deployment prod/api to 5 replicas');
  });

  it('returns correct text for delete_pod', () => {
    const result = describeToolAction('delete_pod', {
      namespace: 'default',
      pod_name: 'web-abc123',
    });
    expect(result).toBe('Delete pod default/web-abc123 (grace period: 30s)');
  });

  it('returns fallback for unknown tool', () => {
    const result = describeToolAction('custom_tool', {});
    expect(result).toBe('Execute custom_tool');
  });
});

describe('riskLevel', () => {
  it('returns MEDIUM for scale_deployment with replicas > 0', () => {
    const result = riskLevel('scale_deployment', { replicas: 3 });
    expect(result.level).toBe('MEDIUM');
    expect(result.color).toBe('text-amber-400');
  });

  it('returns HIGH for scale_deployment with replicas = 0', () => {
    const result = riskLevel('scale_deployment', { replicas: 0 });
    expect(result.level).toBe('HIGH');
    expect(result.color).toBe('text-red-400');
  });

  it('returns HIGH for drain_node', () => {
    const result = riskLevel('drain_node', { node_name: 'node-1' });
    expect(result.level).toBe('HIGH');
    expect(result.color).toBe('text-red-400');
  });

  it('returns MEDIUM for delete_pod', () => {
    const result = riskLevel('delete_pod', { namespace: 'default', pod_name: 'x' });
    expect(result.level).toBe('MEDIUM');
    expect(result.color).toBe('text-amber-400');
  });
});
