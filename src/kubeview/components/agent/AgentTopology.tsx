/**
 * AgentTopology — inline topology graph rendered from agent tool output.
 *
 * Perspective pills fetch directly from /topology REST endpoint and swap in-place.
 * No LLM call — instant perspective switching.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Network, Plus, Loader2 } from 'lucide-react';
import type { TopologySpec, ComponentSpec, LayoutHint } from '../../engine/agentComponents';
import GraphRenderer, { getKindColor } from '../topology/GraphRenderer';
import { PromptPill } from './AIBranding';

const AGENT_BASE = '/api/agent';

interface PerspectiveDef {
  label: string;
  kinds: string;
  relationships: string;
  layout_hint: LayoutHint;
  include_metrics: boolean;
  group_by: string;
}

const PERSPECTIVES: PerspectiveDef[] = [
  { label: 'Physical', kinds: 'Node,Pod', relationships: 'schedules', layout_hint: 'grouped', include_metrics: true, group_by: 'node' },
  { label: 'Logical', kinds: 'Deployment,ReplicaSet,Pod,ConfigMap,Secret,PVC,ServiceAccount,HPA', relationships: 'owns,references,mounts,uses,scales', layout_hint: 'top-down', include_metrics: false, group_by: '' },
  { label: 'Network', kinds: 'Route,Ingress,Service,Pod,NetworkPolicy', relationships: 'routes_to,selects,applies_to', layout_hint: 'left-to-right', include_metrics: false, group_by: '' },
  { label: 'Multi-Tenant', kinds: 'Pod,Node', relationships: 'schedules', layout_hint: 'grouped', include_metrics: true, group_by: 'namespace' },
  { label: 'Helm', kinds: 'HelmRelease,Deployment,StatefulSet,Service,ConfigMap,Secret', relationships: 'manages,owns', layout_hint: 'grouped', include_metrics: false, group_by: '' },
];

export default function AgentTopology({ spec: initialSpec, onAddToView }: { spec: TopologySpec; onAddToView?: (spec: ComponentSpec) => void }) {
  const [currentSpec, setCurrentSpec] = useState<TopologySpec>(initialSpec);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePerspective, setActivePerspective] = useState<string | null>(null);
  const abortRef = useRef<AbortController>(null);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const spec = currentSpec;

  const healthCounts = useMemo(() => {
    const c = { healthy: 0, warning: 0, error: 0 };
    for (const n of spec.nodes) {
      if (n.status === 'error') c.error++;
      else if (n.status === 'warning') c.warning++;
      else c.healthy++;
    }
    return c;
  }, [spec.nodes]);

  const fetchPerspective = useCallback(async (p: PerspectiveDef) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);

    const ns = initialSpec.nodes.find(n => n.namespace)?.namespace || '';
    const params = new URLSearchParams();
    if (ns) params.set('namespace', ns);
    params.set('kinds', p.kinds);
    params.set('relationships', p.relationships);
    params.set('layout_hint', p.layout_hint);
    if (p.include_metrics) params.set('include_metrics', 'true');
    if (p.group_by) params.set('group_by', p.group_by);

    setLoading(true);
    setError(null);
    setSelectedNode(null);
    try {
      const res = await fetch(`${AGENT_BASE}/topology?${params.toString()}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        setError(`Failed to load perspective (${res.status})`);
        return;
      }
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      if (!data.nodes || data.nodes.length === 0) {
        setError('No resources found for this perspective');
        return;
      }
      setCurrentSpec(data as TopologySpec);
      setActivePerspective(p.label);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError('Request timed out or failed');
      }
    } finally {
      setLoading(false);
    }
  }, [initialSpec.nodes]);

  const resetToOriginal = useCallback(() => {
    abortRef.current?.abort();
    setCurrentSpec(initialSpec);
    setActivePerspective(null);
    setError(null);
    setSelectedNode(null);
  }, [initialSpec]);

  if (spec.nodes.length === 0 && !loading) {
    return (
      <div className="my-2 border border-slate-700 rounded-lg p-6 text-center text-xs text-slate-500">
        No topology data available
      </div>
    );
  }

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0">
      {/* Header */}
      <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
          <Network className="w-3.5 h-3.5 text-cyan-400" />
          <span>{spec.title || 'Resource Topology'}</span>
          {spec.description && <span className="text-[11px] text-slate-500 ml-1">{spec.description}</span>}
          {loading && <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span>{spec.nodes.length} resources</span>
          <span>{spec.edges.length} relationships</span>
          {healthCounts.error > 0 && <span className="text-red-400">{healthCounts.error} errors</span>}
          {healthCounts.warning > 0 && <span className="text-yellow-400">{healthCounts.warning} warnings</span>}
          {onAddToView && (
            <button
              onClick={() => onAddToView(spec)}
              className="p-0.5 text-slate-500 hover:text-emerald-400 hover:bg-slate-800 rounded transition-colors"
              title="Add to View"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="px-3 py-1 border-b border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {[...new Set(spec.nodes.map(n => n.kind))].sort().map((kind) => (
          <div key={kind} className="flex items-center gap-1 text-[11px] text-slate-500">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getKindColor(kind) }} />
            {kind}
          </div>
        ))}
      </div>

      {/* Perspective pills */}
      <div className="px-3 py-1.5 border-b border-slate-800 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-600 mr-1">View:</span>
        {activePerspective && (
          <PromptPill onClick={resetToOriginal} className="opacity-60">
            Original
          </PromptPill>
        )}
        {PERSPECTIVES.map((p) => (
          <PromptPill
            key={p.label}
            onClick={() => fetchPerspective(p)}
            className={activePerspective === p.label ? 'ring-1 ring-violet-500/50 bg-violet-500/10' : ''}
          >
            {p.label}
          </PromptPill>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300 ml-2">dismiss</button>
        </div>
      )}

      {/* Graph */}
      <div className={cn('flex', selectedNode ? 'gap-0' : '')}>
        <div className={cn('min-w-0', selectedNode ? 'flex-1' : 'w-full')}>
          <GraphRenderer
            nodes={spec.nodes}
            edges={spec.edges}
            hoveredNode={hoveredNode}
            setHoveredNode={setHoveredNode}
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
            layoutHint={spec.layout_hint}
            includeMetrics={spec.include_metrics}
          />
        </div>

        {/* Inline detail */}
        {selectedNode && (() => {
          const node = spec.nodes.find(n => n.id === selectedNode);
          if (!node) return null;
          const upstream = spec.edges.filter(e => e.target === selectedNode).map(e => {
            const n = spec.nodes.find(n2 => n2.id === e.source);
            return n ? { ...n, rel: e.relationship } : null;
          }).filter(Boolean);
          const downstream = spec.edges.filter(e => e.source === selectedNode).map(e => {
            const n = spec.nodes.find(n2 => n2.id === e.target);
            return n ? { ...n, rel: e.relationship } : null;
          }).filter(Boolean);

          return (
            <div className="w-56 shrink-0 border-l border-slate-800 p-3 text-xs overflow-y-auto max-h-[400px]">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getKindColor(node.kind) }} />
                <span className="font-semibold text-slate-200 truncate">{node.kind}/{node.name}</span>
              </div>
              {node.namespace && (
                <span className="text-[11px] px-1 py-0.5 bg-slate-800 text-slate-400 rounded mb-2 inline-block">{node.namespace}</span>
              )}

              {node.metrics && (
                <div className="mt-2 text-[11px] text-slate-400 space-y-0.5">
                  <div>CPU: {node.metrics.cpu_usage}/{node.metrics.cpu_capacity} ({node.metrics.cpu_percent}%)</div>
                  <div>Memory: {node.metrics.memory_usage}/{node.metrics.memory_capacity} ({node.metrics.memory_percent}%)</div>
                </div>
              )}

              {upstream.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Upstream</div>
                  {upstream.map((n: any) => (
                    <div key={n.id} className="flex items-center gap-1 text-slate-400 mb-0.5 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: getKindColor(n.kind) }} />
                      <span className="truncate">{n.kind}/{n.name}</span>
                      <span className="text-slate-600 text-[10px]">({n.rel})</span>
                    </div>
                  ))}
                </div>
              )}

              {downstream.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Downstream</div>
                  {downstream.map((n: any) => (
                    <div key={n.id} className="flex items-center gap-1 text-slate-400 mb-0.5 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: getKindColor(n.kind) }} />
                      <span className="truncate">{n.kind}/{n.name}</span>
                      <span className="text-slate-600 text-[10px]">({n.rel})</span>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setSelectedNode(null)}
                className="mt-3 text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                Close
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
