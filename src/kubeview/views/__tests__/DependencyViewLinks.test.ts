import { describe, it, expect } from 'vitest';
import { getGvrUrl } from '../DependencyView';

describe('dependency graph node links', () => {
  it('expands the graph short kinds HPA and PDB to their real resources', () => {
    expect(getGvrUrl('HPA', 'shop', 'web')).toBe('/r/autoscaling~v2~horizontalpodautoscalers/shop/web');
    expect(getGvrUrl('PDB', 'shop', 'web')).toBe('/r/policy~v1~poddisruptionbudgets/shop/web');
    expect(getGvrUrl('Deployment', 'shop', 'web')).toBe('/r/apps~v1~deployments/shop/web');
    expect(getGvrUrl('Node', '', 'w1')).toBe('/r/v1~nodes/_/w1');
  });
});
