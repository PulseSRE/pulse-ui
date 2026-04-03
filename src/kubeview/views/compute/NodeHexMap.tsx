/**
 * NodeHexMap — Command-center hexagonal node visualization.
 * Honeycomb layout with context menus, filter bar, pulse animations,
 * and capacity warning overlays.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  Server, Cpu, MemoryStick, ChevronRight, Search,
  ShieldOff, Shield, Terminal, Trash2, FileText, Copy, X,
} from 'lucide-react';
import type { NodeDetail } from './types';

export interface PodInfo {
  name: string;
  namespace: string;
  status: string;
  restarts: number;
}

interface Props {
  nodes: NodeDetail[];
  podsByNode?: Record<string, PodInfo[]>;
  onNodeClick?: (name: string) => void;
  onPodClick?: (namespace: string, name: string) => void;
  onViewAll?: () => void;
}

const MAX_VISIBLE = 8;

const STATUS = {
  ready: { color: '#10b981', glow: '#10b98140', label: 'Ready' },
  pressure: { color: '#f59e0b', glow: '#f59e0b40', label: 'Pressure' },
  notReady: { color: '#ef4444', glow: '#ef444440', label: 'Not Ready' },
  cordoned: { color: '#6b7280', glow: '#6b728040', label: 'Cordoned' },
};

function getStatus(nd: NodeDetail) {
  if (!nd.status.ready) return STATUS.notReady;
  if (nd.unschedulable) return STATUS.cordoned;
  if (nd.pressures.length > 0) return STATUS.pressure;
  return STATUS.ready;
}

// Exact flat-top hexagon with 60° angles
const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

const POD_STATUS_COLOR: Record<string, string> = {
  Running: '#10b981',
  Succeeded: '#3b82f6',
  Pending: '#f59e0b',
  Failed: '#ef4444',
  Unknown: '#6b7280',
  CrashLoopBackOff: '#ef4444',
};

// ─── CSS for pulse animation ─────────────────────────────────────────────────
const pulseKeyframes = `
@keyframes hexPulse {
  0%, 100% { opacity: 0.15; }
  50% { opacity: 0.35; }
}
`;

// ─── Context Menu ────────────────────────────────────────────────────────────

interface ContextMenuItem {
  label: string;
  icon: any;
  action: () => void;
  danger?: boolean;
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ContextMenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[180px] rounded-lg border border-slate-700 bg-slate-900 shadow-2xl py-1 animate-in fade-in zoom-in-95 duration-100"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => { item.action(); onClose(); }}
          className={cn(
            'flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors text-left',
            item.danger ? 'text-red-400 hover:bg-red-900/20' : 'text-slate-300 hover:bg-slate-800',
          )}
        >
          <item.icon className="w-3.5 h-3.5" />
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ─── Gauge Bar ───────────────────────────────────────────────────────────────

function GaugeBar({ icon: Icon, value, color }: { icon: any; value: number | null; color: string }) {
  const pct = value != null ? Math.min(100, Math.max(0, value)) : null;
  return (
    <div className="flex items-center gap-1">
      <Icon className="w-2.5 h-2.5 shrink-0" style={{ color }} />
      <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
        {pct != null ? (
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : color }}
          />
        ) : (
          <div className="h-full w-full bg-slate-700/30" />
        )}
      </div>
      <span className="text-[9px] font-mono w-6 text-right" style={{ color: pct != null && pct > 80 ? '#ef4444' : '#64748b' }}>
        {pct != null ? `${Math.round(pct)}%` : '—'}
      </span>
    </div>
  );
}

// ─── Hex Node ────────────────────────────────────────────────────────────────

function HexNode({ nd, pods, onClick, onPodClick }: {
  nd: NodeDetail; pods?: PodInfo[];
  onClick?: () => void;
  onPodClick?: (ns: string, name: string) => void;
}) {
  const status = getStatus(nd);
  const [hovered, setHovered] = useState(false);
  const [hoveredPod, setHoveredPod] = useState<PodInfo | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; type: 'node' | 'pod'; pod?: PodInfo } | null>(null);

  const podPct = nd.podCap > 0 ? Math.round((nd.podCount / nd.podCap) * 100) : 0;
  const isOverloaded = (nd.cpuUsagePct ?? 0) > 80 || (nd.memUsagePct ?? 0) > 80;

  const shortName = nd.name
    .replace(/^ip-/, '')
    .replace(/\..*internal$/, '')
    .replace(/\..*compute$/, '')
    .slice(-14);

  const handleNodeContext = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, type: 'node' });
  }, []);

  const handlePodContext = useCallback((e: React.MouseEvent, pod: PodInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, type: 'pod', pod });
  }, []);

  const nodeMenuItems: ContextMenuItem[] = [
    { label: 'View Node Details', icon: FileText, action: () => onClick?.() },
    { label: 'Copy Node Name', icon: Copy, action: () => navigator.clipboard.writeText(nd.name) },
    { label: nd.unschedulable ? 'Uncordon Node' : 'Cordon Node', icon: nd.unschedulable ? Shield : ShieldOff, action: () => {} },
    { label: 'Open Terminal', icon: Terminal, action: () => {} },
    { label: 'Drain Node', icon: Trash2, action: () => {}, danger: true },
  ];

  const podMenuItems: ContextMenuItem[] = ctxMenu?.pod ? [
    { label: 'View Pod Details', icon: FileText, action: () => onPodClick?.(ctxMenu.pod!.namespace, ctxMenu.pod!.name) },
    { label: 'View Logs', icon: FileText, action: () => {} },
    { label: 'Copy Pod Name', icon: Copy, action: () => navigator.clipboard.writeText(ctxMenu.pod!.name) },
    { label: 'Exec Into Container', icon: Terminal, action: () => {} },
    { label: 'Delete Pod', icon: Trash2, action: () => {}, danger: true },
  ] : [];

  return (
    <div
      className="relative cursor-pointer transition-all duration-200"
      style={{ width: 180, height: 200 }}
      onClick={onClick}
      onContextMenu={handleNodeContext}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setHoveredPod(null); }}
    >
      {/* Pulse animation for overloaded nodes */}
      {isOverloaded && (
        <div
          className="absolute inset-0"
          style={{
            clipPath: HEX_CLIP,
            background: '#f59e0b',
            animation: 'hexPulse 2s ease-in-out infinite',
          }}
        />
      )}

      {/* Hex outer glow */}
      <div
        className="absolute inset-0 transition-all duration-300"
        style={{
          clipPath: HEX_CLIP,
          background: hovered ? status.color : `${status.color}60`,
          filter: hovered ? 'blur(8px)' : 'blur(4px)',
          opacity: hovered ? 0.3 : 0.1,
          transform: hovered ? 'scale(1.04)' : 'scale(1)',
        }}
      />

      {/* Hex border */}
      <div
        className="absolute inset-[1px] transition-all duration-200"
        style={{
          clipPath: HEX_CLIP,
          background: `linear-gradient(135deg, ${status.color}30, ${status.color}10)`,
        }}
      />

      {/* Hex body */}
      <div
        className="absolute inset-[2px] flex flex-col items-center justify-center px-4 py-3"
        style={{
          clipPath: HEX_CLIP,
          background: 'linear-gradient(180deg, #0f172a 0%, #020617 100%)',
        }}
      >
        {/* Status dot with pulse for unhealthy */}
        <div
          className={cn('absolute top-5 right-10 w-1.5 h-1.5 rounded-full', !nd.status.ready && 'animate-pulse')}
          style={{ background: status.color, boxShadow: `0 0 4px ${status.glow}` }}
        />

        <Server className="w-4 h-4 mb-1" style={{ color: status.color }} />
        <div className="text-[10px] font-semibold text-slate-200 text-center truncate w-full">{shortName}</div>
        <div className="text-[8px] text-slate-500 mb-1">{nd.roles.join(' · ')}{nd.instanceType ? ` · ${nd.instanceType}` : ''}</div>
        {nd.age && <div className="text-[7px] text-slate-600 mb-1">{nd.age}</div>}

        <div className="w-full space-y-0.5 mb-2 px-1">
          <GaugeBar icon={Cpu} value={nd.cpuUsagePct} color="#3b82f6" />
          <GaugeBar icon={MemoryStick} value={nd.memUsagePct} color="#8b5cf6" />
        </div>

        {/* Pod dots */}
        <div className="flex flex-wrap gap-[2px] justify-center max-w-[90px]">
          {pods ? (
            <>
              {pods.slice(0, 30).map((pod) => (
                <div
                  key={pod.name}
                  className="rounded-sm cursor-pointer hover:scale-150 hover:z-10 transition-transform"
                  style={{
                    width: 7, height: 7,
                    background: POD_STATUS_COLOR[pod.status] || '#6b7280',
                    opacity: 0.9,
                  }}
                  onClick={(e) => { e.stopPropagation(); onPodClick?.(pod.namespace, pod.name); }}
                  onContextMenu={(e) => handlePodContext(e, pod)}
                  onMouseEnter={() => setHoveredPod(pod)}
                  onMouseLeave={() => setHoveredPod(null)}
                />
              ))}
              {Array.from({ length: Math.max(0, Math.min(nd.podCap - pods.length, 20)) }, (_, i) => (
                <div key={`e-${i}`} className="rounded-sm" style={{ width: 7, height: 7, background: '#1e293b', opacity: 0.2 }} />
              ))}
            </>
          ) : (
            Array.from({ length: Math.min(nd.podCap, 25) }, (_, i) => (
              <div key={i} className="rounded-sm" style={{
                width: 7, height: 7,
                background: i < nd.podCount ? (podPct > 90 ? '#ef4444' : podPct > 75 ? '#f59e0b' : '#10b981') : '#1e293b',
                opacity: i < nd.podCount ? 0.9 : 0.2,
              }} />
            ))
          )}
        </div>
        <div className="text-[8px] font-mono text-slate-500 mt-0.5">{nd.podCount}/{nd.podCap}</div>
      </div>

      {/* Pod tooltip */}
      {hoveredPod && (
        <div className="absolute -top-14 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 shadow-xl z-50 pointer-events-none min-w-[200px]">
          <div className="text-[11px] font-semibold text-slate-100">{hoveredPod.name}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">{hoveredPod.namespace}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="flex items-center gap-1 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ background: POD_STATUS_COLOR[hoveredPod.status] || '#6b7280' }} />
              <span style={{ color: POD_STATUS_COLOR[hoveredPod.status] || '#94a3b8' }}>{hoveredPod.status}</span>
            </span>
            {hoveredPod.restarts > 0 && (
              <span className="text-[10px] text-amber-400">{hoveredPod.restarts} restart{hoveredPod.restarts !== 1 ? 's' : ''}</span>
            )}
          </div>
          <div className="text-[9px] text-slate-500 mt-1">Click to expand pods · Right-click for actions</div>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.type === 'node' ? nodeMenuItems : podMenuItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function NodeHexMap({ nodes, podsByNode, onNodeClick, onPodClick, onViewAll }: Props) {
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);

  const sorted = [...nodes]
    .filter(nd => {
      if (filter && !nd.name.toLowerCase().includes(filter.toLowerCase())) return false;
      if (statusFilter === 'ready' && !nd.status.ready) return false;
      if (statusFilter === 'issues' && nd.status.ready && nd.pressures.length === 0) return false;
      return true;
    })
    .sort((a, b) => {
      const aReady = a.status.ready ? 1 : 0;
      const bReady = b.status.ready ? 1 : 0;
      if (aReady !== bReady) return aReady - bReady;
      return a.name.localeCompare(b.name);
    });

  const visible = sorted.slice(0, MAX_VISIBLE);
  const remaining = sorted.length - MAX_VISIBLE;
  const readyCount = nodes.filter(n => n.status.ready).length;
  const totalPods = nodes.reduce((sum, n) => sum + n.podCount, 0);
  const totalCap = nodes.reduce((sum, n) => sum + n.podCap, 0);

  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/80 to-slate-950 p-5">
      {/* Inject pulse animation CSS */}
      <style>{pulseKeyframes}</style>

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
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          {Object.entries(STATUS).map(([key, s]) => (
            <span key={key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 flex-1 bg-slate-800/50 rounded-lg px-2.5 py-1.5 border border-slate-700/50">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter nodes..."
            className="bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none flex-1"
          />
          {filter && (
            <button onClick={() => setFilter('')} className="text-slate-500 hover:text-slate-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {['all', 'ready', 'issues'].map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f === 'all' ? null : f)}
            className={cn(
              'px-2.5 py-1.5 rounded-lg text-xs transition-colors border',
              (statusFilter === f || (f === 'all' && !statusFilter))
                ? 'bg-blue-600/20 text-blue-300 border-blue-700/50'
                : 'text-slate-500 hover:text-slate-300 border-slate-700/30 hover:border-slate-600',
            )}
          >
            {f === 'all' ? 'All' : f === 'ready' ? 'Healthy' : 'Issues'}
          </button>
        ))}
      </div>

      {/* Honeycomb hex grid */}
      <div className="flex flex-col items-center gap-0">
        {(() => {
          const cols = Math.min(visible.length, 4);
          const rows: NodeDetail[][] = [];
          for (let i = 0; i < visible.length; i += cols) {
            rows.push(visible.slice(i, i + cols));
          }
          return rows.map((row, rowIdx) => (
            <div
              key={rowIdx}
              className="flex gap-1 justify-center"
              style={{ marginTop: rowIdx > 0 ? -16 : 0, marginLeft: rowIdx % 2 === 1 ? 95 : 0 }}
            >
              {row.map(nd => (
                <HexNode
                  key={nd.name}
                  nd={nd}
                  pods={podsByNode?.[nd.name]}
                  onClick={() => setExpandedNode(expandedNode === nd.name ? null : nd.name)}
                  onPodClick={onPodClick}
                />
              ))}
            </div>
          ));
        })()}
      </div>

      {/* Expanded node pod panel */}
      {expandedNode && (() => {
        const nd = nodes.find(n => n.name === expandedNode);
        const pods = podsByNode?.[expandedNode] || [];
        if (!nd) return null;
        const shortName = nd.name.replace(/^ip-/, '').replace(/\..*internal$/, '').replace(/\..*compute$/, '');
        const statusKey = !nd.status.ready ? 'notReady' : nd.unschedulable ? 'cordoned' : nd.pressures.length > 0 ? 'pressure' : 'ready';
        const color = STATUS[statusKey as keyof typeof STATUS].color;

        return (
          <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/90 overflow-hidden animate-in slide-in-from-top-2 duration-200">
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-800/50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="text-xs font-semibold text-slate-200">{shortName}</span>
                <span className="text-[10px] text-slate-500">{nd.roles.join(', ')} · {pods.length}/{nd.podCap} pods</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onNodeClick?.(nd.name)}
                  className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Open Node →
                </button>
                <button
                  onClick={() => setExpandedNode(null)}
                  className="p-0.5 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Pod table */}
            {pods.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-500">No pods on this node</div>
            ) : (
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-left text-slate-500">
                      <th className="px-3 py-1.5 font-medium">Pod</th>
                      <th className="px-3 py-1.5 font-medium">Namespace</th>
                      <th className="px-3 py-1.5 font-medium">Status</th>
                      <th className="px-3 py-1.5 font-medium">Restarts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pods.map(pod => (
                      <tr
                        key={pod.name}
                        className="border-t border-slate-800/50 hover:bg-slate-800/40 cursor-pointer transition-colors"
                        onClick={() => onPodClick?.(pod.namespace, pod.name)}
                      >
                        <td className="px-3 py-1.5 text-blue-400 hover:text-blue-300 truncate max-w-[200px]">{pod.name}</td>
                        <td className="px-3 py-1.5 text-slate-400">{pod.namespace}</td>
                        <td className="px-3 py-1.5">
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: POD_STATUS_COLOR[pod.status] || '#6b7280' }} />
                            <span style={{ color: POD_STATUS_COLOR[pod.status] || '#94a3b8' }}>{pod.status}</span>
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          {pod.restarts > 0 ? (
                            <span className="text-amber-400">{pod.restarts}</span>
                          ) : (
                            <span className="text-slate-600">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* View all link */}
      {remaining > 0 && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={onViewAll}
            className="flex items-center gap-1 px-4 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 transition-colors"
          >
            View all {sorted.length} nodes <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
