/**
 * GraphRenderer — SVG-based dependency graph with risk overlay and health status.
 *
 * Extracted from TopologyView to keep the view layer thin.
 * Renders nodes with:
 *   - Risk-colored borders (green/yellow/orange/red)
 *   - Health status dots (healthy/warning/error)
 *   - Pulsing glow for recently changed resources
 *   - Blast radius highlighting on click
 */

import { useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { Card } from '../primitives/Card';

// ── Types ─────────────────────────────────────────────────────────────

export interface TopoNode {
  id: string;
  kind: string;
  name: string;
  namespace: string;
  status?: 'healthy' | 'warning' | 'error';
  risk?: number;
  riskLevel?: 'critical' | 'high' | 'medium' | 'low';
  recentlyChanged?: boolean;
}

export interface TopoEdge {
  source: string;
  target: string;
  relationship: string;
}

export interface LayoutNode extends TopoNode {
  x: number;
  y: number;
}

// ── Constants ─────────────────────────────────────────────────────────

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

const RISK_BORDER_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  healthy: '#22c55e',
  warning: '#eab308',
  error: '#ef4444',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  owns: 'owns',
  selects: 'selects',
  mounts: 'mounts',
  references: 'refs',
  schedules: 'schedules',
};

export function getKindColor(kind: string): string {
  return KIND_COLORS[kind] ?? '#64748b';
}

// ── Layout ────────────────────────────────────────────────────────────

export function layoutGraph(nodes: TopoNode[], edges: TopoEdge[]): LayoutNode[] {
  if (nodes.length === 0) return [];

  const nodeIds = new Set(nodes.map(n => n.id));

  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (!children.has(e.source)) children.set(e.source, []);
    children.get(e.source)!.push(e.target);
    if (!parents.has(e.target)) parents.set(e.target, []);
    parents.get(e.target)!.push(e.source);
  }

  const roots = nodes.filter(n => !parents.has(n.id) || parents.get(n.id)!.length === 0);
  if (roots.length === 0) {
    const kindPriority: Record<string, number> = {
      Node: 0, Service: 1, Deployment: 2, StatefulSet: 2, DaemonSet: 2,
      ReplicaSet: 3, Pod: 4, ConfigMap: 5, Secret: 5, PVC: 5,
    };
    roots.push(...nodes.filter(n => (kindPriority[n.kind] ?? 2) <= 2));
    if (roots.length === 0) roots.push(nodes[0]);
  }

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
  for (const n of nodes) {
    if (!layers.has(n.id)) layers.set(n.id, 0);
  }

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
  for (const layer of [...byLayer.keys()].sort((a, b) => a - b)) {
    const group = byLayer.get(layer)!;
    group.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    group.forEach((node, row) => {
      result.push({ ...node, x: paddingX + layer * colWidth, y: paddingY + row * rowHeight });
    });
  }
  return result;
}

// ── Component ─────────────────────────────────────────────────────────

interface GraphRendererProps {
  nodes: TopoNode[];
  edges: TopoEdge[];
  hoveredNode: string | null;
  setHoveredNode: Dispatch<SetStateAction<string | null>>;
  selectedNode: string | null;
  setSelectedNode: Dispatch<SetStateAction<string | null>>;
}

export default function GraphRenderer({
  nodes,
  edges,
  hoveredNode,
  setHoveredNode,
  selectedNode,
  setSelectedNode,
}: GraphRendererProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const layout = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, LayoutNode>();
    for (const n of layout) map.set(n.id, n);
    return map;
  }, [layout]);

  const connectedToHovered = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    const ids = new Set<string>([hoveredNode]);
    for (const e of edges) {
      if (e.source === hoveredNode) ids.add(e.target);
      if (e.target === hoveredNode) ids.add(e.source);
    }
    return ids;
  }, [hoveredNode, edges]);

  const blastRadius = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const visited = new Set<string>([selectedNode]);
    const queue = [selectedNode];
    const adj = new Map<string, string[]>();
    for (const e of edges) {
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
  }, [selectedNode, edges]);

  const svgWidth = useMemo(() => {
    if (layout.length === 0) return 800;
    return Math.max(800, Math.max(...layout.map(n => n.x)) + 240);
  }, [layout]);

  const svgHeight = useMemo(() => {
    if (layout.length === 0) return 400;
    return Math.max(400, Math.max(...layout.map(n => n.y)) + 100);
  }, [layout]);

  return (
    <Card className="overflow-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full"
        style={{ minHeight: Math.min(svgHeight, 600) }}
      >
        {/* Pulsing glow filter for recently changed nodes */}
        <defs>
          <filter id="pulse-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feFlood floodColor="#f97316" floodOpacity="0.6" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <style>{`
            @keyframes pulse-opacity {
              0%, 100% { opacity: 0.4; }
              50% { opacity: 1; }
            }
            .node-pulse { animation: pulse-opacity 2s ease-in-out infinite; }
          `}</style>
        </defs>

        {/* Edges */}
        {edges.map((edge) => {
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

          const kindColor = getKindColor(node.kind);
          const riskBorder = node.riskLevel
            ? RISK_BORDER_COLORS[node.riskLevel]
            : undefined;
          const statusColor = STATUS_DOT_COLORS[node.status ?? 'healthy'];

          // Border color priority: selected > risk > hover > default
          const borderColor = isSelected
            ? kindColor
            : riskBorder ?? (isHovered ? '#94a3b8' : '#334155');
          const borderWidth = isSelected || riskBorder ? 2 : 1;

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}
              className="cursor-pointer"
              opacity={dimmed ? 0.12 : 1}
              filter={node.recentlyChanged ? 'url(#pulse-glow)' : undefined}
            >
              {/* Node body */}
              <rect
                x={0} y={0} width={160} height={36} rx={6}
                fill={isSelected ? kindColor + '33' : '#0f172a'}
                stroke={borderColor}
                strokeWidth={borderWidth}
              />
              {/* Kind color bar */}
              <rect x={0} y={0} width={4} height={36} rx={2} fill={kindColor} />
              {/* Health status dot */}
              <circle
                cx={150} cy={8} r={4}
                fill={statusColor}
                className={node.recentlyChanged ? 'node-pulse' : undefined}
              />
              {/* Kind label */}
              <text x={14} y={14} fill={kindColor} fontSize={9} fontWeight={600}>
                {node.kind}
              </text>
              {/* Name */}
              <text x={14} y={27} fill="#cbd5e1" fontSize={10} fontFamily="monospace">
                {node.name.length > 18 ? node.name.slice(0, 17) + '\u2026' : node.name}
              </text>
              {/* Risk badge (if risk > 0) */}
              {node.risk != null && node.risk > 0 && (
                <g transform="translate(130, 22)">
                  <rect x={0} y={0} width={26} height={14} rx={3}
                    fill={RISK_BORDER_COLORS[node.riskLevel ?? 'low'] + '33'}
                    stroke={RISK_BORDER_COLORS[node.riskLevel ?? 'low']}
                    strokeWidth={0.5}
                  />
                  <text x={13} y={10} fill={RISK_BORDER_COLORS[node.riskLevel ?? 'low']}
                    fontSize={8} textAnchor="middle" fontWeight={600}>
                    {node.risk}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </Card>
  );
}
