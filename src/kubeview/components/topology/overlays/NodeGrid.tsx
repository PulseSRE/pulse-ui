import React, { useState, useMemo } from 'react';
import type { MapNode } from '../types';
import { HEALTH_COLORS } from '../constants';
import { Server } from 'lucide-react';

interface NodeGridProps {
  nodes: MapNode[];
  clusterName: string;
  onNodeClick?: (node: MapNode) => void;
}

export function NodeGrid({ nodes, clusterName, onNodeClick }: NodeGridProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredNode = nodes.find(n => n.id === hoveredId) || null;

  // Sort: unhealthy first (must be before early return — hooks can't be conditional)
  const sorted = useMemo(() => [...nodes].sort((a, b) => a.healthScore - b.healthScore), [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="text-center text-slate-400 py-8">
        <p className="text-sm">No nodes found in {clusterName}</p>
        <p className="text-xs text-slate-500 mt-1">Connect to the cluster to see its nodes</p>
      </div>
    );
  }

  // Summary stats
  const totalPods = nodes.reduce((s, n) => s + n.podCount, 0);
  const readyCount = nodes.filter(n => n.status === 'Ready').length;
  const avgHealth = Math.round(nodes.reduce((s, n) => s + n.healthScore, 0) / nodes.length);

  return (
    <div className="w-full h-full flex flex-col px-5 pt-1">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{clusterName}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Click a node to see its pods</p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="text-center">
            <div className="text-slate-100 font-semibold text-lg">{nodes.length}</div>
            <div className="text-slate-500">Nodes</div>
          </div>
          <div className="text-center">
            <div className="text-slate-100 font-semibold text-lg">{totalPods}</div>
            <div className="text-slate-500">Pods</div>
          </div>
          <div className="text-center">
            <div className="font-semibold text-lg" style={{ color: HEALTH_COLORS[avgHealth >= 90 ? 'healthy' : avgHealth >= 70 ? 'warning' : avgHealth >= 50 ? 'degraded' : 'critical'] }}>{avgHealth}%</div>
            <div className="text-slate-500">Health</div>
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div className="flex h-2 rounded-full overflow-hidden bg-slate-800 mb-4 shrink-0">
        <div style={{ width: `${(readyCount / nodes.length) * 100}%` }} className="bg-emerald-500/70" />
        <div style={{ width: `${((nodes.length - readyCount) / nodes.length) * 100}%` }} className="bg-red-500/70" />
      </div>

      {/* Node visual grid */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        <div className="grid grid-cols-2 gap-2.5">
          {sorted.map(node => {
            const color = HEALTH_COLORS[node.healthGrade];
            const isHovered = hoveredId === node.id;

            return (
              <button
                key={node.id}
                onClick={() => onNodeClick?.(node)}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`
                  text-left rounded-lg border transition-all relative overflow-hidden
                  ${isHovered
                    ? 'bg-slate-800 border-slate-600 scale-[1.01] shadow-lg'
                    : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'}
                `}
                aria-label={`Node ${node.name}, ${node.healthGrade}, ${node.podCount} pods`}
              >
                {/* Health indicator stripe */}
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg" style={{ backgroundColor: color }} />

                <div className="pl-4 pr-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Server className="w-4 h-4 shrink-0" style={{ color }} />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-200 truncate" title={node.name}>
                          {node.name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-500">{node.podCount} pods</span>
                          {node.instanceType && (
                            <span className="text-xs text-slate-600">{node.instanceType}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Health ring */}
                    <div className="shrink-0">
                      <svg width="36" height="36" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="14" fill="none" stroke="#1e293b" strokeWidth="3" />
                        <circle
                          cx="18" cy="18" r="14"
                          fill="none" stroke={color} strokeWidth="3"
                          strokeDasharray={`${(node.healthScore / 100) * 88} 88`}
                          transform="rotate(-90 18 18)"
                          strokeLinecap="round"
                        />
                        <text x="18" y="18" textAnchor="middle" dominantBaseline="central" fill={color} fontSize="9" fontWeight="700" fontFamily="system-ui, sans-serif">
                          {node.healthScore}
                        </text>
                      </svg>
                    </div>
                  </div>

                  {/* Pressure conditions */}
                  {node.conditions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {node.conditions.map(c => (
                        <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          {c.replace('Pressure', '')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
