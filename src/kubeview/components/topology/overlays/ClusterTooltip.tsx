import React from 'react';
import type { MapCluster } from '../types';
import { HEALTH_COLORS } from '../constants';

interface ClusterTooltipProps {
  cluster: MapCluster;
}

export function ClusterTooltip({ cluster }: ClusterTooltipProps) {
  const color = HEALTH_COLORS[cluster.healthGrade];

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl min-w-[200px]">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-sm font-semibold text-slate-100">{cluster.name}</span>
      </div>

      <div className="space-y-1.5 text-xs text-slate-400">
        <div className="flex justify-between">
          <span>Region</span>
          <span className="text-slate-300">{cluster.displayName}</span>
        </div>
        <div className="flex justify-between">
          <span>Health</span>
          <span className="font-medium" style={{ color }}>{cluster.healthScore}%</span>
        </div>
        <div className="flex justify-between">
          <span>Status</span>
          <span className="text-slate-300 capitalize">{cluster.status}</span>
        </div>
        <div className="flex justify-between">
          <span>Nodes</span>
          <span className="text-slate-300">{cluster.nodeCount || 'Unknown'}</span>
        </div>
        {cluster.version && (
          <div className="flex justify-between">
            <span>Version</span>
            <span className="text-slate-300">{cluster.version}</span>
          </div>
        )}
        {cluster.environment && (
          <div className="flex justify-between">
            <span>Environment</span>
            <span className="text-slate-300 capitalize">{cluster.environment}</span>
          </div>
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-slate-700 text-xs text-slate-500">
        Click to zoom in and see nodes
      </div>
    </div>
  );
}
