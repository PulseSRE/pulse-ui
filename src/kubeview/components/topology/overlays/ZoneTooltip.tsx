import React from 'react';
import type { MapZone } from '../types';
import { HEALTH_COLORS } from '../constants';

interface ZoneTooltipProps {
  zone: MapZone;
}

export function ZoneTooltip({ zone }: ZoneTooltipProps) {
  const color = HEALTH_COLORS[zone.healthGrade];

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl min-w-[200px]">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-sm font-semibold text-slate-100">{zone.zone}</span>
        <span className="text-xs text-slate-500 ml-auto">{zone.provider}</span>
      </div>

      <div className="space-y-1.5 text-xs text-slate-400">
        <div className="flex justify-between">
          <span>Region</span>
          <span className="text-slate-300">{zone.displayName}</span>
        </div>
        <div className="flex justify-between">
          <span>Health</span>
          <span className="font-medium" style={{ color }}>{zone.healthScore}%</span>
        </div>
        <div className="flex justify-between">
          <span>Nodes</span>
          <span className="text-slate-300">{zone.nodeCount}</span>
        </div>
        <div className="flex justify-between">
          <span>Pods</span>
          <span className="text-slate-300">{zone.podCount}</span>
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-slate-700 text-xs text-slate-500">
        Click to see nodes in this zone
      </div>
    </div>
  );
}
