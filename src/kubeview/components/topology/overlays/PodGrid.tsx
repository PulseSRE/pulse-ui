import React, { useState } from 'react';
import type { MapPod } from '../types';
import type { HealthScoreResult } from '../../../engine/healthScore';
import { HEALTH_COLORS } from '../constants';

interface PodGridProps {
  pods: MapPod[];
  nodeName: string;
  nodeHealth: HealthScoreResult['grade'];
  onNavigateToNode?: (nodeName: string) => void;
}

const PHASE_COLORS: Record<string, string> = {
  Running: '#10b981',
  Succeeded: '#6366f1',
  Pending: '#f59e0b',
  Failed: '#ef4444',
  Unknown: '#64748b',
};

const PHASE_BG: Record<string, string> = {
  Running: 'bg-emerald-500/15 border-emerald-500/30',
  Succeeded: 'bg-indigo-500/15 border-indigo-500/30',
  Pending: 'bg-amber-500/15 border-amber-500/30',
  Failed: 'bg-red-500/15 border-red-500/30',
  Unknown: 'bg-slate-500/15 border-slate-500/30',
};

function shortName(name: string): string {
  // Trim common suffixes like -7f6d8b5c9-x4k2p to show meaningful part
  const parts = name.split('-');
  if (parts.length > 2) {
    // Remove last 1-2 segments if they look like generated hashes
    const trimmed = parts.filter((p, i) => i < parts.length - 1 || p.length > 5);
    if (trimmed.length < parts.length) return trimmed.join('-');
  }
  return name;
}

export function PodGrid({ pods, nodeName, nodeHealth, onNavigateToNode }: PodGridProps) {
  const nodeColor = HEALTH_COLORS[nodeHealth];
  const [hoveredPod, setHoveredPod] = useState<MapPod | null>(null);

  if (pods.length === 0) {
    return (
      <div className="text-center text-slate-400 py-8">
        <p className="text-sm">No pods on {nodeName}</p>
      </div>
    );
  }

  // Phase summary counts
  const phaseCounts = pods.reduce((acc, p) => {
    acc[p.phase] = (acc[p.phase] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Group by namespace, sort: failing namespaces first
  const byNamespace = new Map<string, MapPod[]>();
  for (const pod of pods) {
    const ns = pod.namespace || 'default';
    if (!byNamespace.has(ns)) byNamespace.set(ns, []);
    byNamespace.get(ns)!.push(pod);
  }
  const sortedNamespaces = Array.from(byNamespace.entries()).sort(([, a], [, b]) => {
    const aFailing = a.filter(p => p.phase !== 'Running' && p.phase !== 'Succeeded').length;
    const bFailing = b.filter(p => p.phase !== 'Running' && p.phase !== 'Succeeded').length;
    return bFailing - aFailing;
  });

  return (
    <div className="w-full max-w-4xl px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: nodeColor }} />
          <h3 className="text-sm font-semibold text-slate-100">{nodeName}</h3>
          <span className="text-xs text-slate-500">{pods.length} pods</span>
          {onNavigateToNode && (
            <button
              onClick={() => onNavigateToNode(nodeName)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors ml-1"
            >
              Open node →
            </button>
          )}
        </div>

        {/* Phase summary bar */}
        <div className="flex items-center gap-1">
          {Object.entries(phaseCounts).map(([phase, count]) => (
            <div key={phase} className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PHASE_COLORS[phase] || '#64748b' }} />
              <span className="text-xs text-slate-300">{count}</span>
              <span className="text-xs text-slate-500">{phase}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Visual pod health bar — stacked bar showing phase distribution */}
      <div className="flex h-3 rounded-full overflow-hidden bg-slate-800 mb-4">
        {Object.entries(phaseCounts).map(([phase, count]) => (
          <div
            key={phase}
            style={{
              width: `${(count / pods.length) * 100}%`,
              backgroundColor: PHASE_COLORS[phase] || '#64748b',
              opacity: 0.8,
            }}
            title={`${count} ${phase}`}
          />
        ))}
      </div>

      {/* Pod cards by namespace */}
      <div className="space-y-4 max-h-[280px] overflow-y-auto pr-1">
        {sortedNamespaces.map(([ns, nsPods]) => (
          <div key={ns}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-slate-400">{ns}</span>
              <span className="text-xs text-slate-600">{nsPods.length} pods</span>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {nsPods
                .sort((a, b) => {
                  // Failed/Pending first, then by restarts
                  const order: Record<string, number> = { Failed: 0, Pending: 1, Unknown: 2, Running: 3, Succeeded: 4 };
                  const diff = (order[a.phase] ?? 3) - (order[b.phase] ?? 3);
                  if (diff !== 0) return diff;
                  return b.restarts - a.restarts;
                })
                .map(pod => {
                  const color = PHASE_COLORS[pod.phase] || '#64748b';
                  const bgClass = PHASE_BG[pod.phase] || PHASE_BG.Unknown;
                  const isHovered = hoveredPod?.name === pod.name;
                  const hasIssue = pod.phase === 'Failed' || pod.phase === 'Pending' || pod.restarts > 5;

                  return (
                    <div
                      key={pod.name}
                      className={`
                        relative rounded-lg border p-2 transition-all cursor-default
                        ${bgClass}
                        ${isHovered ? 'scale-105 shadow-lg' : ''}
                        ${hasIssue ? 'ring-1 ring-red-500/30' : ''}
                      `}
                      onMouseEnter={() => setHoveredPod(pod)}
                      onMouseLeave={() => setHoveredPod(null)}
                    >
                      {/* Health dot */}
                      <div className="flex items-center gap-1.5 mb-1">
                        <div
                          className={`w-2 h-2 rounded-full shrink-0 ${pod.phase === 'Failed' ? 'animate-pulse' : ''}`}
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-xs text-slate-300 truncate" title={pod.name}>
                          {shortName(pod.name)}
                        </span>
                      </div>

                      {/* Phase label */}
                      <div className="text-xs text-slate-500">{pod.phase}</div>

                      {/* Restart badge */}
                      {pod.restarts > 0 && (
                        <div className={`
                          mt-1 text-xs px-1.5 py-0.5 rounded inline-block
                          ${pod.restarts > 5 ? 'bg-red-500/20 text-red-400' : 'bg-slate-700/50 text-slate-400'}
                        `}>
                          {pod.restarts} restart{pod.restarts !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      {/* Hover detail panel */}
      {hoveredPod && (
        <div className="mt-3 p-3 rounded-lg bg-slate-800 border border-slate-700">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PHASE_COLORS[hoveredPod.phase] || '#64748b' }} />
            <span className="text-sm font-medium text-slate-100">{hoveredPod.name}</span>
          </div>
          <div className="grid grid-cols-4 gap-3 text-xs text-slate-400 mt-2">
            <div>
              <span className="text-slate-500 block">Namespace</span>
              <span className="text-slate-300">{hoveredPod.namespace}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Phase</span>
              <span style={{ color: PHASE_COLORS[hoveredPod.phase] }}>{hoveredPod.phase}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Restarts</span>
              <span className={hoveredPod.restarts > 5 ? 'text-red-400' : 'text-slate-300'}>{hoveredPod.restarts}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Node</span>
              <span className="text-slate-300">{hoveredPod.nodeName}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
