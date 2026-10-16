/**
 * AgentNodeMap — Renders NodeMapSpec as an interactive hex node visualization.
 * Adapts the NodeHexMap component for use as an agent component.
 */

import { NodeHexMap, type PodInfo } from '../../views/compute/NodeHexMap';
import type { NodeMapSpec } from '../../engine/agentComponents';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import type { NodeDetail } from '../../views/compute/types';

interface Props {
  spec: NodeMapSpec;
}

export function AgentNodeMap({ spec }: Props) {
  const go = useNavigateTab();

  // Map NodeMapSpec nodes → NodeDetail compatible shape. Agent specs built
  // with emit_component often omit roles/podCount/podCap (the registry example
  // the model copies did), and NodeHexMap calls roles.join() unguarded, so a
  // missing field crashed the whole widget. Default them here.
  const nodeDetails: NodeDetail[] = (spec.nodes || []).map((n) => {
    const roles = Array.isArray(n.roles) ? n.roles : [];
    return {
      node: { metadata: { name: n.name, labels: {}, creationTimestamp: '' }, status: { conditions: [] } } as any,
      status: {
        ready: n.status === 'ready',
        conditions: (n.conditions || []).map(c => ({ type: c, status: n.status === 'ready' ? 'True' : 'False' })),
        roles,
        pressure: {
          disk: n.conditions?.includes('DiskPressure') || false,
          memory: n.conditions?.includes('MemoryPressure') || false,
          pid: n.conditions?.includes('PIDPressure') || false,
        },
      },
      nodeInfo: {},
      capacity: {},
      allocatable: {},
      roles,
      taints: [],
      unschedulable: n.status === 'cordoned',
      podCount: typeof n.podCount === 'number' ? n.podCount : 0,
      podCap: typeof n.podCap === 'number' ? n.podCap : 0,
      cpuCap: 0,
      memCap: 0,
      memUsagePct: n.memPct ?? null,
      cpuUsagePct: n.cpuPct ?? null,
      age: n.age || '',
      pressures: (n.conditions || []).filter(c => c.includes('Pressure')),
      instanceType: n.instanceType || '',
      name: n.name,
    };
  });

  // Map pod data
  const podsByNode: Record<string, PodInfo[]> = spec.pods || {};

  return (
    <div>
      {spec.title && (
        <div className="text-xs font-medium text-slate-400 mb-2">{spec.title}</div>
      )}
      <NodeHexMap
        nodes={nodeDetails}
        podsByNode={podsByNode}
        onNodeClick={(name) => go(`/r/v1~nodes/_/${name}`, name)}
        onPodClick={(ns, name) => go(`/r/v1~pods/${ns}/${name}`, name)}
        onViewAll={() => go('/r/v1~nodes', 'Nodes')}
      />
    </div>
  );
}
