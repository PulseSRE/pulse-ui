import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, GitBranch, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildDependencyGraph, type DependencyGraph, type GraphNode } from '@/lib/dependencyGraph';
import { useUIStore } from '../store/uiStore';
import { resourceDetailUrl } from '../engine/gvr';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { pluralToKind } from '../engine/renderers/index';
import { Card } from '../components/primitives/Card';

interface DependencyViewProps {
  gvrKey: string;
  namespace?: string;
  name: string;
}

const kindColors: Record<string, string> = {
  Deployment: '#3b82f6',
  ReplicaSet: '#60a5fa',
  StatefulSet: '#2563eb',
  DaemonSet: '#1d4ed8',
  Pod: '#22c55e',
  Service: '#06b6d4',
  Ingress: '#8b5cf6',
  Route: '#a78bfa',
  ConfigMap: '#eab308',
  Secret: '#ef4444',
  HPA: '#f97316',
  PDB: '#7c3aed',
  NetworkPolicy: '#dc2626',
  Job: '#0ea5e9',
  CronJob: '#0284c7',
  Node: '#64748b',
};

function getColor(kind: string): string {
  return kindColors[kind] ?? '#64748b';
}

// Kind-to-GVR mapping for dependency graph node navigation
const kindGvrMap: Record<string, string> = {
  Pod: 'v1', Service: 'v1', ConfigMap: 'v1', Secret: 'v1',
  Deployment: 'apps/v1', ReplicaSet: 'apps/v1', StatefulSet: 'apps/v1', DaemonSet: 'apps/v1',
  Job: 'batch/v1', CronJob: 'batch/v1',
  Ingress: 'networking.k8s.io/v1', NetworkPolicy: 'networking.k8s.io/v1',
  HPA: 'autoscaling/v2', PDB: 'policy/v1', Route: 'route.openshift.io/v1',
};

function getGvrUrl(kind: string, namespace: string, name: string): string {
  const apiVersion = kindGvrMap[kind] || 'v1';
  return resourceDetailUrl({ apiVersion, kind, metadata: { name, namespace } });
}

interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  layer: number;
}

function layoutGraph(graph: DependencyGraph): LayoutNode[] {
  if (graph.nodes.length === 0) return [];

  const layers = new Map<string, number>();
  const queue = [graph.rootId];
  layers.set(graph.rootId, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layers.get(current)!;
    for (const edge of graph.edges) {
      const neighbor = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (neighbor && !layers.has(neighbor)) {
        const isParent = edge.to === current;
        layers.set(neighbor, isParent ? currentLayer - 1 : currentLayer + 1);
        queue.push(neighbor);
      }
    }
  }

  const minLayer = Math.min(...Array.from(layers.values()));
  for (const [id, layer] of layers) {
    layers.set(id, layer - minLayer);
  }

  const layerGroups = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    const group = layerGroups.get(layer) ?? [];
    group.push(id);
    layerGroups.set(layer, group);
  }

  const colWidth = 220;
  const rowHeight = 64;
  const paddingX = 40;
  const paddingY = 40;

  return graph.nodes.map((node) => {
    const layer = layers.get(node.id) ?? 0;
    const group = layerGroups.get(layer) ?? [node.id];
    const indexInGroup = group.indexOf(node.id);
    return {
      ...node,
      x: paddingX + layer * colWidth,
      y: paddingY + indexInGroup * rowHeight,
      layer,
    };
  });
}

export default function DependencyView({ gvrKey, namespace, name }: DependencyViewProps) {
  const go = useNavigateTab();

  // Extract kind from gvrKey
  const kind = useMemo(() => {
    const parts = gvrKey.split('/');
    const plural = parts[parts.length - 1];
    return pluralToKind(plural);
  }, [gvrKey]);

  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [blastRadiusNode, setBlastRadiusNode] = useState<string | null>(null);

  useEffect(() => {
    if (!namespace) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    buildDependencyGraph(kind, name, namespace).then((g) => {
      if (!cancelled) { setGraph(g); setLoading(false); }
    }).catch((err) => {
      if (!cancelled) {
        setFetchError(err instanceof Error ? err.message : 'Failed to load dependency data');
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [kind, name, namespace]);

  const layoutNodes = useMemo(() => graph ? layoutGraph(graph) : [], [graph]);

  const connectedToHovered = useMemo(() => {
    if (!hoveredNode || !graph) return new Set<string>();
    const ids = new Set<string>([hoveredNode]);
    for (const e of graph.edges) {
      if (e.from === hoveredNode) ids.add(e.to);
      if (e.to === hoveredNode) ids.add(e.from);
    }
    return ids;
  }, [hoveredNode, graph]);

  const blastRadius = useMemo(() => {
    if (!blastRadiusNode || !graph) return new Set<string>();
    const affected = new Set<string>([blastRadiusNode]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of graph.edges) {
        if (affected.has(e.from) && !affected.has(e.to)) { affected.add(e.to); changed = true; }
      }
    }
    return affected;
  }, [blastRadiusNode, graph]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    if (!node.namespace) return;
    const path = getGvrUrl(node.kind, node.namespace, node.name);
    go(path, node.name);
  }, [go]);

  const gvrUrl = gvrKey.replace(/\//g, '~');

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Building dependency graph...
        </div>
      </div>
    );
  }

  if (!namespace) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950 text-slate-400">
        Dependency graph requires a namespaced resource.
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="h-full flex flex-col bg-slate-950">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-3">
          <button onClick={() => go(`/r/${gvrUrl}/${namespace}/${name}`, name)} className="p-1 rounded hover:bg-slate-800 text-slate-400">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <GitBranch className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-slate-200">Dependencies: {name}</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
            Failed to load dependency data
          </div>
        </div>
      </div>
    );
  }

  if (!graph || graph.nodes.length <= 1) {
    return (
      <div className="h-full flex flex-col bg-slate-950">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-3">
          <button onClick={() => go(`/r/${gvrUrl}/${namespace}/${name}`, name)} className="p-1 rounded hover:bg-slate-800 text-slate-400">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <GitBranch className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-slate-200">Dependencies: {name}</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-slate-400">
          No dependencies found for this resource.
        </div>
      </div>
    );
  }

  const maxLayer = Math.max(...layoutNodes.map((n) => n.layer));
  const maxInLayer = Math.max(...Array.from(
    layoutNodes.reduce((m, n) => { m.set(n.layer, (m.get(n.layer) ?? 0) + 1); return m; }, new Map<number, number>()).values()
  ));

  const svgWidth = Math.max(700, (maxLayer + 1) * 220 + 80);
  const svgHeight = Math.max(300, maxInLayer * 64 + 80);
  const uniqueKinds = [...new Set(graph.nodes.map((n) => n.kind))];

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => go(`/r/${gvrUrl}/${namespace}/${name}`, name)} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <GitBranch className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-slate-200">Dependencies: {name}</span>
          <span className="text-xs text-slate-500">{graph.nodes.length} resources, {graph.edges.length} relationships</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {uniqueKinds.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded" style={{ backgroundColor: `${getColor(k)}20`, color: getColor(k) }}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getColor(k) }} />
              {k}
            </span>
          ))}
        </div>
      </div>

      {/* Graph */}
      <div className="flex-1 overflow-auto p-4">
        <div className="text-xs text-slate-500 mb-2">Click a node to navigate · Right-click to highlight blast radius</div>
        <Card className="overflow-auto">
          <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ minHeight: 300 }}>
            <defs>
              <marker id="kv-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#64748b" />
              </marker>
              <marker id="kv-arrow-red" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#ef4444" />
              </marker>
            </defs>

            {/* Edges */}
            {graph.edges.map((e, i) => {
              const from = layoutNodes.find((n) => n.id === e.from);
              const to = layoutNodes.find((n) => n.id === e.to);
              if (!from || !to) return null;

              const isBlast = blastRadiusNode && blastRadius.has(e.from) && blastRadius.has(e.to);
              const dimmed = hoveredNode && !connectedToHovered.has(e.from) && !connectedToHovered.has(e.to);

              return (
                <g key={i}>
                  <line
                    x1={from.x + 140} y1={from.y + 18}
                    x2={to.x - 2} y2={to.y + 18}
                    stroke={isBlast ? '#ef4444' : dimmed ? '#334155' : '#475569'}
                    strokeWidth={isBlast ? 2 : 1}
                    strokeDasharray={isBlast ? '' : '4,3'}
                    markerEnd={isBlast ? 'url(#kv-arrow-red)' : 'url(#kv-arrow)'}
                    opacity={dimmed ? 0.3 : 1}
                  />
                  {!dimmed && (
                    <text
                      x={(from.x + 140 + to.x - 2) / 2}
                      y={(from.y + to.y) / 2 + 12}
                      textAnchor="middle" fontSize={9} fill="#64748b"
                    >
                      {e.relationship}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {layoutNodes.map((node) => {
              const isRoot = node.id === graph.rootId;
              const dimmed = hoveredNode && hoveredNode !== node.id && !connectedToHovered.has(node.id);
              const isBlast = blastRadiusNode && blastRadius.has(node.id);
              const color = getColor(node.kind);

              return (
                <g
                  key={node.id}
                  style={{ cursor: 'pointer', opacity: dimmed ? 0.2 : 1, transition: 'opacity 0.15s' }}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => handleNodeClick(node)}
                  onContextMenu={(e) => { e.preventDefault(); setBlastRadiusNode((p) => p === node.id ? null : node.id); }}
                >
                  <rect
                    x={node.x} y={node.y}
                    width={138} height={36}
                    rx={6}
                    fill={isBlast ? 'rgba(239,68,68,0.15)' : `${color}15`}
                    stroke={isRoot ? color : isBlast ? '#ef4444' : `${color}40`}
                    strokeWidth={isRoot ? 2 : 1}
                  />
                  <circle cx={node.x + 14} cy={node.y + 18} r={5} fill={color} />
                  <text x={node.x + 24} y={node.y + 15} fontSize={11} fontWeight={isRoot ? 700 : 500} fill="#e2e8f0">
                    {node.name.length > 15 ? node.name.slice(0, 14) + '…' : node.name}
                  </text>
                  <text x={node.x + 24} y={node.y + 28} fontSize={9} fill="#64748b">
                    {node.kind}{node.status ? ` · ${node.status}` : ''}
                  </text>
                </g>
              );
            })}
          </svg>
        </Card>
      </div>
    </div>
  );
}
