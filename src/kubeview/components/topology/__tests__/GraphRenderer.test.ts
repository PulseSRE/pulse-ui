import { describe, it, expect } from 'vitest';
import { layoutGraph, layoutLeftToRight, layoutGrouped } from '../GraphRenderer';
import type { TopoNode, TopoEdge } from '../GraphRenderer';

const baseNodes: TopoNode[] = [
  { id: 'Route/prod/web', kind: 'Route', name: 'web', namespace: 'prod' },
  { id: 'Service/prod/web', kind: 'Service', name: 'web', namespace: 'prod' },
  { id: 'Pod/prod/web-1', kind: 'Pod', name: 'web-1', namespace: 'prod' },
];

const baseEdges: TopoEdge[] = [
  { source: 'Route/prod/web', target: 'Service/prod/web', relationship: 'routes_to' },
  { source: 'Service/prod/web', target: 'Pod/prod/web-1', relationship: 'selects' },
];

describe('layoutGraph (top-down)', () => {
  it('assigns increasing y for deeper layers', () => {
    const result = layoutGraph(baseNodes, baseEdges);
    const route = result.find((n) => n.kind === 'Route')!;
    const svc = result.find((n) => n.kind === 'Service')!;
    const pod = result.find((n) => n.kind === 'Pod')!;
    expect(route.y).toBeLessThan(svc.y);
    expect(svc.y).toBeLessThan(pod.y);
  });

  it('returns empty array for empty input', () => {
    expect(layoutGraph([], [])).toEqual([]);
  });
});

describe('layoutLeftToRight', () => {
  it('assigns increasing x for deeper layers', () => {
    const result = layoutLeftToRight(baseNodes, baseEdges);
    const route = result.find((n) => n.kind === 'Route')!;
    const svc = result.find((n) => n.kind === 'Service')!;
    const pod = result.find((n) => n.kind === 'Pod')!;
    expect(route.x).toBeLessThan(svc.x);
    expect(svc.x).toBeLessThan(pod.x);
  });

  it('keeps same-layer nodes at same x', () => {
    const nodes: TopoNode[] = [
      ...baseNodes,
      { id: 'Pod/prod/web-2', kind: 'Pod', name: 'web-2', namespace: 'prod' },
    ];
    const edges: TopoEdge[] = [
      ...baseEdges,
      { source: 'Service/prod/web', target: 'Pod/prod/web-2', relationship: 'selects' },
    ];
    const result = layoutLeftToRight(nodes, edges);
    const pod1 = result.find((n) => n.name === 'web-1')!;
    const pod2 = result.find((n) => n.name === 'web-2')!;
    expect(pod1.x).toBe(pod2.x);
  });

  it('returns empty array for empty input', () => {
    expect(layoutLeftToRight([], [])).toEqual([]);
  });
});

describe('layoutGrouped', () => {
  it('groups nodes by group field', () => {
    const nodes: TopoNode[] = [
      { id: 'Node//w1', kind: 'Node', name: 'w1', namespace: '', group: 'w1' },
      { id: 'Pod/p/a', kind: 'Pod', name: 'a', namespace: 'p', group: 'w1' },
      { id: 'Node//w2', kind: 'Node', name: 'w2', namespace: '', group: 'w2' },
      { id: 'Pod/p/b', kind: 'Pod', name: 'b', namespace: 'p', group: 'w2' },
    ];
    const result = layoutGrouped(nodes, []);
    expect(result.length).toBe(4);
    const w1Nodes = result.filter((n) => n.group === 'w1');
    const w2Nodes = result.filter((n) => n.group === 'w2');
    expect(w1Nodes.length).toBe(2);
    expect(w2Nodes.length).toBe(2);
  });

  it('returns empty array for empty input', () => {
    expect(layoutGrouped([], [])).toEqual([]);
  });

  it('handles nodes without group field', () => {
    const nodes: TopoNode[] = [
      { id: 'Pod/p/a', kind: 'Pod', name: 'a', namespace: 'p' },
      { id: 'Pod/p/b', kind: 'Pod', name: 'b', namespace: 'p' },
    ];
    const result = layoutGrouped(nodes, []);
    expect(result.length).toBe(2);
  });
});
