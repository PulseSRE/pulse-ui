import { describe, it, expect } from 'vitest';
import { compareSnapshots, type ClusterSnapshot } from '../snapshot';

function makeSnapshot(overrides: Partial<ClusterSnapshot> = {}): ClusterSnapshot {
  return {
    id: 'snap-1',
    label: 'test',
    timestamp: new Date().toISOString(),
    clusterVersion: '4.17.0',
    platform: 'AWS',
    controlPlaneTopology: 'HighlyAvailable',
    nodes: { count: 6, versions: ['v1.30.0'] },
    clusterOperators: [],
    crds: [],
    storageClasses: [],
    namespaceCount: 10,
    ...overrides,
  };
}

describe('snapshot', () => {
  describe('compareSnapshots', () => {
    it('detects controlPlaneTopology change', () => {
      const left = makeSnapshot({ controlPlaneTopology: 'HighlyAvailable' });
      const right = makeSnapshot({ controlPlaneTopology: 'External' });
      const diff = compareSnapshots(left, right);
      const topologyRow = diff.find(r => r.field === 'Control Plane Topology');
      expect(topologyRow).toBeDefined();
      expect(topologyRow!.changed).toBe(true);
      expect(topologyRow!.left).toBe('HighlyAvailable');
      expect(topologyRow!.right).toBe('External');
    });

    it('shows no change when controlPlaneTopology is the same', () => {
      const left = makeSnapshot({ controlPlaneTopology: 'External' });
      const right = makeSnapshot({ controlPlaneTopology: 'External' });
      const diff = compareSnapshots(left, right);
      const topologyRow = diff.find(r => r.field === 'Control Plane Topology');
      expect(topologyRow).toBeDefined();
      expect(topologyRow!.changed).toBe(false);
    });

    it('handles missing controlPlaneTopology gracefully', () => {
      const left = makeSnapshot({ controlPlaneTopology: '' });
      const right = makeSnapshot({ controlPlaneTopology: 'External' });
      const diff = compareSnapshots(left, right);
      const topologyRow = diff.find(r => r.field === 'Control Plane Topology');
      expect(topologyRow).toBeDefined();
      expect(topologyRow!.changed).toBe(true);
      expect(topologyRow!.left).toBe('—');
      expect(topologyRow!.right).toBe('External');
    });

    it('includes controlPlaneTopology in Cluster category', () => {
      const left = makeSnapshot();
      const right = makeSnapshot();
      const diff = compareSnapshots(left, right);
      const topologyRow = diff.find(r => r.field === 'Control Plane Topology');
      expect(topologyRow!.category).toBe('Cluster');
    });
  });
});
