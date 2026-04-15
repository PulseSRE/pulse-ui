import { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Network, Loader2, RefreshCw, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../components/primitives/Card';
import { EmptyState } from '../components/primitives/EmptyState';
import { useUIStore } from '../store/uiStore';

interface TopoNode {
  id: string;
  kind: string;
  name: string;
  namespace: string;
}

interface TopoEdge {
  source: string;
  target: string;
  relationship: string;
}

interface TopologyData {
  nodes: TopoNode[];
  edges: TopoEdge[];
  summary: {
    nodes: number;
    edges: number;
    kinds: Record<string, number>;
    last_refresh: number;
  };
}

async function fetchTopology(namespace?: string): Promise<TopologyData> {
  const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  const res = await fetch(`/api/agent/topology${params}`);
  if (!res.ok) throw new Error(`Topology fetch failed (${res.status})`);
  return res.json();
}

const KIND_COLORS: Record<string, string> = {
  Deployment: '#3b82f6',
  ReplicaSet: '#60a5fa',
  StatefulSet: '#2563eb',
  DaemonSet: '#1d4ed8',
  Pod: '#22c55e',
  Service: '#06b6d4',
  ConfigMap: '#eab308',
  Secret: '#ef4444',
  PVC: '#f97316',
  Node: '#64748b',
  Ingress: '#8b5cf6',
  Route: '#a78bfa',
};

function getColor(kind: string): string {
  return KIND_COLORS[kind] ?? '#64748b';
}

// Relationship-aware layout: roots on the left, leaves on the right
interface LayoutNode extends TopoNode {
  x: number;
  y: number;
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  owns: 'owns',
  selects: 'selects',
  mounts: 'mounts',
  references: 'refs',
};

function layoutGraph(nodes: TopoNode[], edges: TopoEdge[]): LayoutNode[] {
  if (nodes.length === 0) return [];

  const nodeIds = new Set(nodes.map(n => n.id));

  // Build adjacency for BFS layering (source → targets)
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (!children.has(e.source)) children.set(e.source, []);
    children.get(e.source)!.push(e.target);
    if (!parents.has(e.target)) parents.set(e.target, []);
    parents.get(e.target)!.push(e.source);
  }

  // Find roots (nodes with no parents) — these go on the left
  const roots = nodes.filter(n => !parents.has(n.id) || parents.get(n.id)!.length === 0);
  if (roots.length === 0) {
    // No clear roots — use kind hierarchy as fallback
    const kindPriority: Record<string, number> = { Node: 0, Service: 1, Deployment: 2, StatefulSet: 2, DaemonSet: 2, ReplicaSet: 3, Pod: 4, ConfigMap: 5, Secret: 5, PVC: 5 };
    roots.push(...nodes.filter(n => (kindPriority[n.kind] ?? 2) <= 2));
    if (roots.length === 0) roots.push(nodes[0]);
  }

  // BFS to assign layers
  const layers = new Map<string, number>();
  const queue: string[] = [];
  for (const r of roots) {
    if (!layers.has(r.id)) {
      layers.set(r.id, 0);
      queue.push(r.id);
    }
  }
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currLayer = layers.get(curr)!;
    for (const child of children.get(curr) ?? []) {
      if (!layers.has(child)) {
        layers.set(child, currLayer + 1);
        queue.push(child);
      }
    }
  }
  // Assign unvisited nodes to layer 0
  for (const n of nodes) {
    if (!layers.has(n.id)) layers.set(n.id, 0);
  }

  // Group by layer
  const byLayer = new Map<number, TopoNode[]>();
  for (const n of nodes) {
    const layer = layers.get(n.id) ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(n);
  }

  const colWidth = 220;
  const rowHeight = 56;
  const paddingX = 40;
  const paddingY = 40;

  const result: LayoutNode[] = [];
  const sortedLayers = [...byLayer.keys()].sort((a, b) => a - b);
  for (const layer of sortedLayers) {
    const group = byLayer.get(layer)!;
    // Sort within layer by kind then name for consistency
    group.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    group.forEach((node, row) => {
      result.push({
        ...node,
        x: paddingX + layer * colWidth,
        y: paddingY + row * rowHeight,
      });
    });
  }
  return result;
}

export default function TopologyView() {
  // Default to the active namespace from uiStore, fallback to 'openshiftpulse'
  const activeNs = useUIStore((s) => s.selectedNamespace);
  const [selectedNamespace, setSelectedNamespace] = useState<string>(
    activeNs && activeNs !== '*' ? activeNs : 'openshiftpulse',
  );
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Always fetch with namespace filter to avoid dumping the entire cluster
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['topology', selectedNamespace],
    queryFn: () => fetchTopology(selectedNamespace || undefined),
    refetchInterval: 120_000,
  });

  // Fetch namespace list separately (lightweight — just needs the node list for distinct namespaces)
  const { data: allData } = useQuery({
    queryKey: ['topology', '__all_ns_list__'],
    queryFn: () => fetchTopology(),
    staleTime: 300_000, // 5 min cache
    refetchOnWindowFocus: false,
  });

  const topology = data ?? { nodes: [], edges: [], summary: { nodes: 0, edges: 0, kinds: {}, last_refresh: 0 } };
  const layout = useMemo(() => layoutGraph(topology.nodes, topology.edges), [topology.nodes, topology.edges]);

  const namespaces = useMemo(() => {
    const ns = new Set<string>();
    for (const n of (allData?.nodes ?? [])) {
      if (n.namespace) ns.add(n.namespace);
    }
    return [...ns].sort();
  }, [allData]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, LayoutNode>();
    for (const n of layout) map.set(n.id, n);
    return map;
  }, [layout]);

  const connectedToHovered = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    const ids = new Set<string>([hoveredNode]);
    for (const e of topology.edges) {
      if (e.source === hoveredNode) ids.add(e.target);
      if (e.target === hoveredNode) ids.add(e.source);
    }
    return ids;
  }, [hoveredNode, topology.edges]);

  const blastRadius = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const visited = new Set<string>([selectedNode]);
    const queue = [selectedNode];
    const adj = new Map<string, string[]>();
    for (const e of topology.edges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source)!.push(e.target);
    }
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const next of adj.get(curr) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return visited;
  }, [selectedNode, topology.edges]);

  const edgeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of topology.edges) {
      map.set(`${e.source}→${e.target}`, e.relationship);
    }
    return map;
  }, [topology.edges]);

  const svgWidth = useMemo(() => {
    if (layout.length === 0) return 800;
    return Math.max(800, Math.max(...layout.map(n => n.x)) + 240);
  }, [layout]);

  const svgHeight = useMemo(() => {
    if (layout.length === 0) return 400;
    return Math.max(400, Math.max(...layout.map(n => n.y)) + 100);
  }, [layout]);

  if (isLoading) {
    return (
      <div className="h-full overflow-auto bg-slate-950 p-6 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full overflow-auto bg-slate-950 p-6 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="mb-4 mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-950/50 border border-red-900/50">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-slate-100 mb-1">Failed to load topology data</h2>
          <p className="text-sm text-red-400 mb-4">{error instanceof Error ? error.message : 'Unknown error'}</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-2 font-medium mx-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-[1400px] mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Network className="w-6 h-6 text-cyan-400" />
              Impact Analysis
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Resource dependencies and blast radius — click a node to see what it affects
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedNamespace}
              onChange={(e) => { setSelectedNamespace(e.target.value); setSelectedNode(null); }}
              className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="">All namespaces</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
            </select>
            <button
              onClick={() => refetch()}
              className="p-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200 transition-colors"
              title="Refresh graph"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3">
          <Card className="p-3">
            <div className="text-xs text-slate-500 mb-1">Resources</div>
            <div className="text-xl font-bold text-slate-100">{topology.nodes.length}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-slate-500 mb-1">Relationships</div>
            <div className="text-xl font-bold text-slate-100">{topology.edges.length}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-slate-500 mb-1">Resource Types</div>
            <div className="text-xl font-bold text-slate-100">
              {new Set(topology.nodes.map(n => n.kind)).size}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-slate-500 mb-1">
              {selectedNode ? 'Blast Radius' : 'Click a node'}
            </div>
            <div className="text-xl font-bold text-slate-100">
              {selectedNode ? blastRadius.size - 1 : '-'}
            </div>
          </Card>
        </div>

        {/* Legend */}
        {topology.nodes.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {[...new Set(topology.nodes.map(n => n.kind))].sort().map((kind) => (
              <div key={kind} className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: getColor(kind) }} />
                {kind} ({topology.nodes.filter(n => n.kind === kind).length})
              </div>
            ))}
          </div>
        )}

        {/* Graph */}
        {topology.nodes.length === 0 ? (
          <EmptyState
            icon={<Network className="w-8 h-8 text-slate-500" />}
            title="No topology data"
            description="The dependency graph is built during scan cycles. It will populate as the monitor scans your cluster."
          />
        ) : (
          <Card className="overflow-auto">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full"
              style={{ minHeight: Math.min(svgHeight, 600) }}
            >
              {/* Edges with curved paths */}
              {topology.edges.map((edge, i) => {
                const from = nodeMap.get(edge.source);
                const to = nodeMap.get(edge.target);
                if (!from || !to) return null;

                const isHighlighted = hoveredNode
                  ? connectedToHovered.has(edge.source) && connectedToHovered.has(edge.target)
                  : selectedNode
                    ? blastRadius.has(edge.source) && blastRadius.has(edge.target)
                    : false;

                const opacity = hoveredNode || selectedNode
                  ? isHighlighted ? 0.8 : 0.06
                  : 0.3;

                const x1 = from.x + 160;
                const y1 = from.y + 18;
                const x2 = to.x;
                const y2 = to.y + 18;
                const midX = (x1 + x2) / 2;

                const relLabel = RELATIONSHIP_LABELS[edge.relationship] || edge.relationship;

                return (
                  <g key={`${edge.source}:${edge.target}`}>
                    <path
                      d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={isHighlighted ? '#06b6d4' : '#334155'}
                      strokeWidth={isHighlighted ? 2 : 1}
                      opacity={opacity}
                    />
                    {/* Relationship label on highlighted edges */}
                    {isHighlighted && (
                      <text
                        x={midX}
                        y={(y1 + y2) / 2 - 4}
                        fill="#06b6d4"
                        fontSize={8}
                        textAnchor="middle"
                        opacity={0.8}
                      >
                        {relLabel}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {layout.map((node) => {
                const isHovered = hoveredNode === node.id;
                const isConnected = connectedToHovered.has(node.id);
                const isInBlast = blastRadius.has(node.id);
                const isSelected = selectedNode === node.id;
                const dimmed = (hoveredNode && !isConnected) || (selectedNode && !isInBlast);

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}
                    className="cursor-pointer"
                    opacity={dimmed ? 0.12 : 1}
                  >
                    <rect
                      x={0} y={0} width={160} height={36} rx={6}
                      fill={isSelected ? getColor(node.kind) + '33' : '#0f172a'}
                      stroke={isSelected ? getColor(node.kind) : isHovered ? '#94a3b8' : '#334155'}
                      strokeWidth={isSelected ? 2 : 1}
                    />
                    <rect x={0} y={0} width={4} height={36} rx={2} fill={getColor(node.kind)} />
                    <text x={14} y={14} fill={getColor(node.kind)} fontSize={9} fontWeight={600}>
                      {node.kind}
                    </text>
                    <text x={14} y={27} fill="#cbd5e1" fontSize={10} fontFamily="monospace">
                      {node.name.length > 18 ? node.name.slice(0, 17) + '\u2026' : node.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </Card>
        )}

        {/* Selected node detail */}
        {selectedNode && (() => {
          const node = nodeMap.get(selectedNode);
          if (!node) return null;
          const upstream = topology.edges
            .filter(e => e.target === selectedNode)
            .map(e => ({ node: nodeMap.get(e.source), rel: e.relationship }))
            .filter((x): x is { node: LayoutNode; rel: string } => !!x.node);
          const downstream = topology.edges
            .filter(e => e.source === selectedNode)
            .map(e => ({ node: nodeMap.get(e.target), rel: e.relationship }))
            .filter((x): x is { node: LayoutNode; rel: string } => !!x.node);
          return (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getColor(node.kind) }} />
                <span className="text-sm font-semibold text-slate-200">{node.kind}/{node.name}</span>
                {node.namespace && (
                  <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{node.namespace}</span>
                )}
                <span className="text-xs text-slate-600 ml-auto">
                  Blast radius: {blastRadius.size - 1} resource{blastRadius.size - 1 !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Upstream (depends on)</h4>
                  {upstream.length === 0 ? (
                    <span className="text-xs text-slate-600">None</span>
                  ) : (
                    <div className="space-y-1">
                      {upstream.map(({ node: n, rel }) => (
                        <div key={n.id} className="text-xs font-mono text-slate-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getColor(n.kind) }} />
                          {n.kind}/{n.name}
                          <span className="text-slate-600 text-[10px]">({rel})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Downstream (blast radius)</h4>
                  {downstream.length === 0 ? (
                    <span className="text-xs text-slate-600">None</span>
                  ) : (
                    <div className="space-y-1">
                      {downstream.map(({ node: n, rel }) => (
                        <div key={n.id} className="text-xs font-mono text-slate-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getColor(n.kind) }} />
                          {n.kind}/{n.name}
                          <span className="text-slate-600 text-[10px]">({rel})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })()}
      </div>
    </div>
  );
}
