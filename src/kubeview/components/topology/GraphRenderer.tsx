/**
 * GraphRenderer — SVG-based dependency graph with risk overlay and health status.
 *
 * Supports 3 layout strategies: top-down (default), left-to-right, grouped.
 * Renders nodes with kind-color bars, health dots, risk badges, metric bars,
 * and grouped container boxes.
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
  group?: string;
  metrics?: {
    cpu_usage: string;
    cpu_capacity: string;
    cpu_percent: number;
    memory_usage: string;
    memory_capacity: string;
    memory_percent: number;
  };
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
  Job: '#1e40af',
  CronJob: '#1e3a8a',
  Pod: '#22c55e',
  Service: '#06b6d4',
  ConfigMap: '#eab308',
  Secret: '#ef4444',
  PVC: '#f97316',
  Node: '#64748b',
  Ingress: '#8b5cf6',
  Route: '#a78bfa',
  HPA: '#14b8a6',
  NetworkPolicy: '#6366f1',
  ServiceAccount: '#f472b6',
  HelmRelease: '#a855f7',
  Summary: '#475569',
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
  routes_to: 'routes',
  applies_to: 'policy',
  scales: 'scales',
  manages: 'manages',
  uses: 'uses',
};

const KIND_PRIORITY: Record<string, number> = {
  HelmRelease: 0, Route: 1, Ingress: 1, HPA: 1, NetworkPolicy: 1,
  Node: 0, Service: 2, Deployment: 3, StatefulSet: 3, DaemonSet: 3,
  CronJob: 3, Job: 4, ReplicaSet: 4, Pod: 5,
  ServiceAccount: 6, ConfigMap: 6, Secret: 6, PVC: 6,
};

export function getKindColor(kind: string): string {
  return KIND_COLORS[kind] ?? '#64748b';
}

// ── Layout helpers ───────────────────────────────────────────────────

function bfsLayers(nodes: TopoNode[], edges: TopoEdge[]): Map<string, number> {
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
    roots.push(...nodes.filter(n => (KIND_PRIORITY[n.kind] ?? 3) <= 2));
    if (roots.length === 0) roots.push(nodes[0]);
  }

  const layers = new Map<string, number>();
  const queue: string[] = [];
  for (const r of roots) {
    if (!layers.has(r.id)) { layers.set(r.id, 0); queue.push(r.id); }
  }
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currLayer = layers.get(curr)!;
    for (const child of children.get(curr) ?? []) {
      const existing = layers.get(child);
      if (existing === undefined || existing < currLayer + 1) {
        layers.set(child, currLayer + 1);
        queue.push(child);
      }
    }
  }
  for (const n of nodes) {
    if (!layers.has(n.id)) layers.set(n.id, 0);
  }
  return layers;
}

function groupByLayer(nodes: TopoNode[], layers: Map<string, number>): Map<number, TopoNode[]> {
  const byLayer = new Map<number, TopoNode[]>();
  for (const n of nodes) {
    const layer = layers.get(n.id) ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(n);
  }
  return byLayer;
}

// ── Layout strategies ────────────────────────────────────────────────

export function layoutTopDown(nodes: TopoNode[], edges: TopoEdge[]): LayoutNode[] {
  if (nodes.length === 0) return [];

  const layers = bfsLayers(nodes, edges);
  const byLayer = groupByLayer(nodes, layers);

  const colWidth = 260;
  const rowHeight = 64;
  const paddingX = 30;
  const paddingY = 30;
  const maxPerLayer = 6;

  const result: LayoutNode[] = [];
  let globalYOffset = 0;

  for (const layer of [...byLayer.keys()].sort((a, b) => a - b)) {
    const group = byLayer.get(layer)!;
    group.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    const rows = Math.ceil(group.length / maxPerLayer);
    group.forEach((node, idx) => {
      const col = idx % maxPerLayer;
      const row = Math.floor(idx / maxPerLayer);
      result.push({ ...node, x: paddingX + col * colWidth, y: paddingY + globalYOffset + row * rowHeight });
    });
    globalYOffset += rows * rowHeight + 40;
  }
  return result;
}

export const layoutGraph = layoutTopDown;

export function layoutLeftToRight(nodes: TopoNode[], edges: TopoEdge[]): LayoutNode[] {
  if (nodes.length === 0) return [];

  const layers = bfsLayers(nodes, edges);
  const byLayer = groupByLayer(nodes, layers);

  const colWidth = 260;
  const rowHeight = 64;
  const paddingX = 30;
  const paddingY = 30;

  const result: LayoutNode[] = [];
  let globalXOffset = 0;

  for (const layer of [...byLayer.keys()].sort((a, b) => a - b)) {
    const group = byLayer.get(layer)!;
    group.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    group.forEach((node, idx) => {
      result.push({ ...node, x: paddingX + globalXOffset, y: paddingY + idx * rowHeight });
    });
    globalXOffset += colWidth;
  }
  return result;
}

export function layoutGrouped(nodes: TopoNode[], _edges: TopoEdge[]): LayoutNode[] {
  if (nodes.length === 0) return [];

  const groups = new Map<string, TopoNode[]>();
  for (const n of nodes) {
    const g = n.group ?? 'default';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(n);
  }

  const nodeWidth = 170;
  const rowHeight = 50;
  const groupGap = 30;
  const headerHeight = 28;
  const internalPadding = 16;
  const paddingX = 30;
  const paddingY = 30;
  const maxGroupsPerRow = 3;
  const nodesPerRow = 2;

  const groupEntries = [...groups.entries()];
  const groupHeights = groupEntries.map(([, members]) => {
    const rows = Math.ceil(members.length / nodesPerRow);
    return headerHeight + internalPadding * 2 + rows * rowHeight;
  });
  const maxGroupWidth = nodeWidth * nodesPerRow + internalPadding * 2;

  const result: LayoutNode[] = [];

  groupEntries.forEach(([, members], gIdx) => {
    const groupCol = gIdx % maxGroupsPerRow;
    const groupRow = Math.floor(gIdx / maxGroupsPerRow);

    let yOffset = 0;
    for (let r = 0; r < groupRow; r++) {
      const rowStart = r * maxGroupsPerRow;
      const rowEnd = Math.min(rowStart + maxGroupsPerRow, groupHeights.length);
      yOffset += Math.max(...groupHeights.slice(rowStart, rowEnd)) + groupGap;
    }

    const groupX = paddingX + groupCol * (maxGroupWidth + groupGap);
    const groupY = paddingY + yOffset;

    members.forEach((node, idx) => {
      const col = idx % nodesPerRow;
      const row = Math.floor(idx / nodesPerRow);
      result.push({
        ...node,
        x: groupX + internalPadding + col * nodeWidth,
        y: groupY + headerHeight + internalPadding + row * rowHeight,
      });
    });
  });
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
  layoutHint?: 'top-down' | 'left-to-right' | 'grouped';
  includeMetrics?: boolean;
}

export default function GraphRenderer({
  nodes, edges, hoveredNode, setHoveredNode, selectedNode, setSelectedNode,
  layoutHint, includeMetrics,
}: GraphRendererProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const layout = useMemo(() => {
    if (layoutHint === 'left-to-right') return layoutLeftToRight(nodes, edges);
    if (layoutHint === 'grouped') return layoutGrouped(nodes, edges);
    return layoutTopDown(nodes, edges);
  }, [nodes, edges, layoutHint]);

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

        {/* Group containers (for grouped layout) */}
        {layoutHint === 'grouped' && (() => {
          const groupMap = new Map<string, LayoutNode[]>();
          for (const n of layout) {
            const g = n.group ?? 'default';
            if (!groupMap.has(g)) groupMap.set(g, []);
            groupMap.get(g)!.push(n);
          }
          return [...groupMap.entries()].map(([groupName, members]) => {
            const nodeH = includeMetrics ? 52 : 44;
            const minX = Math.min(...members.map(m => m.x)) - 16;
            const minY = Math.min(...members.map(m => m.y)) - 28;
            const maxX = Math.max(...members.map(m => m.x)) + 176;
            const maxY = Math.max(...members.map(m => m.y)) + nodeH;
            return (
              <g key={`group-${groupName}`}>
                <rect
                  x={minX} y={minY}
                  width={maxX - minX} height={maxY - minY}
                  rx={8} fill="#0f172a" fillOpacity={0.5}
                  stroke="#334155" strokeWidth={1} strokeDasharray="4 2"
                />
                <text x={minX + 8} y={minY + 16} fill="#94a3b8" fontSize={11} fontWeight={600}>
                  {groupName}
                </text>
              </g>
            );
          });
        })()}

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

          const nodeH = includeMetrics && from.metrics ? 44 : 36;
          let d: string;
          let labelX: number;
          let labelY: number;

          if (layoutHint === 'left-to-right') {
            const x1 = from.x + 160;
            const y1 = from.y + nodeH / 2;
            const x2 = to.x;
            const y2 = to.y + nodeH / 2;
            const midX = (x1 + x2) / 2;
            d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
            labelX = midX;
            labelY = (y1 + y2) / 2 - 4;
          } else {
            const x1 = from.x + 80;
            const y1 = from.y + nodeH;
            const x2 = to.x + 80;
            const y2 = to.y;
            const midY = (y1 + y2) / 2;
            d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
            labelX = (x1 + x2) / 2;
            labelY = midY - 4;
          }

          const relLabel = RELATIONSHIP_LABELS[edge.relationship] || edge.relationship;

          return (
            <g key={`${edge.source}:${edge.target}`}>
              <path
                d={d}
                fill="none"
                stroke={isHighlighted ? '#06b6d4' : '#334155'}
                strokeWidth={isHighlighted ? 2 : 1}
                opacity={opacity}
              />
              {isHighlighted && (
                <text
                  x={labelX}
                  y={labelY}
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
          const borderColor = isSelected
            ? kindColor
            : riskBorder ?? (isHovered ? '#94a3b8' : '#334155');
          const borderWidth = isSelected || riskBorder ? 2 : 1;
          const nodeH = includeMetrics && node.metrics ? 48 : 36;

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
                x={0} y={0} width={160} height={nodeH} rx={6}
                fill={isSelected ? kindColor + '33' : '#0f172a'}
                stroke={borderColor}
                strokeWidth={borderWidth}
              />
              {/* Kind color bar */}
              <rect x={0} y={0} width={4} height={nodeH} rx={2} fill={kindColor} />
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
              {/* Metric bars */}
              {includeMetrics && node.metrics && (() => {
                const m = node.metrics!;
                const barWidth = 130;
                const cpuColor = m.cpu_percent >= 80 ? '#ef4444' : m.cpu_percent >= 60 ? '#eab308' : '#3b82f6';
                const memColor = m.memory_percent >= 80 ? '#ef4444' : m.memory_percent >= 60 ? '#eab308' : '#22c55e';
                return (
                  <g data-testid="metric-bar">
                    <title>{`CPU: ${m.cpu_usage}/${m.cpu_capacity} (${m.cpu_percent}%) | Memory: ${m.memory_usage}/${m.memory_capacity} (${m.memory_percent}%)`}</title>
                    <rect x={14} y={32} width={barWidth} height={5} rx={2} fill="#1e293b" />
                    <rect x={14} y={32} width={barWidth * m.cpu_percent / 100} height={5} rx={2} fill={cpuColor} />
                    <rect x={14} y={39} width={barWidth} height={5} rx={2} fill="#1e293b" />
                    <rect x={14} y={39} width={barWidth * m.memory_percent / 100} height={5} rx={2} fill={memColor} />
                  </g>
                );
              })()}
            </g>
          );
        })}
      </svg>
    </Card>
  );
}
