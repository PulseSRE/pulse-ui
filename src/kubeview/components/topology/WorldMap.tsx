import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import countriesTopo from 'world-atlas/countries-110m.json';
import type { MapCluster, MapZone, MapNode, MapPod, MapEvent, ZoneUtilization, PodMovement, ZoomLevel } from './types';
import { HEALTH_COLORS, PIN_RADIUS_MIN, PIN_RADIUS_MAX, FLY_DURATION } from './constants';
import { ClusterTooltip } from './overlays/ClusterTooltip';
import { ZoneTooltip } from './overlays/ZoneTooltip';
import { NodeGrid } from './overlays/NodeGrid';
import { PodGrid } from './overlays/PodGrid';
import { Search, Filter, Cpu, MemoryStick, Server, Box, AlertTriangle, Activity } from 'lucide-react';

export interface MapStats {
  totalNodes: number;
  readyNodes: number;
  totalPods: number;
  runningPods: number;
  failedPods: number;
  pendingPods: number;
  avgCpu: number;
  avgMem: number;
  zones: number;
  alerts: number;
}

interface WorldMapProps {
  clusters: MapCluster[];
  zones: MapZone[];
  nodes: MapNode[];
  pods: MapPod[];
  events?: MapEvent[];
  zoneUtilization?: ZoneUtilization[];
  podMovements?: PodMovement[];
  stats: MapStats;
  onClusterClick?: (cluster: MapCluster) => void;
  onNavigateToNode?: (nodeName: string) => void;
}

interface ViewState {
  zoom: ZoomLevel;
  center: [number, number];
  scale: number;
  selectedCluster: MapCluster | null;
  selectedZone: MapZone | null;
  selectedNode: MapNode | null;
}

type HealthFilter = 'all' | 'healthy' | 'warning' | 'degraded' | 'critical';
type Overlay = 'none' | 'cpu' | 'memory';

const EVENT_COLORS: Record<string, string> = { deploy: '#6366f1', scale: '#3b82f6', restart: '#f59e0b', alert: '#ef4444', eviction: '#ef4444', scheduled: '#10b981' };
const MOVEMENT_COLORS: Record<string, string> = { Pending: '#f59e0b', Running: '#10b981', Failed: '#ef4444', Succeeded: '#6366f1', Deleted: '#64748b' };

function utilizationColor(pct: number): string {
  if (pct >= 90) return '#ef4444';
  if (pct >= 70) return '#f97316';
  if (pct >= 50) return '#f59e0b';
  return '#10b981';
}

export function WorldMap({ clusters, zones, nodes, pods, events = [], zoneUtilization = [], podMovements = [], stats, onClusterClick, onNavigateToNode }: WorldMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewState, setViewState] = useState<ViewState | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<MapCluster | null>(null);
  const [hoveredZone, setHoveredZone] = useState<MapZone | null>(null);
  const [animating, setAnimating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>('none');

  const width = 960;
  const height = 420;

  // Auto-center
  const autoCenter = useMemo<Pick<ViewState, 'center' | 'scale'>>(() => {
    const pts = [...clusters.map(c => ({ lng: c.longitude, lat: c.latitude })), ...zones.map(z => ({ lng: z.longitude, lat: z.latitude }))];
    if (pts.length === 0) return { center: [0, 20] as [number, number], scale: 1 };
    if (pts.length === 1) return { center: [pts[0].lng, pts[0].lat] as [number, number], scale: 2.5 };
    const lngs = pts.map(p => p.lng), lats = pts.map(p => p.lat);
    const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2, cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const span = Math.max(Math.max(...lngs) - Math.min(...lngs), Math.max(...lats) - Math.min(...lats), 20);
    return { center: [cLng, cLat] as [number, number], scale: Math.min(4, Math.max(1, 120 / span)) };
  }, [clusters, zones]);

  const defaultView: ViewState = { zoom: 'world', ...autoCenter, selectedCluster: null, selectedZone: null, selectedNode: null };
  const cv = viewState || defaultView;

  const { countriesPath } = useMemo(() => {
    try { const t = countriesTopo as unknown as Topology; return { countriesPath: feature(t, t.objects.countries) as unknown as GeoJSON.FeatureCollection }; }
    catch { return { countriesPath: null }; }
  }, []);

  const projection = useMemo(() => geoNaturalEarth1().translate([width / 2, height / 2]).scale(150 * cv.scale).center(cv.center), [cv.center, cv.scale]);
  const pathGen = useMemo(() => geoPath(projection), [projection]);
  const graticule = useMemo(() => geoGraticule10(), []);
  const countrySvg = useMemo(() => countriesPath ? pathGen(countriesPath) || '' : '', [countriesPath, pathGen]);

  // Filters
  const fClusters = useMemo(() => { let r = clusters; if (healthFilter !== 'all') r = r.filter(c => c.healthGrade === healthFilter); if (searchQuery) { const q = searchQuery.toLowerCase(); r = r.filter(c => c.name.toLowerCase().includes(q) || c.displayName.toLowerCase().includes(q)); } return r; }, [clusters, healthFilter, searchQuery]);
  const fZones = useMemo(() => { let r = zones; if (healthFilter !== 'all') r = r.filter(z => z.healthGrade === healthFilter); if (searchQuery) { const q = searchQuery.toLowerCase(); r = r.filter(z => z.zone.toLowerCase().includes(q) || z.displayName.toLowerCase().includes(q) || z.provider.toLowerCase().includes(q)); } return r; }, [zones, healthFilter, searchQuery]);

  const cPos = useMemo(() => fClusters.map(c => { const p = projection([c.longitude, c.latitude]); return { c, x: p?.[0] ?? 0, y: p?.[1] ?? 0 }; }), [fClusters, projection]);
  const zPos = useMemo(() => fZones.map(z => { const p = projection([z.longitude, z.latitude]); return { z, x: p?.[0] ?? 0, y: p?.[1] ?? 0 }; }), [fZones, projection]);
  const utilMap = useMemo(() => { const m = new Map<string, ZoneUtilization>(); for (const u of zoneUtilization) m.set(u.zoneId, u); return m; }, [zoneUtilization]);

  const pinR = useCallback((n: number) => Math.min(PIN_RADIUS_MAX, Math.max(PIN_RADIUS_MIN, Math.log(n + 2) * 4)), []);
  const fly = useCallback((t: Partial<ViewState>) => { setAnimating(true); setViewState(p => ({ ...(p || defaultView), ...t })); setTimeout(() => setAnimating(false), FLY_DURATION); }, [defaultView]);

  const onCluster = useCallback((c: MapCluster) => { if (cv.zoom !== 'world') return; fly({ zoom: 'cluster', center: [c.longitude, c.latitude], scale: 4, selectedCluster: c, selectedZone: null, selectedNode: null }); onClusterClick?.(c); }, [cv.zoom, fly, onClusterClick]);
  const onZone = useCallback((z: MapZone) => { if (cv.zoom !== 'world') return; fly({ zoom: 'cluster', center: [z.longitude, z.latitude], scale: 4, selectedCluster: null, selectedZone: z, selectedNode: null }); }, [cv.zoom, fly]);
  const onNode = useCallback((n: MapNode) => { setViewState(p => ({ ...(p || defaultView), zoom: 'node' as ZoomLevel, selectedNode: n })); }, [defaultView]);

  // Interactions
  const handleWheel = useCallback((e: React.WheelEvent) => { e.preventDefault(); const d = e.deltaY > 0 ? -0.3 : 0.3; setViewState(p => { const b = p || defaultView; return { ...b, scale: Math.max(0.5, Math.min(8, b.scale + d * b.scale * 0.3)) }; }); }, [defaultView]);
  const drag = useRef({ on: false, lx: 0, ly: 0 });
  const onMD = useCallback((e: React.MouseEvent) => { if (e.button !== 0) return; drag.current = { on: true, lx: e.clientX, ly: e.clientY }; }, []);
  const onMM = useCallback((e: React.MouseEvent) => { if (!drag.current.on) return; const dx = e.clientX - drag.current.lx, dy = e.clientY - drag.current.ly; drag.current.lx = e.clientX; drag.current.ly = e.clientY; const sf = 0.3 / cv.scale; setViewState(p => { const b = p || defaultView; return { ...b, center: [b.center[0] - dx * sf, b.center[1] + dy * sf] as [number, number] }; }); }, [cv.scale, defaultView]);
  const onMU = useCallback(() => { drag.current.on = false; }, []);
  useEffect(() => { const up = () => { drag.current.on = false; }; window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, []);

  const back = useCallback(() => { if (cv.zoom === 'node') setViewState(p => p ? { ...p, zoom: 'cluster', selectedNode: null } : p); else if (cv.zoom === 'cluster') fly({ ...autoCenter, zoom: 'world', selectedCluster: null, selectedZone: null, selectedNode: null }); }, [cv.zoom, fly, autoCenter]);
  const reset = useCallback(() => { fly({ ...autoCenter, zoom: 'world', selectedCluster: null, selectedZone: null, selectedNode: null }); }, [fly, autoCenter]);
  const search = useCallback((q: string) => { setSearchQuery(q); if (!q) return; const ql = q.toLowerCase(); const mc = clusters.find(c => c.name.toLowerCase().includes(ql) || c.displayName.toLowerCase().includes(ql)); if (mc) { fly({ center: [mc.longitude, mc.latitude], scale: 3 }); return; } const mz = zones.find(z => z.zone.toLowerCase().includes(ql) || z.displayName.toLowerCase().includes(ql)); if (mz) fly({ center: [mz.longitude, mz.latitude], scale: 3 }); }, [clusters, zones, fly]);

  const breadcrumbs = useMemo(() => {
    const items: { label: string; onClick?: () => void }[] = [{ label: clusters.length > 0 ? 'Fleet' : 'Infrastructure', onClick: cv.zoom !== 'world' ? reset : undefined }];
    if (cv.selectedCluster) items.push({ label: cv.selectedCluster.name, onClick: cv.zoom === 'node' ? () => setViewState(p => p ? { ...p, zoom: 'cluster', selectedNode: null } : p) : undefined });
    if (cv.selectedZone) items.push({ label: `${cv.selectedZone.zone}`, onClick: cv.zoom === 'node' ? () => setViewState(p => p ? { ...p, zoom: 'cluster', selectedNode: null } : p) : undefined });
    if (cv.selectedNode) items.push({ label: cv.selectedNode.name });
    return items;
  }, [cv, reset, clusters.length]);

  const drillNodes = useMemo(() => cv.selectedZone ? nodes.filter(n => cv.selectedZone!.nodeNames.includes(n.name)) : nodes, [nodes, cv.selectedZone]);
  const drillPods = useMemo(() => cv.selectedNode ? pods.filter(p => p.nodeName === cv.selectedNode!.name) : [], [pods, cv.selectedNode]);

  // Event + movement positions
  const evtPos = useMemo(() => events.slice(0, 10).map((evt, i) => { const z = zones.find(zn => (evt.zone && zn.zone === evt.zone) || (evt.nodeName && zn.nodeNames.includes(evt.nodeName))); if (!z) return null; const p = projection([z.longitude, z.latitude]); if (!p) return null; const a = (i / 10) * Math.PI * 2, o = 30 + i * 3; return { evt, x: p[0] + Math.cos(a) * o, y: p[1] + Math.sin(a) * o, zx: p[0], zy: p[1] }; }).filter(Boolean) as Array<{ evt: MapEvent; x: number; y: number; zx: number; zy: number }>, [events, zones, projection]);
  const mvPos = useMemo(() => podMovements.slice(0, 8).map((mv, i) => { const z = zones.find(zn => mv.nodeName && zn.nodeNames.includes(mv.nodeName)); if (!z) return null; const p = projection([z.longitude, z.latitude]); if (!p) return null; const a = (i / 8) * Math.PI * 2 + Math.PI / 4; return { mv, x: p[0] + Math.cos(a) * 45, y: p[1] + Math.sin(a) * 45 }; }).filter(Boolean) as Array<{ mv: PodMovement; x: number; y: number }>, [podMovements, zones, projection]);

  // Connection lines
  const connLines = useMemo(() => { if (clusters.length < 2 || cPos.length < 2) return []; const hub = cPos[0]; return cPos.slice(1).map(cp => ({ id: `${hub.c.id}-${cp.c.id}`, path: `M${hub.x},${hub.y} Q${(hub.x + cp.x) / 2},${Math.min(hub.y, cp.y) - 20} ${cp.x},${cp.y}`, ok: cp.c.healthGrade === 'healthy' })); }, [cPos, clusters.length]);

  const css = `@keyframes mp{0%,100%{opacity:.2}50%{opacity:.7}}@keyframes glow{0%,100%{filter:drop-shadow(0 0 4px var(--glow))}50%{filter:drop-shadow(0 0 12px var(--glow))}}@keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}`;

  // Stats color helper
  const statColor = (val: number, warn: number, crit: number) => val >= crit ? 'text-red-400' : val >= warn ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="relative rounded-lg border border-slate-800 overflow-hidden bg-[#080e1a]" style={{ height: 520 }}>
      <style>{css}</style>

      {/* ═══ STATS HEADER ═══ */}
      <div className="h-10 bg-slate-900/80 border-b border-slate-800/50 flex items-center px-4 gap-6">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-xs shrink-0">
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-slate-700 mx-1">›</span>}
              {b.onClick ? <button onClick={b.onClick} className="text-blue-400 hover:text-blue-300 transition-colors">{b.label}</button> : <span className="text-slate-300 font-medium">{b.label}</span>}
            </React.Fragment>
          ))}
        </div>

        <div className="h-4 w-px bg-slate-800" />

        {/* Stats */}
        <div className="flex items-center gap-5 text-xs">
          <span className="flex items-center gap-1.5 text-slate-400">
            <Server className="w-3 h-3" />
            <span className={statColor(stats.totalNodes - stats.readyNodes, 1, 2)}>{stats.readyNodes}</span>
            <span className="text-slate-600">/ {stats.totalNodes} nodes</span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <Box className="w-3 h-3" />
            <span className="text-emerald-400">{stats.runningPods}</span>
            {stats.failedPods > 0 && <span className="text-red-400">({stats.failedPods} failed)</span>}
            {stats.pendingPods > 0 && <span className="text-amber-400">({stats.pendingPods} pending)</span>}
            <span className="text-slate-600">pods</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3 h-3 text-slate-400" />
            <span className={statColor(stats.avgCpu, 70, 90)}>{stats.avgCpu}%</span>
          </span>
          <span className="flex items-center gap-1.5">
            <MemoryStick className="w-3 h-3 text-slate-400" />
            <span className={statColor(stats.avgMem, 70, 90)}>{stats.avgMem}%</span>
          </span>
          {stats.alerts > 0 && (
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 text-red-400" />
              <span className="text-red-400">{stats.alerts}</span>
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Controls */}
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 bg-slate-800/60 rounded p-0.5 mr-1">
            <button onClick={() => setOverlay(overlay === 'cpu' ? 'none' : 'cpu')} className={`px-1.5 py-0.5 rounded text-xs transition-colors ${overlay === 'cpu' ? 'bg-blue-600/30 text-blue-300' : 'text-slate-500 hover:text-slate-300'}`}>CPU</button>
            <button onClick={() => setOverlay(overlay === 'memory' ? 'none' : 'memory')} className={`px-1.5 py-0.5 rounded text-xs transition-colors ${overlay === 'memory' ? 'bg-violet-600/30 text-violet-300' : 'text-slate-500 hover:text-slate-300'}`}>MEM</button>
          </div>

          {searchOpen ? (
            <input type="text" value={searchQuery} onChange={(e) => search(e.target.value)} onBlur={() => { if (!searchQuery) setSearchOpen(false); }} placeholder="Search..." className="w-32 px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500" autoFocus />
          ) : (
            <button onClick={() => setSearchOpen(true)} className="p-1 text-slate-500 hover:text-slate-200 transition-colors"><Search className="w-3.5 h-3.5" /></button>
          )}

          <div className="relative">
            <button onClick={() => setFilterOpen(v => !v)} className={`p-1 transition-colors ${healthFilter !== 'all' ? 'text-blue-400' : 'text-slate-500 hover:text-slate-200'}`}><Filter className="w-3.5 h-3.5" /></button>
            {filterOpen && (
              <div className="absolute right-0 top-7 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-1 z-20">
                {(['all', 'healthy', 'warning', 'degraded', 'critical'] as HealthFilter[]).map(f => (
                  <button key={f} onClick={() => { setHealthFilter(f); setFilterOpen(false); }} className={`block w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${healthFilter === f ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-700/50'}`}>
                    <span className="flex items-center gap-2">{f !== 'all' && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: HEALTH_COLORS[f] }} />}<span className="capitalize">{f === 'all' ? 'All' : f}</span></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ MAP ═══ */}
      <div className="relative" style={{ height: 'calc(100% - 70px)' }}>
        {/* Zoom controls */}
        {cv.zoom === 'world' && (
          <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-0.5">
            <button onClick={() => setViewState(p => { const b = p || defaultView; return { ...b, scale: Math.min(8, b.scale * 1.5) }; })} className="w-6 h-6 flex items-center justify-center text-xs text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 rounded border border-slate-700/50 transition-colors">+</button>
            <button onClick={() => setViewState(p => { const b = p || defaultView; return { ...b, scale: Math.max(0.5, b.scale / 1.5) }; })} className="w-6 h-6 flex items-center justify-center text-xs text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 rounded border border-slate-700/50 transition-colors">−</button>
            <button onClick={reset} className="w-6 h-6 flex items-center justify-center text-xs text-slate-500 hover:text-white bg-slate-900/80 hover:bg-slate-800 rounded border border-slate-700/50 transition-colors">↺</button>
          </div>
        )}
        {cv.zoom !== 'world' && (
          <button onClick={back} className="absolute top-2 left-[calc(45%+8px)] z-20 px-3 py-1 text-xs text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700 rounded-lg border border-slate-700/50 transition-colors shadow-lg">← Back</button>
        )}

        {/* SVG */}
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full h-full" style={{ transition: animating ? `all ${FLY_DURATION}ms cubic-bezier(0.4,0,0.2,1)` : undefined, cursor: drag.current.on ? 'grabbing' : 'grab' }}
          onWheel={handleWheel} onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU}>

          {/* SVG Defs for glow effects */}
          <defs>
            <radialGradient id="pinGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="white" stopOpacity="0.15" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>
            <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
            </filter>
          </defs>

          {/* Ocean gradient */}
          <rect width={width} height={height} fill="#060d1a" />

          {/* Graticule */}
          <path d={pathGen(graticule) || ''} fill="none" stroke="#0f1a2e" strokeWidth={0.4} />

          {/* Countries */}
          {countrySvg && <path d={countrySvg} fill="#141f30" stroke="#1e3048" strokeWidth={0.4} />}

          {/* Continent labels */}
          {[{ n: 'North America', lng: -100, lat: 45 }, { n: 'South America', lng: -60, lat: -15 }, { n: 'Europe', lng: 15, lat: 52 }, { n: 'Africa', lng: 20, lat: 5 }, { n: 'Asia', lng: 90, lat: 42 }, { n: 'Oceania', lng: 135, lat: -25 }].map(c => {
            const p = projection([c.lng, c.lat]); if (!p) return null;
            return <text key={c.n} x={p[0]} y={p[1]} textAnchor="middle" fill="#1e3048" fontSize={11} fontWeight={600} fontFamily="system-ui" style={{ pointerEvents: 'none', letterSpacing: '0.05em' }}>{c.n.toUpperCase()}</text>;
          })}

          {/* Connection lines */}
          {connLines.map(l => (
            <g key={l.id}>
              <path d={l.path} fill="none" stroke={l.ok ? '#10b98130' : '#ef444430'} strokeWidth={2} strokeDasharray="8 4"><animate attributeName="stroke-dashoffset" from="0" to="-24" dur="3s" repeatCount="indefinite" /></path>
              <path d={l.path} fill="none" stroke={l.ok ? '#10b98115' : '#ef444415'} strokeWidth={6} filter="url(#softGlow)" />
            </g>
          ))}

          {/* ═══ ZONE PINS ═══ */}
          {zPos.map(({ z, x, y }) => {
            const r = pinR(z.nodeCount);
            const color = HEALTH_COLORS[z.healthGrade];
            const hov = hoveredZone?.id === z.id;
            const sel = cv.selectedZone?.id === z.id;
            const pulse = z.healthGrade === 'critical' || z.healthGrade === 'degraded';
            const util = utilMap.get(z.id);
            const showU = overlay !== 'none' && util;
            const uPct = showU ? (overlay === 'cpu' ? util!.cpuPercent : util!.memoryPercent) : 0;

            return (
              <g key={`z-${z.id}`} transform={`translate(${x},${y})`} style={{ cursor: cv.zoom === 'world' ? 'pointer' : 'default', ['--glow' as string]: color }}
                onMouseEnter={() => setHoveredZone(z)} onMouseLeave={() => setHoveredZone(null)} onClick={() => onZone(z)}
                role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onZone(z); }}>

                {/* Ambient glow */}
                <circle r={r * 3} fill="url(#pinGlow)" opacity={hov || sel ? 0.4 : 0.15} style={pulse ? { animation: 'mp 2s ease-in-out infinite' } : undefined} />

                {/* Utilization or health ring */}
                {showU ? (
                  <circle r={r + 4} fill="none" stroke={utilizationColor(uPct)} strokeWidth={3} strokeDasharray={`${(uPct / 100) * Math.PI * 2 * (r + 4)} 999`} transform="rotate(-90)" opacity={0.9} strokeLinecap="round" />
                ) : (
                  <circle r={r + 4} fill="none" stroke={color} strokeWidth={2.5} strokeDasharray={`${(z.healthScore / 100) * Math.PI * 2 * (r + 4)} 999`} transform="rotate(-90)" opacity={0.8} strokeLinecap="round" />
                )}

                {/* Pin body */}
                <circle r={r} fill={color} opacity={hov || sel ? 1 : 0.85} />
                <circle r={r} fill="url(#pinGlow)" />

                {/* Count */}
                <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize={r > 14 ? 12 : 9} fontWeight={800} fontFamily="system-ui">{z.nodeCount}</text>

                {/* Util label */}
                {showU && <text y={-r - 7} textAnchor="middle" fill={utilizationColor(uPct)} fontSize={8} fontWeight={700} fontFamily="system-ui">{uPct}%</text>}

                {/* Labels */}
                <text y={r + 13} textAnchor="middle" fill="#8896ab" fontSize={9} fontWeight={600} fontFamily="system-ui">{z.displayName}</text>
                <text y={r + 23} textAnchor="middle" fill="#3d4f65" fontSize={7} fontFamily="system-ui">{z.provider} · {z.zone}</text>

                {/* Pod distribution mini bar */}
                {z.podCount > 0 && (
                  <rect x={-r} y={r + 27} width={r * 2} height={2} rx={1} fill="#1e293b" />
                )}
              </g>
            );
          })}

          {/* ═══ CLUSTER PINS ═══ */}
          {cPos.map(({ c, x, y }) => {
            const r = pinR(c.nodeCount);
            const color = HEALTH_COLORS[c.healthGrade];
            const hov = hoveredCluster?.id === c.id;
            const sel = cv.selectedCluster?.id === c.id;
            const pulse = c.healthGrade === 'critical' || c.healthGrade === 'degraded';

            return (
              <g key={`c-${c.id}`} transform={`translate(${x},${y})`} style={{ cursor: cv.zoom === 'world' ? 'pointer' : 'default', ['--glow' as string]: color }}
                onMouseEnter={() => setHoveredCluster(c)} onMouseLeave={() => setHoveredCluster(null)} onClick={() => onCluster(c)}
                role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onCluster(c); }}>
                <circle r={r * 3} fill="url(#pinGlow)" opacity={hov || sel ? 0.4 : 0.15} style={pulse ? { animation: 'mp 2s ease-in-out infinite' } : undefined} />
                <circle r={r + 4} fill="none" stroke={color} strokeWidth={2.5} strokeDasharray={`${(c.healthScore / 100) * Math.PI * 2 * (r + 4)} 999`} transform="rotate(-90)" opacity={0.8} strokeLinecap="round" />
                <circle r={r} fill={color} opacity={hov || sel ? 1 : 0.85} />
                <circle r={r} fill="url(#pinGlow)" />
                <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize={r > 14 ? 12 : 9} fontWeight={800} fontFamily="system-ui">{c.nodeCount || '?'}</text>
                <text y={r + 13} textAnchor="middle" fill="#8896ab" fontSize={9} fontWeight={600} fontFamily="system-ui">{c.displayName}</text>
              </g>
            );
          })}

          {/* Live events */}
          {cv.zoom === 'world' && evtPos.map(({ evt, x, y, zx, zy }) => (
            <g key={evt.id} opacity={0.8}>
              <line x1={zx} y1={zy} x2={x} y2={y} stroke={EVENT_COLORS[evt.type] || '#64748b'} strokeWidth={0.5} opacity={0.3} strokeDasharray="2 2" />
              <circle cx={x} cy={y} r={3} fill={EVENT_COLORS[evt.type] || '#64748b'} />
              <circle cx={x} cy={y} fill="none" stroke={EVENT_COLORS[evt.type] || '#64748b'} strokeWidth={0.8}><animate attributeName="r" from="3" to="10" dur="2s" repeatCount="indefinite" /><animate attributeName="opacity" from="0.5" to="0" dur="2s" repeatCount="indefinite" /></circle>
              <text x={x + 6} y={y + 3} fill={EVENT_COLORS[evt.type] || '#64748b'} fontSize={6} fontFamily="system-ui" fontWeight={500}>{evt.type}</text>
            </g>
          ))}

          {/* Pod movements */}
          {cv.zoom === 'world' && mvPos.map(({ mv, x, y }) => {
            const col = MOVEMENT_COLORS[mv.toPhase] || '#64748b';
            return (
              <g key={`${mv.podName}-${mv.timestamp}`} opacity={0.7}>
                <circle cx={x} cy={y} r={2.5} fill={col} />
                <circle cx={x} cy={y} fill="none" stroke={col} strokeWidth={0.8}><animate attributeName="r" from="2.5" to="10" dur="2s" fill="freeze" /><animate attributeName="opacity" from="0.5" to="0" dur="2s" fill="freeze" /></circle>
                <text x={x + 5} y={y + 1} fill={col} fontSize={5} fontFamily="system-ui">{mv.toPhase}</text>
              </g>
            );
          })}
        </svg>

        {/* ═══ DRILL-DOWN PANELS ═══ */}
        {cv.zoom === 'cluster' && (cv.selectedCluster || cv.selectedZone) && (
          <div className="absolute right-0 top-0 bottom-0 w-[55%] bg-[#080e1a]/90 backdrop-blur-md border-l border-slate-700/30 overflow-y-auto pt-8 pb-4">
            <NodeGrid nodes={drillNodes} clusterName={cv.selectedCluster?.name || `${cv.selectedZone?.zone} (${cv.selectedZone?.provider})`} onNodeClick={onNode} />
          </div>
        )}
        {cv.zoom === 'node' && cv.selectedNode && (
          <div className="absolute right-0 top-0 bottom-0 w-[60%] bg-[#080e1a]/90 backdrop-blur-md border-l border-slate-700/30 overflow-y-auto pt-8 pb-4">
            <PodGrid pods={drillPods} nodeName={cv.selectedNode.name} nodeHealth={cv.selectedNode.healthGrade} onNavigateToNode={onNavigateToNode} />
          </div>
        )}

        {/* Tooltips */}
        {hoveredCluster && cv.zoom === 'world' && <div className="absolute bottom-8 left-3 z-10"><ClusterTooltip cluster={hoveredCluster} /></div>}
        {hoveredZone && !hoveredCluster && cv.zoom === 'world' && <div className="absolute bottom-8 left-3 z-10"><ZoneTooltip zone={hoveredZone} /></div>}
      </div>

      {/* ═══ ACTIVITY TICKER ═══ */}
      <div className="h-[30px] bg-slate-900/60 border-t border-slate-800/50 flex items-center px-4 overflow-hidden">
        <Activity className="w-3 h-3 text-slate-600 shrink-0 mr-2" />
        <div className="flex-1 overflow-hidden relative">
          {events.length > 0 ? (
            <div className="flex items-center gap-6 whitespace-nowrap" style={{ animation: events.length > 3 ? `ticker ${events.length * 4}s linear infinite` : undefined }}>
              {[...events, ...(events.length > 3 ? events : [])].map((evt, i) => (
                <span key={`${evt.id}-${i}`} className="flex items-center gap-1.5 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: EVENT_COLORS[evt.type] || '#64748b' }} />
                  <span className="text-slate-500">{evt.type}</span>
                  <span className="text-slate-400">{evt.message.slice(0, 60)}</span>
                </span>
              ))}
            </div>
          ) : podMovements.length > 0 ? (
            <div className="flex items-center gap-6 text-xs text-slate-500">
              {podMovements.slice(0, 5).map((mv, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: MOVEMENT_COLORS[mv.toPhase] || '#64748b' }} />
                  <span>{mv.podName.slice(0, 25)}</span>
                  <span className="text-slate-600">→ {mv.toPhase}</span>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-slate-600">No recent activity</span>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 ml-4 shrink-0 text-xs text-slate-600">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />OK</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Warn</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />Crit</span>
        </div>
      </div>
    </div>
  );
}
