/**
 * NodeHexMap — Command-center style node visualization.
 * Each node is a glowing hexagonal tile with pod grid, resource gauges,
 * and status-driven coloring. Designed to look like a datacenter floor plan.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Server, Cpu, MemoryStick, HardDrive, Box } from 'lucide-react';
import type { NodeDetail } from './types';

interface Props {
  nodes: NodeDetail[];
  onNodeClick?: (name: string) => void;
}

const STATUS = {
  ready: { color: '#10b981', glow: '#10b98140', bg: '#10b98108', label: 'Ready' },
  pressure: { color: '#f59e0b', glow: '#f59e0b40', bg: '#f59e0b08', label: 'Pressure' },
  notReady: { color: '#ef4444', glow: '#ef444440', bg: '#ef444408', label: 'Not Ready' },
  cordoned: { color: '#6b7280', glow: '#6b728040', bg: '#6b728008', label: 'Cordoned' },
};

function getStatus(nd: NodeDetail) {
  if (!nd.status.ready) return STATUS.notReady;
  if (nd.unschedulable) return STATUS.cordoned;
  if (nd.pressures.length > 0) return STATUS.pressure;
  return STATUS.ready;
}

function GaugeBar({ label, icon: Icon, value, color }: { label: string; icon: any; value: number | null; color: string }) {
  const pct = value != null ? Math.min(100, Math.max(0, value)) : null;
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="w-3 h-3 shrink-0" style={{ color }} />
      <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        {pct != null ? (
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : color }}
          />
        ) : (
          <div className="h-full w-full bg-slate-700/50 animate-pulse" />
        )}
      </div>
      <span className="text-[10px] font-mono w-8 text-right" style={{ color: pct != null && pct > 80 ? '#ef4444' : '#94a3b8' }}>
        {pct != null ? `${Math.round(pct)}%` : '—'}
      </span>
    </div>
  );
}

function NodeCard({ nd, onClick }: { nd: NodeDetail; onClick?: () => void }) {
  const status = getStatus(nd);
  const [hovered, setHovered] = useState(false);

  // Pod fill visualization — colored dots
  const maxDots = Math.min(nd.podCap, 40); // Cap at 40 dots for visual clarity
  const filledDots = Math.round((nd.podCount / nd.podCap) * maxDots);
  const podPct = nd.podCap > 0 ? Math.round((nd.podCount / nd.podCap) * 100) : 0;

  const shortName = nd.name
    .replace(/^ip-/, '')
    .replace(/\..*internal$/, '')
    .replace(/\..*compute$/, '');

  return (
    <div
      className={cn(
        'relative rounded-xl border p-3 cursor-pointer transition-all duration-200',
        'bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950',
        hovered ? 'scale-[1.02] z-10' : '',
      )}
      style={{
        borderColor: hovered ? status.color : `${status.color}40`,
        boxShadow: hovered ? `0 0 20px ${status.glow}, inset 0 1px 0 ${status.color}15` : `inset 0 1px 0 ${status.color}08`,
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Status indicator dot */}
      <div
        className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full"
        style={{ background: status.color, boxShadow: `0 0 6px ${status.glow}` }}
      />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${status.color}15`, border: `1px solid ${status.color}30` }}
        >
          <Server className="w-3.5 h-3.5" style={{ color: status.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-slate-200 truncate">{shortName}</div>
          <div className="text-[10px] text-slate-500">
            {nd.roles.join(' · ')} · {nd.instanceType || nd.age}
          </div>
        </div>
      </div>

      {/* Resource gauges */}
      <div className="space-y-1.5 mb-2.5">
        <GaugeBar label="CPU" icon={Cpu} value={nd.cpuUsagePct} color="#3b82f6" />
        <GaugeBar label="Mem" icon={MemoryStick} value={nd.memUsagePct} color="#8b5cf6" />
      </div>

      {/* Pod grid */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-slate-500 flex items-center gap-1">
          <Box className="w-2.5 h-2.5" /> Pods
        </span>
        <span className="text-[10px] font-mono text-slate-400">{nd.podCount}/{nd.podCap}</span>
      </div>
      <div className="flex flex-wrap gap-[2px]">
        {Array.from({ length: maxDots }, (_, i) => (
          <div
            key={i}
            className="rounded-sm transition-colors duration-300"
            style={{
              width: maxDots > 30 ? 4 : 5,
              height: maxDots > 30 ? 4 : 5,
              background: i < filledDots
                ? podPct > 90 ? '#ef4444' : podPct > 75 ? '#f59e0b' : '#10b981'
                : '#1e293b',
              opacity: i < filledDots ? 0.85 : 0.3,
            }}
          />
        ))}
      </div>

      {/* Bottom status bar */}
      <div className="mt-2 pt-2 border-t border-slate-800/50 flex items-center justify-between">
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{ color: status.color, background: `${status.color}15` }}
        >
          {status.label}
        </span>
        {nd.pressures.length > 0 && (
          <span className="text-[10px] text-amber-400">{nd.pressures.join(', ')}</span>
        )}
      </div>
    </div>
  );
}

export function NodeHexMap({ nodes, onNodeClick }: Props) {
  // Sort: unhealthy first, then by name
  const sorted = [...nodes].sort((a, b) => {
    const aReady = a.status.ready ? 1 : 0;
    const bReady = b.status.ready ? 1 : 0;
    if (aReady !== bReady) return aReady - bReady;
    return a.name.localeCompare(b.name);
  });

  const readyCount = nodes.filter(n => n.status.ready).length;
  const totalPods = nodes.reduce((sum, n) => sum + n.podCount, 0);
  const totalCap = nodes.reduce((sum, n) => sum + n.podCap, 0);

  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/80 to-slate-950 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-800/30 flex items-center justify-center">
            <Server className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Cluster Nodes</h3>
            <p className="text-xs text-slate-500">{readyCount}/{nodes.length} ready · {totalPods}/{totalCap} pods</p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          {Object.entries(STATUS).map(([key, s]) => (
            <span key={key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Node grid */}
      <div className={cn(
        'grid gap-3',
        nodes.length <= 2 ? 'grid-cols-1 sm:grid-cols-2' :
        nodes.length <= 4 ? 'grid-cols-2 md:grid-cols-4' :
        nodes.length <= 6 ? 'grid-cols-2 md:grid-cols-3' :
        'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
      )}>
        {sorted.map(nd => (
          <NodeCard
            key={nd.name}
            nd={nd}
            onClick={() => onNodeClick?.(nd.name)}
          />
        ))}
      </div>
    </div>
  );
}
