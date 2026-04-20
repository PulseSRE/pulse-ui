/**
 * AgentTopology — inline topology graph rendered from agent tool output.
 *
 * Reuses the GraphRenderer from the topology view, scoped to the nodes/edges
 * returned by the agent tool (e.g. get_topology_graph).
 * Includes perspective quick-launch pills for one-click view switching.
 */

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Network, Plus } from 'lucide-react';
import type { TopologySpec, ComponentSpec } from '../../engine/agentComponents';
import GraphRenderer, { getKindColor } from '../topology/GraphRenderer';
import { PromptPill } from './AIBranding';
import { useAgentStore } from '../../store/agentStore';

const PERSPECTIVES = [
  { label: 'Physical', prompt: 'Show physical topology with hardware metrics' },
  { label: 'Logical', prompt: 'Show logical app structure topology' },
  { label: 'Network', prompt: 'Show network flow topology' },
  { label: 'Multi-Tenant', prompt: 'Show multi-tenant topology grouped by namespace' },
  { label: 'Helm', prompt: 'Show Helm release topology' },
] as const;

export default function AgentTopology({ spec, onAddToView }: { spec: TopologySpec; onAddToView?: (spec: ComponentSpec) => void }) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const sendMessage = useAgentStore((s) => s.sendMessage);

  const healthCounts = useMemo(() => {
    const c = { healthy: 0, warning: 0, error: 0 };
    for (const n of spec.nodes) {
      if (n.status === 'error') c.error++;
      else if (n.status === 'warning') c.warning++;
      else c.healthy++;
    }
    return c;
  }, [spec.nodes]);

  if (spec.nodes.length === 0) {
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
          {spec.description && <span className="text-[10px] text-slate-500 ml-1">{spec.description}</span>}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
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
          <div key={kind} className="flex items-center gap-1 text-[10px] text-slate-500">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getKindColor(kind) }} />
            {kind}
          </div>
        ))}
      </div>

      {/* Perspective pills */}
      <div className="px-3 py-1.5 border-b border-slate-800 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-slate-600 mr-1">View:</span>
        {PERSPECTIVES.map((p) => {
          const ns = spec.nodes[0]?.namespace;
          const prompt = ns ? `${p.prompt} for namespace ${ns}` : p.prompt;
          return (
            <PromptPill key={p.label} onClick={() => sendMessage(prompt)}>
              {p.label}
            </PromptPill>
          );
        })}
      </div>

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
                <span className="text-[10px] px-1 py-0.5 bg-slate-800 text-slate-400 rounded mb-2 inline-block">{node.namespace}</span>
              )}

              {/* Metrics detail */}
              {node.metrics && (
                <div className="mt-2 text-[10px] text-slate-400 space-y-0.5">
                  <div>CPU: {node.metrics.cpu_usage}/{node.metrics.cpu_capacity} ({node.metrics.cpu_percent}%)</div>
                  <div>Memory: {node.metrics.memory_usage}/{node.metrics.memory_capacity} ({node.metrics.memory_percent}%)</div>
                </div>
              )}

              {upstream.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Upstream</div>
                  {upstream.map((n: any) => (
                    <div key={n.id} className="flex items-center gap-1 text-slate-400 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: getKindColor(n.kind) }} />
                      <span className="truncate">{n.kind}/{n.name}</span>
                      <span className="text-slate-600 text-[9px]">({n.rel})</span>
                    </div>
                  ))}
                </div>
              )}

              {downstream.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Downstream</div>
                  {downstream.map((n: any) => (
                    <div key={n.id} className="flex items-center gap-1 text-slate-400 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: getKindColor(n.kind) }} />
                      <span className="truncate">{n.kind}/{n.name}</span>
                      <span className="text-slate-600 text-[9px]">({n.rel})</span>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setSelectedNode(null)}
                className="mt-3 text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
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
